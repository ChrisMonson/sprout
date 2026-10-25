import { describe, expect, it } from 'vitest';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A fresh Mac: an empty Sprout folder, and the app's resources.
const base = mkdtempSync(join(tmpdir(), 'sprout-runtime-'));
process.env.SPROUT_HOME = join(base, 'home');
process.env.SPROUT_RESOURCES = join(base, 'resources');

const { ensureRuntime } = await import('../server/runtime.ts');
const { paths } = await import('../server/paths.ts');

cpSync(join(import.meta.dirname, '..', 'runtime'), paths.runtimeSource, { recursive: true });
const wanted = readFileSync(join(paths.runtimeSource, 'package.json'), 'utf8');
const deps = Object.keys(JSON.parse(wanted).dependencies).filter(dep => dep !== '@sprout/greenhouse');

describe('setting up the runtime on a new Mac', () => {
  it('installs with npm from a package.json it puts in the Sprout folder first', async () => {
    // A stand-in npm that fails, as the real one does, without a package.json to read.
    const bin = join(base, 'bin');
    mkdirSync(bin, { recursive: true });
    const script = [
      '#!/bin/sh',
      '[ -f package.json ] || { echo "Could not read package.json" >&2; exit 1; }',
      ...deps.map(dep => `mkdir -p "node_modules/${dep}" && echo '{}' > "node_modules/${dep}/package.json"`),
      'mkdir -p node_modules/@sprout && ln -sfn ../../.runtime/sdk node_modules/@sprout/greenhouse',
    ].join('\n');
    writeFileSync(join(bin, 'npm'), script);
    chmodSync(join(bin, 'npm'), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      await ensureRuntime(() => {});
    } finally {
      process.env.PATH = path;
    }
    expect(readFileSync(join(paths.home, 'package.json'), 'utf8')).toBe(wanted);
    expect(existsSync(join(paths.nodeModules, 'vite', 'package.json'))).toBe(true);
  });

  it('inside the packaged app, uses the shipped set even without its package.json, and never npm', async () => {
    // Start over with nothing installed.
    rmSync(paths.nodeModules, { recursive: true, force: true });
    rmSync(join(paths.home, 'package.json'), { force: true });
    for (const dep of deps) {
      mkdirSync(join(paths.prebuiltModules, dep), { recursive: true });
      writeFileSync(join(paths.prebuiltModules, dep, 'package.json'), '{}');
    }
    process.env.SPROUT_PACKAGED = '1';
    const path = process.env.PATH;
    process.env.PATH = '/nonexistent'; // no npm anywhere
    try {
      await ensureRuntime(() => {});
    } finally {
      process.env.PATH = path;
      delete process.env.SPROUT_PACKAGED;
    }
    expect(existsSync(join(paths.nodeModules, 'vite', 'package.json'))).toBe(true);
  });
});
