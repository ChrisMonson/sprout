// The models this Claude account can use, straight from the Claude CLI, so
// new models show up without a Sprout update. Cached; refreshed on demand.

import { query, type ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { agentEnv } from './credentials.ts';
import { claudeExecutable } from '../platform.ts';
import { FALLBACK, type Step, type StepModel } from '../settings.ts';

export interface ModelChoice {
  /** What to store and pass to Claude: a family alias or an exact id. */
  value: string;
  displayName: string;
  description: string;
  /** The exact model this currently runs. */
  resolvedModel: string;
  /** True for a family (opus, sonnet…) that moves to new versions by itself. */
  followsLatest: boolean;
  efforts: string[];
}

const TTL_MS = 30 * 60_000;
let cached: { at: number; models: ModelChoice[] } | null = null;

export function toChoices(models: ModelInfo[]): ModelChoice[] {
  return models
    .filter(m => m.value !== 'default')
    .map(m => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
      resolvedModel: m.resolvedModel ?? m.value,
      followsLatest: !m.value.startsWith('claude-'),
      efforts: m.supportedEffortLevels ?? [],
    }));
}

export async function listModels(refresh = false): Promise<ModelChoice[]> {
  if (!refresh && cached && Date.now() - cached.at < TTL_MS) return cached.models;
  async function* idle() { await new Promise(() => {}); }
  const q = query({
    prompt: idle(),
    options: { settingSources: [], persistSession: false, tools: [], env: agentEnv(), pathToClaudeCodeExecutable: claudeExecutable() },
  });
  try {
    const models = toChoices(await q.supportedModels());
    cached = { at: Date.now(), models };
    return models;
  } finally {
    q.close();
  }
}

/** The models list if it has been fetched, without waiting for Claude. */
export function knownModels(): ModelChoice[] {
  return cached?.models ?? [];
}

/**
 * The model and effort a step should run with. A pinned model that this
 * account no longer offers falls back to the step's family; an effort the
 * model doesn't support is dropped.
 */
export function resolveStep(step: Step, chosen: StepModel, available = knownModels()): { model: string; effort: string | undefined; fellBack: boolean } {
  if (!available.length) return { model: chosen.model, effort: chosen.effort ?? undefined, fellBack: false };
  const match = available.find(m => m.value === chosen.model || m.resolvedModel === chosen.model);
  const model = match ?? available.find(m => m.value === FALLBACK[step]);
  const value = model?.value ?? FALLBACK[step];
  const effort = chosen.effort && model?.efforts.includes(chosen.effort) ? chosen.effort : undefined;
  return { model: value, effort, fellBack: !match };
}
