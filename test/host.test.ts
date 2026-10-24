import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'sprout-host-'));
process.env.SPROUT_HOME = join(base, 'home');
process.env.SPROUT_RESOURCES = join(base, 'resources');

const { acquireLock, releaseLock, AlreadyRunning } = await import('../server/lock.ts');
const { agentEnv } = await import('../server/agent/credentials.ts');
const { ensureRuntime } = await import('../server/runtime.ts');
const { paths } = await import('../server/paths.ts');

describe('greenhouse lock', () => {
  const file = join(base, 'greenhouse.lock');

  it('refuses a second greenhouse while the first is alive', () => {
    acquireLock(file, process.pid);
    expect(() => acquireLock(file, process.pid + 1)).toThrow(AlreadyRunning);
  });

  it('takes over a lock left by a process that died', () => {
    writeFileSync(file, '999999');
    expect(() => acquireLock(file, process.pid)).not.toThrow();
  });

  it('only releases its own lock', () => {
    acquireLock(file, process.pid);
    releaseLock(file, process.pid + 1);
    expect(existsSync(file)).toBe(true);
    releaseLock(file, process.pid);
    expect(existsSync(file)).toBe(false);
  });
});

describe('agent environment', () => {
  it('never passes on the app-as-Node switch', () => {
    process.env.ELECTRON_RUN_AS_NODE = '1';
    try {
      expect(agentEnv()).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    } finally {
      delete process.env.ELECTRON_RUN_AS_NODE;
    }
  });
});

describe('prebuilt runtime', () => {
  it('copies the shipped dependencies once, keeping relative links', async () => {
    cpSync(join(import.meta.dirname, '..', 'runtime'), paths.runtimeSource, { recursive: true });
    mkdirSync(join(paths.prebuiltModules, 'vite'), { recursive: true });
    writeFileSync(join(paths.prebuiltModules, 'vite', 'package.json'), '{}');
    mkdirSync(join(paths.prebuiltModules, '@sprout'), { recursive: true });
    symlinkSync('../../.runtime/sdk', join(paths.prebuiltModules, '@sprout', 'greenhouse'));

    await ensureRuntime(() => {});
    const link = join(paths.nodeModules, '@sprout', 'greenhouse');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe('../../.runtime/sdk');
    expect(existsSync(join(link, 'index.js'))).toBe(true);

    writeFileSync(join(paths.nodeModules, 'marker'), '');
    await ensureRuntime(() => {});
    expect(existsSync(join(paths.nodeModules, 'marker'))).toBe(true);
  });
});
