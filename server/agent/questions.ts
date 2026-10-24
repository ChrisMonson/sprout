// The short conversation before planting: a fast model asks follow-up
// questions until it has enough to build a useful first version.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { agentEnv } from './credentials.ts';
import { MODELS } from './runner.ts';

export interface Exchange { q: string; a: string }
export interface NextQuestion { done: boolean; question: string; suggestions: string[]; name: string; reply: string }

const MAX_QUESTIONS = 3;

const SYSTEM = `You help someone who doesn't code describe a small tool they want, so it can be built for them.
Ask one short, friendly question at a time, the kind a thoughtful person would ask, to learn what the first version must do and what they want to see first. Never ask about technology, platforms or data storage.
Each question comes with three short suggested answers (under 8 words each) written in their voice.
Stop as soon as you know enough for a useful first version, and after at most ${MAX_QUESTIONS} questions.
"reply" is a brief warm acknowledgement of their last answer (or of their idea, before the first question), under 20 words, no exclamation marks.
When done, give the tool a short friendly name (two or three words).`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['done', 'reply', 'question', 'suggestions', 'name'],
  properties: {
    done: { type: 'boolean' },
    reply: { type: 'string' },
    question: { type: 'string', description: 'Empty when done' },
    suggestions: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    name: { type: 'string', description: 'Short name for the tool; required when done' },
  },
};

export async function nextQuestion(seed: string, exchange: Exchange[]): Promise<NextQuestion> {
  const forced = exchange.length >= MAX_QUESTIONS;
  const prompt = [
    `They want to grow: "${seed}"`,
    exchange.length ? exchange.map(e => `Q: ${e.q}\nA: ${e.a}`).join('\n\n') : '(no questions asked yet)',
    forced ? 'That is enough questions: set done to true now.' : '',
  ].filter(Boolean).join('\n\n');

  const q = query({
    prompt,
    options: {
      model: MODELS.observe,
      systemPrompt: SYSTEM,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: 3,
      env: agentEnv(),
      outputFormat: { type: 'json_schema', schema: SCHEMA },
    },
  });
  for await (const msg of q) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success' && msg.structured_output) {
        const out = msg.structured_output as NextQuestion;
        return { ...out, done: out.done || forced || !out.question, suggestions: (out.suggestions ?? []).slice(0, 3) };
      }
      throw new Error(`Couldn't think of a question (${msg.subtype}).`);
    }
  }
  throw new Error('No answer from Claude.');
}
