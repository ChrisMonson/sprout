// Reminders and alerts a sprout sends to its person. Sprouts schedule them
// through the greenhouse (see runtime/sdk), so they arrive even when no tab is
// open: the platform shows them as macOS notifications and, if the sprout is
// on screen, they also appear as an in-app toast.

import { q, type Db } from './db.ts';
import { bus } from './bus.ts';
import { platform } from './platform.ts';

export const MAX_SCHEDULED_PER_SPROUT = 50;
/** Notifications due further in the past than this are dropped, not delivered late. */
export const STALE_MS = 6 * 3600_000;

export interface NotificationRequest { title: string; body?: string; at?: number; key?: string }

export interface NotificationRow {
  id: number; sprout_id: string; key: string | null; title: string; body: string | null;
  due_at: number; status: string; created_at: number; sent_at: number | null;
}

/** Schedule (or replace, when a key is given) a notification. Returns its id. */
export function schedule(db: Db, sproutId: string, req: NotificationRequest, now = Date.now()): number {
  const title = String(req.title ?? '').trim().slice(0, 120);
  if (!title) throw new Error('A notification needs a title.');
  const dueAt = req.at === undefined ? now : Number(req.at);
  if (!Number.isFinite(dueAt)) throw new Error('"at" must be a time.');
  const key = req.key ? String(req.key).slice(0, 80) : null;
  if (key) cancel(db, sproutId, key);
  const open = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE sprout_id = ? AND status = 'scheduled'").get(sproutId) as { n: number };
  if (open.n >= MAX_SCHEDULED_PER_SPROUT) throw new Error(`At most ${MAX_SCHEDULED_PER_SPROUT} notifications can be scheduled at once. Use keys to replace old ones.`);
  return Number(db.prepare('INSERT INTO notifications (sprout_id, key, title, body, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sproutId, key, title, req.body ? String(req.body).slice(0, 300) : null, dueAt, now).lastInsertRowid);
}

export function cancel(db: Db, sproutId: string, key: string): number {
  return Number(db.prepare("UPDATE notifications SET status = 'cancelled' WHERE sprout_id = ? AND key = ? AND status = 'scheduled'").run(sproutId, key).changes);
}

export function cancelById(db: Db, sproutId: string, id: number): number {
  return Number(db.prepare("UPDATE notifications SET status = 'cancelled' WHERE sprout_id = ? AND id = ? AND status = 'scheduled'").run(sproutId, id).changes);
}

export function upcoming(db: Db, sproutId: string): NotificationRow[] {
  return db.prepare("SELECT * FROM notifications WHERE sprout_id = ? AND status = 'scheduled' ORDER BY due_at LIMIT 20").all(sproutId) as unknown as NotificationRow[];
}

/** Notifications that should go out now. Old ones (greenhouse was off) are marked missed instead. */
export function takeDue(db: Db, now = Date.now()): NotificationRow[] {
  db.prepare("UPDATE notifications SET status = 'missed' WHERE status = 'scheduled' AND due_at < ?").run(now - STALE_MS);
  const due = db.prepare("SELECT * FROM notifications WHERE status = 'scheduled' AND due_at <= ? ORDER BY due_at").all(now) as unknown as NotificationRow[];
  const mark = db.prepare("UPDATE notifications SET status = 'sent', sent_at = ? WHERE id = ?");
  for (const n of due) mark.run(now, n.id);
  return due;
}

export function deliverDue(db: Db, now = Date.now()) {
  for (const n of takeDue(db, now)) {
    const name = q.sprout(db, n.sprout_id)?.name || 'Sprout';
    platform().notify({ sproutId: n.sprout_id, app: name, title: n.title, body: n.body ?? '' });
    bus.send({ type: 'notification', sproutId: n.sprout_id, title: n.title, body: n.body ?? '' });
  }
}
