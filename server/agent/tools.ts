// The tools a sprout's agent gets from the greenhouse, served in-process over
// MCP. Results are short and every one ends with the time left in the turn,
// so the agent can pace itself. (Port of og-world-supervisor/agent/tools.py.)

import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Db } from '../db.ts';
import { q } from '../db.ts';
import { bus } from '../bus.ts';
import { digest } from '../friction.ts';
import { appendJournal, writeUnderstanding } from '../memory.ts';
import { runGate, formatGate } from '../gate.ts';
import { commitWork, queueApply } from '../apply.ts';

export interface TurnContext {
  db: Db;
  sproutId: string;
  turnId: number;
  kind: 'plant' | 'grow' | 'observe';
  deadline: number;
  checkpoints: number;
  say: (line: string) => void;
}

const RESULT_CAP = 12_000;

function reply(ctx: TurnContext, text: string) {
  const left = Math.max(0, Math.round((ctx.deadline - Date.now()) / 1000));
  const body = text.length > RESULT_CAP ? `${text.slice(0, RESULT_CAP)}\n… (cut at ${RESULT_CAP} characters)` : text;
  return { content: [{ type: 'text' as const, text: `${body}\n\n[${left}s left in this turn]` }] };
}

export function createSproutTools(ctx: TurnContext) {
  const { db, sproutId } = ctx;
  const canBuild = ctx.kind !== 'observe';

  const tools: SdkMcpToolDefinition<any>[] = [
    tool('progress', 'Tell the person, in one short plain sentence with no jargon, what you are doing right now. They see it live. Example: "Making a place to keep every feeding".',
      { line: z.string().max(120) },
      async ({ line }) => { ctx.say(line); return reply(ctx, 'Shown.'); }),

    tool('journal', 'Add an entry to your journal: what you noticed, what you changed and why, what you are unsure about. Your future turns read the latest entries. Keep it short and only write what you actually observed.',
      { entry: z.string().max(2000) },
      async ({ entry }) => { appendJournal(sproutId, ctx.kind, entry); return reply(ctx, 'Written.'); }),

    tool('understanding', 'Replace your understanding of this person and their tool (who they are, what it is for, what matters to them). Under 4000 characters. Rewrite it whole when you learn something.',
      { text: z.string() },
      async ({ text }) => reply(ctx, writeUnderstanding(sproutId, text) ?? 'Saved.')),

    tool('signals', 'How the tool has been used since a point in the event log: what gets used, repeated clicks, errors, pages. Pass since=0 for everything.',
      { since: z.number().int().min(0).default(0) },
      async ({ since }) => reply(ctx, JSON.stringify(digest(db, sproutId, since), null, 1))),

    tool('propose_bud', 'Suggest one new capability the person has not asked for, based on something you saw them do. They will see it as a card and can say yes or no. Nothing is built unless they say yes. Only one open suggestion at a time.',
      { text: z.string().max(220).describe('The suggestion as you would say it to them, e.g. "You log feedings around 8am and 8pm. Want a reminder?"'), why: z.string().max(500).describe('What you observed that led to this') },
      async ({ text, why }) => {
        if (!q.sprout(db, sproutId)?.growing) return reply(ctx, 'Growth is turned off, so no suggestions right now.');
        const open = db.prepare("SELECT COUNT(*) AS n FROM buds WHERE sprout_id = ? AND status = 'proposed'").get(sproutId) as { n: number };
        if (open.n > 0) return reply(ctx, 'There is already a suggestion waiting for an answer. Wait for it.');
        const dismissed = db.prepare("SELECT text FROM buds WHERE sprout_id = ? AND status = 'dismissed' ORDER BY id DESC LIMIT 10").all(sproutId) as { text: string }[];
        db.prepare('INSERT INTO buds (sprout_id, ts, kind, text, why, turn_id) VALUES (?, ?, ?, ?, ?, ?)').run(sproutId, Date.now(), 'bud', text, why, ctx.turnId);
        bus.send({ type: 'sprout', sproutId });
        return reply(ctx, `Shown to the person.${dismissed.length ? `\nThey previously said no to: ${dismissed.map(d => `"${d.text}"`).join('; ')}` : ''}`);
      }),

    tool('ask_user', 'Ask the person one short question inside their tool, with up to three suggested answers. Use sparingly, only when the answer changes what you build. Their answer arrives in a later turn.',
      { question: z.string().max(200), suggestions: z.array(z.string().max(60)).max(3).default([]) },
      async ({ question, suggestions }) => {
        const open = db.prepare("SELECT COUNT(*) AS n FROM buds WHERE sprout_id = ? AND kind = 'question' AND status = 'proposed'").get(sproutId) as { n: number };
        if (open.n > 0) return reply(ctx, 'A question is already waiting for an answer.');
        db.prepare('INSERT INTO buds (sprout_id, ts, kind, text, suggestions, turn_id) VALUES (?, ?, ?, ?, ?, ?)').run(sproutId, Date.now(), 'question', question, JSON.stringify(suggestions), ctx.turnId);
        bus.send({ type: 'sprout', sproutId });
        return reply(ctx, 'Asked.');
      }),
  ];

  if (canBuild) {
    tools.push(
      tool('check', 'Run the greenhouse gate on your current changes without saving them: data changes only add, types check, it builds, and it loads in a real browser without errors. Use it before checkpoint.',
        {},
        async () => {
          const result = await runGate(sproutId);
          return reply(ctx, `${result.ok ? 'All checks pass.' : 'Not ready yet.'}\n${formatGate(result)}`);
        }),

      tool('checkpoint', 'Save your current changes as one step the person will see in their history. Runs the gate first; if it fails nothing is saved. Saved steps go live when the person pauses, so nothing moves while they are mid-task.',
        { title: z.string().max(60).describe('Plain words, e.g. "Feeding reminders"'), detail: z.string().max(300).describe('One sentence the person will read about what changed') },
        async ({ title, detail }) => {
          const result = await runGate(sproutId);
          if (!result.ok) return reply(ctx, `Not saved. Fix these first:\n${formatGate(result)}`);
          const commit = await commitWork(sproutId, title, detail, ctx.turnId);
          if (!commit) return reply(ctx, 'Nothing has changed since the last checkpoint.');
          ctx.checkpoints++;
          queueApply(db, sproutId, { commit, title, detail, turnId: ctx.turnId }, ctx.kind === 'plant');
          return reply(ctx, ctx.kind === 'plant' ? 'Saved. It goes live as soon as this turn ends.' : 'Saved. It will go live the next time the person pauses.');
        }),

      tool('name_tool', 'Give the tool a short name the person will see (two or three words).',
        { name: z.string().min(1).max(40) },
        async ({ name }) => { q.update(db, sproutId, { name }); bus.send({ type: 'sprout', sproutId }); return reply(ctx, `Named "${name}".`); }),
    );
  }

  return createSdkMcpServer({ name: 'sprout', version: '0.1.0', tools });
}
