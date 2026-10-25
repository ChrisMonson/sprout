import { describe, expect, it } from 'vitest';
import { openDb } from '../server/db.ts';
import { noteRateLimit, resetPlanUsage, sproutSpend, usage } from '../server/usage.ts';
import { resetSettingsCache } from '../server/settings.ts';

describe('Claude usage', () => {
  it('adds up what Sprout spent today, this month, and per sprout', () => {
    resetSettingsCache();
    const db = openDb(':memory:');
    const turn = db.prepare("INSERT INTO turns (sprout_id, kind, started_at, status, cost_usd) VALUES (?, 'grow', ?, 'done', ?)");
    const now = Date.now();
    turn.run('a', now, 0.5);
    turn.run('b', now, 0.25);
    turn.run('a', now, null); // a turn that didn't report a cost
    turn.run('a', new Date(new Date().getFullYear() - 1, 0, 1).getTime(), 9); // last year
    const { spend } = usage(db);
    expect(spend.today).toBeCloseTo(0.75);
    expect(spend.month).toBeCloseTo(0.75);
    expect(sproutSpend(db, 'a')).toBeCloseTo(9.5);
  });

  it('keeps the newest session reading from an agent turn, as a percentage with a time in ms', () => {
    resetPlanUsage({ session: { percent: 10, resetsAt: 0 }, week: { percent: 30, resetsAt: 0 }, models: [], plan: 'max', checkedAt: 0 });
    noteRateLimit({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.82, resetsAt: 1_900_000_000 });
    const db = openDb(':memory:');
    const plan = usage(db).plan!;
    expect(plan.session).toEqual({ percent: 82, resetsAt: 1_900_000_000_000 });
    expect(plan.week?.percent).toBe(30);
    resetPlanUsage();
  });

  it('ignores turn updates until the plan has been read once', () => {
    resetPlanUsage();
    noteRateLimit({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.5 });
    expect(usage(openDb(':memory:')).plan).toBeNull();
  });
});
