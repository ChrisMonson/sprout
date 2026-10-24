// Every change passes this gate before it can go live. It belongs to the
// greenhouse, so the agent can't weaken it: the sprout's own tests (if any)
// are never the only check. (Port of Og-World's gate/run-gate.sh + smoke.py.)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths, sproutPaths } from './paths.ts';
import { git } from './git.ts';
import { checkMigrations, type FileChange } from './migrations.ts';
import { spawnRunner } from './sprouts.ts';
import { backupDb } from './snapshot.ts';
import { nodeCommand, platform } from './platform.ts';

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
    const node = nodeCommand();
    await run(node.cmd, [join(paths.nodeModules, 'typescript', 'bin', 'tsc'), '-p', p.work, '--noEmit'],
      { cwd: p.work, env: { ...process.env, ...node.env }, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    step('Types check', true);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    step('Types check', false, trim(e.stdout || e.stderr || e.message));
    return { ok: false, steps, changed: changes.length > 0 };
  }

  // 3. it builds
  const out = mkdtempSync(join(tmpdir(), 'sprout-build-'));
  try {
    const node = nodeCommand();
    await run(node.cmd, ['--no-warnings', join(paths.runtime, 'runner.mjs'), '--root', p.work, '--build', out, '--cache', join(p.cache, 'build')],
      { cwd: paths.home, env: { ...process.env, ...node.env }, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
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
  try {
    await runner.ready;
    const base = `http://127.0.0.1:${runner.port}`;
    const health = await fetch(`${base}/api/health`).catch(() => null);
    if (health?.status !== 200) problems.push(`/api/health returned ${health?.status ?? 'nothing'}`);
    problems.push(...await platform().browserCheck(`${base}/`));
  } catch (err) {
    problems.push((err as Error).message.split('\n')[0]);
  } finally {
    runner.proc.kill('SIGTERM');
    rmSync(scratch, { recursive: true, force: true });
  }
  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, detail: trim(unique.join('\n'), 15) };
}

export function formatGate(result: GateResult): string {
  return result.steps.map(s => `${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.detail ? `\n${s.detail}` : ''}`).join('\n');
}
