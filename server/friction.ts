// Turns the raw event log into a short digest an agent can act on: what gets
// used, what goes wrong, and where people struggle. Every list is capped and
// says when it was cut. (Port of the Stuck/Unparsed ideas in Og-World's QueryStore.)

import type { Db } from './db.ts';

interface EventRow { id: number; ts: number; kind: string; target: string | null; detail: string | null }

const ERROR_KINDS = ['error', 'console_error', 'server_error', 'build_error', 'api_error'];
export const isErrorKind = (kind: string) => ERROR_KINDS.includes(kind);

function label(target: string | null): string {
  if (!target) return '(page)';
  try {
    const t = JSON.parse(target) as { sproutId?: string; path?: string; text?: string };
    const name = t.sproutId ? `[data-sprout-id=${t.sproutId}]` : t.path ?? '?';
    return t.text ? `${name} "${t.text.slice(0, 40)}"` : name;
  } catch {
    return target;
  }
}

function top<T>(map: Map<string, T & { count: number }>, n = 10) {
  const all = [...map.values()].sort((a, b) => b.count - a.count);
  return { items: all.slice(0, n), more: Math.max(0, all.length - n) };
}

export function digest(db: Db, sproutId: string, sinceId: number, untilId = Number.MAX_SAFE_INTEGER) {
  const rows = db.prepare('SELECT id, ts, kind, target, detail FROM events WHERE sprout_id = ? AND id > ? AND id <= ? ORDER BY id')
    .all(sproutId, sinceId, untilId) as unknown as EventRow[];

  const counts: Record<string, number> = {};
  const used = new Map<string, { what: string; count: number }>();
  const rage = new Map<string, { what: string; count: number }>();
  const errors = new Map<string, { kind: string; message: string; count: number; last: string }>();
  const pages = new Map<string, { path: string; count: number }>();

  for (const row of rows) {
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    const detail = row.detail ? JSON.parse(row.detail) as Record<string, unknown> : {};
    if (row.kind === 'click' || row.kind === 'input' || row.kind === 'submit') {
      const what = label(row.target);
      const entry = used.get(what) ?? { what, count: 0 };
      entry.count++;
      used.set(what, entry);
    } else if (row.kind === 'rage') {
      const what = label(row.target);
      const entry = rage.get(what) ?? { what, count: 0 };
      entry.count++;
      rage.set(what, entry);
    } else if (row.kind === 'nav') {
      const path = String(detail.path ?? '/');
      const entry = pages.get(path) ?? { path, count: 0 };
      entry.count++;
      pages.set(path, entry);
    } else if (isErrorKind(row.kind)) {
      const message = String(detail.message ?? `${detail.method ?? ''} ${detail.url ?? ''} ${detail.status ?? ''}`).slice(0, 300);
      const key = `${row.kind}:${message}`;
      const entry = errors.get(key) ?? { kind: row.kind, message, count: 0, last: '' };
      entry.count++;
      entry.last = new Date(row.ts).toISOString();
      errors.set(key, entry);
    }
  }

  return {
    events: rows.length,
    firstId: rows[0]?.id ?? null,
    lastId: rows.at(-1)?.id ?? null,
    from: rows[0] ? new Date(rows[0].ts).toISOString() : null,
    to: rows.at(-1) ? new Date(rows.at(-1)!.ts).toISOString() : null,
    counts,
    mostUsed: top(used),
    repeatedClicks: top(rage),
    errors: top(errors),
    pages: top(pages, 5),
  };
}

export function errorsSince(db: Db, sproutId: string, sinceId: number): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE sprout_id = ? AND id > ? AND kind IN (${ERROR_KINDS.map(() => '?').join(',')})`)
    .get(sproutId, sinceId, ...ERROR_KINDS) as { n: number };
  return row.n;
}

export function errorsAfter(db: Db, sproutId: string, sinceTs: number): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE sprout_id = ? AND ts > ? AND kind IN ('error', 'server_error', 'build_error')`)
    .get(sproutId, sinceTs) as { n: number };
  return row.n;
}

export function usageEventsSince(db: Db, sproutId: string, sinceId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM events WHERE sprout_id = ? AND id > ?').get(sproutId, sinceId) as { n: number };
  return row.n;
}
