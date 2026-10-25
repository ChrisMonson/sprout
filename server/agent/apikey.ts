// An Anthropic API key, for people who'd rather pay per use than run Sprout on
// their Claude plan (and the way Sprout can be shared: each person brings
// their own key). It lives in the macOS keychain, never in Sprout's database
// or files; only its last four characters are kept in settings, to show.

import { execFileSync, spawnSync } from 'node:child_process';

const SERVICE = 'Sprout';
const ACCOUNT = 'anthropic-api-key';

let cached: string | null | undefined;

/** Anthropic keys look like sk-ant-… with no spaces. */
export function checkKeyShape(key: string): string {
  const trimmed = key.trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(trimmed)) throw new Error('That doesn’t look like an Anthropic API key. They start with sk-ant- and come from console.anthropic.com.');
  return trimmed;
}

export function readApiKey(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    cached = null;
  }
  return cached;
}

export function saveApiKey(key: string) {
  const value = checkKeyShape(key);
  // Through security's own prompt (-i reads commands on stdin), so the key never
  // shows up in the list of running processes.
  const quoted = `"${value.replace(/(["\\])/g, '\\$1')}"`;
  const result = spawnSync('security', ['-i'], { input: `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -l "Sprout: Anthropic API key" -w ${quoted}\n`, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Sprout couldn’t save the key in your keychain: ${(result.stderr || result.stdout).trim()}`);
  cached = value;
}

export function removeApiKey() {
  spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], { stdio: 'ignore' });
  cached = null;
}

/** For showing which key is saved: its last four characters. */
export const keyHint = (key: string) => key.slice(-4);
