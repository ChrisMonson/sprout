// Greenhouse-wide settings: whether Sprout uses Claude at all, which model
// (and effort) each step uses, and how many agents may work at once.
//
// Models are stored as whatever the Claude CLI lists: a family alias such as
// "opus" follows the newest version automatically, an exact id stays pinned.

import type { Db } from './db.ts';

export type Step = 'questions' | 'plant' | 'grow' | 'observe';
export const STEPS: Step[] = ['questions', 'plant', 'grow', 'observe'];

export interface StepModel { model: string; effort: string | null }

export type SignIn = 'claude-code' | 'api-key';
export const SIGN_INS: SignIn[] = ['claude-code', 'api-key'];

export type Appearance = 'system' | 'light' | 'dark';
export const APPEARANCES: Appearance[] = ['system', 'light', 'dark'];

export interface Settings {
  /** The greenhouse's own screens; each sprout keeps the feel it was planted with. */
  appearance: Appearance;
  /**
   * signIn: Claude Code's sign-in (your Claude plan), or an Anthropic API key
   * (pay per use) kept in the keychain; keyHint is its last four characters.
   */
  claude: { enabled: boolean; signIn: SignIn; keyHint: string | null };
  models: Record<Step, StepModel>;
  concurrency: number;
}

/** Presets are made of families, so they stay current as new models ship. */
export const PRESETS: Record<string, { label: string; blurb: string; models: Record<Step, StepModel> }> = {
  balanced: {
    label: 'Balanced',
    blurb: 'The strongest model builds; a fast one asks and watches.',
    models: { questions: { model: 'haiku', effort: null }, plant: { model: 'opus', effort: 'high' }, grow: { model: 'opus', effort: 'high' }, observe: { model: 'haiku', effort: 'medium' } },
  },
  thorough: {
    label: 'Thorough',
    blurb: 'More care everywhere. Uses your plan’s limits faster.',
    models: { questions: { model: 'sonnet', effort: null }, plant: { model: 'opus', effort: 'xhigh' }, grow: { model: 'opus', effort: 'xhigh' }, observe: { model: 'sonnet', effort: 'medium' } },
  },
  light: {
    label: 'Light',
    blurb: 'Lighter models throughout. Goes further on a smaller plan.',
    models: { questions: { model: 'haiku', effort: null }, plant: { model: 'sonnet', effort: 'high' }, grow: { model: 'sonnet', effort: 'medium' }, observe: { model: 'haiku', effort: 'low' } },
  },
};

export const DEFAULTS: Settings = {
  appearance: 'system',
  claude: { enabled: true, signIn: 'claude-code', keyHint: null },
  models: PRESETS.balanced.models,
  concurrency: Number(process.env.SPROUT_CONCURRENCY ?? 1),
};

/** The family a step falls back to when its chosen model is no longer offered. */
export const FALLBACK: Record<Step, string> = { questions: 'haiku', plant: 'opus', grow: 'opus', observe: 'haiku' };

let cache: Settings | null = null;

export function getSettings(db: Db): Settings {
  if (cache) return cache;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'greenhouse'").get() as { value: string } | undefined;
  const saved = row ? JSON.parse(row.value) as Partial<Settings> : {};
  cache = {
    appearance: APPEARANCES.includes(saved.appearance as Appearance) ? saved.appearance as Appearance : DEFAULTS.appearance,
    claude: { ...DEFAULTS.claude, ...saved.claude },
    models: Object.fromEntries(STEPS.map(s => [s, { ...DEFAULTS.models[s], ...saved.models?.[s] }])) as Record<Step, StepModel>,
    concurrency: saved.concurrency ?? DEFAULTS.concurrency,
  };
  return cache;
}

export function updateSettings(db: Db, patch: { appearance?: Appearance; claude?: Partial<Settings['claude']>; models?: Partial<Record<Step, Partial<StepModel>>>; concurrency?: number }): Settings {
  const current = getSettings(db);
  if (patch.appearance !== undefined && !APPEARANCES.includes(patch.appearance)) throw new Error('Appearance must be system, light or dark.');
  if (patch.claude?.signIn !== undefined && !SIGN_INS.includes(patch.claude.signIn)) throw new Error('Sign in with your Claude account or an API key.');
  const next: Settings = {
    appearance: patch.appearance ?? current.appearance,
    claude: { ...current.claude, ...patch.claude },
    models: Object.fromEntries(STEPS.map(s => [s, { ...current.models[s], ...patch.models?.[s] }])) as Record<Step, StepModel>,
    concurrency: Math.min(4, Math.max(1, Math.round(patch.concurrency ?? current.concurrency))),
  };
  for (const s of STEPS) {
    if (typeof next.models[s].model !== 'string' || !next.models[s].model.trim()) throw new Error(`Choose a model for ${s}.`);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('greenhouse', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  cache = next;
  return next;
}

export function claudeEnabled(db: Db): boolean {
  return getSettings(db).claude.enabled;
}

/** Test seam: forget the cached settings. */
export function resetSettingsCache() {
  cache = null;
}
