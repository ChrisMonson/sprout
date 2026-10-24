import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkToolUse } from '../server/agent/confine.ts';
import { checkMigrations } from '../server/migrations.ts';
import { nextTurn, type WakeInput, ERROR_GROW_GAP_MS, OBSERVE_GAP_MS } from '../server/wake.ts';

describe('checkToolUse', () => {
  let root: string;
  let live: string;
  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), 'sprout-confine-'));
    root = join(base, 'work');
    live = join(base, 'live');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'migrations'), { recursive: true });
    mkdirSync(join(live, 'migrations'), { recursive: true });
    writeFileSync(join(root, 'src', 'App.tsx'), '');
    writeFileSync(join(live, 'migrations', '001_init.sql'), '');
    writeFileSync(join(root, 'migrations', '001_init.sql'), '');
    writeFileSync(join(base, 'secret.txt'), 'nope');
    symlinkSync(join(base, 'secret.txt'), join(root, 'src', 'link.txt'));
  });

  it('allows files inside the sprout', () => {
    expect(checkToolUse('Read', { file_path: join(root, 'src', 'App.tsx') }, root).ok).toBe(true);
    expect(checkToolUse('Edit', { file_path: 'src/App.tsx' }, root).ok).toBe(true);
    expect(checkToolUse('Glob', { pattern: 'src/**/*.tsx' }, root).ok).toBe(true);
    expect(checkToolUse('Grep', { pattern: 'x' }, root).ok).toBe(true);
  });

  it('rejects climbing out, absolute paths and symlinks that leave', () => {
    expect(checkToolUse('Read', { file_path: '../secret.txt' }, root).ok).toBe(false);
    expect(checkToolUse('Read', { file_path: '/etc/passwd' }, root).ok).toBe(false);
    expect(checkToolUse('Read', { file_path: 'src/link.txt' }, root).ok).toBe(false);
    expect(checkToolUse('Glob', { pattern: '/Users/**/*' }, root).ok).toBe(false);
    expect(checkToolUse('Grep', { pattern: 'x', path: '..' }, root).ok).toBe(false);
  });

  it('rejects .git and node_modules', () => {
    expect(checkToolUse('Read', { file_path: '.git/config' }, root).ok).toBe(false);
    expect(checkToolUse('Write', { file_path: 'node_modules/x.js' }, root).ok).toBe(false);
  });

  it('freezes migrations that are already live, but not new ones', () => {
    expect(checkToolUse('Edit', { file_path: 'migrations/001_init.sql' }, root, live).ok).toBe(false);
    expect(checkToolUse('Write', { file_path: 'migrations/002_feedings.sql' }, root, live).ok).toBe(true);
    expect(checkToolUse('Read', { file_path: 'migrations/001_init.sql' }, root, live).ok).toBe(true);
  });

  it('ignores tools without paths', () => {
    expect(checkToolUse('Bash', { command: 'cat /etc/passwd' }, root).ok).toBe(true);
  });
});

describe('checkMigrations', () => {
  const existing = ['migrations/001_init.sql'];

  it('accepts additive migrations', () => {
    const sql = 'CREATE TABLE feedings (id INTEGER PRIMARY KEY);\nALTER TABLE feedings ADD COLUMN flour TEXT;\nCREATE INDEX f ON feedings(flour);\nINSERT INTO app_meta VALUES (1, 2);';
    expect(checkMigrations([{ status: 'A', path: 'migrations/002_feedings.sql' }], { 'migrations/002_feedings.sql': sql }, existing)).toEqual([]);
  });

  it('ignores forbidden words in comments', () => {
    const sql = '-- we will never DROP anything\nCREATE TABLE x (id INTEGER);';
    expect(checkMigrations([{ status: 'A', path: 'migrations/002_x.sql' }], { 'migrations/002_x.sql': sql }, existing)).toEqual([]);
  });

  it('rejects destructive SQL', () => {
    for (const sql of ['DROP TABLE x;', 'ALTER TABLE x RENAME TO y;', 'DELETE FROM x;', 'UPDATE x SET a = 1;', 'ALTER TABLE x DROP COLUMN a;']) {
      expect(checkMigrations([{ status: 'A', path: 'migrations/002_x.sql' }], { 'migrations/002_x.sql': sql }, existing)).not.toEqual([]);
    }
  });

  it('rejects changing or removing a live migration', () => {
    expect(checkMigrations([{ status: 'M', path: 'migrations/001_init.sql' }], {}, existing)).toHaveLength(1);
    expect(checkMigrations([{ status: 'D', path: 'migrations/001_init.sql' }], {}, existing)).toHaveLength(1);
  });

  it('rejects bad names and old numbers', () => {
    expect(checkMigrations([{ status: 'A', path: 'migrations/feedings.sql' }], { 'migrations/feedings.sql': '' }, existing)).toHaveLength(1);
    expect(checkMigrations([{ status: 'A', path: 'migrations/001_again.sql' }], { 'migrations/001_again.sql': '' }, existing)).toHaveLength(1);
  });

  it('ignores files outside migrations', () => {
    expect(checkMigrations([{ status: 'D', path: 'src/old.tsx' }], {}, existing)).toEqual([]);
  });
});

describe('nextTurn', () => {
  const now = 10_000_000;
  const quiet: WakeInput = {
    now, growing: true, pausedUntil: 0, busy: false, asks: 0, rollbackNote: false,
    errorsSinceGrowMark: 0, lastGrowAt: 0, eventsSinceObserveMark: 0, lastObserveAt: 0,
  };

  it('sleeps when nothing happened', () => {
    expect(nextTurn(quiet)).toBeNull();
  });

  it('grows when asked', () => {
    expect(nextTurn({ ...quiet, asks: 1 })?.kind).toBe('grow');
  });

  it('never wakes when growth is off, paused or busy', () => {
    expect(nextTurn({ ...quiet, asks: 1, growing: false })).toBeNull();
    expect(nextTurn({ ...quiet, asks: 1, pausedUntil: now + 1 })).toBeNull();
    expect(nextTurn({ ...quiet, asks: 1, busy: true })).toBeNull();
  });

  it('grows on errors, but not more often than the error gap', () => {
    expect(nextTurn({ ...quiet, errorsSinceGrowMark: 2, lastGrowAt: now - ERROR_GROW_GAP_MS })?.kind).toBe('grow');
    expect(nextTurn({ ...quiet, errorsSinceGrowMark: 2, lastGrowAt: now - 1000 })).toBeNull();
  });

  it('observes after enough events and enough time', () => {
    expect(nextTurn({ ...quiet, eventsSinceObserveMark: 20, lastObserveAt: now - OBSERVE_GAP_MS })?.kind).toBe('observe');
    expect(nextTurn({ ...quiet, eventsSinceObserveMark: 20, lastObserveAt: now - 1000 })).toBeNull();
    expect(nextTurn({ ...quiet, eventsSinceObserveMark: 3, lastObserveAt: 0 })).toBeNull();
  });

  it('prefers what the person asked for over observing', () => {
    expect(nextTurn({ ...quiet, asks: 1, eventsSinceObserveMark: 50 })?.kind).toBe('grow');
  });
});
