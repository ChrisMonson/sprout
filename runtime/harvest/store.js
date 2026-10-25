// The one SQLite database of a harvested sprout, held in memory by sql.js and
// saved to the phone after writes. The node:sqlite shim (sqlite.js) reads it
// from here, so the sprout's own server code runs unchanged.

export const store = {
  /** The open sql.js Database. */
  raw: null,
  /** Bumped whenever sql.js frees prepared statements (it does on export). */
  generation: 0,
  dirty: false,
  /** PRAGMAs the sprout set, replayed after a save resets them. */
  pragmas: [],
  persist: null,
  timer: null,
  /** Save shortly after writes; off for a background run, which saves once at the end. */
  autoSave: true,
  /** The last save's promise, when persist returns one. */
  lastWrite: null,
};

/**
 * Open the database: the saved copy, else the seed from the Mac, else empty.
 * Then apply migrations the same way the greenhouse does (runtime/plugin.mjs).
 * persist(bytes) stores a snapshot; saved is the last snapshot, if any.
 */
export function openStore({ SQL, saved, seed, migrations, persist }) {
  store.raw = new SQL.Database(saved ?? seed ?? undefined);
  store.persist = persist;
  store.generation++;
  const applied = applyMigrations(migrations);
  if (store.autoSave && (!saved || applied.length)) save();
}

export function applyMigrations(migrations) {
  const db = store.raw;
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((db.exec('SELECT name FROM _migrations')[0]?.values ?? []).map(r => r[0]));
  const applied = [];
  for (const name of Object.keys(migrations).sort()) {
    if (done.has(name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migrations[name]);
      db.run('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)', [name, new Date().toISOString()]);
      db.exec('COMMIT');
      applied.push(name);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${err.message}`);
    }
  }
  return applied;
}

/** Note a write; the database is saved shortly after the last one. */
export function touched() {
  store.dirty = true;
  if (!store.autoSave) return;
  clearTimeout(store.timer);
  store.timer = setTimeout(save, 400);
}

/** Save now, unless a transaction is open (then try again shortly). */
export function save() {
  if (!store.raw || !store.persist) return;
  clearTimeout(store.timer);
  try {
    store.raw.exec('BEGIN');
    store.raw.exec('COMMIT');
  } catch {
    store.timer = setTimeout(save, 400);
    return;
  }
  const bytes = store.raw.export();
  store.generation++;
  for (const sql of store.pragmas) {
    try { store.raw.exec(sql); } catch { /* a pragma sql.js can't honour */ }
  }
  store.dirty = false;
  store.lastWrite = store.persist(bytes);
}
