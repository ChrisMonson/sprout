// Sprout as a macOS app. The main process owns the window, the menu bar icon
// and notifications; the greenhouse itself runs in a utility process
// (desktop/greenhouse.ts). Closing the window hides it: the greenhouse keeps
// growing sprouts and sending reminders until you quit from the menu bar.

import { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, nativeTheme, session, shell, utilityProcess, type UtilityProcess } from 'electron';
import { createServer } from 'node:net';
import { createWriteStream, mkdirSync, readFileSync, watch } from 'node:fs';
import { createHash } from 'node:crypto';
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

// The dev app (npm run desktop:dev) is its own app, so it never hands off to
// an installed Sprout. If both use the same Sprout folder, the greenhouse lock
// says so.
if (!app.isPackaged) {
  app.setName('Sprout Dev');
  app.setPath('userData', join(app.getPath('appData'), 'Sprout Dev'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start);
}

let port = 0;
let restarting = false;
const dev = !app.isPackaged && !!process.env.SPROUT_DEV;

async function start() {
  // Exports arrive as downloads: ask where to save them, starting in Downloads.
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: 'Export sprout',
      defaultPath: join(app.getPath('downloads'), item.getFilename()),
      filters: [{ name: 'Sprout', extensions: ['sprout'] }],
    });
  });
  port = await freePort(Number(process.env.SPROUT_PORT ?? 4100));
  mkdirSync(home, { recursive: true });
  spawnGreenhouse();
  if (dev) watchGreenhouse();
}

function spawnGreenhouse() {
  const log = createWriteStream(join(home, 'greenhouse.log'), { flags: 'a' });
  const child = utilityProcess.fork(join(import.meta.dirname, 'greenhouse.mjs'), [], {
    serviceName: 'Sprout Greenhouse',
    stdio: 'pipe',
    env: { ...process.env, SPROUT_RESOURCES: resources, SPROUT_PORT: String(port), SPROUT_HOME: home, SPROUT_PACKAGED: app.isPackaged ? '1' : '' },
  });
  greenhouse = child;
  child.stdout?.on('data', chunk => { log.write(chunk); process.stdout.write(chunk); });
  child.stderr?.on('data', chunk => { log.write(chunk); process.stderr.write(chunk); });
  child.on('message', (msg: FromGreenhouse) => void onMessage(msg));
  child.on('exit', code => {
    if (greenhouse === child) greenhouse = null;
    if (quitting || restarting) return;
    dialog.showErrorBox('Sprout stopped', `The greenhouse stopped unexpectedly (code ${code}). Details are in ${join(home, 'greenhouse.log')}.`);
    app.exit(1);
  });
}

/**
 * Desktop dev mode: when the greenhouse bundle is rebuilt (npm run desktop:dev
 * watches server/ and desktop/), restart just the greenhouse. The window stays
 * open and reloads once the new one is ready. Changes to this file (the main
 * process) still need the app relaunched.
 */
function watchGreenhouse() {
  // Rebuilds can rewrite a bundle without changing it; only react to real changes.
  const onChange = (file: string, then: () => void) => {
    let last = digest(file);
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(file, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const now = digest(file);
        if (now && now !== last) { last = now; then(); }
      }, 300);
    });
  };
  onChange(join(import.meta.dirname, 'greenhouse.mjs'), () => void restartGreenhouse());
  onChange(join(import.meta.dirname, 'main.mjs'), () => console.log('[dev] The app shell changed: quit and run npm run desktop:dev again to use it.'));
}

function digest(file: string): string {
  try { return createHash('sha1').update(readFileSync(file)).digest('hex'); } catch { return ''; }
}

async function restartGreenhouse() {
  if (restarting || quitting) return;
  restarting = true;
  console.log('[dev] Server code changed: restarting the greenhouse…');
  const old = greenhouse;
  if (old) {
    await new Promise<void>(resolve => {
      old.once('exit', () => resolve());
      send({ type: 'stop' });
      setTimeout(() => { old.kill(); resolve(); }, 8_000);
    });
  }
  spawnGreenhouse();
}

async function onMessage(msg: FromGreenhouse) {
  switch (msg.type) {
    case 'ready':
      base = `http://127.0.0.1:${msg.port}`;
      if (restarting) {
        restarting = false;
        win?.webContents.reload();
        console.log('[dev] Greenhouse restarted.');
        break;
      }
      createTray();
      if (!app.getLoginItemSettings().wasOpenedAtLogin) showWindow();
      break;
    case 'fatal':
      quitting = true;
      dialog.showErrorBox(msg.alreadyRunning ? 'Sprout is already running' : 'Sprout couldn’t start', msg.message);
      app.exit(1);
      break;
    case 'notify':
      void showNotice(msg.notice);
      break;
    case 'appearance':
      // Native menus, dialogs and the window follow Greenhouse Settings.
      nativeTheme.themeSource = msg.appearance;
      win?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#121513' : '#F7F8F6');
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
      title: 'Sprout', backgroundColor: nativeTheme.shouldUseDarkColors ? '#121513' : '#F7F8F6', show: false,
      // No title bar: the page runs to the top and the window buttons sit on
      // it. The page marks where the window can be dragged (see .desktop in styles.css).
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 20, y: 25 }, // centred in the 64px sprout header
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
    // A sprout filling the window has a slim 38px bar instead of the 64px
    // header, so the window buttons move up into it there.
    const placeButtons = (url: string) => win?.setWindowButtonPosition(url.includes('/full') ? { x: 14, y: 12 } : { x: 20, y: 25 });
    win.webContents.on('did-navigate-in-page', (_event, url) => placeButtons(url));
    win.webContents.on('did-navigate', (_event, url) => placeButtons(url));
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

/** A sprout's icon as an image for native UI, or undefined if it has none yet. Cached by icon version. */
const icons = new Map<string, Electron.NativeImage>();
async function sproutIcon(id: string, version: number | undefined, points: number): Promise<Electron.NativeImage | undefined> {
  if (version === 0) return undefined;
  const key = `${id}:${version ?? 'latest'}:${points}`;
  if (version !== undefined && icons.has(key)) return icons.get(key);
  try {
    const res = await fetch(`${base}/api/sprouts/${id}/icon.png?size=${points * 2}`);
    if (!res.ok) return undefined;
    const image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()), { scaleFactor: 2 });
    if (version !== undefined) icons.set(key, image);
    return image;
  } catch {
    return undefined;
  }
}

async function showNotice(n: Notice) {
  const icon = await sproutIcon(n.sproutId, undefined, 64);
  const note = new Notification({ title: n.app, subtitle: n.body ? n.title : undefined, body: n.body || n.title, icon });
  // Kept referenced until it goes away, or clicks stop arriving.
  notices.add(note);
  note.on('click', () => { notices.delete(note); openSprout(n.sproutId); });
  note.on('close', () => notices.delete(note));
  note.show();
}

// ---------- the menu bar ----------

interface SproutSummary { id: string; name: string; status: string; growing: boolean; icon?: number }

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
  const menuIcons = await Promise.all(sprouts.map(s => sproutIcon(s.id, s.icon ?? 0, 16)));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Sprout', click: () => showWindow() },
    { type: 'separator' },
    ...(sprouts.length
      ? sprouts.map((s, i) => ({ label: s.name || 'Unnamed sprout', icon: menuIcons[i], sublabel: s.status === 'ready' ? (s.growing ? 'Growing' : 'Resting') : undefined, click: () => openSprout(s.id) }))
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
