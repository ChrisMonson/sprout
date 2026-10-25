// The one place that decides how Sprout signs in to Claude.
//
// v1 is for personal use: the agent runs on the Claude subscription you are
// already signed in to with `claude`. Anthropic's terms do not allow a
// third-party app to route other people's Pro/Max credentials, so before
// Sprout is shared, add an API-key path here (each user brings their own key).

import { execFile } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { claudeExecutable } from '../platform.ts';
import { runtimePath } from '../runtime.ts';

const PASS_THROUGH = ['HOME', 'PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'CLAUDE_CODE_OAUTH_TOKEN'];

/** The environment an agent process gets: nothing from a parent Claude session leaks in. */
export function agentEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASS_THROUGH) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  if (process.env.SPROUT_ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.SPROUT_ANTHROPIC_API_KEY;
  env.PATH = runtimePath();
  return { ...env, ...extra };
}

/** Sprout uses Claude Code's sign-in (the `claude` command), which the Claude app doesn't share. */
const SIGNED_OUT = 'Sprout uses Claude Code’s sign-in, and it has expired or isn’t set up.';

export interface CredentialStatus { ok: boolean; message: string; checkedAt: number; signedOut?: boolean }

export async function checkCredentials(): Promise<CredentialStatus> {
  const checkedAt = Date.now();
  try {
    const q = query({
      prompt: 'Reply with exactly: OK',
      options: {
        model: 'claude-haiku-5-5',
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        maxTurns: 1,
        persistSession: false,
        env: agentEnv(),
        pathToClaudeCodeExecutable: claudeExecutable(),
      },
    });
    for await (const msg of q) {
      if (msg.type === 'assistant' && msg.error) {
        const signedOut = ['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required'].includes(msg.error);
        return { ok: false, checkedAt, signedOut, message: signedOut ? SIGNED_OUT : `Claude is unavailable right now (${msg.error}).` };
      }
      if (msg.type === 'result') {
        return msg.subtype === 'success' && !msg.is_error
          ? { ok: true, checkedAt, message: 'Signed in.' }
          : { ok: false, checkedAt, signedOut: true, message: `Could not reach Claude. ${SIGNED_OUT}` };
      }
    }
    return { ok: false, checkedAt, message: 'Claude did not answer.' };
  } catch (err) {
    return { ok: false, checkedAt, message: `Could not start Claude: ${(err as Error).message}` };
  }
}

/** Opens Terminal on Claude Code's own sign-in (`claude auth login`). */
export function openSignIn() {
  const claude = claudeExecutable();
  const command = `${claude ? `'${claude.replace(/'/g, `'\\''`)}'` : 'claude'} auth login`;
  const script = [`tell application "Terminal" to do script ${JSON.stringify(command)}`, 'tell application "Terminal" to activate'];
  execFile('osascript', script.flatMap(line => ['-e', line]), err => { if (err) console.error('[sign-in]', err.message); });
}
