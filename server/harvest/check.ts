// Can this sprout run on a phone? A harvested sprout runs its server inside
// the app's web view, where Node's own modules don't exist. node:sqlite is the
// exception: the harvest build swaps in a SQLite that works there.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';

export interface Portability {
  /** Why it can't be harvested; empty when it can. */
  blockers: string[];
  /** Things that may not work on the phone. */
  warnings: string[];
}

const BUILTINS = new Set(builtinModules.map(m => m.replace(/^node:/, '')));
const SHIMMED = new Set(['sqlite']);

const WHAT: Record<string, string> = {
  dgram: 'talks to devices directly over the network',
  net: 'talks to devices directly over the network',
  tls: 'talks to devices directly over the network',
  http: 'runs its own network server',
  https: 'runs its own network server',
  http2: 'runs its own network server',
  fs: 'reads or writes files on the Mac',
  'fs/promises': 'reads or writes files on the Mac',
  child_process: 'runs programs on the Mac',
  os: 'reads details about the Mac',
  worker_threads: 'uses Node worker threads',
};

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path);
    return /\.(tsx?|jsx?|mjs)$/.test(name) ? [path] : [];
  });
}

export function checkPortability(root: string, name = 'This sprout'): Portability {
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const file of [...files(join(root, 'server')), ...files(join(root, 'src'))]) {
    const rel = relative(root, file);
    const code = readFileSync(file, 'utf8');
    for (const [, spec] of code.matchAll(IMPORT)) {
      const bare = spec.replace(/^node:/, '');
      if (!spec.startsWith('node:') && !BUILTINS.has(bare)) continue;
      if (SHIMMED.has(bare)) continue;
      const what = WHAT[bare] ?? `uses Node's ${bare} module`;
      blockers.push(`${name} ${what} (${spec} in ${rel}), which a phone app can't do.`);
    }
    if (rel.startsWith('server') && /\bBuffer\./.test(code)) {
      blockers.push(`${name} uses Node's Buffer in ${rel}, which a phone app doesn't have.`);
    }
    if (rel.startsWith('src') && /(?:src|href)=\{?\s*[`"']\/api\//.test(code)) {
      warnings.push(`${rel} loads something straight from /api (an image or link). That may not show on the phone.`);
    }
    if (/new\s+EventSource\s*\(/.test(code)) {
      warnings.push(`${rel} uses live updates (EventSource), which won't work on the phone.`);
    }
  }
  if (hasBackgroundTasks(root)) {
    warnings.push(`${name} checks for things on a timer. On the phone, Android also wakes it to check while it's closed, about every 15 minutes at best; with the phone idle or on low battery it can be much less often.`);
  }
  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

/** Does the server check for things on a timer (every() or setInterval)? Then the phone app wakes in the background. */
export function hasBackgroundTasks(root: string): boolean {
  return /\bsetInterval\s*\(|(?<![.\w])every\s*\(/.test(files(join(root, 'server')).map(f => readFileSync(f, 'utf8')).join('\n'));
}
