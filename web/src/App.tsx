import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, useStream, type AppState } from './api.ts';
import { Leaf, Seed, Seedling } from './icons.tsx';
import NewSprout from './NewSprout.tsx';
import SproutView from './SproutView.tsx';

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

  if (!state) return <div className="app" />;

  const sproutMatch = /^\/s\/([\w-]+)(\/full)?/.exec(route);
  if (sproutMatch) {
    const id = sproutMatch[1];
    return <SproutView key={id} id={id} full={!!sproutMatch[2]} summary={state.sprouts.find(s => s.id === id)} />;
  }
  const nothingYet = state.sprouts.length === 0 && state.removed.length === 0;
  if (route === '/new' || nothingYet) {
    return <NewSprout feels={state.feels} setup={<SetupBanners state={state} onChange={refresh} />} canGoHome={!nothingYet} />;
  }
  return <Home state={state} onRefresh={refresh} />;
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
        <div className="sprout-list tray">
          {state.sprouts.map(s => (
            <a key={s.id} className="sprout-card" href={`#/s/${s.id}`}
              style={s.id === transitionSprout ? { viewTransitionName: `sprout-${s.id}` } : undefined}>
              <span className="n" style={s.id === transitionSprout ? { viewTransitionName: `sprout-name-${s.id}` } : undefined}>{s.name || 'Unnamed sprout'}</span>
              <span className="s">{s.seed}</span>
              <span className={`status ${statusGlyph(s).tone}`}>{statusGlyph(s).icon}{statusText(s)}</span>
            </a>
          ))}
          {Array.from({ length: emptyCells(state.sprouts.length) }, (_, i) => i === 0
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
  const signedOut = state.credentials && !state.credentials.ok;
  return (
    <>
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
