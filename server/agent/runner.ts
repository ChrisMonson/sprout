// Runs one agent turn for one sprout: a fresh Claude Code session confined to
// the sprout's work folder, with a hard wall-clock deadline. Everything the
// agent says or does is written to a transcript; the UI gets plain-language
// progress lines. (Port of og-world-supervisor/agent/driver.py.)

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { paths, sproutPaths } from '../paths.ts';
import { bus } from '../bus.ts';
import type { Db } from '../db.ts';
import { agentEnv } from './credentials.ts';
import { claudeExecutable } from '../platform.ts';
import { checkToolUse } from './confine.ts';
import { createSproutTools, type TurnContext } from './tools.ts';

export type TurnKind = 'plant' | 'grow' | 'observe';

export const MODELS = {
  build: 'claude-opus-5-5',
  observe: 'claude-haiku-5-5',
} as const;

export interface TurnSpec {
  db: Db;
  sproutId: string;
  kind: TurnKind;
  reason: string;
  opening: string;
  brief: string;
  deadlineMs: number;
}

export interface TurnOutcome {
  turnId: number;
  status: 'done' | 'failed' | 'timeout' | 'rate_limited' | 'signed_out';
  summary: string;
  checkpoints: number;
  resetsAt?: number;
}

const BUILD_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

/** Inside the app, the agent's `node` shim runs the app's binary, so Bash must be able to read it. */
function appBundle(): string[] {
  if (!process.versions.electron) return [];
  const i = process.execPath.indexOf('.app/');
  return [i >= 0 ? process.execPath.slice(0, i + 4) : dirname(process.execPath)];
}
const LOOK_TOOLS = ['Read', 'Glob', 'Grep'];

