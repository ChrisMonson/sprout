import { useCallback, useEffect, useState } from 'react';
import { api, useStream, type AppState } from './api.ts';
import { Leaf } from './icons.tsx';
import NewSprout from './NewSprout.tsx';
import SproutView from './SproutView.tsx';

function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

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
  if (sproutMatch) return <SproutView key={sproutMatch[1]} id={sproutMatch[1]} full={!!sproutMatch[2]} feels={state.feels} />;
  const nothingYet = state.sprouts.length === 0 && state.removed.length === 0;
  if (route === '/new' || nothingYet) {
    return <NewSprout feels={state.feels} setup={<SetupBanners state={state} onChange={refresh} />} canGoHome={!nothingYet} />;
  }
  return <Home state={state} onRefresh={refresh} />;
}

function Home({ state, onRefresh }: { state: AppState; onRefresh: () => void }) {
  const statusText = (s: AppState['sprouts'][number]) =>
    s.status === 'planting' ? 'Planting…' : s.status === 'failed' ? "Didn't take root" : s.busy ? 'Growing…' : s.growing ? 'Growing' : 'Resting';
  return (
    <div className="app">
      <main className="home">
        <div className="home-head">
          <span className="brand" style={{ fontSize: 20 }}><Leaf size={26} />Sprout</span>
          <button className="btn" onClick={() => go('/new')}>Grow something new</button>
        </div>
        <SetupBanners state={state} onChange={onRefresh} />
        {state.pausedUntil > Date.now() && state.pausedUntil - Date.now() < 7 * 24 * 3600_000 && (
          <div className="banner" role="status">Sprout is resting until {new Date(state.pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (Claude usage limit). Your tools still work.</div>
        )}
        <h1 className="title-l">Your sprouts</h1>
        <div className="sprout-list">
          {state.sprouts.map(s => (
            <a key={s.id} className="sprout-card" href={`#/s/${s.id}`}>
              <span className="n">{s.name || 'Unnamed sprout'}</span>
              <span className="s">{s.seed}</span>
              <span className="status"><i className={s.busy ? 'busy' : s.growing && s.status === 'ready' ? 'on' : ''} />{statusText(s)}</span>
            </a>
          ))}
          {state.sprouts.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing growing right now.</p>}
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
