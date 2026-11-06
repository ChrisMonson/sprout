import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-rewind-'));
const { openDb } = await import('../server/db.ts');
const { sproutPaths } = await import('../server/paths.ts');
const { createSproutRow, plantFiles } = await import('../server/sprouts.ts');
const { FEELS } = await import('../server/feel.ts');
const { git } = await import('../server/git.ts');
const { rewind } = await import('../server/apply.ts');

describe('rewinding, and undoing a rewind', () => {
  const db = openDb(':memory:');
  let id: string;
  const app = () => readFileSync(join(sproutPaths(id).live, 'src', 'App.tsx'), 'utf8');
  const growth = () => db.prepare('SELECT id, kind, title, rewindable FROM growth WHERE sprout_id = ? ORDER BY id').all(id) as { id: number; kind: string; title: string; rewindable: number }[];

  beforeAll(async () => {
    id = createSproutRow(db, 'A water counter');
    await plantFiles(id, FEELS[1]);
    const p = sproutPaths(id);
    let ts = 1;
    for (const [title, text] of [['Count glasses', 'Water'], ['A daily goal', 'Water, goal 8']]) {
      writeFileSync(join(p.live, 'src', 'App.tsx'), `export default function App() { return <main>${text}</main>; }\n`);
      await git(p.live, 'commit', '-qam', title);
      db.prepare('INSERT INTO growth (sprout_id, ts, kind, title, commit_sha, rewindable) VALUES (?, ?, ?, ?, ?, 1)')
        .run(id, ts++, 'grow', title, await git(p.live, 'rev-parse', 'HEAD'));
    }
  });

  it('rewinds a change and everything after it, as one step that can itself be undone', async () => {
    const before = Number(await git(sproutPaths(id).live, 'rev-list', '--count', 'HEAD'));
    const { title } = await rewind(db, id, growth()[0].id);
    expect(title).toBe('Rewound "Count glasses"');
    expect(app()).not.toContain('Water');
    expect(Number(await git(sproutPaths(id).live, 'rev-list', '--count', 'HEAD'))).toBe(before + 1);
    expect(growth().map(g => [g.title, g.rewindable])).toEqual([['Count glasses', 0], ['A daily goal', 0], ['Rewound "Count glasses"', 1]]);
  });

  it('undoing the rewind brings back exactly what it took out', async () => {
    const { title } = await rewind(db, id, growth().at(-1)!.id);
    expect(title).toBe('Brought back "Count glasses"');
    expect(app()).toContain('Water, goal 8');
    expect(growth().at(-1)).toMatchObject({ kind: 'rewind', rewindable: 1 });
    expect(growth().at(-2)!.rewindable).toBe(0);
  });

  it('and that can be undone too, leaving git with nothing half-done', async () => {
    const { title } = await rewind(db, id, growth().at(-1)!.id);
    expect(title).toBe('Rewound "Count glasses"');
    expect(app()).not.toContain('Water');
    const p = sproutPaths(id);
    expect(await git(p.live, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(p.live, '.git', 'sequencer'))).toBe(false);
  });

  it('refuses entries that are no longer rewindable', async () => {
    await expect(rewind(db, id, growth()[0].id)).rejects.toThrow(/cannot be rewound/);
  });
});
