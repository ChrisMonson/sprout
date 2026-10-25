// Decides when each sprout's agent wakes, runs one turn at a time across the
// greenhouse, and applies finished changes at quiet moments.
// (Port of og-world-supervisor/agent/loop.py + wake.py.)

import { q, type Db, type SproutRow } from './db.ts';
import { bus } from './bus.ts';
import { sproutPaths } from './paths.ts';
import { nextTurn } from './wake.ts';
import { errorsSince, usageEventsSince } from './friction.ts';
import { hasWakeNote, hasRequestNote, appendJournal } from './memory.ts';
import { drawIcon } from './icons.ts';
import { maybeApply, watchdog, commitWork, queueApply, hasPending } from './apply.ts';
import { runGate, formatGate } from './gate.ts';
import { resetWork, ensureDevServer } from './sprouts.ts';
import { dirty } from './git.ts';
import { runTurn, type TurnKind, type TurnOutcome } from './agent/runner.ts';
import { deliverDue } from './notifications.ts';
import { claudeEnabled, getSettings } from './settings.ts';
import { brief, plantOpening, growOpening, observeOpening, collectAsks } from './agent/opening.ts';

const TICK_MS = 3_000;
const MINUTES: Record<TurnKind, number> = { plant: 20, grow: 15, observe: 4 };
/** After a turn fails, wait before trying again: 1 minute, then 5, then 30. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
const failures = new Map<string, { count: number; until: number }>();

export function noteOutcome(sproutId: string, status: string, now = Date.now()) {
  if (status === 'failed') {
    const count = (failures.get(sproutId)?.count ?? 0) + 1;
    failures.set(sproutId, { count, until: now + BACKOFF_MS[Math.min(count, BACKOFF_MS.length) - 1] });
  } else if (status === 'done' || status === 'timeout') {
    failures.delete(sproutId);
  }
}

export function backoffUntil(sproutId: string): number {
  return failures.get(sproutId)?.until ?? 0;
}

const busy = new Set<string>();
const lastGrowAt = new Map<string, number>();
let globalPauseUntil = 0;

export function isBusy(sproutId: string) {
  return busy.has(sproutId);
}

export function startScheduler(db: Db) {
  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try { await tick(db); } catch (err) { console.error('[scheduler]', err); } finally { ticking = false; }
  }, TICK_MS);
  return () => clearInterval(timer);
}

async function tick(db: Db) {
  const now = Date.now();
  deliverDue(db, now);
  for (const row of q.sprouts(db)) {
    if (row.status !== 'ready') continue;
    await maybeApply(db, row.id, now).catch(err => console.error('[apply]', row.id, err));
    await watchdog(db, row.id, now).catch(err => console.error('[watchdog]', row.id, err));
    // With Claude off, nothing wakes an agent; applying and watching go on.
    if (!claudeEnabled(db) || busy.size >= getSettings(db).concurrency) continue;
    const wake = decide(db, row, now);
    if (wake) void growOrObserve(db, row.id, wake.kind, wake.reason);
  }
}

function decide(db: Db, row: SproutRow, now: number) {
  const asks = collectAsks(db, row.id);
  return nextTurn({
    now,
    growing: !!row.growing,
    pausedUntil: Math.max(row.paused_until, globalPauseUntil, backoffUntil(row.id)),
    busy: busy.has(row.id) || hasPending(db, row.id),
    asks: asks.whispers.length + asks.buds.length + asks.answers.length + (hasRequestNote(row.id) ? 1 : 0),
    rollbackNote: hasWakeNote(row.id),
    errorsSinceGrowMark: errorsSince(db, row.id, row.grow_mark),
    lastGrowAt: lastGrowAt.get(row.id) ?? 0,
    eventsSinceObserveMark: usageEventsSince(db, row.id, row.observe_mark),
    lastObserveAt: row.last_observe_at,
  });
}

/** Plant runs right away (the person is watching), outside the wake rules. */
export async function plant(db: Db, sproutId: string) {
  busy.add(sproutId);
  q.update(db, sproutId, { status: 'planting' });
  bus.send({ type: 'sprout', sproutId });
  try {
    await resetWork(sproutId);
    const outcome = await runTurn({
      db, sproutId, kind: 'plant', reason: 'Planting',
      opening: plantOpening(db, sproutId, MINUTES.plant),
      brief: brief('plant'),
      deadlineMs: MINUTES.plant * 60_000,
    });
    await salvage(db, sproutId, outcome, 'First version');
    const planted = (db.prepare("SELECT COUNT(*) AS n FROM turns WHERE sprout_id = ? AND kind = 'plant' AND status = 'done'").get(sproutId) as { n: number }).n > 0
      || hasPending(db, sproutId);
    handleLimits(db, sproutId, outcome);
    q.update(db, sproutId, { status: planted ? 'ready' : 'failed', grow_mark: q.maxEventId(db, sproutId), observe_mark: q.maxEventId(db, sproutId) });
    if (planted) await maybeApply(db, sproutId);
    await ensureDevServer(db, sproutId);
    if (planted) void drawIcon(db, sproutId);
  } catch (err) {
    console.error('[plant]', sproutId, err);
    q.update(db, sproutId, { status: 'failed' });
  } finally {
    busy.delete(sproutId);
    bus.send({ type: 'sprout', sproutId });
  }
}

