// A sprout's agent memory lives outside its git repo, so rewinds and resets
// never erase what the agent learned. Caps are enforced when writing, not
// when reading, so newer conclusions are never silently cut.

import { existsSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sproutPaths } from './paths.ts';

export const JOURNAL_CAP = 16_000;
export const UNDERSTANDING_CAP = 4_000;

function read(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

export function appendJournal(id: string, kind: string, entry: string) {
  const file = sproutPaths(id).journal;
  const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  let text = read(file) || '# Journal\n';
  text += `\n## ${stamp} · ${kind}\n${entry.trim()}\n`;
  if (text.length > JOURNAL_CAP) {
    const [header, ...entries] = text.split(/\n(?=## )/);
    while (entries.length > 1 && [header, ...entries].join('\n').length > JOURNAL_CAP - 60) entries.shift();
    text = [header, '_(older entries trimmed)_', ...entries].join('\n');
  }
  writeFileSync(file, text);
}

export function journalTail(id: string, chars = 5_000): string {
  const text = read(sproutPaths(id).journal);
  if (text.length <= chars) return text;
  const cut = text.slice(-chars);
  const start = cut.indexOf('\n## ');
  return start >= 0 ? cut.slice(start + 1) : cut;
}

export function readUnderstanding(id: string): string {
  return read(sproutPaths(id).understanding);
}

/** Returns an error message instead of writing when the text is too long. */
export function writeUnderstanding(id: string, text: string): string | null {
  if (text.length > UNDERSTANDING_CAP) {
    return `That is ${text.length} characters; the limit is ${UNDERSTANDING_CAP}. Tighten it and try again.`;
  }
  writeFileSync(sproutPaths(id).understanding, text.trim() + '\n');
  return null;
}

/**
 * Notes from the greenhouse (rollbacks, rewinds) the next grow turn must see once.
 * wake: the note needs the agent's attention now (a rollback), not just at its next turn.
 */
export function addNote(id: string, note: string, wake = false) {
  appendFileSync(sproutPaths(id).notes, `- ${new Date().toISOString()} ${note}\n`);
  if (wake) writeFileSync(wakeFlag(id), '');
}

/** A note the person caused directly (a rename): acted on like a whisper, even while growth is off. */
export function addRequestNote(id: string, note: string) {
  addNote(id, note);
  writeFileSync(requestFlag(id), '');
}

export function hasWakeNote(id: string): boolean {
  return existsSync(wakeFlag(id));
}

export function hasRequestNote(id: string): boolean {
  return existsSync(requestFlag(id));
}

export function takeNotes(id: string): string {
  const text = read(sproutPaths(id).notes);
  if (text) writeFileSync(sproutPaths(id).notes, '');
  rmSync(wakeFlag(id), { force: true });
  rmSync(requestFlag(id), { force: true });
  return text.trim();
}

function wakeFlag(id: string) {
  return join(sproutPaths(id).memory, 'wake');
}

function requestFlag(id: string) {
  return join(sproutPaths(id).memory, 'request');
}
