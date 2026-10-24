// Runs the real gate against a real sprout: install, build, browser.
// Slow, so it only runs with `npm run test:integration`.

import { describe, expect, it, beforeAll } from 'vitest';
import { appendFileSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SPROUT_HOME ??= join(tmpdir(), 'sprout-integration-home');

const { ensureRuntime, ensureBrowser } = await import('../server/runtime.ts');
const { openDb } = await import('../server/db.ts');
const { paths, sproutPaths } = await import('../server/paths.ts');
const { createSproutRow, plantFiles, resetWork } = await import('../server/sprouts.ts');
const { FEELS } = await import('../server/feel.ts');
const { runGate } = await import('../server/gate.ts');
const { backupDb } = await import('../server/snapshot.ts');
const { DatabaseSync } = await import('node:sqlite');

describe('gate', () => {
  let id: string;
  beforeAll(async () => {
    await ensureRuntime(() => {});
    await ensureBrowser(() => {});
    const db = openDb(paths.db);
    id = createSproutRow(db, 'integration');
    await plantFiles(id, FEELS[0]);
  }, 600_000);

  it('passes an unchanged sprout', async () => {
    const result = await runGate(id);
    expect(result.steps.map(s => [s.name, s.ok])).toEqual([
      ['Data changes only add', true], ['Types check', true], ['Builds', true], ['Runs without errors', true],
    ]);
  }, 120_000);

  it('catches a change that type-checks and builds but crashes in the browser', async () => {
    await resetWork(id);
    const app = join(sproutPaths(id).work, 'src', 'App.tsx');
    writeFileSync(app, readFileSync(app, 'utf8').replace('return (', 'if (Date.now() > 0) throw new Error("boom");\n  return ('));
    const result = await runGate(id);
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ name: 'Runs without errors', ok: false });
  }, 120_000);

  it('catches a server route that fails', async () => {
    await resetWork(id);
    const api = join(sproutPaths(id).work, 'server', 'api.ts');
    writeFileSync(api, readFileSync(api, 'utf8').replace("db.prepare('SELECT 1').get();", "db.prepare('SELECT * FROM nope').get();"));
    const result = await runGate(id);
    expect(result.ok).toBe(false);
  }, 120_000);

  it('catches type errors before building', async () => {
    await resetWork(id);
    appendFileSync(join(sproutPaths(id).work, 'src', 'App.tsx'), '\nconst n: number = "text";\n');
    const result = await runGate(id);
    expect(result.steps.at(-1)).toMatchObject({ name: 'Types check', ok: false });
  }, 120_000);

  it('rejects destructive migrations', async () => {
    await resetWork(id);
    writeFileSync(join(sproutPaths(id).work, 'migrations', '002_oops.sql'), 'DROP TABLE app_meta;');
    const result = await runGate(id);
    expect(result.steps).toHaveLength(1);
    expect(result.ok).toBe(false);
  }, 120_000);
});

describe('snapshots', () => {
  it('copies a database with uncheckpointed WAL writes', async () => {
    const dir = join(tmpdir(), `sprout-snap-${Date.now()}`);
    const src = join(dir, 'app.db');
    const dest = join(dir, 'copy.db');
    rmSync(dir, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(src);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE t (n INTEGER);');
    for (let i = 0; i < 134; i++) db.prepare('INSERT INTO t VALUES (?)').run(i);
    expect(existsSync(`${src}-wal`)).toBe(true);
    expect(await backupDb(src, dest)).toBe(true);
    const copy = new DatabaseSync(dest);
    expect((copy.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n).toBe(134);
    copy.close();
    db.close();
  });
});