async function growOrObserve(db: Db, sproutId: string, kind: 'grow' | 'observe', reason: string) {
  busy.add(sproutId);
  bus.send({ type: 'sprout', sproutId });
  const markAtStart = q.maxEventId(db, sproutId);
  const asks = collectAsks(db, sproutId);
  try {
    await resetWork(sproutId);
    let outcome: TurnOutcome;
    if (kind === 'grow') {
      lastGrowAt.set(sproutId, Date.now());
      const ids = asks.whispers.map(w => w.id);
      if (ids.length) db.prepare(`UPDATE whispers SET status = 'taken' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
      outcome = await runTurn({
        db, sproutId, kind, reason,
        opening: growOpening(db, sproutId, MINUTES.grow, reason, asks),
        brief: brief('grow'),
        deadlineMs: MINUTES.grow * 60_000,
      });
      await salvage(db, sproutId, outcome, 'Small fixes');
      const ok = outcome.status === 'done' || outcome.status === 'timeout';
      const settle = (table: string, ids: number[], status: string) => {
        if (ids.length) db.prepare(`UPDATE ${table} SET status = ?, turn_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(status, outcome.turnId, ...ids);
      };
      settle('whispers', ids, ok ? 'done' : 'new');
      if (ok) {
        settle('buds', asks.buds.map(b => b.id), 'grown');
        settle('buds', asks.answers.map(a => a.id), 'used');
        q.update(db, sproutId, { grow_mark: markAtStart });
      }
    } else {
      outcome = await runTurn({
        db, sproutId, kind, reason,
        opening: observeOpening(db, sproutId, MINUTES.observe, reason),
        brief: brief('observe'),
        deadlineMs: MINUTES.observe * 60_000,
      });
      if (outcome.status === 'done' || outcome.status === 'timeout') {
        q.update(db, sproutId, { observe_mark: markAtStart, last_observe_at: Date.now() });
      } else {
        q.update(db, sproutId, { last_observe_at: Date.now() });
      }
    }
    handleLimits(db, sproutId, outcome);
    noteOutcome(sproutId, outcome.status);
  } catch (err) {
    noteOutcome(sproutId, 'failed');
    console.error(`[${kind}]`, sproutId, err);
  } finally {
    busy.delete(sproutId);
    bus.send({ type: 'sprout', sproutId });
  }
}

/**
 * Work left uncommitted when a turn ends is checked once more by the gate;
 * if it passes it is kept, otherwise it is thrown away and noted.
 */
async function salvage(db: Db, sproutId: string, outcome: TurnOutcome, title: string) {
  const work = sproutPaths(sproutId).work;
  if (!(await dirty(work))) return;
  const result = await runGate(sproutId);
  if (result.ok) {
    const commit = await commitWork(sproutId, title, 'Finished at the end of a turn.', outcome.turnId);
    if (commit) queueApply(db, sproutId, { commit, title, detail: 'Finished at the end of a turn.', turnId: outcome.turnId }, title === 'First version');
  } else {
    appendJournal(sproutId, 'greenhouse', `Unsaved changes at the end of turn ${outcome.turnId} did not pass the gate and were discarded:\n${formatGate(result)}`);
  }
}

function handleLimits(db: Db, sproutId: string, outcome: TurnOutcome) {
  if (outcome.status === 'rate_limited') {
    globalPauseUntil = outcome.resetsAt ?? Date.now() + 30 * 60_000;
    bus.send({ type: 'toast', sproutId, text: `Sprout is resting until ${new Date(globalPauseUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (Claude usage limit).` });
  }
  if (outcome.status === 'signed_out') {
    globalPauseUntil = Date.now() + 10 * 365 * 24 * 3600_000;
    bus.send({ type: 'toast', sproutId, text: 'Sprout needs you to sign in to Claude again. Run `claude` and /login, then restart Sprout.' });
  }
}

export function pausedUntil() {
  return globalPauseUntil;
}
