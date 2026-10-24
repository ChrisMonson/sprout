import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { paths, sproutPaths, GREENHOUSE_URL } from './paths.ts';
import { git } from './git.ts';
import { feelCss, type Feel } from './feel.ts';
import { q, type Db } from './db.ts';
import { bus } from './bus.ts';
import { nodeCommand } from './platform.ts';
import { runtimePath } from './runtime.ts';

export function newSproutId(): string {
  return 's' + Date.now().toString(36) + randomBytes(2).toString('hex');
}

export function createSproutRow(db: Db, seed: string): string {
  const id = newSproutId();
  db.prepare('INSERT INTO sprouts (id, seed, status, created_at, position) VALUES (?, ?, ?, ?, ?)').run(id, seed, 'seeding', Date.now(), q.frontPosition(db));
  return id;
}

/** Copy the template into a fresh git repo (live = main) with a work worktree on branch "growing". */
export async function plantFiles(id: string, feel: Feel) {
  const p = sproutPaths(id);
  for (const dir of [p.data, p.snapshots, p.cache, p.memory]) mkdirSync(dir, { recursive: true });
  cpSync(paths.template, p.live, { recursive: true });
  writeFileSync(join(p.live, 'src', 'feel.css'), feelCss(feel));
  writeFileSync(p.journal, '# Journal\n');
  writeFileSync(p.understanding, '# Understanding\n');
  await git(p.live, 'init', '-q', '-b', 'main');
  await git(p.live, 'add', '-A');
  await git(p.live, 'commit', '-q', '-m', 'Planted from the template');
  await git(p.live, 'worktree', 'add', '-q', '-b', 'growing', p.work);
}

/** Start every agent turn from exactly what is live. */
export async function resetWork(id: string) {
  const p = sproutPaths(id);
  await git(p.work, 'reset', '-q', '--hard', 'main');
  await git(p.work, 'clean', '-q', '-fd');
}

// ---------- dev servers (one child process per running sprout) ----------

interface Running { proc: ChildProcess; port: number; ready: Promise<void> }
const running = new Map<string, Running>();

export async function freePort(from = 4201): Promise<number> {
  for (let port = from; port < from + 500; port++) {
    const ok = await new Promise<boolean>(resolve => {
      const srv = createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new Error('No free port for a sprout');
}

export interface RunnerOptions { root: string; db: string; cache: string; sproutId: string; greenhouse?: string; logFile?: string }

/** Spawn runtime/runner.mjs and resolve once Vite is listening. */
export async function spawnRunner(opts: RunnerOptions): Promise<Running> {
  const port = await freePort(opts.greenhouse ? 4201 : 4701);
  const args = [join(paths.runtime, 'runner.mjs'), '--root', opts.root, '--port', String(port), '--db', opts.db, '--sprout', opts.sproutId, '--cache', opts.cache];
  if (opts.greenhouse) args.push('--greenhouse', opts.greenhouse);
  const node = nodeCommand();
  const proc = spawn(node.cmd, ['--no-warnings', ...args], { cwd: paths.home, env: { ...process.env, ...node.env, PATH: runtimePath() }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = opts.logFile ? createWriteStream(opts.logFile, { flags: 'a' }) : null;
  let output = '';
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Dev server did not start:\n${output.slice(-2000)}`)), 60_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      log?.write(text);
      if (text.includes(`SPROUT_READY ${port}`)) { clearTimeout(timer); resolve(); }
    };
    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', onData);
    proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Dev server exited (${code}):\n${output.slice(-2000)}`)); });
  });
  return { proc, port, ready };
}

export async function ensureDevServer(db: Db, id: string): Promise<number> {
  const existing = running.get(id);
  if (existing) { await existing.ready; return existing.port; }
  const p = sproutPaths(id);
  const r = await spawnRunner({ root: p.live, db: p.db, cache: join(p.cache, 'live'), sproutId: id, greenhouse: GREENHOUSE_URL, logFile: p.log });
  running.set(id, r);
  r.proc.once('exit', code => {
    running.delete(id);
    if (code !== 0 && code !== null) {
      db.prepare('INSERT INTO events (sprout_id, ts, kind, detail) VALUES (?, ?, ?, ?)').run(id, Date.now(), 'server_error', JSON.stringify({ message: `The dev server stopped (exit ${code})` }));
    }
    bus.send({ type: 'sprout', sproutId: id });
  });
  try {
    await r.ready;
  } catch (err) {
    running.delete(id);
    r.proc.kill();
    throw err;
  }
  return r.port;
}

export function devServerPort(id: string): number | null {
  return running.get(id)?.port ?? null;
}

export function stopDevServer(id: string) {
  running.get(id)?.proc.kill('SIGTERM');
  running.delete(id);
}

export function stopAll() {
  for (const id of [...running.keys()]) stopDevServer(id);
}

export function sproutExists(db: Db, id: string): boolean {
  return !!q.sprout(db, id) && existsSync(sproutPaths(id).live);
}
