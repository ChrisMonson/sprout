// Decides whether a sprout's agent should wake, and for what. Growth is pulled
// by evidence: something the person said, a bud they accepted, or errors.
// Observation is cheap and periodic; it never changes code.

export const OBSERVE_GAP_MS = 5 * 60_000;
export const OBSERVE_MIN_EVENTS = 12;
export const ERROR_GROW_GAP_MS = 10 * 60_000;

export interface WakeInput {
  now: number;
  growing: boolean;
  pausedUntil: number;
  busy: boolean;
  /** whispers, accepted buds and answered questions not yet acted on */
  asks: number;
  /** a rollback the agent hasn't seen yet */
  rollbackNote: boolean;
  errorsSinceGrowMark: number;
  lastGrowAt: number;
  eventsSinceObserveMark: number;
  lastObserveAt: number;
}

/** The reason wording is matched by wakeReason() in web/src/SproutView.tsx. */
export type Wake = { kind: 'grow' | 'observe'; reason: string } | null;

export function nextTurn(w: WakeInput): Wake {
  if (!w.growing || w.busy || w.pausedUntil > w.now) return null;
  if (w.asks > 0) return { kind: 'grow', reason: 'The person asked for something.' };
  if (w.rollbackNote) return { kind: 'grow', reason: 'The last change was rolled back.' };
  if (w.errorsSinceGrowMark > 0 && w.now - w.lastGrowAt >= ERROR_GROW_GAP_MS) {
    return { kind: 'grow', reason: `${w.errorsSinceGrowMark} new error(s).` };
  }
  if (w.eventsSinceObserveMark >= OBSERVE_MIN_EVENTS && w.now - w.lastObserveAt >= OBSERVE_GAP_MS) {
    return { kind: 'observe', reason: `${w.eventsSinceObserveMark} new things happened.` };
  }
  return null;
}
