// Runs first in a harvested sprout, before its own front end. It opens the
// database and serves the sprout's /api from its own server code, inside the
// page: same-origin /api requests never leave the phone.
//
// Android also loads the app in a hidden web view every so often (see the
// SproutBackgroundWorker the harvest adds), with ?sprout-background. Then this
// runs the sprout's periodic tasks once, saves, and tells Android it's done.

import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import migrations from 'virtual:sprout-migrations';
import { openStore, save, store } from './store.js';

const background = new URLSearchParams(location.search).has('sprout-background') && !!globalThis.SproutNative;
globalThis.__sproutBackground = background;
const tasks = (globalThis.__sproutTasks ??= []);

// Sprout server code reads its settings from process.env, as under Node.
globalThis.process ??= { env: {} };
Object.assign(globalThis.process.env ??= {}, { SPROUT_DB: 'app.db', SPROUT_ID: __SPROUT_ID__ });

const DB_NAME = 'sprout';

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      tx.oncomplete = () => { open.result.close(); resolve(req.result); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

// ---- requests ----

const pageFetch = window.fetch.bind(window);
let inFlight = 0;
let lastActivity = Date.now();
const track = promise => {
  inFlight++;
  return promise.finally(() => { inFlight--; lastActivity = Date.now(); });
};

/** fetch through the native helper, which (unlike the hidden web view) isn't held back by CORS. */
const nativeReplies = new Map();
globalThis.__sproutNative = {
  done(id, json) {
    const reply = nativeReplies.get(id);
    nativeReplies.delete(id);
    reply?.(JSON.parse(json));
  },
};
let nativeIds = 0;
function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
async function nativeFetch(input, init = {}) {
  const request = new Request(input, init);
  const body = ['GET', 'HEAD'].includes(request.method) ? null : new Uint8Array(await request.arrayBuffer());
  const id = `f${++nativeIds}`;
  const reply = await new Promise((resolve, reject) => {
    nativeReplies.set(id, resolve);
    request.signal?.addEventListener('abort', () => { nativeReplies.delete(id); reject(request.signal.reason ?? new DOMException('Aborted', 'AbortError')); });
    globalThis.SproutNative.fetch(id, JSON.stringify({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: body && body.length ? toBase64(body) : null,
    }));
  });
  if (reply.error) {
    console.warn(`[sprout] background fetch failed: ${request.url}: ${reply.error}`);
    throw new TypeError(`Failed to fetch: ${reply.error}`);
  }
  const bytes = Uint8Array.from(atob(reply.body ?? ''), c => c.charCodeAt(0));
  return new Response([204, 205, 304].includes(reply.status) ? null : bytes, { status: reply.status, headers: reply.headers ?? {} });
}

async function seed() {
  try {
    const res = await pageFetch(new URL('sprout-seed.db', document.baseURI));
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

function showError(err) {
  console.error('[sprout]', err);
  if (background) return;
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:auto 12px 12px;z-index:99999;margin:0;padding:12px;border-radius:10px;background:#5b1a12;color:#fff;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;max-height:40vh;overflow:auto';
  box.textContent = `This tool couldn't start on the phone:\n${err?.stack ?? err}`;
  document.body.append(box);
}

// ---- the sprout's server ----

/** When this page loaded the database, by the stamp saved with it: a newer stamp means someone else saved since. */
let loadedStamp = 0;

const server = (async () => {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await idb('readonly', files => files.get('app.db'));
  loadedStamp = (await idb('readonly', files => files.get('savedAt'))) ?? 0;
  // In the background, nothing is saved until the run ends (and only if the app didn't save meanwhile).
  store.autoSave = !background;
  openStore({
    SQL,
    saved: saved ? new Uint8Array(saved) : undefined,
    seed: saved ? undefined : await seed(),
    migrations,
    persist: bytes => {
      loadedStamp = Date.now();
      const at = loadedStamp;
      return idb('readwrite', files => { files.put(bytes, 'app.db'); return files.put(at, 'savedAt'); }).catch(showError);
    },
  });
  // Timers the server starts as it loads are its periodic checks: in the
  // background they're run once below instead of on a timer.
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms, ...args) => {
    if (typeof fn === 'function' && ms >= 30_000) tasks.push({ ms, task: () => fn(...args) });
    return background ? 0 : realSetInterval(fn, ms, ...args);
  };
  try {
    // The server module opens the database when it loads, so it loads now.
    const { default: app } = await import('virtual:sprout-server');
    return app;
  } finally {
    globalThis.setInterval = realSetInterval;
  }
})();
server.catch(showError);

const isApi = url => url.origin === location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/'));

window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (isApi(url)) return track(server.then(app => app.fetch(new Request(input instanceof Request ? input : url, init))));
  if (background && url.origin !== location.origin) return track(nativeFetch(input, init));
  return track(pageFetch(input, init));
};

// ---- in the background ----

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const within = (promise, ms) => Promise.race([promise, sleep(ms)]);

/** Until nothing's been in flight for a moment (or time runs out). */
async function settled(maxMs) {
  const until = Date.now() + maxMs;
  while (Date.now() < until && (inFlight > 0 || Date.now() - lastActivity < 1500)) await sleep(250);
}

async function runInBackground() {
  try {
    await server;
    await sleep(2000); // let start-up timers (a first refresh) begin
    for (const { task } of tasks) {
      await within(Promise.resolve().then(task).catch(err => console.error('[sprout] background task:', err)), 45_000);
    }
    await settled(45_000);
    // Only keep this run's changes if the app hasn't saved since this page loaded the data.
    const current = (await idb('readonly', files => files.get('savedAt'))) ?? 0;
    const keep = current === loadedStamp && store.dirty;
    if (keep) {
      save();
      await store.lastWrite;
    }
    console.info(`[sprout] background run: ${tasks.length} task(s), ${keep ? 'saved' : store.dirty ? 'dropped (the app saved meanwhile)' : 'nothing changed'}`);
    try { localStorage.setItem('sprout-background-ran', String(Date.now())); } catch { /* best effort */ }
  } catch (err) {
    console.error('[sprout] background run failed:', err);
  } finally {
    globalThis.SproutNative.done();
  }
}

if (background) {
  void runInBackground();
} else {
  // Save before Android puts the app away, and pick up what a background run found when it comes back.
  const openedAt = Date.now();
  const flush = () => { if (store.dirty) save(); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return flush();
    let ran = 0;
    try { ran = Number(localStorage.getItem('sprout-background-ran') ?? 0); } catch { /* none */ }
    if (ran > openedAt) location.reload();
  });
  window.addEventListener('pagehide', flush);
}
