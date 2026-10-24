import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-memory-'));
const { sproutPaths } = await import('../server/paths.ts');
const { addNote, addRequestNote, hasRequestNote, takeNotes } = await import('../server/memory.ts');

describe('greenhouse notes', () => {
  const id = 'snotes';
  mkdirSync(sproutPaths(id).memory, { recursive: true });

  it('a rename asks for a turn; a plain note does not', () => {
    addNote(id, 'Just so you know.');
    expect(hasRequestNote(id)).toBe(false);
    addRequestNote(id, 'The person renamed the tool.');
    expect(hasRequestNote(id)).toBe(true);
  });

  it('the next turn reads every note once and clears the request', () => {
    const notes = takeNotes(id);
    expect(notes).toContain('Just so you know.');
    expect(notes).toContain('The person renamed the tool.');
    expect(hasRequestNote(id)).toBe(false);
    expect(takeNotes(id)).toBe('');
  });
});
