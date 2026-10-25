// Runs one sprout: a Vite dev server (or a production build with --build).
// The greenhouse spawns this as a child process, one per running sprout.
//
//   node runner.mjs --root DIR --port N --db PATH --sprout ID --cache DIR [--greenhouse URL]
//   node runner.mjs --root DIR --build OUTDIR --cache DIR
//   node runner.mjs --root DIR --build OUTDIR --cache DIR --harvest --sprout ID   (a phone build)

import { parseArgs } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import react from '@vitejs/plugin-react';
import { sproutPlugin } from './plugin.mjs';
import { harvestPlugin } from './harvest/plugin.mjs';

const { values: args } = parseArgs({
  options: {
    root: { type: 'string' },
    port: { type: 'string' },
    db: { type: 'string' },
    sprout: { type: 'string' },
    cache: { type: 'string' },
    greenhouse: { type: 'string' },
    build: { type: 'string' },
    harvest: { type: 'boolean' },
  },
});

const here = dirname(fileURLToPath(import.meta.url));
const home = dirname(here);

if (args.build && args.harvest) {
  // The sprout's server runs in the page, on sql.js, with Android notifications.
  await build({
    root: args.root,
    configFile: false,
    cacheDir: args.cache,
    logLevel: 'error',
    base: './',
    plugins: [react(), harvestPlugin({ root: args.root })],
    define: { __SPROUT_ID__: JSON.stringify(args.sprout ?? '') },
    resolve: {
      alias: {
        'node:sqlite': join(here, 'harvest', 'sqlite.js'),
        '@sprout/greenhouse': join(here, 'harvest', 'greenhouse.js'),
      },
    },
    build: { outDir: args.build, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4096 },
  }).catch(err => {
    // Bundler errors keep their detail in err.errors; print that, not the stack.
    console.error((err.errors ?? [err]).map(e => e.message).join('\n'));
    process.exit(1);
  });
  process.exit(0);
}

if (args.build) {
  await build({
    root: args.root,
    configFile: false,
    cacheDir: args.cache,
    logLevel: 'error',
    plugins: [react()],
    build: { outDir: args.build, emptyOutDir: true },
  });
  process.exit(0);
}

const server = await createServer({
  root: args.root,
  configFile: false,
  cacheDir: args.cache,
  clearScreen: false,
  logLevel: 'info',
  plugins: [react(), sproutPlugin({ sproutId: args.sprout, dbPath: args.db, greenhouseUrl: args.greenhouse })],
  server: {
    host: '127.0.0.1',
    port: Number(args.port),
    strictPort: true,
    fs: { allow: [args.root, home] },
  },
});
await server.listen();
console.log(`SPROUT_READY ${args.port}`);

const stop = async () => { await server.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
