// Installs the shared sprout runtime into SPROUT_HOME: the dependencies every
// sprout uses (one copy, found by Node's parent-folder lookup) and the
// greenhouse-owned runner, plugin and observer.
//
// From a terminal the dependencies come from `npm install`. Inside the app
// they're copied from the prebuilt set shipped with it, so the Mac needs no
// Node or npm, and a `node` shim lets `#!/usr/bin/env node` tools still work.

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { paths, REPO } from './paths.ts';
import { inElectron } from './platform.ts';

const run = promisify(execFile);

export async function ensureRuntime(log: (line: string) => void = console.log) {
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(paths.sprouts, { recursive: true });
  mkdirSync(paths.turns, { recursive: true });

  // Greenhouse-owned scripts are refreshed on every start.
  mkdirSync(paths.runtime, { recursive: true });
  for (const file of ['runner.mjs', 'plugin.mjs', 'observer.js', 'sdk', 'harvest']) {
    cpSync(join(paths.runtimeSource, file), join(paths.runtime, file), { recursive: true });
  }

  const wanted = readFileSync(join(paths.runtimeSource, 'package.json'), 'utf8');
  const installedPkg = join(paths.home, 'package.json');
  const current = existsSync(installedPkg) ? readFileSync(installedPkg, 'utf8') : '';
  const missing = Object.keys(JSON.parse(wanted).dependencies).some(dep => !existsSync(join(paths.nodeModules, dep, 'package.json')));
  if (wanted !== current || missing) {
    // Only a prebuilt set made from this same package.json; an older one (say,
    // left from packaging before a dependency was added) would be missing things.
    const prebuiltPkg = join(paths.prebuiltModules, '..', 'package.json');
    if (existsSync(paths.prebuiltModules) && existsSync(prebuiltPkg) && readFileSync(prebuiltPkg, 'utf8') === wanted) {
      log('Setting up the sprout runtime…');
      rmSync(paths.nodeModules, { recursive: true, force: true });
      // Symlinks stay relative, so @sprout/greenhouse points at this home's .runtime/sdk.
      cpSync(paths.prebuiltModules, paths.nodeModules, { recursive: true, verbatimSymlinks: true });
    } else {
      log('Installing the sprout runtime (first run only)…');
      await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: paths.home, maxBuffer: 32 * 1024 * 1024 });
    }
    writeFileSync(installedPkg, wanted);
    log('Sprout runtime ready.');
  }

  if (inElectron) writeNodeShim();
}

/** A `node` command that runs the app's own binary as Node. */
function writeNodeShim() {
  mkdirSync(paths.shimBin, { recursive: true });
  const shim = join(paths.shimBin, 'node');
  writeFileSync(shim, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${JSON.stringify(process.execPath)} "$@"\n`);
  chmodSync(shim, 0o755);
}

/** PATH for anything the greenhouse starts: inside the app, `node` resolves to the shim. */
export function runtimePath(): string {
  const base = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin';
  return inElectron ? `${paths.shimBin}:${base}` : base;
}

export async function ensureBrowser(log: (line: string) => void = console.log) {
  const { chromium } = await import('playwright');
  if (existsSync(chromium.executablePath())) return;
  log('Installing the test browser used to check each change (first run only)…');
  await run('npx', ['playwright', 'install', 'chromium'], { cwd: REPO, maxBuffer: 32 * 1024 * 1024 });
}

/** True when git works. On a fresh Mac, git needs Apple's Command Line Tools. */
export async function hasGit(): Promise<boolean> {
  try {
    await run('git', ['--version'], { env: { ...process.env, PATH: runtimePath() } });
    return true;
  } catch {
    return false;
  }
}
