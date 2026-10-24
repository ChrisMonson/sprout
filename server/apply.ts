// Moving changes from the agent's work copy to the live sprout: commit after
// the gate passes, go live at a quiet moment, watch for trouble, roll back if
// it comes. Rewind is the person's undo. (Port of Og-World's deploy/promote/
// watchdog shape.) Code rolls back; data does not, which is why migrations
// may only add.

import { join } from 'node:path';
import { sproutPaths } from './paths.ts';
import { git, head } from './git.ts';
import { q, type Db } from './db.ts';
import { bus } from './bus.ts';
import { backupDb } from './snapshot.ts';
import { errorsAfter } from './friction.ts';
import { addNote } from './memory.ts';

export const QUIET_MS = 10_000;
export const WATCH_MS = 120_000;
export const WATCH_ERRORS = 3;

interface Checkpoint { commit: string; title: string; detail: string; turnId: number }
interface Pending { checkpoints: Checkpoint[]; urgent: boolean }
interface Watch { since: number; from: string; to: string; growthIds: number[] }

/** Commit the work copy. Returns null when there was nothing to commit. */
export async function commitWork(sproutId: string, title: string, detail: string, turnId: number): Promise<string | null> {
  const p = sproutPaths(sproutId);
  await git(p.work, 'add', '-A');
  const staged = await git(p.work, 'diff', '--cached', '--name-only');
  if (!staged) return null;
  await git(p.work, 'commit', '-q', '-m', `${title}\n\n${detail}\n\nTurn: ${turnId}`);
  return head(p.work);
}

export function queueApply(db: Db, sproutId: string, checkpoint: Checkpoint, urgent: boolean) {
  const row = q.sprout(db, sproutId)!;
  const pending: Pending = row.pending_apply ? JSON.parse(row.pending_apply) : { checkpoints: [], urgent: false };
  pending.checkpoints.push(checkpoint);
  pending.urgent ||= urgent;
  q.update(db, sproutId, { pending_apply: JSON.stringify(pending) });
  bus.send({ type: 'sprout', sproutId });
}

export function hasPending(db: Db, sproutId: string): boolean {
  return !!q.sprout(db, sproutId)?.pending_apply;
}

/** Called by the scheduler. Applies pending changes once the person pauses. */
export async function maybeApply(db: Db, sproutId: string, now = Date.now()): Promise<boolean> {
  const row = q.sprout(db, sproutId);
  if (!row?.pending_apply) return false;
  const pending: Pending = JSON.parse(row.pending_apply);
  if (!pending.urgent && now - row.last_activity < QUIET_MS) return false;
  await applyNow(db, sproutId, pending);
  return true;
}

