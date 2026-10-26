import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-uploads-'));
const { openDb } = await import('../server/db.ts');
const { sproutPaths } = await import('../server/paths.ts');
const { safeName, saveUploads, uploadsFor, listUploads, deleteUpload, clearUnused, MAX_FILE_BYTES } = await import('../server/uploads.ts');
const { forgetAbandonedSeeds } = await import('../server/remove.ts');
const { checkToolUse } = await import('../server/agent/confine.ts');

describe('files the person gives a sprout', () => {
  const db = openDb(':memory:');
  const id = 'sfiles';

  it('keeps a safe name on disk, and its extension', () => {
    expect(safeName('Enemy Sprite (Final).PNG')).toBe('enemy-sprite-final.png');
    expect(safeName('../../etc/passwd')).toBe('etc-passwd');
    expect(safeName('🎵.mp3')).toBe('file.mp3');
  });

  it('saves files with their whisper, without overwriting one with the same name', async () => {
    const first = await saveUploads(db, id, [new File(['abc'], 'Hero.png', { type: 'image/png' })], 7);
    const second = await saveUploads(db, id, [new File(['xyz'], 'hero.png', { type: 'image/png' })], 8);
    expect(first[0].file).toBe('hero.png');
    expect(second[0].file).toBe('hero-2.png');
    expect(readFileSync(join(sproutPaths(id).uploads, 'hero.png'), 'utf8')).toBe('abc');
    expect(uploadsFor(db, id, [7]).map(u => u.name)).toEqual(['Hero.png']);
    expect(uploadsFor(db, id, [7, 8])).toHaveLength(2);
  });

  it('keeps files given before planting apart from whispers', async () => {
    await saveUploads(db, id, [new File(['level'], 'levels.csv', { type: 'text/csv' })], null);
    expect(uploadsFor(db, id, 'planting').map(u => u.file)).toEqual(['levels.csv']);
  });

  it('refuses a file that’s too big, and keeps none of that batch', async () => {
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'huge.wav');
    await expect(saveUploads(db, id, [new File(['ok'], 'small.txt'), big], 9)).rejects.toThrow(/too big/);
    expect(existsSync(join(sproutPaths(id).uploads, 'small.txt'))).toBe(false);
  });
});

describe('managing those files', () => {
  const db = openDb(':memory:');
  const id = 'smanage';

  it('marks the ones the tool uses, deletes one, and clears the rest', async () => {
    await saveUploads(db, id, [new File(['sprite'], 'hero.png'), new File(['sketch'], 'reference.jpg'), new File(['beep'], 'beep.wav')], 1);
    // The agent copied the sprite into the tool (under another name).
    mkdirSync(join(sproutPaths(id).live, 'public', 'assets'), { recursive: true });
    writeFileSync(join(sproutPaths(id).live, 'public', 'assets', 'player.png'), 'sprite');
    const listed = listUploads(db, id);
    expect(listed.files.map(f => [f.name, f.used])).toEqual([['beep.wav', false], ['reference.jpg', false], ['hero.png', true]]);
    expect(listed.bytes).toBe(16);

    deleteUpload(db, id, listed.files[0].id);
    expect(listUploads(db, id).files.map(f => f.name)).toEqual(['reference.jpg', 'hero.png']);

    expect(clearUnused(db, id)).toBe(1);
    expect(listUploads(db, id).files.map(f => f.name)).toEqual(['hero.png']);
    expect(existsSync(join(sproutPaths(id).uploads, 'reference.jpg'))).toBe(false);
  });

  it('forgets a sprout that was started but never planted, after a day, with its files', async () => {
    db.prepare("INSERT INTO sprouts (id, seed, status, created_at) VALUES ('sold', 'a game', 'seeding', ?)").run(Date.now() - 2 * 24 * 3600_000);
    db.prepare("INSERT INTO sprouts (id, seed, status, created_at) VALUES ('snew', 'a game', 'seeding', ?)").run(Date.now());
    await saveUploads(db, 'sold', [new File(['art'], 'art.png')], null);
    expect(forgetAbandonedSeeds(db)).toBe(1);
    expect(existsSync(sproutPaths('sold').base)).toBe(false);
    expect(uploadsFor(db, 'sold', 'planting')).toHaveLength(0);
    expect(db.prepare("SELECT id FROM sprouts WHERE id IN ('sold', 'snew')").all()).toEqual([{ id: 'snew' }]);
  });
});

describe('the agent and those files', () => {
  const base = mkdtempSync(join(tmpdir(), 'sprout-uploads-confine-'));
  const work = join(base, 'work');
  const uploads = join(base, 'uploads');
  mkdirSync(work, { recursive: true });
  mkdirSync(uploads, { recursive: true });
  writeFileSync(join(uploads, 'hero.png'), 'x');

  it('can read them', () => {
    expect(checkToolUse('Read', { file_path: join(uploads, 'hero.png') }, work, undefined, [uploads]).ok).toBe(true);
    expect(checkToolUse('Glob', { pattern: `${uploads}/*.png` }, work, undefined, [uploads]).ok).toBe(true);
  });

  it('can’t change them', () => {
    const verdict = checkToolUse('Write', { file_path: join(uploads, 'hero.png') }, work, undefined, [uploads]);
    expect(verdict.ok).toBe(false);
  });

  it('still can’t read anything else outside the sprout', () => {
    expect(checkToolUse('Read', { file_path: join(base, 'secret.txt') }, work, undefined, [uploads]).ok).toBe(false);
  });
});
