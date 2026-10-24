// Runs the gate's integration scenarios inside Electron, the way the app runs
// them: Node children via the app binary, and the hidden-window browser check.
//   npm run build && npx electron dist/desktop/selftest.mjs
// Uses a throwaway SPROUT_HOME unless one is set.

import { app } from 'electron';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SPROUT_HOME ??= mkdtempSync(join(tmpdir(), 'sprout-selftest-'));
process.env.SPROUT_RESOURCES ??= join(import.meta.dirname, '..', '..');

const scenarios: [string, (work: string) => void, (r: { ok: boolean; steps: { name: string; ok: boolean }[] }) => boolean][] = [
  ['an unchanged sprout passes', () => {}, r => r.ok && r.steps.length === 4],
  ['a page that crashes fails at "Runs"', work => {
    const f = join(work, 'src', 'App.tsx');
    writeFileSync(f, readFileSync(f, 'utf8').replace('return (', 'if (Date.now() > 0) throw new Error("boom");\n  return ('));
  }, r => !r.ok && r.steps.at(-1)?.name === 'Runs without errors'],
  ['a failing server route fails', work => {
    const f = join(work, 'server', 'api.ts');
    writeFileSync(f, readFileSync(f, 'utf8').replace("db.prepare('SELECT 1').get();", "db.prepare('SELECT * FROM nope').get();"));
  }, r => !r.ok],
  ['a type error fails at "Types"', work => appendFileSync(join(work, 'src', 'App.tsx'), '\nconst n: number = "text";\n'),
    r => !r.ok && r.steps.at(-1)?.name === 'Types check'],
  ['a destructive migration fails first', work => writeFileSync(join(work, 'migrations', '002_oops.sql'), 'DROP TABLE app_meta;'),
    r => !r.ok && r.steps.length === 1],
];

// The browser check opens and closes windows; closing the last one mustn't quit.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  app.dock?.hide();
  const { setPlatform } = await import('../server/platform.ts');
  const { browserCheck } = await import('./browser-check.ts');
  setPlatform({ notify: () => {}, browserCheck });
  const { ensureRuntime } = await import('../server/runtime.ts');
  const { openDb } = await import('../server/db.ts');
  const { paths, sproutPaths } = await import('../server/paths.ts');
  const { createSproutRow, plantFiles, resetWork, stopAll } = await import('../server/sprouts.ts');
  const { FEELS } = await import('../server/feel.ts');
  const { runGate, formatGate } = await import('../server/gate.ts');

  await ensureRuntime(() => {});
  const id = createSproutRow(openDb(paths.db), 'selftest');
  await plantFiles(id, FEELS[0]);

  let failed = 0;
  for (const [name, change, expect] of scenarios) {
    await resetWork(id);
    change(sproutPaths(id).work);
    const result = await runGate(id);
    const ok = expect(result);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n${formatGate(result)}`}`);
  }
  stopAll();
  console.log(failed ? `${failed} scenario(s) failed` : 'All scenarios behaved as expected');
  app.exit(failed ? 1 : 0);
});
