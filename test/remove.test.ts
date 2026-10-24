import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-remove-'));
const { openDb, q } = await import('../server/db.ts');
const { sproutPaths } = await import('../server/paths.ts');
const { removeSprout, restoreSprout, deleteForever, listRemoved } = await import('../server/remove.ts');
const { schedule, upcoming } = await import('../server/notifications.ts');

describe('removing sprouts', () => {
  const db = openDb(':memory:');
  const id = 'stest';
  beforeAll(() => {
    db.prepare("INSERT INTO sprouts (id, name, seed, status, created_at) VALUES (?, 'Test', 'seed', 'ready', 0)").run(id);
    mkdirSync(sproutPaths(id).live, { recursive: true });
    writeFileSync(join(sproutPaths(id).live, 'App.tsx'), 'x');
    db.prepare("INSERT INTO whispers (sprout_id, ts, text) VALUES (?, 0, 'hi')").run(id);
    schedule(db, id, { title: 'Later', at: Date.now() + 60_000 });
  });

  it('refuses while the agent is working on it', () => {
    expect(() => removeSprout(db, id, true)).toThrow();
    expect(q.sprout(db, id)!.status).toBe('ready');
  });

  it('moves it aside, keeps its data and cancels its notifications', () => {
    removeSprout(db, id, false);
    expect(q.sprout(db, id)!.status).toBe('removed');
    expect(existsSync(sproutPaths(id).base)).toBe(false);
    expect(listRemoved(db).map(r => r.id)).toEqual([id]);
    expect(upcoming(db, id)).toHaveLength(0);
  });

  it('brings it back exactly where it was', () => {
    restoreSprout(db, id);
    expect(q.sprout(db, id)!.status).toBe('ready');
    expect(existsSync(join(sproutPaths(id).live, 'App.tsx'))).toBe(true);
    expect(listRemoved(db)).toHaveLength(0);
  });

  it('only deletes forever once removed, and then erases everything', () => {
    expect(() => deleteForever(db, id)).toThrow();
    removeSprout(db, id, false);
    deleteForever(db, id);
    expect(q.sprout(db, id)).toBeUndefined();
    expect((db.prepare('SELECT COUNT(*) AS n FROM whispers WHERE sprout_id = ?').get(id) as { n: number }).n).toBe(0);
    expect(existsSync(join(process.env.SPROUT_HOME!, 'removed', id))).toBe(false);
  });
});