async function applyNow(db: Db, sproutId: string, pending: Pending) {
  const p = sproutPaths(sproutId);
  const from = await head(p.live);
  const snapshot = join(p.snapshots, `${Date.now()}.db`);
  const saved = await backupDb(p.db, snapshot);
  q.update(db, sproutId, { pending_apply: null });
  try {
    await git(p.live, 'merge', '-q', '--ff-only', 'growing');
  } catch {
    addNote(sproutId, 'A finished change could not go live because the live version changed while you worked (the person probably rewound something). Start again from what is live now.', true);
    bus.send({ type: 'sprout', sproutId });
    return;
  }
  const to = await head(p.live);
  const now = Date.now();
  const insert = db.prepare('INSERT INTO growth (sprout_id, ts, kind, title, detail, commit_sha, snapshot, rewindable, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const plant = !!db.prepare("SELECT 1 FROM turns WHERE id = ? AND kind = 'plant'").get(pending.checkpoints[0].turnId);
  const growthIds = pending.checkpoints.map(c => Number(insert.run(sproutId, now, plant ? 'plant' : 'grow', c.title, c.detail, c.commit, saved ? snapshot : null, plant ? 0 : 1, c.turnId).lastInsertRowid));
  const watch: Watch = { since: now, from, to, growthIds };
  q.update(db, sproutId, { watch: JSON.stringify(watch) });
  bus.send({ type: 'sprout', sproutId });
  if (!plant) {
    const last = pending.checkpoints.at(-1)!;
    bus.send({ type: 'toast', sproutId, text: `${q.sprout(db, sproutId)!.name || 'Your tool'} grew: ${last.title}`, undoGrowthId: growthIds[0] });
  }
}

/** Called by the scheduler while a fresh change is being watched. */
export async function watchdog(db: Db, sproutId: string, now = Date.now()) {
  const row = q.sprout(db, sproutId);
  if (!row?.watch) return;
  const watch: Watch = JSON.parse(row.watch);
  const errors = errorsAfter(db, sproutId, watch.since);
  if (errors >= WATCH_ERRORS) {
    await rollBack(db, sproutId, watch, errors);
  } else if (now - watch.since >= WATCH_MS) {
    await git(sproutPaths(sproutId).live, 'tag', '-f', 'last-known-good', watch.to);
    q.update(db, sproutId, { watch: null });
  }
}

async function rollBack(db: Db, sproutId: string, watch: Watch, errors: number) {
  const p = sproutPaths(sproutId);
  q.update(db, sproutId, { watch: null });
  try {
    await git(p.live, 'revert', '--no-edit', `${watch.from}..${watch.to}`);
  } catch {
    await git(p.live, 'revert', '--abort').catch(() => {});
    await git(p.live, 'reset', '-q', '--hard', watch.from);
  }
  const titles = db.prepare(`SELECT title FROM growth WHERE id IN (${watch.growthIds.map(() => '?').join(',')})`).all(...watch.growthIds) as { title: string }[];
  db.prepare(`UPDATE growth SET rewindable = 0 WHERE id IN (${watch.growthIds.map(() => '?').join(',')})`).run(...watch.growthIds);
  db.prepare('INSERT INTO growth (sprout_id, ts, kind, title, detail, commit_sha) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sproutId, Date.now(), 'rollback', 'Put things back after errors', `"${titles.map(t => t.title).join('", "')}" caused ${errors} errors, so it was rolled back.`, await head(p.live));
  addNote(sproutId, `Your change(s) "${titles.map(t => t.title).join('", "')}" went live and caused ${errors} errors within ${Math.round((Date.now() - watch.since) / 1000)}s, so the greenhouse rolled them back. Look at the errors in signals before trying again.`, true);
  bus.send({ type: 'toast', sproutId, text: 'That change caused problems, so Sprout put things back.' });
  bus.send({ type: 'sprout', sproutId });
}

/** The person's undo: put the code back to how it was before this growth entry. */
export async function rewind(db: Db, sproutId: string, growthId: number) {
  const p = sproutPaths(sproutId);
  const entry = db.prepare('SELECT * FROM growth WHERE id = ? AND sprout_id = ?').get(growthId, sproutId) as { commit_sha: string; title: string; rewindable: number; ts: number } | undefined;
  if (!entry?.rewindable) throw new Error('That change cannot be rewound.');
  q.update(db, sproutId, { watch: null, pending_apply: null });
  try {
    await git(p.live, 'revert', '--no-edit', `${entry.commit_sha}~1..HEAD`);
  } catch (err) {
    await git(p.live, 'revert', '--abort').catch(() => {});
    throw new Error(`Could not rewind: ${(err as Error).message.split('\n')[0]}`);
  }
  db.prepare('UPDATE growth SET rewindable = 0 WHERE sprout_id = ? AND ts >= ?').run(sproutId, entry.ts);
  db.prepare('INSERT INTO growth (sprout_id, ts, kind, title, detail, commit_sha) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sproutId, Date.now(), 'rewind', `Rewound "${entry.title}"`, 'Back to how it was before that change.', await head(p.live));
  addNote(sproutId, `The person rewound "${entry.title}" (and anything after it). Don't bring it back unless they ask.`);
  bus.send({ type: 'sprout', sproutId });
}
