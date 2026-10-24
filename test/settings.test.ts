import { describe, expect, it, beforeEach } from 'vitest';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { openDb } from '../server/db.ts';
import { getSettings, updateSettings, resetSettingsCache, PRESETS } from '../server/settings.ts';
import { toChoices, resolveStep } from '../server/agent/models.ts';
import { noteOutcome, backoffUntil, BACKOFF_MS } from '../server/scheduler.ts';

const listed: ModelInfo[] = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: '' },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: '', supportedEffortLevels: ['low', 'medium', 'high'] },
  { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: 'Opus 4.8', description: '', supportedEffortLevels: ['low', 'medium', 'high'] },
] as ModelInfo[];

describe('greenhouse settings', () => {
  beforeEach(resetSettingsCache);

  it('starts with Claude on and the Balanced models', () => {
    const s = getSettings(openDb(':memory:'));
    expect(s.claude.enabled).toBe(true);
    expect(s.models).toEqual(PRESETS.balanced.models);
  });

  it('saves partial changes and keeps the rest', () => {
    const db = openDb(':memory:');
    updateSettings(db, { claude: { enabled: false }, models: { grow: { model: 'claude-opus-4-8' } } });
    resetSettingsCache();
    const s = getSettings(db);
    expect(s.claude.enabled).toBe(false);
    expect(s.models.grow).toEqual({ model: 'claude-opus-4-8', effort: 'high' });
    expect(s.models.plant).toEqual(PRESETS.balanced.models.plant);
  });

  it('keeps how many agents work at once between 1 and 4', () => {
    const db = openDb(':memory:');
    expect(updateSettings(db, { concurrency: 9 }).concurrency).toBe(4);
    expect(updateSettings(db, { concurrency: 0 }).concurrency).toBe(1);
  });

  it('follows the system appearance by default, and accepts only system, light or dark', () => {
    const db = openDb(':memory:');
    expect(getSettings(db).appearance).toBe('system');
    expect(updateSettings(db, { appearance: 'dark' }).appearance).toBe('dark');
    expect(() => updateSettings(db, { appearance: 'purple' as 'dark' })).toThrow();
    expect(getSettings(db).appearance).toBe('dark');
  });

  it('refuses an empty model', () => {
    expect(() => updateSettings(openDb(':memory:'), { models: { plant: { model: ' ' } } })).toThrow();
  });
});

describe('models from the Claude CLI', () => {
  const choices = toChoices(listed);

  it('leaves out "default" and tells families from pinned versions', () => {
    expect(choices.map(c => c.value)).toEqual(['opus', 'haiku', 'claude-opus-4-8']);
    expect(choices.find(c => c.value === 'opus')!.followsLatest).toBe(true);
    expect(choices.find(c => c.value === 'claude-opus-4-8')!.followsLatest).toBe(false);
  });

  it('uses the chosen model when it is offered', () => {
    expect(resolveStep('grow', { model: 'claude-opus-4-8', effort: 'high' }, choices)).toEqual({ model: 'claude-opus-4-8', effort: 'high', fellBack: false });
  });

  it('falls back to the family when a pinned version is gone', () => {
    expect(resolveStep('grow', { model: 'claude-opus-3', effort: 'high' }, choices)).toMatchObject({ model: 'opus', fellBack: true });
  });

  it('drops an effort the model does not support', () => {
    expect(resolveStep('observe', { model: 'haiku', effort: 'max' }, choices).effort).toBeUndefined();
  });

  it('uses the choice as-is before the list has been fetched', () => {
    expect(resolveStep('plant', { model: 'opus', effort: 'high' }, [])).toEqual({ model: 'opus', effort: 'high', fellBack: false });
  });
});

describe('retry backoff', () => {
  it('waits longer after each failure, and resets after a success', () => {
    const now = 1_000_000;
    noteOutcome('s1', 'failed', now);
    expect(backoffUntil('s1')).toBe(now + BACKOFF_MS[0]);
    noteOutcome('s1', 'failed', now);
    expect(backoffUntil('s1')).toBe(now + BACKOFF_MS[1]);
    noteOutcome('s1', 'failed', now);
    noteOutcome('s1', 'failed', now);
    expect(backoffUntil('s1')).toBe(now + BACKOFF_MS[2]);
    noteOutcome('s1', 'done', now);
    expect(backoffUntil('s1')).toBe(0);
  });
});
