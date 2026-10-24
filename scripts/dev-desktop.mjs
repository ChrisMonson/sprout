// Desktop dev mode: runs the app unpackaged against your real ~/Sprout (unless
// SPROUT_HOME says otherwise), with
//   - the UI served by Vite, so edits to web/ hot-reload in the window
//   - server/ and desktop/ rebuilt on save; the app restarts the greenhouse
//     itself when its bundle changes (main-process changes need a relaunch)
// Quit the installed Sprout first: one greenhouse per Sprout folder.
import { context } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { desktopBuild } from './build.mjs';

const root = join(import.meta.dirname, '..');
const electron = devBundle(createRequire(import.meta.url)('electron'));
let app = null;

/**
 * macOS takes the menu bar name and Dock icon from the app bundle, so running
 * Electron's own bundle shows "Electron". Make a copy named Sprout Dev with
 * Sprout's icon (an APFS clone, so it costs no space) and run that instead.
 * Rebuilt when Electron or the icon changes.
 */
function devBundle(electronBinary) {
  const source = join(dirname(electronBinary), '..', '..');
  const dest = join(root, 'node_modules', '.sprout-dev', 'Sprout Dev.app');
  const icon = join(root, 'desktop', 'assets', 'icon.icns');
  const stamp = join(dirname(dest), 'stamp');
  const version = `${readFileSync(join(source, 'Contents', 'Info.plist'), 'utf8').length}:${readFileSync(icon).length}`;
  if (existsSync(dest) && existsSync(stamp) && readFileSync(stamp, 'utf8') === version) return join(dest, 'Contents', 'MacOS', 'Electron');

  console.log('[dev] Preparing the Sprout Dev app bundle (once)…');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync('cp', ['-cR', source, dest]);
  const plist = join(dest, 'Contents', 'Info.plist');
  for (const [key, value] of [['CFBundleName', 'Sprout Dev'], ['CFBundleDisplayName', 'Sprout Dev'], ['CFBundleIdentifier', 'com.visualsorcery.sprout.dev']]) {
    execFileSync('plutil', ['-replace', key, '-string', value, plist]);
  }
  copyFileSync(icon, join(dest, 'Contents', 'Resources', 'electron.icns'));
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', dest], { stdio: 'ignore' });
  writeFileSync(stamp, version);
  return join(dest, 'Contents', 'MacOS', 'Electron');
}

const ctx = await context({
  ...desktopBuild(root),
  plugins: [{
    name: 'launch',
    setup(b) {
      b.onEnd(result => {
        if (app) {
          console.log(result.errors.length ? '[dev] Build failed; keeping the last good version.' : '[dev] Rebuilt.');
          return;
        }
        if (result.errors.length) return;
        // The first successful build launches the app; later ones it picks up itself.
        app = spawn(electron, ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, SPROUT_DEV: '1' } });
        app.on('exit', async code => {
          await ctx.dispose();
          process.exit(code ?? 0);
        });
      });
    },
  }],
});
await ctx.watch();
