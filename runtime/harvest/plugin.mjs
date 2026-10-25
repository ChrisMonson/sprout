// Vite plugin for a harvested (phone) build of a sprout. It runs boot.js
// before the sprout's own front end, and gives boot.js the sprout's server
// module and migrations to start inside the page.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = '\0sprout-migrations';

/** The module script index.html starts the front end with (usually src/main.tsx). */
function entryOf(root) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const src = html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/i)?.[1] ?? '/src/main.tsx';
  return resolve(root, src.replace(/^\//, ''));
}

export function harvestPlugin({ root }) {
  const entry = entryOf(root);
  const boot = join(here, 'boot.js');

  return {
    name: 'sprout-harvest',
    enforce: 'pre',

    resolveId(id) {
      if (id === 'virtual:sprout-server') return join(root, 'server', 'api.ts');
      if (id === 'virtual:sprout-migrations') return MIGRATIONS;
      return null;
    },

    load(id) {
      if (id !== MIGRATIONS) return null;
      const dir = join(root, 'migrations');
      const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.sql')).sort() : [];
      const all = Object.fromEntries(files.map(f => [f, readFileSync(join(dir, f), 'utf8')]));
      return `export default ${JSON.stringify(all)};`;
    },

    transform(code, id) {
      if (id.split('?')[0] !== entry) return null;
      return { code: `import ${JSON.stringify(boot)};\n${code}`, map: null };
    },
  };
}
