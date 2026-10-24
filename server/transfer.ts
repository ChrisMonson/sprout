// Export a sprout to a single .sprout file, and import one as a new sprout.
//
// The file is gzipped JSON holding a git bundle of the code (full history, so
// commit ids and Rewind survive the trip), the agent's memory, the greenhouse
// record (name, seed, conversation, feel, growth history) and, if asked, a
// copy of the tool's data. Transcripts and raw usage events stay behind.

import { gunzipSync, gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sproutPaths } from './paths.ts';
import { git } from './git.ts';
import { q, type Db } from './db.ts';
import { newSproutId } from './sprouts.ts';
import { backupDb } from './snapshot.ts';

const FORMAT = 'sprout/1';

interface GrowthEntry { ts: number; kind: string; title: string; detail: string | null; commit_sha: string | null; rewindable: number }

interface SproutFile {
  format: typeof FORMAT;
  exportedAt: number;
  sprout: { name: string; seed: string; conversation: string; feel: string | null };
  growth: GrowthEntry[];
  memory: { journal: string; understanding: string };
  /** base64 git bundle of the sprout's main branch */
  repo: string;
  /** base64 SQLite database, when the person chose to include their data */
  data: string | null;
}

export async function exportSprout(db: Db, id: string, includeData: boolean): Promise<{ filename: string; bytes: Buffer }> {
  const row = q.sprout(db, id);
  if (!row || (row.status !== 'ready' && row.status !== 'failed')) throw new Error('Only a planted sprout can be exported.');
  const p = sproutPaths(id);
  const scratch = mkdtempSync(join(tmpdir(), 'sprout-export-'));
  try {
    const bundle = join(scratch, 'repo.bundle');
    await git(p.live, 'bundle', 'create', '-q', bundle, 'main');
    let data: string | null = null;
    if (includeData && existsSync(p.db)) {
      const copy = join(scratch, 'app.db');
      await backupDb(p.db, copy);
      data = readFileSync(copy).toString('base64');
    }
    const read = (file: string) => existsSync(file) ? readFileSync(file, 'utf8') : '';
    const file: SproutFile = {
      format: FORMAT,
      exportedAt: Date.now(),
      sprout: { name: row.name, seed: row.seed, conversation: row.conversation, feel: row.feel },
      growth: db.prepare('SELECT ts, kind, title, detail, commit_sha, rewindable FROM growth WHERE sprout_id = ? ORDER BY id').all(id) as unknown as GrowthEntry[],
      memory: { journal: read(p.journal), understanding: read(p.understanding) },
      repo: readFileSync(bundle).toString('base64'),
      data,
    };
    const slug = (row.name || 'sprout').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sprout';
    return { filename: `${slug}.sprout`, bytes: gzipSync(JSON.stringify(file)) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function importSprout(db: Db, bytes: Buffer): Promise<string> {
  let file: SproutFile;
  try {
    file = JSON.parse(gunzipSync(bytes).toString('utf8'));
  } catch {
    throw new Error('That isn’t a Sprout file.');
  }
  if (file?.format !== FORMAT || !file.repo || !file.sprout) throw new Error('That isn’t a Sprout file this version understands.');

  const id = newSproutId();
  const p = sproutPaths(id);
  const scratch = mkdtempSync(join(tmpdir(), 'sprout-import-'));
  try {
    for (const dir of [p.data, p.snapshots, p.cache, p.memory]) mkdirSync(dir, { recursive: true });
    const bundle = join(scratch, 'repo.bundle');
    writeFileSync(bundle, Buffer.from(file.repo, 'base64'));
    await git(p.base, 'clone', '-q', '--branch', 'main', bundle, p.live).catch(() => { throw new Error('The code in that file is damaged.'); });
    await git(p.live, 'remote', 'remove', 'origin');
    await git(p.live, 'worktree', 'add', '-q', '-b', 'growing', p.work);
    if (file.data) writeFileSync(p.db, Buffer.from(file.data, 'base64'));
    writeFileSync(p.journal, file.memory?.journal || '# Journal\n');
    writeFileSync(p.understanding, file.memory?.understanding || '# Understanding\n');

    const now = Date.now();
    db.prepare('INSERT INTO sprouts (id, name, seed, conversation, feel, status, growing, created_at, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, file.sprout.name || 'Imported sprout', file.sprout.seed || '', file.sprout.conversation || '[]', file.sprout.feel ?? null, 'ready', 0, now, now);
    const insert = db.prepare('INSERT INTO growth (sprout_id, ts, kind, title, detail, commit_sha, rewindable) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const g of file.growth ?? []) insert.run(id, g.ts, g.kind, g.title, g.detail, g.commit_sha, g.rewindable ? 1 : 0);
    insert.run(id, now, 'import', 'Replanted', file.data ? 'Replanted from a .sprout file, with its data.' : 'Replanted from a .sprout file, without its data.', await git(p.live, 'rev-parse', 'HEAD'), 0);
    return id;
  } catch (err) {
    rmSync(p.base, { recursive: true, force: true });
    db.prepare('DELETE FROM growth WHERE sprout_id = ?').run(id);
    db.prepare('DELETE FROM sprouts WHERE id = ?').run(id);
    throw err;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
