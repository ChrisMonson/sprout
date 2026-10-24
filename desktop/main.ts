// Sprout as a macOS app. The main process owns the window, the menu bar icon
// and notifications; the greenhouse itself runs in a utility process
// (desktop/greenhouse.ts). Closing the window hides it: the greenhouse keeps
// growing sprouts and sending reminders until you quit from the menu bar.

import { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, shell, utilityProcess, type UtilityProcess } from 'electron';
import { createServer } from 'node:net';
import { createWriteStream, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { browserCheck } from './browser-check.ts';
import type { FromGreenhouse, ToGreenhouse } from './messages.ts';
import type { Notice } from '../server/platform.ts';

const resources = app.isPackaged ? process.resourcesPath : app.getAppPath();
const home = process.env.SPROUT_HOME ?? join(homedir(), 'Sprout');
const assets = join(resources, 'desktop', 'assets');

let greenhouse: UtilityProcess | null = null;
let base = '';
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const notices = new Set<Notification>();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start);
}

async function start() {
  const port = await freePort(Number(process.env.SPROUT_PORT ?? 4100));
  mkdirSync(home, { recursive: true });
  const log = createWriteStream(join(home, 'greenhouse.log'), { flags: 'a' });

  greenhouse = utilityProcess.fork(join(import.meta.dirname, 'greenhouse.mjs'), [], {
    serviceName: 'Sprout Greenhouse',
    stdio: 'pipe',
    env: { ...process.env, SPROUT_RESOURCES: resources, SPROUT_PORT: String(port), SPROUT_HOME: home },
  });
  greenhouse.stdout?.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
  greenhouse.stderr?.on('data', chunk => { log.write(chunk); process.stderr.write(chunk); });
  greenhouse.on('message', (msg: FromGreenhouse) => void onMessage(msg));
  greenhouse.on('exit', code => {
    greenhouse = null;
    if (quitting) return;
    dialog.showErrorBox('Sprout stopped', `The greenhouse stopped unexpectedly (code ${code}). Details are in ${join(home, 'greenhouse.log')}.`);
    app.exit(1);
  });
}

async function onMessage(msg: FromGreenhouse) {
  switch (msg.type) {
    case 'ready':
      base = `http://127.0.0.1:${msg.port}`;
      createTray();
      if (!app.getLoginItemSettings().wasOpenedAtLogin) showWindow();
      break;
    case 'fatal':
      quitting = true;
      dialog.showErrorBox(msg.alreadyRunning ? 'Sprout is already running' : 'Sprout couldn’t start', msg.message);
      app.exit(1);
      break;
    case 'notify':
      showNotice(msg.notice);
      break;
    case 'browser-check':
      send({ type: 'browser-check-result', id: msg.id, problems: await browserCheck(msg.url) });
      break;
  }
}

function send(msg: ToGreenhouse) {
  greenhouse?.postMessage(msg);
}

// ---------- the window ----------

function showWindow(route = '') {
  if (!base) return;
  if (!win) {
    win = new BrowserWindow({
      width: 1200, height: 820, minWidth: 720, minHeight: 520,
      title: 'Sprout', backgroundColor: '#F7F8F6', show: false,
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.on('close', event => {
      if (quitting) return;
      event.preventDefault();
      win?.hide();
      app.dock?.hide();
    });
    win.on('closed', () => { win = null; });
    win.once('ready-to-show', () => win?.show());
    void win.loadURL(`${base}/${route}`);
  } else {
    if (route) void win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(route)}`);
    win.show();
  }
  void app.dock?.show();
  win.focus();
}

function openSprout(id: string) {
  showWindow(`#/s/${id}`);
}

app.on('activate', () => showWindow());
app.on('window-all-closed', () => { /* keep running in the menu bar */ });

// ---------- notifications ----------

function showNotice(n: Notice) {
  const note = new Notification({ title: n.app, subtitle: n.body ? n.title : undefined, body: n.body || n.title });
  // Kept referenced until it goes away, or clicks stop arriving.
  notices.add(note);
  note.on('click', () => { notices.delete(note); openSprout(n.sproutId); });
  note.on('close', () => notices.delete(note));
  note.show();
}

// ---------- the menu bar ----------

interface SproutSummary { id: string; name: string; status: string; growing: boolean }

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(join(assets, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Sprout');
  void refreshTray();
  setInterval(() => void refreshTray(), 15_000);
}

async function refreshTray() {
  if (!tray) return;
  let sprouts: SproutSummary[] = [];
  try {
    sprouts = ((await (await fetch(`${base}/api/state`)).json()) as { sprouts: SproutSummary[] }).sprouts;
  } catch { /* the greenhouse may be busy starting */ }
  const ready = sprouts.filter(s => s.status === 'ready');
  const anyGrowing = ready.some(s => s.growing);
  const setGrowing = async (on: boolean) => {
    await Promise.all(ready.map(s => fetch(`${base}/api/sprouts/${s.id}/growing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) })));
    void refreshTray();
  };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Sprout', click: () => showWindow() },
    { type: 'separator' },
    ...(sprouts.length
      ? sprouts.map(s => ({ label: s.name || 'Unnamed sprout', sublabel: s.status === 'ready' ? (s.growing ? 'Growing' : 'Resting') : undefined, click: () => openSprout(s.id) }))
      : [{ label: 'No sprouts yet', enabled: false }]),
    { type: 'separator' },
    ready.length
      ? { label: anyGrowing ? 'Rest all sprouts' : 'Grow all sprouts', click: () => void setGrowing(!anyGrowing) }
      : { label: 'Rest all sprouts', enabled: false },
    {
      label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Quit Sprout', click: () => app.quit() },
  ]));
}

// ---------- quitting ----------

app.on('before-quit', event => {
  if (!greenhouse) return;
  quitting = true;
  event.preventDefault();
  const child = greenhouse;
  child.once('exit', () => app.exit(0));
  send({ type: 'stop' });
  // Give the greenhouse time to stop sprout servers; don't hang forever.
  setTimeout(() => { child.kill(); app.exit(0); }, 8_000);
});

function freePort(from: number): Promise<number> {
  return new Promise(resolve => {
    const tryPort = (port: number) => {
      const srv = createServer();
      srv.once('error', () => tryPort(port + 1));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(port)));
    };
    tryPort(from);
  });
}
