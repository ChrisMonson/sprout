import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { flushSync } from 'react-dom';
import { api, useStream, type AppState } from './api.ts';
import { Cog, Leaf, Seed, Seedling } from './icons.tsx';
import NewSprout from './NewSprout.tsx';
import SproutView from './SproutView.tsx';
import SettingsPage from './Settings.tsx';

function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    // Route changes animate with a view transition: a tray cell grows into
    // its sprout's frame and shrinks back (see view-transition-name below).
    const onChange = () => {
      const sproutIn = (hash: string) => /^#\/s\/([\w-]+)/.exec(hash)?.[1];
      const opening = sproutIn(location.hash);
      const leaving = sproutIn(shownHash);
      const toHome = (location.hash.replace(/^#/, '') || '/') === '/';
      shownHash = location.hash;
      // A named element with nothing to become on the new page hovers over it
      // as its own layer until the transition ends, so only names with a
      // counterpart survive. Going home, the sprout's frame shrinks into its
      // cell; between a sprout's normal and full views, its frame carries over.
      if (!toHome) {
        const unname = (selector: string) => document.querySelectorAll<HTMLElement>(selector).forEach(el => { el.style.viewTransitionName = ''; });
        unname('a.sprout-card, a.sprout-card .n');
        if (leaving && leaving !== opening) unname('[style*="view-transition-name"]');
        else if (leaving) unname('.topbar [style*="view-transition-name"]'); // the header isn't shown in the full view
        transitionSprout = opening ?? null;
      }
      // The clicked cell must be named before the old view is captured.
      const cell = opening && document.querySelector<HTMLElement>(`a.sprout-card[href="#/s/${opening}"]`);
      if (cell) {
        cell.style.viewTransitionName = `sprout-${opening}`;
        cell.querySelector<HTMLElement>('.n')?.style.setProperty('view-transition-name', `sprout-name-${opening}`);
      }
      const update = () => flushSync(() => setHash(location.hash));
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(update);
      else update();
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

/**
 * The one tray cell that takes part in the open/close transition: the sprout
 * being opened, or the one being returned from. Naming every cell would make
 * each its own animated layer, and the others would float over the new page.
 */
let transitionSprout: string | null = null;
/** The route currently on screen, so a route change knows where it came from. */
let shownHash = location.hash;

export function go(path: string) {
  location.hash = path;
}

export default function App() {
  const route = useRoute();
  const [state, setState] = useState<AppState | null>(null);

  // Fill in lists an older greenhouse server doesn't send yet, so a UI that
  // hot-reloaded ahead of its server still renders.
  const refresh = useCallback(() => {
    api.get<AppState>('/state').then(s => setState({ ...s, sprouts: s.sprouts ?? [], removed: s.removed ?? [] })).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);
  useStream(msg => { if (msg.type === 'sprout' || msg.type === 'turn') refresh(); });
  useAppearance(state?.appearance ?? 'system');

  if (!state) return <div className="app" />;
  return <><DragStrip route={route} /><Page route={route} state={state} refresh={refresh} /></>;
}

function Page({ route, state, refresh }: { route: string; state: AppState; refresh: () => void }) {
  const sproutMatch = /^\/s\/([\w-]+)(\/full)?/.exec(route);
  if (sproutMatch) {
    const id = sproutMatch[1];
    return <SproutView key={id} id={id} full={!!sproutMatch[2]} summary={state.sprouts.find(s => s.id === id)} />;
  }
  if (route === '/settings') return <SettingsPage state={state} onChange={refresh} />;
  const nothingYet = state.sprouts.length === 0 && state.removed.length === 0;
  if (route === '/new' || nothingYet) {
    return <NewSprout feels={state.feels} setup={<SetupBanners state={state} onChange={refresh} />} canGoHome={!nothingYet} claude={state.claudeEnabled !== false} />;
  }
  return <Home state={state} onRefresh={refresh} />;
}

/**
 * In the desktop app, a strip along the top of the window to drag it by. A
 * sprout's own header (or, filling the window, its slim top bar) does this
 * job, so the strip is left out there; on top of them it would swallow clicks.
 */
function DragStrip({ route }: { route: string }) {
  if (/^\/s\/[\w-]+(\/full)?$/.test(route)) return null;
  return <div className="drag-strip" aria-hidden="true" />;
}

/** A seedling while it grows, a seed while it rests. */
function statusGlyph(s: AppState['sprouts'][number]) {
  if (s.status === 'failed') return { icon: <i />, tone: '' };
  if (s.busy || s.status === 'planting') return { icon: <Seedling />, tone: 'glyph busy' };
  if (s.growing) return { icon: <Seedling />, tone: 'glyph growing' };
  return { icon: <Seed />, tone: 'glyph resting' };
}

const TRAY_COLUMNS = 3;

/** Empty cells to finish the tray's last row, always leaving at least one to plant in. */
function emptyCells(count: number) {
  const leftover = (TRAY_COLUMNS - (count % TRAY_COLUMNS)) % TRAY_COLUMNS;
  return leftover === 0 ? TRAY_COLUMNS : leftover;
}

function Home({ state, onRefresh }: { state: AppState; onRefresh: () => void }) {
  const [importError, setImportError] = useState('');
  const { sprouts, tray, drag, moveBy } = useTrayOrder(state.sprouts, onRefresh);
  const statusText = (s: AppState['sprouts'][number]) =>
    s.status === 'planting' ? 'Planting…' : s.status === 'failed' ? "Didn't take root" : s.busy ? 'Growing…' : s.growing ? 'Growing' : 'Resting';
  return (
    <div className="app">
      <main className="home">
        <div className="home-head">
          <span className="brand" style={{ fontSize: 20 }}><Leaf size={26} />Sprout</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ImportSprout onError={setImportError} />
            <button className="btn" onClick={() => go('/new')}>Grow something new</button>
            <a className="pill-btn icon-only" href="#/settings" aria-label="Settings" title="Settings"><Cog /></a>
          </div>
        </div>
        <SetupBanners state={state} onChange={onRefresh} />
        {importError && <div className="banner" role="alert">{importError}</div>}
        {state.pausedUntil > Date.now() && state.pausedUntil - Date.now() < 7 * 24 * 3600_000 && (
          <div className="banner" role="status">Sprout is resting until {new Date(state.pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (Claude usage limit). Your tools still work.</div>
        )}
        <h1 className="title-l">Your sprouts</h1>
        {/* A nod to a seed-starting tray: each sprout sits in a cell, and the
            row is filled out with empty cells, the first of which plants a new one. */}
        <div className="sprout-list tray" ref={tray} onDragOver={drag.over} onDrop={drag.drop}>
          {sprouts.map(s => (
            <a key={s.id} className={`sprout-card${drag.id === s.id ? ' dragging' : ''}`} href={`#/s/${s.id}`} data-id={s.id}
              draggable onDragStart={e => drag.start(e, s.id)} onDragEnd={drag.end}
              onKeyDown={e => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); moveBy(s.id, e.key === 'ArrowLeft' ? -1 : 1); } }}
              title="Drag to reorder (or Option-← / →)" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
              style={s.id === transitionSprout ? { viewTransitionName: `sprout-${s.id}` } : undefined}>
              <span className="card-head">
                {!!s.icon && <img className="card-icon" src={`/api/sprouts/${s.id}/icon.svg?v=${s.icon}`} alt="" draggable={false} />}
                <span className="n" style={s.id === transitionSprout ? { viewTransitionName: `sprout-name-${s.id}` } : undefined}>{s.name || 'Unnamed sprout'}</span>
              </span>
              <span className="s">{s.seed}</span>
              <span className={`status ${statusGlyph(s).tone}`}>{statusGlyph(s).icon}{statusText(s)}</span>
            </a>
          ))}
          {Array.from({ length: emptyCells(sprouts.length) }, (_, i) => i === 0
            ? <a key="plant" className="cell-empty plant" href="#/new"><span aria-hidden="true">+</span>Grow something new</a>
            : <span key={i} className="cell-empty extra" aria-hidden="true" />)}
        </div>
        {state.removed.length > 0 && (
          <section className="removed" aria-labelledby="removed-title">
            <h2 id="removed-title">Removed</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Removed sprouts keep everything, including their data, until you delete them forever.</p>
            {state.removed.map(r => <RemovedRow key={r.id} sprout={r} />)}
          </section>
        )}
      </main>
    </div>
  );
}

function RemovedRow({ sprout }: { sprout: AppState['removed'][number] }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const act = (fn: () => Promise<unknown>) => fn().catch(err => setError((err as Error).message));
  return (
    <div className="removed-row">
      <div className="body">
        <span className="n">{sprout.name || 'Unnamed sprout'}</span>
        <span className="muted" style={{ fontSize: 14 }}>Removed {new Date(sprout.removedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
        {error && <span className="error" role="alert">{error}</span>}
      </div>
      {confirming ? (
        <div className="actions" role="group" aria-label="Confirm delete">
          <span style={{ fontSize: 14 }}>Delete it and its data for good?</span>
          <button className="btn small danger" onClick={() => act(() => api.delete(`/sprouts/${sprout.id}`))}>Delete forever</button>
          <button className="btn quiet small" onClick={() => setConfirming(false)}>Keep it</button>
        </div>
      ) : (
        <div className="actions">
          <button className="btn small" onClick={() => act(() => api.post(`/sprouts/${sprout.id}/restore`))}>Bring back</button>
          <button className="btn quiet small" onClick={() => setConfirming(true)}>Delete forever…</button>
        </div>
      )}
    </div>
  );
}

/** Things Sprout needs before it can grow anything: git, and a Claude sign-in. */
function SetupBanners({ state, onChange }: { state: AppState; onChange: () => void }) {
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    await api.post('/sign-in/check').catch(() => {});
    setChecking(false);
    onChange();
  };
  const signedOut = state.claudeEnabled !== false && state.credentials && !state.credentials.ok;
  return (
    <>
      {state.claudeEnabled === false && (
        <div className="banner" role="status">
          Claude is off, so nothing grows and new sprouts can’t be planted. Your tools keep working. <a href="#/settings">Turn it on in Settings</a>.
        </div>
      )}
      {state.git === false && (
        <div className="banner" role="status">
          Sprout needs Apple’s Command Line Tools to keep track of changes. Open Terminal, run <code>xcode-select --install</code>, then restart Sprout.
        </div>
      )}
      {signedOut && (
        <div className="banner" role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: '1 1 240px' }}>{state.credentials!.message}{state.credentials!.signedOut ? ' A Terminal window will open; type /login there and follow the steps.' : ''}</span>
          {state.credentials!.signedOut && <button className="btn small" onClick={() => api.post('/sign-in')}>Sign in</button>}
          <button className="btn quiet small" onClick={recheck} disabled={checking}>{checking ? 'Checking…' : 'I’ve signed in'}</button>
        </div>
      )}
    </>
  );
}

/** Brings in a .sprout file exported from Sprout, as a new (resting) sprout. */
function ImportSprout({ onError }: { onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    onError('');
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
      const body = await res.json() as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? 'That file couldn’t be imported.');
      go(`/s/${body.id}`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input ref={input} type="file" accept=".sprout" className="sr" tabIndex={-1} aria-hidden="true" onChange={e => void choose(e.target.files?.[0])} />
      <button className="btn quiet" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Importing…' : 'Import…'}</button>
    </>
  );
}

type Summary = AppState['sprouts'][number];

/**
 * Drag-to-reorder for the tray. While dragging, the order updates live so the
 * other cells slide aside (animated FLIP-style); dropping saves it. Dropping on
 * an empty cell moves the sprout to the end. Option-arrows move a focused cell.
 */
function useTrayOrder(source: Summary[], onSaved: () => void) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const tray = useRef<HTMLDivElement>(null);
  const rects = useRef(new Map<string, DOMRect>());
  // dragend follows drop; it must not undo an order that was just dropped.
  const dropped = useRef(false);
  // The drag in progress, readable by handlers from an older render.
  const dragging = useRef<string | null>(null);

  const byId = new Map(source.map(s => [s.id, s]));
  const ids = order ? [...order.filter(id => byId.has(id)), ...source.filter(s => !order.includes(s.id)).map(s => s.id)] : source.map(s => s.id);
  const sprouts = ids.map(id => byId.get(id)!);

  // Remember where every cell was before a change, then slide each from there to its new place.
  const measure = () => {
    rects.current.clear();
    tray.current?.querySelectorAll<HTMLElement>('[data-id]').forEach(el => rects.current.set(el.dataset.id!, el.getBoundingClientRect()));
  };
  useLayoutEffect(() => {
    if (!rects.current.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    tray.current?.querySelectorAll<HTMLElement>('[data-id]').forEach(el => {
      const before = rects.current.get(el.dataset.id!);
      if (!before) return;
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left, dy = before.top - after.top;
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: 'ease-out' });
    });
    rects.current.clear();
  }, [ids.join()]);

  // Cells slide for a moment after each move; hovering while they slide would
  // read the pointer as over a different cell and swap straight back.
  const settledAt = useRef(0);
  const SLIDE_MS = 180;

  const place = (next: string[]) => {
    if (next.join() === ids.join()) return;
    measure();
    settledAt.current = performance.now() + SLIDE_MS;
    setOrder(next);
  };

  const save = async (next: string[]) => {
    await api.post('/order', { ids: next }).catch(() => {});
    onSaved();
  };

  // Where in the card it was picked up, so we can follow the card itself
  // (not the pointer) as it moves.
  const grab = useRef({ x: 0, y: 0, w: 0, h: 0 });

  /** The slot the held card's center is over: a sprout's id, null for an empty cell, undefined for none. */
  const slotUnderCard = (e: DragEvent): string | null | undefined => {
    const box = tray.current?.getBoundingClientRect();
    if (!box) return undefined;
    const cx = e.clientX - grab.current.x + grab.current.w / 2 - box.left;
    const cy = e.clientY - grab.current.y + grab.current.h / 2 - box.top;
    for (const el of tray.current!.querySelectorAll<HTMLElement>('[data-id], .cell-empty')) {
      // Layout positions, so cells mid-slide are judged where they will be.
      if (cx >= el.offsetLeft && cx < el.offsetLeft + el.offsetWidth && cy >= el.offsetTop && cy < el.offsetTop + el.offsetHeight) {
        return el.dataset.id ?? null;
      }
    }
    return undefined;
  };

  const moveTo = (id: string, target: string | null) => {
    const without = ids.filter(x => x !== id);
    const at = target === null ? without.length : without.indexOf(target);
    // Moving forward lands after the target, backward before it, which feels like swapping places.
    const offset = target !== null && ids.indexOf(id) < ids.indexOf(target) ? 1 : 0;
    return [...without.slice(0, at + offset), id, ...without.slice(at + offset)];
  };

  const drag = {
    id: dragId,
    start(e: DragEvent, id: string) {
      dropped.current = false;
      const card = e.currentTarget as HTMLElement;
      const rect = card.getBoundingClientRect();
      grab.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
      // The browser snapshots the card for the drag image right after this
      // handler; drop the hover outline first, or slivers of it show at the
      // rounded corners (it is drawn outside the card and cropped).
      card.classList.add('lifting');
      setTimeout(() => card.classList.remove('lifting'), 50);
      dragging.current = id;
      setDragId(id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    },
    // One handler on the whole tray: the card swaps into whichever slot its
    // center is over. After a swap its center sits in its own new slot, so it
    // stays put until it is moved into another one.
    over(e: DragEvent) {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (performance.now() < settledAt.current) return;
      const target = slotUnderCard(e);
      if (target === undefined || target === dragId) return;
      if (target === null && ids.at(-1) === dragId) return;
      place(moveTo(dragId, target));
    },
    drop(e: DragEvent) {
      if (!dragId) return;
      e.preventDefault();
      dropped.current = true;
      dragging.current = null;
      setDragId(null);
      void save(ids);
    },
    end() {
      // Let go outside the tray: put things back.
      if (dropped.current || !dragging.current) return;
      dragging.current = null;
      setDragId(null);
      measure();
      setOrder(null);
    },
  };

  const moveBy = (id: string, step: number) => {
    const i = ids.indexOf(id), j = i + step;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    place(next);
    void save(next);
    requestAnimationFrame(() => tray.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus());
  };

  // Once the server has the new order, follow it again.
  useEffect(() => { if (order && !dragId && source.map(s => s.id).join() === order.join()) setOrder(null); }, [source, order, dragId]);

  return { sprouts, tray, drag, moveBy };
}

/** Light or dark for the greenhouse's own screens; "system" follows macOS as it changes. */
function useAppearance(appearance: 'system' | 'light' | 'dark') {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      try { localStorage.setItem('sprout-theme', dark ? 'dark' : 'light'); } catch { /* fine without it */ }
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
}
