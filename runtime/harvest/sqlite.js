// node:sqlite for a harvested sprout: the same synchronous DatabaseSync API,
// backed by the sql.js database in store.js. Every DatabaseSync shares that
// one database, whatever path the sprout passes.

import { store, touched } from './store.js';

const PREFIXES = ['$', ':', '@'];

function value(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  return v;
}

/** node:sqlite takes named parameters with or without their prefix; sql.js needs it. */
function params(args) {
  const [first] = args;
  if (args.length === 1 && first !== null && typeof first === 'object' && !(first instanceof Uint8Array) && !Array.isArray(first)) {
    const named = {};
    for (const [key, v] of Object.entries(first)) {
      if (PREFIXES.includes(key[0])) named[key] = value(v);
      else for (const p of PREFIXES) named[p + key] = value(v);
    }
    return named;
  }
  return args.map(value);
}

const writes = sql => !/^\s*(SELECT|EXPLAIN)\b/i.test(sql);

export class StatementSync {
  #sql;
  #stmt = null;
  #generation = -1;

  constructor(sql) {
    this.#sql = sql;
    this.#prepared();
  }

  get sourceSQL() { return this.#sql; }

  /** sql.js frees statements when it saves, so prepare again when that happened. */
  #prepared() {
    if (this.#generation !== store.generation) {
      this.#stmt = store.raw.prepare(this.#sql);
      this.#generation = store.generation;
    }
    return this.#stmt;
  }

  #rows(args, limit) {
    const stmt = this.#prepared();
    stmt.bind(params(args));
    const rows = [];
    try {
      while (rows.length < limit && stmt.step()) rows.push({ ...stmt.getAsObject() });
    } finally {
      stmt.reset();
    }
    if (writes(this.#sql)) touched();
    return rows;
  }

  all(...args) { return this.#rows(args, Infinity); }
  get(...args) { return this.#rows(args, 1)[0]; }
  iterate(...args) { return this.all(...args)[Symbol.iterator](); }

  run(...args) {
    const stmt = this.#prepared();
    stmt.bind(params(args));
    try {
      while (stmt.step()) { /* drain, e.g. RETURNING */ }
    } finally {
      stmt.reset();
    }
    const changes = store.raw.getRowsModified();
    const lastInsertRowid = store.raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
    touched();
    return { changes, lastInsertRowid };
  }

  // Accepted for compatibility; rows are always plain objects with numbers.
  setReadBigInts() { return this; }
  setAllowBareNamedParameters() { return this; }
  setReturnArrays() { return this; }
}

export class DatabaseSync {
  #open = true;

  constructor() {
    if (!store.raw) throw new Error('The database is not ready yet.');
  }

  get isOpen() { return this.#open; }

  prepare(sql) { return new StatementSync(sql); }

  exec(sql) {
    // WAL needs shared memory sql.js doesn't have; other pragmas are remembered.
    if (/^\s*PRAGMA\s+journal_mode/i.test(sql)) return;
    store.raw.exec(sql);
    if (/^\s*PRAGMA\b/i.test(sql) && !store.pragmas.includes(sql)) store.pragmas.push(sql);
    else touched();
  }

  close() { this.#open = false; }
  open() { this.#open = true; }
}

export default { DatabaseSync, StatementSync };
