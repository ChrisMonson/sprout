// How much of Claude Sprout (and you) are using. On a Claude plan that's the
// plan's limit windows, account-wide: your own Claude Code and claude.ai use
// count too, and they decide whether Sprout can keep working. With an API key,
// plan limits don't apply; what matters is what Sprout has spent, from the cost
// each turn records.
//
// Plan numbers come from the Agent SDK's /usage data (experimental, so a failure
// just means no meter) and from the rate-limit updates every agent turn gets.

import { query, type SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { Db } from './db.ts';
import { bus } from './bus.ts';
import { agentEnv, signInMethod } from './agent/credentials.ts';
import { claudeExecutable } from './platform.ts';
import { claudeEnabled } from './settings.ts';

export interface Window { percent: number; resetsAt: number | null }
export interface PlanUsage {
  /** The 5-hour session window. */
  session: Window | null;
  week: Window | null;
  /** Weekly windows for particular models (e.g. Opus), when the plan has them. */
  models: (Window & { name: string })[];
  plan: string | null;
  checkedAt: number;
}

export interface Usage {
  signIn: 'claude-code' | 'api-key';
  plan: PlanUsage | null;
  /** What Sprout's agent turns cost (an estimate at list prices; on a plan, notional). */
  spend: { today: number; month: number };
}

let plan: PlanUsage | null = null;
let lastAsked = 0;
let asking: Promise<void> | null = null;

const MIN_GAP_MS = 60_000;

function toWindow(raw: { utilization: number | null; resets_at: string | null } | null | undefined): Window | null {
  if (!raw || raw.utilization === null) return null;
  return { percent: Math.round(raw.utilization), resetsAt: raw.resets_at ? Date.parse(raw.resets_at) : null };
}

/** Ask Claude Code for the plan's windows; at most once a minute unless forced. */
export function refreshPlanUsage(db: Db, force = false): Promise<void> {
  if (!claudeEnabled(db) || signInMethod() !== 'claude-code') {
    plan = null;
    return Promise.resolve();
  }
  if (asking) return asking;
  if (!force && Date.now() - lastAsked < MIN_GAP_MS) return Promise.resolve();
  lastAsked = Date.now();
  asking = (async () => {
    // A session that's never sent a prompt: just enough to ask for /usage.
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    async function* idle() { await held; }
    const session = query({ prompt: idle(), options: { settingSources: [], persistSession: false, tools: [], env: agentEnv(), pathToClaudeCodeExecutable: claudeExecutable() } });
    try {
      const answer = await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      const limits = answer.rate_limits;
      plan = answer.rate_limits_available && limits ? {
        session: toWindow(limits.five_hour),
        week: toWindow(limits.seven_day),
        models: (limits.model_scoped ?? []).flatMap(m => {
          const window = toWindow(m);
          return window ? [{ name: m.display_name, ...window }] : [];
        }),
        plan: answer.subscription_type,
        checkedAt: Date.now(),
      } : null;
      bus.send({ type: 'usage' });
    } catch (err) {
      console.error('[usage]', (err as Error).message.split('\n')[0]);
    } finally {
      release();
      session.close();
      asking = null;
    }
  })();
  return asking;
}

/** A rate-limit update from an agent turn: keep the newest reading between checks. */
export function noteRateLimit(info: SDKRateLimitInfo) {
  if (info.utilization === undefined || !plan) return;
  const percent = Math.round(info.utilization <= 1 ? info.utilization * 100 : info.utilization);
  const resetsAt = info.resetsAt ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : null;
  const window = { percent, resetsAt };
  if (info.rateLimitType === 'five_hour') plan = { ...plan, session: window };
  else if (info.rateLimitType === 'seven_day') plan = { ...plan, week: window };
  else return;
  bus.send({ type: 'usage' });
}

function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function startOfMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

const spentSince = (db: Db, since: number, sproutId?: string) => (db.prepare(
  `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM turns WHERE started_at >= ?${sproutId ? ' AND sprout_id = ?' : ''}`,
).get(...(sproutId ? [since, sproutId] : [since])) as { total: number }).total;

export function usage(db: Db): Usage {
  return {
    signIn: signInMethod(),
    plan: signInMethod() === 'claude-code' ? plan : null,
    spend: { today: spentSince(db, startOfToday()), month: spentSince(db, startOfMonth()) },
  };
}

/** What growing one sprout has cost, all told. */
export const sproutSpend = (db: Db, sproutId: string) => spentSince(db, 0, sproutId);

/** Test seam: set (or forget) the last plan reading. */
export function resetPlanUsage(next: PlanUsage | null = null) {
  plan = next;
  lastAsked = 0;
}
