// Starts the greenhouse: sets up the sprout runtime, checks git and the Claude
// sign-in, serves the UI and API on one port, and starts the scheduler.
// Used by both the terminal entry (main.ts) and the desktop app.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { openDb } from './db.ts';
import { paths } from './paths.ts';
import { ensureRuntime, hasGit } from './runtime.ts';
import { createApi } from './api.ts';
import { startScheduler } from './scheduler.ts';
import { stopAll } from './sprouts.ts';
import { acquireLock, releaseLock } from './lock.ts';
import { checkCredentials, openSignIn, type CredentialStatus } from './agent/credentials.ts';
import { listModels } from './agent/models.ts';
import { claudeEnabled, getSettings } from './settings.ts';
import { platform } from './platform.ts';

export interface GreenhouseOptions {
  port: number;
  /** 'vite' serves web/ with hot reload (development); otherwise the built UI from staticDir. */
  web: 'vite' | { staticDir: string };
  log?: (line: string) => void;
}

export interface Greenhouse {
  port: number;
  stop(): Promise<void>;
}

export async function startGreenhouse(options: GreenhouseOptions): Promise<Greenhouse> {
  const log = options.log ?? console.log;
  quietSqliteWarning();
  log(`Sprout home: ${paths.home}`);
  acquireLock(paths.lock);

  await ensureRuntime(log);
  const git = await hasGit();
  if (!git) log('git is missing: install Apple’s Command Line Tools with `xcode-select --install`.');
  const db = openDb(paths.db);
  platform().setAppearance?.(getSettings(db).appearance);

  // Turns cut off by a stop or crash can't resume: close them out, and put
  // anything they had picked up back in the queue. A sprout left mid-plant fails.
  db.prepare("UPDATE turns SET status = 'interrupted', ended_at = ? WHERE status = 'running'").run(Date.now());
  db.prepare("UPDATE whispers SET status = 'new' WHERE status = 'taken'").run();
  db.prepare("UPDATE sprouts SET status = 'failed' WHERE status = 'planting'").run();

  let credentials: CredentialStatus | null = null;
  const recheck = async () => {
    // With Claude off, Sprout never contacts it, not even to check sign-in.
    if (!claudeEnabled(db)) {
      credentials = null;
      log('Claude: off (Greenhouse Settings).');
      return { ok: false, checkedAt: Date.now(), message: 'Claude is turned off in Settings.' };
    }
    credentials = await checkCredentials();
    log(credentials.ok ? 'Claude: signed in.' : `Claude: ${credentials.message}`);
    if (credentials.ok) void listModels(true).catch(() => {});
    return credentials;
  };
  void recheck();

  const api = createApi(db, { credentials: () => credentials, recheck, signIn: openSignIn, git });
  const apiListener = getRequestListener(api.fetch);

  const server = createServer();
  let web: (req: IncomingMessage, res: ServerResponse) => void;
  let closeWeb = async () => {};
  if (options.web === 'vite') {
    const { createServer: createVite } = await import('vite');
    const { default: react } = await import('@vitejs/plugin-react');
    const vite = await createVite({
      root: paths.web,
      configFile: false,
      appType: 'spa',
      plugins: [react()],
      server: { middlewareMode: true, hmr: { server } },
      logLevel: 'warn',
    });
    web = vite.middlewares;
    closeWeb = () => vite.close();
  } else {
    web = serveStatic(options.web.staticDir);
  }

  server.on('request', (req, res) => {
    if (req.url?.startsWith('/api')) void apiListener(req, res);
    else web(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
  log(`Sprout is running at http://localhost:${options.port}`);

  const stopScheduler = startScheduler(db);

  return {
    port: options.port,
    async stop() {
      stopScheduler();
      stopAll();
      await closeWeb();
      server.close();
      releaseLock(paths.lock);
    },
  };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

/** The built UI. Unknown paths get index.html, since routing happens in the page. */
function serveStatic(root: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = normalize(join(root, path));
    if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  };
}

// node:sqlite is still marked experimental; the warning is noise here.
function quietSqliteWarning() {
  const emit = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning).includes('SQLite')) return;
    return (emit as (...a: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}