export async function runTurn(spec: TurnSpec): Promise<TurnOutcome> {
  const { db, sproutId, kind } = spec;
  const p = sproutPaths(sproutId);
  const canBuild = kind !== 'observe';
  const model = canBuild ? MODELS.build : MODELS.observe;
  const startedAt = Date.now();
  const deadline = startedAt + spec.deadlineMs;

  const turnId = Number(db.prepare('INSERT INTO turns (sprout_id, kind, reason, started_at, status, model) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sproutId, kind, spec.reason, startedAt, 'running', model).lastInsertRowid);
  const dir = join(paths.turns, sproutId);
  mkdirSync(dir, { recursive: true });
  const transcriptPath = join(dir, `${String(turnId).padStart(4, '0')}-${kind}.jsonl`);
  const transcript = createWriteStream(transcriptPath);
  transcript.write(JSON.stringify({ type: 'sprout_turn', kind, reason: spec.reason, model, opening: spec.opening }) + '\n');
  db.prepare('UPDATE turns SET transcript = ? WHERE id = ?').run(transcriptPath, turnId);
  bus.send({ type: 'turn', sproutId, turnId, kind, status: 'running' });

  let lastLine = '';
  let narrated = false;
  const say = (line: string, fromAgent = false) => {
    line = line.trim().replace(/\s+/g, ' ').slice(0, 140);
    if (!line || line === lastLine) return;
    if (fromAgent) narrated = true;
    lastLine = line;
    bus.send({ type: 'progress', sproutId, turnId, line });
  };

  const ctx: TurnContext = { db, sproutId, turnId, kind, deadline, checkpoints: 0, say: line => say(line, true) };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), spec.deadlineMs);
  const allowed = new Set(canBuild ? BUILD_TOOLS : LOOK_TOOLS);

  let outcome: TurnOutcome = { turnId, status: 'failed', summary: '', checkpoints: 0 };
  let cliVersion = '';
  let cost: number | null = null;
  let numTurns: number | null = null;
  let lastText = '';

  try {
    const q = query({
      prompt: spec.opening,
      options: {
        cwd: p.work,
        model,
        effort: canBuild ? 'high' : 'medium',
        abortController: abort,
        persistSession: false,
        settingSources: [],
        strictMcpConfig: true,
        env: agentEnv(),
        pathToClaudeCodeExecutable: claudeExecutable(),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: spec.brief },
        tools: canBuild ? BUILD_TOOLS : LOOK_TOOLS,
        disallowedTools: ['WebFetch', 'WebSearch', 'Agent', 'Task', 'Skill', 'NotebookEdit'],
        mcpServers: { sprout: createSproutTools(ctx) },
        permissionMode: 'default',
        canUseTool: async (name, input) => {
          const verdict = checkToolUse(name, input, p.work, p.live);
          if (!verdict.ok) return { behavior: 'deny', message: verdict.reason };
          if (allowed.has(name) || name.startsWith('mcp__sprout__')) return { behavior: 'allow', updatedInput: input };
          return { behavior: 'deny', message: `${name} is not available in Sprout.` };
        },
        hooks: {
          PreToolUse: [{
            hooks: [async input => {
              if (input.hook_event_name !== 'PreToolUse') return {};
              const verdict = checkToolUse(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, p.work, p.live);
              if (verdict.ok) return {};
              return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } };
            }],
          }],
        },
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
          network: { allowedDomains: [] },
          filesystem: {
            allowWrite: [p.work],
            denyRead: ['~/'],
            allowRead: [p.work, paths.nodeModules, paths.runtime, join(paths.home, 'package.json'), ...appBundle()],
          },
        },
      },
    });

    for await (const msg of q as AsyncIterable<SDKMessage>) {
      transcript.write(JSON.stringify(msg) + '\n');
      if (msg.type === 'system' && msg.subtype === 'init') {
        cliVersion = msg.claude_code_version;
      } else if (msg.type === 'assistant') {
        if (msg.error === 'rate_limit') outcome = { ...outcome, status: 'rate_limited' };
        if (msg.error === 'authentication_failed') outcome = { ...outcome, status: 'signed_out' };
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) lastText = block.text.trim();
          if (block.type === 'tool_use' && msg.parent_tool_use_id === null) {
            const line = describeToolUse(block.name, block.input as Record<string, unknown>, p.work);
            if (line && (!narrated || block.name.startsWith('mcp__sprout__check'))) say(line);
          }
        }
      } else if (msg.type === 'rate_limit_event') {
        const info = msg.rate_limit_info;
        if (info.status === 'rejected') {
          const resetsAt = info.resetsAt ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : Date.now() + 30 * 60_000;
          outcome = { ...outcome, status: 'rate_limited', resetsAt };
        }
      } else if (msg.type === 'result') {
        cost = msg.total_cost_usd;
        numTurns = msg.num_turns;
        if (msg.subtype === 'success' && !msg.is_error && outcome.status === 'failed') {
          outcome = { ...outcome, status: 'done', summary: msg.result || lastText };
        } else if (outcome.status === 'failed') {
          outcome = { ...outcome, summary: msg.subtype === 'success' ? msg.result : `Stopped: ${msg.subtype}` };
        }
      }
    }
  } catch (err) {
    if (abort.signal.aborted) outcome = { ...outcome, status: 'timeout', summary: lastText || 'Ran out of time.' };
    else outcome = { ...outcome, status: outcome.status === 'failed' ? 'failed' : outcome.status, summary: (err as Error).message };
  } finally {
    clearTimeout(timer);
    transcript.end();
  }

  outcome.checkpoints = ctx.checkpoints;
  if (!outcome.summary) outcome.summary = lastText;
  db.prepare('UPDATE turns SET ended_at = ?, status = ?, cli_version = ?, cost_usd = ?, num_turns = ?, summary = ? WHERE id = ?')
    .run(Date.now(), outcome.status, cliVersion, cost, numTurns, outcome.summary.slice(0, 4000), turnId);
  bus.send({ type: 'turn', sproutId, turnId, kind, status: outcome.status });
  return outcome;
}

const PLACES: [RegExp, string][] = [
  [/^src\/App\.tsx$/, 'Shaping the main screen'],
  [/^src\/feel\.css$/, 'Adjusting the look'],
  [/\.css$/, 'Working on the styling'],
  [/^migrations\//, 'Making a place to keep your data'],
  [/^server\//, 'Working on the behind-the-scenes part'],
];

export function describeToolUse(name: string, input: Record<string, unknown>, root: string): string {
  if (name === 'mcp__sprout__check') return 'Testing the new version';
  if (name === 'mcp__sprout__checkpoint') return 'Saving this version';
  if (name.startsWith('mcp__sprout__')) return '';
  if (name === 'Bash') return 'Checking its work';
  if (name === 'Read' || name === 'Glob' || name === 'Grep') return 'Looking around';
  const file = typeof input.file_path === 'string' ? relative(root, input.file_path.startsWith('/') ? input.file_path : join(root, input.file_path)) : '';
  for (const [pattern, line] of PLACES) if (pattern.test(file)) return line;
  const base = file.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') ?? '';
  if (base) return `Working on ${base.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`;
  return 'Editing';
}
