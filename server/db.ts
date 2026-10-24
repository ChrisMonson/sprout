import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sprouts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  seed TEXT NOT NULL,
  conversation TEXT NOT NULL DEFAULT '[]',
  feel TEXT,
  status TEXT NOT NULL,
  growing INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL DEFAULT 0,
  observe_mark INTEGER NOT NULL DEFAULT 0,
  grow_mark INTEGER NOT NULL DEFAULT 0,
  last_observe_at INTEGER NOT NULL DEFAULT 0,
  paused_until INTEGER NOT NULL DEFAULT 0,
  pending_apply TEXT,
  watch TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprout_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS events_by_sprout ON events (sprout_id, id);
CREATE TABLE IF NOT EXISTS whispers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprout_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  text TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  turn_id INTEGER
);
CREATE TABLE IF NOT EXISTS buds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprout_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'bud',
  text TEXT NOT NULL,
  why TEXT,
  suggestions TEXT,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  turn_id INTEGER
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprout_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,
  model TEXT,
  cli_version TEXT,
  cost_usd REAL,
  num_turns INTEGER,
  summary TEXT,
  transcript TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS growth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprout_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  commit_sha TEXT,
  snapshot TEXT,
  rewindable INTEGER NOT NULL DEFAULT 0,
  turn_id INTEGER
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprout_id TEXT NOT NULL,
  key TEXT,
  title TEXT NOT NULL,
  body TEXT,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_due ON notifications (status, due_at);
CREATE TABLE IF NOT EXISTS removed (
  sprout_id TEXT PRIMARY KEY,
  removed_at INTEGER NOT NULL,
  prev_status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 3000');
  db.exec(SCHEMA);
  return db;
}

export interface SproutRow {
  id: string;
  name: string;
  seed: string;
  conversation: string;
  feel: string | null;
  status: 'seeding' | 'planting' | 'ready' | 'failed' | 'removed';
  growing: number;
  created_at: number;
  last_activity: number;
  observe_mark: number;
  grow_mark: number;
  last_observe_at: number;
  paused_until: number;
  pending_apply: string | null;
  watch: string | null;
}

export interface Turn {
  id: number;
  sprout_id: string;
  kind: string;
  status: string;
}

export const q = {
  sprout(db: Db, id: string) {
    return db.prepare('SELECT * FROM sprouts WHERE id = ?').get(id) as unknown as SproutRow | undefined;
  },
  sprouts(db: Db) {
    return db.prepare('SELECT * FROM sprouts ORDER BY created_at DESC').all() as unknown as SproutRow[];
  },
  update(db: Db, id: string, fields: Partial<SproutRow>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const sql = `UPDATE sprouts SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...keys.map(k => (fields as Record<string, never>)[k]), id);
  },
  maxEventId(db: Db, sproutId: string): number {
    const row = db.prepare('SELECT MAX(id) AS m FROM events WHERE sprout_id = ?').get(sproutId) as { m: number | null };
    return row.m ?? 0;
  },
};
