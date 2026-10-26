// Removing a sprout is reversible: its folder moves aside to SPROUT_HOME/removed
// and it disappears from the list until it's brought back. Only "delete
// forever" erases anything, and only for a sprout that was already removed.

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paths, sproutPaths } from './paths.ts';
import { q, type Db } from './db.ts';
import { bus } from './bus.ts';
import { stopDevServer } from './sprouts.ts';

export interface RemovedSprout { id: string; name: string; seed: string; removedAt: number }

function removedDir(id: string) {
  return join(paths.removed, id);
}

/** @param busy whether an agent turn is running for this sprout right now */
export function removeSprout(db: Db, id: string, busy: boolean) {
  const row = q.sprout(db, id);
  if (!row || row.status === 'removed') throw new Error('No such sprout.');
  if (busy || row.status === 'planting') throw new Error('Sprout is working on this tool right now. Try again once it has finished.');
  stopDevServer(id);
  db.prepare("UPDATE notifications SET status = 'cancelled' WHERE sprout_id = ? AND status = 'scheduled'").run(id);
  const base = sproutPaths(id).base;
  if (existsSync(base)) {
    mkdirSync(paths.removed, { recursive: true });
    renameSync(base, removedDir(id));
  }
  db.prepare('INSERT OR REPLACE INTO removed (sprout_id, removed_at, prev_status) VALUES (?, ?, ?)').run(id, Date.now(), row.status);
  q.update(db, id, { status: 'removed', pending_apply: null, watch: null });
  bus.send({ type: 'sprout', sproutId: id });
}

export function restoreSprout(db: Db, id: string) {
  const entry = db.prepare('SELECT prev_status FROM removed WHERE sprout_id = ?').get(id) as { prev_status: string } | undefined;
  if (!entry) throw new Error('That sprout is not in Removed.');
  const base = sproutPaths(id).base;
  if (existsSync(base)) throw new Error('A sprout is already planted in that spot.');
  // Its git worktrees use absolute paths, so it must go back exactly where it was.
  if (existsSync(removedDir(id))) renameSync(removedDir(id), base);
  const status = entry.prev_status === 'ready' && existsSync(sproutPaths(id).live) ? 'ready' : 'failed';
  db.prepare('DELETE FROM removed WHERE sprout_id = ?').run(id);
  q.update(db, id, { status: status as 'ready' | 'failed', last_activity: Date.now() });
  bus.send({ type: 'sprout', sproutId: id });
}

export function deleteForever(db: Db, id: string) {
  const row = q.sprout(db, id);
  if (row?.status !== 'removed') throw new Error('Remove the sprout first.');
  rmSync(removedDir(id), { recursive: true, force: true });
  rmSync(join(paths.turns, id), { recursive: true, force: true });
  for (const table of ['events', 'whispers', 'buds', 'turns', 'growth', 'notifications', 'uploads']) {
    db.prepare(`DELETE FROM ${table} WHERE sprout_id = ?`).run(id);
  }
  db.prepare('DELETE FROM removed WHERE sprout_id = ?').run(id);
  db.prepare('DELETE FROM sprouts WHERE id = ?').run(id);
  bus.send({ type: 'sprout', sproutId: id });
}

/**
 * Sprouts someone started describing but never planted (they left the Grow
 * page): after a day, forget them and any files they were given.
 */
export function forgetAbandonedSeeds(db: Db, now = Date.now()) {
  const stale = db.prepare("SELECT id FROM sprouts WHERE status = 'seeding' AND created_at < ?").all(now - 24 * 3600_000) as { id: string }[];
  for (const { id } of stale) {
    rmSync(sproutPaths(id).base, { recursive: true, force: true });
    db.prepare('DELETE FROM uploads WHERE sprout_id = ?').run(id);
    db.prepare('DELETE FROM sprouts WHERE id = ?').run(id);
  }
  return stale.length;
}

export function listRemoved(db: Db): RemovedSprout[] {
  return (db.prepare('SELECT s.id, s.name, s.seed, r.removed_at FROM removed r JOIN sprouts s ON s.id = r.sprout_id ORDER BY r.removed_at DESC').all() as { id: string; name: string; seed: string; removed_at: number }[])
    .map(r => ({ id: r.id, name: r.name, seed: r.seed, removedAt: r.removed_at }));
}
