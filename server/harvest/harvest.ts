// Harvest: turn a sprout into an Android app and put it on a phone or emulator.
// The app is a snapshot. It runs the sprout's own code with its own database
// on the phone, but it doesn't grow and nothing flows back to the Mac.
//
// Each sprout's Android project is kept in ~/Sprout/harvest/<id>, so only the
// first harvest pays for creating it and for Gradle's first download.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { q, type Db } from '../db.ts';
import { bus } from '../bus.ts';
import { paths, RESOURCES, sproutPaths } from '../paths.ts';
import { nodeCommand } from '../platform.ts';
import { runtimePath } from '../runtime.ts';
import { backupDb } from '../snapshot.ts';
import { checkPortability, hasBackgroundTasks } from './check.ts';
import { iconFile, iconPng } from '../icons.ts';
import { androidEnv, androidTools, install } from './android.ts';

const run = promisify(execFile);

export interface HarvestState {
  running: boolean;
  /** What's happening now, or how the last harvest ended. */
  step: string;
  error: string | null;
  /** The last successful build. */
  built: { at: number; withData: boolean; installedOn: string | null } | null;
}

const states = new Map<string, HarvestState>();

export function harvestDir(id: string) {
  return join(paths.harvest, id);
}

export function apkPath(id: string) {
  return join(harvestDir(id), 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
}

export const appIdFor = (id: string) => `com.visualsorcery.sprout.h${id.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;

export function harvestState(id: string): HarvestState {
  const known = states.get(id);
  if (known) return known;
  const file = join(harvestDir(id), 'last.json');
  const built = existsSync(file) && existsSync(apkPath(id)) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  return { running: false, step: '', error: null, built };
}

function set(id: string, patch: Partial<HarvestState>) {
  states.set(id, { ...harvestState(id), ...patch });
  bus.send({ type: 'harvest', sproutId: id });
}

/** Starts a harvest in the background; progress arrives as 'harvest' bus messages. */
export function startHarvest(db: Db, id: string, options: { serial: string | null; includeData: boolean }) {
  const row = q.sprout(db, id);
  if (!row || row.status !== 'ready') throw new Error('Only a planted sprout can be harvested.');
  if (harvestState(id).running) throw new Error('It’s already being harvested.');
  const { blockers } = checkPortability(sproutPaths(id).live, row.name);
  if (blockers.length) throw new Error(blockers.join(' '));
  set(id, { running: true, step: 'Getting ready…', error: null });
  void harvest(db, id, row.name, options)
    .then(built => set(id, { running: false, step: '', built }))
    .catch(err => set(id, { running: false, step: '', error: (err as Error).message }));
}

async function harvest(db: Db, id: string, name: string, { serial, includeData }: { serial: string | null; includeData: boolean }) {
  const tools = await androidTools();
  if ('missing' in tools) throw new Error(tools.missing);
  for (const pkg of ['sql.js', '@capacitor/cli', '@capacitor/android', '@capacitor/local-notifications']) {
    if (!existsSync(join(paths.nodeModules, pkg, 'package.json'))) {
      throw new Error('Sprout is missing parts it needs to make phone apps. Quit and reopen Sprout so it can finish setting up, then try again.');
    }
  }
  const dir = harvestDir(id);
  const web = join(dir, 'web');
  const p = sproutPaths(id);
  mkdirSync(dir, { recursive: true });

  set(id, { step: 'Building the tool for a phone…' });
  const node = nodeCommand();
  await step('The tool didn’t build', run(node.cmd, ['--no-warnings', join(paths.runtime, 'runner.mjs'), '--root', p.live, '--build', web, '--cache', join(p.cache, 'harvest'), '--harvest', '--sprout', id],
    { cwd: paths.home, env: { ...process.env, ...node.env }, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }));

  if (includeData && await backupDb(p.db, join(web, 'sprout-seed.db'))) {
    // sql.js can't open a WAL database; switch the copy back to a plain journal.
    const copy = new DatabaseSync(join(web, 'sprout-seed.db'));
    try { copy.exec('PRAGMA journal_mode = DELETE'); } finally { copy.close(); }
  }

  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sprout-harvest', private: true, dependencies: capacitorDependencies() }, null, 2));
  writeFileSync(join(dir, 'capacitor.config.json'), JSON.stringify({
    appId: appIdFor(id),
    appName: name || 'Sprout',
    webDir: 'web',
    plugins: { CapacitorHttp: { enabled: true } },
  }, null, 2));

  const fresh = !existsSync(join(dir, 'android'));
  set(id, { step: fresh ? 'Setting up the Android app (the first time takes a few minutes)…' : 'Updating the Android app…' });
  const cap = join(paths.nodeModules, '@capacitor', 'cli', 'bin', 'capacitor');
  const env = { ...process.env, ...node.env, ...androidEnv(tools), PATH: runtimePath() };
  try {
    await step('Sprout couldn’t set up the Android app', run(node.cmd, [cap, fresh ? 'add' : 'sync', 'android'], { cwd: dir, env, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 }));
  } catch (err) {
    if (fresh) rmSync(join(dir, 'android'), { recursive: true, force: true });
    throw err;
  }
  await setIcon(join(dir, 'android'), id);
  addBackgroundWork(join(dir, 'android'), appIdFor(id), hasBackgroundTasks(p.live));
  setLabel(join(dir, 'android'), name || 'Sprout');

  set(id, { step: fresh ? 'Building the app (the first time takes a few minutes)…' : 'Building the app…' });
  await step('The Android build failed', run(join(dir, 'android', 'gradlew'), ['assembleDebug', '-q'], { cwd: join(dir, 'android'), env, timeout: 900_000, maxBuffer: 32 * 1024 * 1024 }));

  let installedOn: string | null = null;
  if (serial) {
    set(id, { step: 'Installing it…' });
    await step('Sprout couldn’t install it', install(tools, serial, apkPath(id), appIdFor(id)));
    installedOn = serial;
  }
  const built = { at: Date.now(), withData: includeData, installedOn };
  writeFileSync(join(dir, 'last.json'), JSON.stringify(built));
  return built;
}

/** Runs one step; on failure, explains it with the end of the tool's output. */
async function step<T>(what: string, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    const detail = (e.stderr || e.stdout || e.message).trim().split('\n').slice(-12).join('\n');
    throw new Error(`${what}.\n${detail}`);
  }
}

/** The Capacitor packages the runtime installed, at the versions it installed. */
function capacitorDependencies(): Record<string, string> {
  const wanted = ['@capacitor/android', '@capacitor/core', '@capacitor/local-notifications'];
  return Object.fromEntries(wanted.map(pkg => [pkg, JSON.parse(readFileSync(join(paths.nodeModules, pkg, 'package.json'), 'utf8')).version]));
}

/**
 * The native side of background checks: a WorkManager job that wakes the tool in
 * a hidden web view, plus fetch and notifications for it (runtime/harvest/android).
 */
function addBackgroundWork(android: string, appId: string, wanted: boolean) {
  const source = join(paths.runtime, 'harvest', 'android');
  const target = join(android, 'app', 'src', 'main', 'java', ...appId.split('.'));
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(source).filter(f => f.endsWith('.java'))) {
    const java = readFileSync(join(source, file), 'utf8').replaceAll('__PACKAGE__', appId).replaceAll('__BACKGROUND__', String(wanted));
    writeFileSync(join(target, file), java);
  }
  const gradle = join(android, 'app', 'build.gradle');
  const text = readFileSync(gradle, 'utf8');
  if (!text.includes('androidx.work:work-runtime')) {
    writeFileSync(gradle, text.replace(/dependencies \{/, `dependencies {\n    implementation "androidx.work:work-runtime:${WORK_VERSION}"\n    implementation "androidx.webkit:webkit:$androidxWebkitVersion"`));
  }
}

const WORK_VERSION = '2.10.0';

/** The app's name on the home screen. */
function setLabel(android: string, name: string) {
  const file = join(android, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  if (!existsSync(file)) return;
  const escaped = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'").replace(/"/g, '\\"');
  const xml = readFileSync(file, 'utf8')
    .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${escaped}$2`)
    .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${escaped}$2`);
  writeFileSync(file, xml);
}

/** The sprout's own icon (or Sprout's leaf, if it has none yet) in place of Capacitor's default. */
async function setIcon(android: string, id: string) {
  const source = await iconPng(id, 512).catch(() => null) ?? join(RESOURCES, 'desktop', 'assets', 'icon.png');
  const res = join(android, 'app', 'src', 'main', 'res');
  if (!existsSync(source) || !existsSync(res)) return;
  const icon = iconFile(id);
  const background = (icon && readFileSync(icon, 'utf8').match(/fill=["'](#[0-9a-fA-F]{6})["']/)?.[1]) || '#FFFFFF';
  const sizes: Record<string, number> = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(sizes)) {
    const folder = join(res, `mipmap-${density}`);
    if (!existsSync(folder)) continue;
    // Older Android shows these as they are.
    for (const file of ['ic_launcher.png', 'ic_launcher_round.png']) {
      await run('sips', ['-z', String(size), String(size), source, '--out', join(folder, file)]);
    }
    // Newer Android masks a 108dp layer to the launcher's shape and shows its middle 72dp:
    // the icon fills that middle, so its own background fills the shape.
    const layer = Math.round(size * 108 / 48);
    const middle = Math.round(size * 72 / 48);
    const foreground = join(folder, 'ic_launcher_foreground.png');
    await run('sips', ['-z', String(middle), String(middle), source, '--out', foreground]);
    await run('sips', ['-p', String(layer), String(layer), foreground, '--out', foreground]);
  }
  writeFileSync(join(res, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${background}</color>\n</resources>\n`);
  const adaptive = join(res, 'mipmap-anydpi-v26');
  mkdirSync(adaptive, { recursive: true });
  const xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n';
  for (const file of ['ic_launcher.xml', 'ic_launcher_round.xml']) writeFileSync(join(adaptive, file), xml);
}
