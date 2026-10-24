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

  const refresh = useCallback(() => { api.get<AppState>('/state').then(setState).catch(() => {}); }, []);
  useEffect(refresh, [refresh]);
  useStream(msg => { if (msg.type === 'sprout' || msg.type === 'turn') refresh(); });

  if (!state) return <div className="app" />;

  const sproutMatch = /^\/s\/([\w-]+)/.exec(route);
  if (sproutMatch) return <SproutView key={sproutMatch[1]} id={sproutMatch[1]} feels={state.feels} />;
  if (route === '/new' || state.sprouts.length === 0) {
    return <NewSprout feels={state.feels} credentials={state.credentials} canGoHome={state.sprouts.length > 0} />;
  }
  return <Home state={state} />;
}

function Home({ state }: { state: AppState }) {
  const statusText = (s: AppState['sprouts'][number]) =>
    s.status === 'planting' ? 'Planting…' : s.status === 'failed' ? "Didn't take root" : s.busy ? 'Growing…' : s.growing ? 'Growing' : 'Resting';
  return (
    <div className="app">
      <main className="home">
        <div className="home-head">
          <span className="brand" style={{ fontSize: 20 }}><Leaf size={26} />Sprout</span>
          <button className="btn" onClick={() => go('/new')}>Grow something new</button>
        </div>
        {state.credentials && !state.credentials.ok && <div className="banner" role="status">{state.credentials.message}</div>}
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
        </div>
      </main>
    </div>
  );
}
