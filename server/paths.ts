import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
/** Where the template, briefs, runtime and built UI live: the repo, or the app's Resources folder. */
export const RESOURCES = process.env.SPROUT_RESOURCES ?? REPO;
export const HOME = process.env.SPROUT_HOME ?? join(homedir(), 'Sprout');
export const PORT = Number(process.env.SPROUT_PORT ?? 4100);
export const GREENHOUSE_URL = `http://127.0.0.1:${PORT}`;

export const paths = {
  home: HOME,
  db: join(HOME, 'greenhouse.db'),
  runtime: join(HOME, '.runtime'),
  nodeModules: join(HOME, 'node_modules'),
  sprouts: join(HOME, 'sprouts'),
  removed: join(HOME, 'removed'),
  turns: join(HOME, 'turns'),
  lock: join(HOME, 'greenhouse.lock'),
  shimBin: join(HOME, '.runtime', 'bin'),
  template: join(RESOURCES, 'template'),
  briefs: join(RESOURCES, 'briefs'),
  runtimeSource: join(RESOURCES, 'runtime'),
  /** Dependencies installed at build time, shipped inside the app. */
  prebuiltModules: join(RESOURCES, 'build', 'runtime', 'node_modules'),
  web: join(RESOURCES, 'web'),
  webDist: join(RESOURCES, 'dist', 'web'),
};

export function sproutPaths(id: string) {
  const base = join(paths.sprouts, id);
  return {
    base,
    live: join(base, 'live'),
    work: join(base, 'work'),
    data: join(base, 'data'),
    db: join(base, 'data', 'app.db'),
    snapshots: join(base, 'snapshots'),
    cache: join(base, 'cache'),
    memory: join(base, 'memory'),
    journal: join(base, 'memory', 'journal.md'),
    understanding: join(base, 'memory', 'understanding.md'),
    notes: join(base, 'memory', 'notes.md'),
    log: join(base, 'devserver.log'),
  };
}
