// Every change passes this gate before it can go live. It belongs to the
// greenhouse, so the agent can't weaken it: the sprout's own tests (if any)
// are never the only check. (Port of Og-World's gate/run-gate.sh + smoke.py.)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { paths, sproutPaths } from './paths.ts';
import { git } from './git.ts';
import { checkMigrations, type FileChange } from './migrations.ts';
import { spawnRunner } from './sprouts.ts';
import { backupDb } from './snapshot.ts';

const run = promisify(execFile);

export interface GateStep { name: string; ok: boolean; detail: string }
export interface GateResult { ok: boolean; steps: GateStep[]; changed: boolean }

function trim(text: string, lines = 30): string {
  const all = text.trim().split('\n');
  return all.length > lines ? [...all.slice(0, lines), `… ${all.length - lines} more lines`].join('\n') : all.join('\n');
}

export async function runGate(sproutId: string): Promise<GateResult> {
  const p = sproutPaths(sproutId);
  const steps: GateStep[] = [];
  const step = (name: string, ok: boolean, detail = '') => { steps.push({ name, ok, detail }); return ok; };

  await git(p.work, 'add', '-A');
  const diff = await git(p.work, 'diff', '--cached', '--name-status', 'main');
  const changes: FileChange[] = diff ? diff.split('\n').map(line => {
    const [status, ...rest] = line.split('\t');
    return { status, path: rest.at(-1)! };
  }) : [];

  // 1. migrations only add
  const added: Record<string, string> = {};
  for (const c of changes) if (c.status.startsWith('A') && c.path.startsWith('migrations/')) added[c.path] = readFileSync(join(p.work, c.path), 'utf8');
  const existing = existsSync(join(p.live, 'migrations')) ? readdirSync(join(p.live, 'migrations')).map(f => `migrations/${f}`) : [];
  const problems = checkMigrations(changes, added, existing);
  if (!step('Data changes only add', problems.length === 0, problems.join('\n'))) return { ok: false, steps, changed: changes.length > 0 };

  // 2. types
  try {
    await run(join(paths.nodeModules, '.bin', 'tsc'), ['-p', p.work, '--noEmit'], { cwd: p.work, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    step('Types check', true);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    step('Types check', false, trim(e.stdout || e.stderr || e.message));
    return { ok: false, steps, changed: changes.length > 0 };
  }

  // 3. it builds
  const out = mkdtempSync(join(tmpdir(), 'sprout-build-'));
  try {
    await run(process.execPath, ['--no-warnings', join(paths.runtime, 'runner.mjs'), '--root', p.work, '--build', out, '--cache', join(p.cache, 'build')],
      { cwd: paths.home, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    step('Builds', true);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    step('Builds', false, trim(e.stderr || e.stdout || e.message));
    return { ok: false, steps, changed: changes.length > 0 };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }

  // 4. it runs: load it in a real browser against a throwaway copy of the data
  const smoke = await smokeTest(sproutId);
  step('Runs without errors', smoke.ok, smoke.detail);
  return { ok: steps.every(s => s.ok), steps, changed: changes.length > 0 };
}

async function smokeTest(sproutId: string): Promise<{ ok: boolean; detail: string }> {
  const p = sproutPaths(sproutId);
  const scratch = mkdtempSync(join(tmpdir(), 'sprout-smoke-'));
  const db = join(scratch, 'app.db');
  await backupDb(p.db, db);
  const runner = await spawnRunner({ root: p.work, db, cache: join(p.cache, 'smoke'), sproutId });
  const problems: string[] = [];
  const browser = await chromium.launch();
  try {
    await runner.ready;
    const base = `http://127.0.0.1:${runner.port}`;
    const page = await browser.newPage();
    page.on('console', msg => {
      // Fonts come from Google; being offline is not the change's fault.
      const where = msg.location().url ?? '';
      if (msg.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(where + msg.text())) problems.push(`Console error: ${msg.text().slice(0, 300)}`);
    });
    page.on('pageerror', err => problems.push(`Page crashed: ${err.message.slice(0, 300)}`));
    page.on('response', res => {
      if (res.url().startsWith(`${base}/api`) && res.status() >= 500) problems.push(`${res.request().method()} ${res.url().slice(base.length)} returned ${res.status()}`);
    });

    const health = await page.request.get(`${base}/api/health`);
    if (health.status() !== 200) problems.push(`/api/health returned ${health.status()}`);

    await page.goto(base, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(800);
    const rendered = await page.evaluate(() => (document.getElementById('root')?.childElementCount ?? 0) > 0);
    if (!rendered) problems.push('The page rendered nothing.');

    const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href')!)
      .filter(h => h.startsWith('/') || h.startsWith('#')))].slice(0, 5));
    for (const href of links) {
      await page.goto(href.startsWith('#') ? `${base}/${href}` : `${base}${href}`, { waitUntil: 'networkidle', timeout: 15_000 });
      await page.waitForTimeout(300);
    }
  } catch (err) {
    problems.push((err as Error).message.split('\n')[0]);
  } finally {
    await browser.close();
    runner.proc.kill('SIGTERM');
    rmSync(scratch, { recursive: true, force: true });
  }
  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, detail: trim(unique.join('\n'), 15) };
}

export function formatGate(result: GateResult): string {
  return result.steps.map(s => `${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.detail ? `\n${s.detail}` : ''}`).join('\n');
}
