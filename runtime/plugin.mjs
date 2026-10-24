// The greenhouse's Vite plugin for a sprout. It lives outside the sprout's
// folder, so the agent that grows the sprout can read about it but never edit it.
//
// It does four things:
//   - applies the sprout's additive SQL migrations to its database
//   - serves /api/* from the sprout's own server/api.ts (hot-reloaded via ssrLoadModule)
//   - injects the observer script into the page
//   - reports server and build errors back to the greenhouse

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const OBSERVER_PATH = '/@sprout/observer.js';

export function applyMigrations(root, dbPath) {
  const dir = join(root, 'migrations');
  if (!existsSync(dir)) return [];
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const done = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
    const applied = [];
    for (const name of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      const sql = readFileSync(join(dir, name), 'utf8');
      db.exec('BEGIN');
      try {
        db.exec(sql);
        db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
        db.exec('COMMIT');
        applied.push(name);
      } catch (err) {
        db.exec('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${err.message}`);
      }
    }
    return applied;
  } finally {
    db.close();
  }
}

export function sproutPlugin({ sproutId, dbPath, greenhouseUrl }) {
  const report = (kind, detail) => {
    if (!greenhouseUrl) return;
    fetch(`${greenhouseUrl}/api/sprouts/${sproutId}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, detail }),
    }).catch(() => {});
  };

  return {
    name: 'sprout-greenhouse',

    configureServer(server) {
      const root = server.config.root;
      process.env.SPROUT_DB = dbPath;
      process.env.SPROUT_ID = sproutId;
      if (greenhouseUrl) process.env.SPROUT_GREENHOUSE_URL = greenhouseUrl;

      const migrate = () => {
        try {
          const applied = applyMigrations(root, dbPath);
          if (applied.length) server.config.logger.info(`[sprout] applied ${applied.join(', ')}`);
        } catch (err) {
          server.config.logger.error(`[sprout] ${err.message}`);
          report('server_error', { message: err.message, where: 'migrations' });
        }
      };
      migrate();
      server.watcher.on('add', file => { if (file.includes('/migrations/') && file.endsWith('.sql')) migrate(); });

      // Surface compile errors (the red overlay) to the greenhouse too.
      const send = server.ws.send.bind(server.ws);
      server.ws.send = (payload, ...rest) => {
        if (payload && typeof payload === 'object' && payload.type === 'error') {
          report('build_error', { message: String(payload.err?.message ?? '').slice(0, 2000), file: payload.err?.id });
        }
        return send(payload, ...rest);
      };

      server.middlewares.use(async (req, res, next) => {
        if (req.url === OBSERVER_PATH) {
          res.setHeader('content-type', 'text/javascript');
          res.end(readFileSync(join(here, 'observer.js')));
          return;
        }
        if (!req.url?.startsWith('/api')) return next();
        try {
          const mod = await server.ssrLoadModule('/server/api.ts');
          const app = mod.default;
          if (!app?.fetch) throw new Error('server/api.ts must default-export a Hono app');
          const request = toRequest(req);
          const response = await app.fetch(request);
          if (response.status >= 500) {
            report('server_error', { message: `${req.method} ${req.url} returned ${response.status}` });
          }
          await sendResponse(res, response);
        } catch (err) {
          server.ssrFixStacktrace?.(err);
          report('server_error', { message: String(err?.message ?? err).slice(0, 2000), route: `${req.method} ${req.url}` });
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
        }
      });
    },

    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: OBSERVER_PATH }, injectTo: 'head' }];
    },
  };
}

function toRequest(req) {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    else if (value != null) headers.set(key, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
}

async function sendResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) return res.end();
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}
