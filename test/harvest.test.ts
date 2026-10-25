import { describe, expect, it, beforeAll } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { checkPortability, hasBackgroundTasks } from '../server/harvest/check.ts';
// @ts-expect-error plain JS shared by the Mac and phone SDKs
import { intervalMs } from '../runtime/harvest/interval.js';
// @ts-expect-error intervalMs isn't part of the SDK's published types
import { intervalMs as macIntervalMs } from '../runtime/sdk/index.js';
// @ts-expect-error plain JS shims that run on the phone
import { openStore, save, store } from '../runtime/harvest/store.js';
// @ts-expect-error plain JS shims that run on the phone
import { DatabaseSync } from '../runtime/harvest/sqlite.js';

describe('can it go on a phone', () => {
  it('the template can', () => {
    expect(checkPortability(join(import.meta.dirname, '..', 'template')).blockers).toEqual([]);
  });

  it('a tool that talks UDP to lights cannot, and says why', () => {
    const root = mkdtempSync(join(tmpdir(), 'sprout-port-'));
    mkdirSync(join(root, 'server'));
    writeFileSync(join(root, 'server', 'artnet.ts'), "import { createSocket } from 'node:dgram';\nimport { DatabaseSync } from 'node:sqlite';\n");
    const { blockers } = checkPortability(root, 'Lighting Console');
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain('node:dgram');
    expect(blockers[0]).toContain('server/artnet.ts');
  });

  it('knows which tools check on a timer, and isn’t fooled by Array.every', () => {
    const root = mkdtempSync(join(tmpdir(), 'sprout-port-'));
    mkdirSync(join(root, 'server'));
    writeFileSync(join(root, 'server', 'api.ts'), 'const ok = [1, 2].every(n => n > 0);\n');
    expect(hasBackgroundTasks(root)).toBe(false);
    writeFileSync(join(root, 'server', 'api.ts'), "every('15m', refresh);\n");
    expect(hasBackgroundTasks(root)).toBe(true);
  });

  it('reads every() intervals the same way on the Mac and the phone', () => {
    for (const read of [intervalMs, macIntervalMs]) {
      expect(read('15m')).toBe(900_000);
      expect(read('1h')).toBe(3_600_000);
      expect(read('30s')).toBe(30_000);
      expect(read(5000)).toBe(5000);
      expect(() => read('soon')).toThrow();
    }
  });

  it('warns about timers that only run while the app is open', () => {
    const root = mkdtempSync(join(tmpdir(), 'sprout-port-'));
    mkdirSync(join(root, 'server'));
    writeFileSync(join(root, 'server', 'api.ts'), 'setInterval(() => {}, 1000);\n');
    expect(checkPortability(root).warnings[0]).toContain('timer');
  });
});

describe('node:sqlite on the phone', () => {
  const saves: Uint8Array[] = [];
  const migrations = {
    '001_init.sql': 'CREATE TABLE songs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, plays INTEGER NOT NULL DEFAULT 0, liked INTEGER);',
    '002_more.sql': 'ALTER TABLE songs ADD COLUMN artist TEXT;',
  };

  beforeAll(async () => {
    const SQL = await initSqlJs();
    openStore({ SQL, migrations, persist: (bytes: Uint8Array) => saves.push(bytes) });
  });

  it('applies migrations once and saves the new database', () => {
    const db = new DatabaseSync('app.db');
    expect(db.prepare('SELECT name FROM _migrations ORDER BY name').all().map((r: { name: string }) => r.name)).toEqual(['001_init.sql', '002_more.sql']);
    expect(saves).toHaveLength(1);
  });

  it('runs, gets and lists like node:sqlite', () => {
    const db = new DatabaseSync('app.db');
    const insert = db.prepare('INSERT INTO songs (name, artist, liked) VALUES (?, ?, ?)');
    expect(insert.run('Wonderwall', 'Oasis', true)).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(insert.run('Creep', undefined, false)).toEqual({ changes: 1, lastInsertRowid: 2 });
    expect(db.prepare('SELECT name, artist, liked FROM songs WHERE id = ?').get(2)).toEqual({ name: 'Creep', artist: null, liked: 0 });
    expect(db.prepare('SELECT * FROM songs WHERE id = 99').get()).toBeUndefined();
    expect(db.prepare('SELECT name FROM songs ORDER BY id').all()).toEqual([{ name: 'Wonderwall' }, { name: 'Creep' }]);
  });

  it('takes named parameters with or without their prefix', () => {
    const db = new DatabaseSync('app.db');
    db.prepare('UPDATE songs SET plays = :plays WHERE name = :name').run({ plays: 3, name: 'Wonderwall' });
    db.prepare('UPDATE songs SET plays = $plays WHERE name = $name').run({ $plays: 5, $name: 'Creep' });
    expect(db.prepare('SELECT plays FROM songs ORDER BY id').all()).toEqual([{ plays: 3 }, { plays: 5 }]);
  });

  it('keeps prepared statements working after a save', () => {
    const db = new DatabaseSync('app.db');
    const count = db.prepare('SELECT COUNT(*) AS n FROM songs');
    db.exec('PRAGMA foreign_keys = ON');
    save();
    expect(count.get()).toEqual({ n: 2 });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('doesn’t save in the middle of a transaction', () => {
    const db = new DatabaseSync('app.db');
    const before = saves.length;
    db.exec('BEGIN');
    db.prepare('INSERT INTO songs (name) VALUES (?)').run('Halfway');
    save();
    expect(saves.length).toBe(before);
    db.exec('COMMIT');
    save();
    expect(saves.length).toBe(before + 1);
    expect(store.dirty).toBe(false);
  });

  it('holds saves during a background run until it says so', () => {
    const db = new DatabaseSync('app.db');
    const before = saves.length;
    store.autoSave = false;
    const timer = store.timer;
    db.prepare('INSERT INTO songs (name) VALUES (?)').run('Quietly');
    expect(store.timer).toBe(timer);
    expect(saves.length).toBe(before);
    expect(store.dirty).toBe(true);
    save();
    expect(saves.length).toBe(before + 1);
    store.autoSave = true;
  });

  it('opens a saved copy without migrating it again', async () => {
    const SQL = await initSqlJs();
    const saved = saves.at(-1);
    openStore({ SQL, saved, migrations, persist: (bytes: Uint8Array) => saves.push(bytes) });
    const db = new DatabaseSync('app.db');
    expect(db.prepare('SELECT COUNT(*) AS n FROM songs').get()).toEqual({ n: 4 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM _migrations').get()).toEqual({ n: 2 });
  });
});
