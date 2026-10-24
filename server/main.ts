// Starts the greenhouse: installs the sprout runtime if needed, checks the
// Claude sign-in, serves the UI and API on one port, and starts the scheduler.

import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';
import { openDb } from './db.ts';
import { paths, PORT } from './paths.ts';
import { ensureRuntime, ensureBrowser } from './runtime.ts';
import { createApi } from './api.ts';
import { startScheduler } from './scheduler.ts';
import { stopAll } from './sprouts.ts';
import { checkCredentials, type CredentialStatus } from './agent/credentials.ts';

// node:sqlite is still marked experimental; the warning is noise here.
const emit = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (String(warning).includes('SQLite')) return;
  return (emit as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

console.log(`Sprout home: ${paths.home}`);
await ensureRuntime();
await ensureBrowser();
const db = openDb(paths.db);

// A sprout left mid-plant by a crash can't resume.
db.prepare("UPDATE sprouts SET status = 'failed' WHERE status = 'planting'").run();

let credentials: CredentialStatus | null = null;
const recheck = async () => {
  credentials = await checkCredentials();
  console.log(credentials.ok ? 'Claude: signed in.' : `Claude: ${credentials.message}`);
};
void recheck();

const api = createApi(db, () => credentials);
const apiListener = getRequestListener(api.fetch);

const server = createServer();
const vite = await createVite({
  root: paths.web,
  configFile: false,
  appType: 'spa',
  plugins: [react()],
  server: { middlewareMode: true, hmr: { server } },
  logLevel: 'warn',
});

server.on('request', (req, res) => {
  if (req.url?.startsWith('/api')) void apiListener(req, res);
  else vite.middlewares(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Sprout is running at http://localhost:${PORT}\n`);
});

const stopScheduler = startScheduler(db);

const shutdown = async () => {
  stopScheduler();
  stopAll();
  await vite.close();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
