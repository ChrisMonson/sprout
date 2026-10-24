// Builds the first message of each turn: everything the agent needs to know,
// assembled fresh, because sessions are never resumed. (Port of the opening()
// builder in og-world-supervisor/agent/loop.py.)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../paths.ts';
import { q, type Db } from '../db.ts';
import { digest } from '../friction.ts';
import { journalTail, readUnderstanding, takeNotes } from '../memory.ts';
import { feelById } from '../feel.ts';

export function brief(kind: 'plant' | 'grow' | 'observe'): string {
  return [readFileSync(join(paths.briefs, 'base.md'), 'utf8'), readFileSync(join(paths.briefs, `${kind}.md`), 'utf8')].join('\n\n');
}

interface Turn { exchange: { q: string; a: string }[] }

function header(minutes: number, reason: string) {
  return `It is ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}. You have ${minutes} minutes for this turn.\nWhy you're awake: ${reason}`;
}

function memory(sproutId: string) {
  const understanding = readUnderstanding(sproutId).trim();
  const journal = journalTail(sproutId).trim();
  return [
    `## Your understanding\n${understanding || '(empty)'}`,
    `## Latest journal entries\n${journal || '(none yet)'}`,
  ].join('\n\n');
}

export function plantOpening(db: Db, sproutId: string, minutes: number): string {
  const row = q.sprout(db, sproutId)!;
  const convo = JSON.parse(row.conversation) as Turn['exchange'];
  const feel = row.feel ? JSON.parse(row.feel) as { preset: string; note?: string } : { preset: 'calm' };
  return [
    header(minutes, 'Someone wants a new tool.'),
    `## What they want\n"${row.seed}"`,
    convo.length ? `## What they told you\n${convo.map(e => `Q: ${e.q}\nA: ${e.a}`).join('\n\n')}` : '',
    `## How it should feel\n${feelById(feel.preset).name}${feel.note ? `, in their words: "${feel.note}"` : ''}`,
    row.name ? `They'll see it called "${row.name}" unless you rename it.` : '',
  ].filter(Boolean).join('\n\n');
}

export interface GrowAsks {
  whispers: { id: number; text: string; target: string | null; ts: number }[];
  buds: { id: number; text: string }[];
  answers: { id: number; text: string; answer: string }[];
}

export function collectAsks(db: Db, sproutId: string): GrowAsks {
  return {
    whispers: db.prepare("SELECT id, text, target, ts FROM whispers WHERE sprout_id = ? AND status = 'new' ORDER BY id").all(sproutId) as unknown as GrowAsks['whispers'],
    buds: db.prepare("SELECT id, text FROM buds WHERE sprout_id = ? AND kind = 'bud' AND status = 'accepted' ORDER BY id").all(sproutId) as unknown as GrowAsks['buds'],
    answers: db.prepare("SELECT id, text, answer FROM buds WHERE sprout_id = ? AND kind = 'question' AND status = 'answered' ORDER BY id").all(sproutId) as unknown as GrowAsks['answers'],
  };
}

function describeTarget(target: string | null): string {
  if (!target) return '';
  const t = JSON.parse(target) as { sproutId?: string; path?: string; text?: string };
  return ` (pointing at ${t.sproutId ? `[data-sprout-id=${t.sproutId}]` : t.path}${t.text ? `, showing "${t.text}"` : ''})`;
}

export function growOpening(db: Db, sproutId: string, minutes: number, reason: string, asks: GrowAsks): string {
  const row = q.sprout(db, sproutId)!;
  const notes = takeNotes(sproutId);
  const signals = digest(db, sproutId, row.grow_mark);
  const history = db.prepare('SELECT kind, title, ts FROM growth WHERE sprout_id = ? ORDER BY id DESC LIMIT 6').all(sproutId) as { kind: string; title: string; ts: number }[];
  return [
    header(minutes, reason),
    row.growing ? '' : '## Growth is turned off\nThe person turned growth off, so do exactly what they asked below and nothing else: no fixes or improvements they did not ask for, and no suggestions (propose_bud).',
    asks.whispers.length ? `## What they said\n${asks.whispers.map(w => `- "${w.text}"${describeTarget(w.target)}`).join('\n')}` : '',
    asks.buds.length ? `## Suggestions they said yes to\n${asks.buds.map(b => `- ${b.text}`).join('\n')}` : '',
    asks.answers.length ? `## Answers to your questions\n${asks.answers.map(a => `- You asked "${a.text}". They said: "${a.answer}"`).join('\n')}` : '',
    notes ? `## Notes from the greenhouse\n${notes}` : '',
    signals.errors.items.length ? `## Errors since your last growth turn\n${signals.errors.items.map(e => `- ${e.kind} ×${e.count}: ${e.message}`).join('\n')}` : '',
    `## Recent history\n${history.map(h => `- ${h.kind}: ${h.title}`).join('\n') || '(nothing yet)'}`,
    memory(sproutId),
    `Usage since your last growth turn: ${signals.events} events (event log up to #${signals.lastId ?? row.grow_mark}). Call signals for detail.`,
  ].filter(Boolean).join('\n\n');
}

export function observeOpening(db: Db, sproutId: string, minutes: number, reason: string): string {
  const row = q.sprout(db, sproutId)!;
  const signals = digest(db, sproutId, row.observe_mark);
  const open = db.prepare("SELECT text FROM buds WHERE sprout_id = ? AND status = 'proposed'").all(sproutId) as { text: string }[];
  const dismissed = db.prepare("SELECT text FROM buds WHERE sprout_id = ? AND status = 'dismissed' ORDER BY id DESC LIMIT 10").all(sproutId) as { text: string }[];
  return [
    header(minutes, reason),
    `## Usage since you last looked (events #${row.observe_mark + 1}–#${signals.lastId ?? row.observe_mark})\n${JSON.stringify(signals, null, 1)}`,
    open.length ? `## Waiting for their answer\n${open.map(b => `- ${b.text}`).join('\n')}` : '',
    dismissed.length ? `## Suggestions they said no to\n${dismissed.map(b => `- ${b.text}`).join('\n')}` : '',
    memory(sproutId),
  ].filter(Boolean).join('\n\n');
}
