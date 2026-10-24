// The one place that decides how Sprout signs in to Claude.
//
// v1 is for personal use: the agent runs on the Claude subscription you are
// already signed in to with `claude`. Anthropic's terms do not allow a
// third-party app to route other people's Pro/Max credentials, so before
// Sprout is shared, add an API-key path here (each user brings their own key).

import { query } from '@anthropic-ai/claude-agent-sdk';

const PASS_THROUGH = ['HOME', 'PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'CLAUDE_CODE_OAUTH_TOKEN'];

/** The environment an agent process gets: nothing from a parent Claude session leaks in. */
export function agentEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASS_THROUGH) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  if (process.env.SPROUT_ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.SPROUT_ANTHROPIC_API_KEY;
  return { ...env, ...extra };
}

export interface CredentialStatus { ok: boolean; message: string; checkedAt: number }

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
      },
    });
    for await (const msg of q) {
      if (msg.type === 'assistant' && msg.error) {
        const signedOut = ['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required'].includes(msg.error);
        return { ok: false, checkedAt, message: signedOut ? 'Sign in to Claude: run `claude` in a terminal and use /login, then restart Sprout.' : `Claude is unavailable right now (${msg.error}).` };
      }
      if (msg.type === 'result') {
        return msg.subtype === 'success' && !msg.is_error
          ? { ok: true, checkedAt, message: 'Signed in.' }
          : { ok: false, checkedAt, message: 'Could not reach Claude. Make sure `claude` is signed in.' };
      }
    }
    return { ok: false, checkedAt, message: 'Claude did not answer.' };
  } catch (err) {
    return { ok: false, checkedAt, message: `Could not start Claude: ${(err as Error).message}` };
  }
}
