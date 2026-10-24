import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-transfer-'));
const { openDb, q } = await import('../server/db.ts');
const { sproutPaths } = await import('../server/paths.ts');
const { createSproutRow, plantFiles } = await import('../server/sprouts.ts');
const { FEELS } = await import('../server/feel.ts');
const { git } = await import('../server/git.ts');
const { exportSprout, importSprout } = await import('../server/transfer.ts');

describe('export and import', () => {
  const db = openDb(':memory:');
  let id: string;
  let head: string;

  beforeAll(async () => {
    id = createSproutRow(db, 'A water counter');
    await plantFiles(id, FEELS[1]);
    const p = sproutPaths(id);
    writeFileSync(join(p.live, 'src', 'App.tsx'), 'export default function App() { return <main>Water</main>; }\n');
    await git(p.live, 'commit', '-qam', 'Count glasses');
    head = await git(p.live, 'rev-parse', 'HEAD');
    const app = new DatabaseSync(p.db);
    app.exec('CREATE TABLE glasses (n INTEGER); INSERT INTO glasses VALUES (7);');
    app.close();
    writeFileSync(p.journal, '# Journal\n\n## note\nThey drink a lot of water.\n');
    q.update(db, id, { name: 'Water Counter', status: 'ready', growing: 1 });
    db.prepare('INSERT INTO growth (sprout_id, ts, kind, title, commit_sha, rewindable) VALUES (?, ?, ?, ?, ?, ?)').run(id, 1, 'grow', 'Count glasses', head, 1);
  });

  it('round-trips code with history, data, memory and growth as a new, resting sprout', async () => {
    const { filename, bytes } = await exportSprout(db, id, true);
    expect(filename).toBe('water-counter.sprout');
    const copy = await importSprout(db, bytes);
    expect(copy).not.toBe(id);

    const p = sproutPaths(copy);
    expect(await git(p.live, 'rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(p.live, 'src', 'App.tsx'), 'utf8')).toContain('Water');
    expect(existsSync(join(p.work, 'src', 'App.tsx'))).toBe(true);
    expect(await git(p.live, 'remote')).toBe('');
    const app = new DatabaseSync(p.db);
    expect((app.prepare('SELECT n FROM glasses').get() as { n: number }).n).toBe(7);
    app.close();
    expect(readFileSync(p.journal, 'utf8')).toContain('a lot of water');

    const row = q.sprout(db, copy)!;
    expect(row).toMatchObject({ name: 'Water Counter', status: 'ready', growing: 0 });
    const growth = db.prepare('SELECT kind, title, commit_sha, rewindable FROM growth WHERE sprout_id = ? ORDER BY id').all(copy) as { kind: string; commit_sha: string; rewindable: number }[];
    expect(growth.map(g => g.kind)).toEqual(['grow', 'import']);
    expect(growth[0]).toMatchObject({ commit_sha: head, rewindable: 1 });
  });

  it('leaves the data out when asked', async () => {
    const { bytes } = await exportSprout(db, id, false);
    const copy = await importSprout(db, bytes);
    expect(existsSync(sproutPaths(copy).db)).toBe(false);
  });

  it('refuses files that are not Sprout files, leaving nothing behind', async () => {
    const before = q.sprouts(db).length;
    await expect(importSprout(db, Buffer.from('hello'))).rejects.toThrow();
    await expect(importSprout(db, gzipSync(JSON.stringify({ format: 'sprout/1', sprout: {}, repo: Buffer.from('nope').toString('base64') })))).rejects.toThrow();
    expect(q.sprouts(db).length).toBe(before);
  });
});
