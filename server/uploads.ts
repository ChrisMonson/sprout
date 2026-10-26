// Files the person gives a sprout: sprites, sounds, a dataset, a reference
// image. They're kept beside the sprout, outside its code, where its agent can
// read them; the agent copies what the tool actually uses into public/assets,
// so those become part of its history, exports and phone builds.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Db } from './db.ts';
import { sproutPaths } from './paths.ts';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SPROUT_BYTES = 300 * 1024 * 1024;
export const MAX_FILES_AT_ONCE = 20;

export interface Upload { id: number; whisper_id: number | null; ts: number; name: string; file: string; size: number; type: string }

/** A name safe to keep on disk: lowercase words and dashes, its extension kept. */
export function safeName(name: string): string {
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
  const base = name.slice(0, name.length - extname(name).length).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  return `${base}${ext}`;
}

function folderBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
}

/** Checks the whole batch first, so a request either keeps all its files or none. */
export async function saveUploads(db: Db, sproutId: string, files: File[], whisperId: number | null): Promise<Upload[]> {
  if (files.length > MAX_FILES_AT_ONCE) throw new Error(`Send up to ${MAX_FILES_AT_ONCE} files at a time.`);
  const big = files.find(f => f.size > MAX_FILE_BYTES);
  if (big) throw new Error(`${big.name} is too big. Files can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const dir = sproutPaths(sproutId).uploads;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (folderBytes(dir) + total > MAX_SPROUT_BYTES) throw new Error(`That would take this sprout past ${MAX_SPROUT_BYTES / 1024 / 1024} MB of files.`);
  mkdirSync(dir, { recursive: true });
  const saved: Upload[] = [];
  const insert = db.prepare('INSERT INTO uploads (sprout_id, whisper_id, ts, name, file, size, type) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const f of files) {
    let file = safeName(f.name);
    for (let n = 2; existsSync(join(dir, file)); n++) file = safeName(f.name).replace(/(\.[a-z0-9]+)?$/, `-${n}$1`);
    writeFileSync(join(dir, file), new Uint8Array(await f.arrayBuffer()));
    const ts = Date.now();
    const type = f.type || 'application/octet-stream';
    const { lastInsertRowid } = insert.run(sproutId, whisperId, ts, f.name.slice(0, 200), file, f.size, type);
    saved.push({ id: Number(lastInsertRowid), whisper_id: whisperId, ts, name: f.name, file, size: f.size, type });
  }
  return saved;
}

export function uploadsFor(db: Db, sproutId: string, whisperIds: number[] | 'planting'): Upload[] {
  if (whisperIds === 'planting') {
    return db.prepare('SELECT * FROM uploads WHERE sprout_id = ? AND whisper_id IS NULL ORDER BY id').all(sproutId) as unknown as Upload[];
  }
  if (!whisperIds.length) return [];
  return db.prepare(`SELECT * FROM uploads WHERE sprout_id = ? AND whisper_id IN (${whisperIds.map(() => '?').join(',')}) ORDER BY id`)
    .all(sproutId, ...whisperIds) as unknown as Upload[];
}

const kb = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** How a file appears in the agent's opening: where to read it, and what it is. */
export function describeUpload(sproutId: string, u: Upload): string {
  return `${join(sproutPaths(sproutId).uploads, u.file)} ("${u.name}", ${u.type}, ${kb(u.size)})`;
}

export interface ListedUpload { id: number; name: string; size: number; ts: number; type: string; used: boolean }

const hashOf = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]);
}

/**
 * Every file the person gave this sprout, newest first. "used" means an
 * identical copy is part of the live tool (anywhere under public/), so
 * deleting the upload can't change the tool.
 */
export function listUploads(db: Db, sproutId: string): { files: ListedUpload[]; bytes: number; limit: number } {
  const p = sproutPaths(sproutId);
  const shipped = new Set(filesUnder(join(p.live, 'public')).map(hashOf));
  const rows = db.prepare('SELECT * FROM uploads WHERE sprout_id = ? ORDER BY id DESC').all(sproutId) as unknown as Upload[];
  const files = rows.filter(r => existsSync(join(p.uploads, r.file))).map(r => ({
    id: r.id, name: r.name, size: r.size, ts: r.ts, type: r.type, used: shipped.has(hashOf(join(p.uploads, r.file))),
  }));
  return { files, bytes: files.reduce((sum, f) => sum + f.size, 0), limit: MAX_SPROUT_BYTES };
}

export function deleteUpload(db: Db, sproutId: string, uploadId: number) {
  const row = db.prepare('SELECT * FROM uploads WHERE id = ? AND sprout_id = ?').get(uploadId, sproutId) as unknown as Upload | undefined;
  if (!row) throw new Error('That file is already gone.');
  rmSync(join(sproutPaths(sproutId).uploads, row.file), { force: true });
  db.prepare('DELETE FROM uploads WHERE id = ?').run(uploadId);
}

/** Deletes the files the tool doesn't use. Reference pictures go too; that's why it asks first. */
export function clearUnused(db: Db, sproutId: string): number {
  const unused = listUploads(db, sproutId).files.filter(f => !f.used);
  for (const f of unused) deleteUpload(db, sproutId, f.id);
  return unused.length;
}
