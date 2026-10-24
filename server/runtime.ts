// Installs the shared sprout runtime into SPROUT_HOME: the dependencies every
// sprout uses (one copy, found by Node's parent-folder lookup) and the
// greenhouse-owned runner, plugin and observer.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { paths, REPO } from './paths.ts';

const run = promisify(execFile);

export async function ensureRuntime(log: (line: string) => void = console.log) {
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(paths.sprouts, { recursive: true });
  mkdirSync(paths.turns, { recursive: true });

  // Greenhouse-owned scripts are refreshed on every start.
  mkdirSync(paths.runtime, { recursive: true });
  for (const file of ['runner.mjs', 'plugin.mjs', 'observer.js']) {
    cpSync(join(paths.runtimeSource, file), join(paths.runtime, file));
  }

  const wanted = readFileSync(join(paths.runtimeSource, 'package.json'), 'utf8');
  const installedPkg = join(paths.home, 'package.json');
  const current = existsSync(installedPkg) ? readFileSync(installedPkg, 'utf8') : '';
  if (wanted !== current || !existsSync(join(paths.nodeModules, 'vite'))) {
    log('Installing the sprout runtime (first run only)…');
    writeFileSync(installedPkg, wanted);
    await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: paths.home, maxBuffer: 32 * 1024 * 1024 });
    log('Sprout runtime ready.');
  }
}

export async function ensureBrowser(log: (line: string) => void = console.log) {
  const { chromium } = await import('playwright');
  if (existsSync(chromium.executablePath())) return;
  log('Installing the test browser used to check each change (first run only)…');
  await run('npx', ['playwright', 'install', 'chromium'], { cwd: REPO, maxBuffer: 32 * 1024 * 1024 });
}
