import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-order-'));
const { openDb, q } = await import('../server/db.ts');
const { createSproutRow } = await import('../server/sprouts.ts');

const names = (db: ReturnType<typeof openDb>) => q.sprouts(db).map(s => s.seed);

describe('sprout order', () => {
  it('puts new sprouts first', () => {
    const db = openDb(':memory:');
    for (const seed of ['a', 'b', 'c']) createSproutRow(db, seed);
    expect(names(db)).toEqual(['c', 'b', 'a']);
  });

  it('keeps the order the person arranged, and new sprouts still arrive first', () => {
    const db = openDb(':memory:');
    const [a, b, c] = ['a', 'b', 'c'].map(seed => createSproutRow(db, seed));
    q.reorder(db, [a, c, b]);
    expect(names(db)).toEqual(['a', 'c', 'b']);
    createSproutRow(db, 'd');
    expect(names(db)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('keeps sprouts left out of a reorder after the ones listed', () => {
    const db = openDb(':memory:');
    const [a, b] = ['a', 'b', 'c'].map(seed => createSproutRow(db, seed));
    q.reorder(db, [a, b]);
    expect(names(db)).toEqual(['a', 'b', 'c']);
  });

  it('gives an existing greenhouse its current order (newest first) when upgrading', () => {
    const file = join(process.env.SPROUT_HOME!, 'old.db');
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE sprouts (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', seed TEXT NOT NULL, conversation TEXT NOT NULL DEFAULT '[]', feel TEXT, status TEXT NOT NULL, growing INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_activity INTEGER NOT NULL DEFAULT 0, observe_mark INTEGER NOT NULL DEFAULT 0, grow_mark INTEGER NOT NULL DEFAULT 0, last_observe_at INTEGER NOT NULL DEFAULT 0, paused_until INTEGER NOT NULL DEFAULT 0, pending_apply TEXT, watch TEXT)");
    for (const [id, t] of [['old1', 1], ['old2', 2], ['old3', 3]] as const) old.prepare("INSERT INTO sprouts (id, seed, status, created_at) VALUES (?, ?, 'ready', ?)").run(id, id, t);
    old.close();
    const db = openDb(file);
    expect(names(db)).toEqual(['old3', 'old2', 'old1']);
    db.close();
  });
});
