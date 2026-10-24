import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, timeOf, useStream, type Bud, type Feel, type SproutDetail, type Target } from './api.ts';
import { Bud as BudIcon, Check, Close, Expand, Grow, History, Leaf, Send, Shrink, Target as TargetIcon } from './icons.tsx';
import { go } from './App.tsx';

interface Toast { text: string; undoGrowthId?: number }

export default function SproutView({ id, full }: { id: string; full: boolean; feels: Feel[] }) {
  const [detail, setDetail] = useState<SproutDetail | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [startError, setStartError] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Cards that float over the tool show briefly, then fold into small pills
  // so they don't sit on top of it. Clicking a pill opens its card again.
  const [workingOpen, setWorkingOpen] = useState(false);
  const [foldedBuds, setFoldedBuds] = useState<number[]>([]);
  const workingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openWorking = (ms = 6000) => {
    setWorkingOpen(true);
    clearTimeout(workingTimer.current);
    workingTimer.current = setTimeout(() => setWorkingOpen(false), ms);
  };

  // The tool can fill the browser window with Sprout's own UI hidden. It is a
  // route (#/s/<id>/full) so it can be bookmarked.
  const enterFull = () => go(`/s/${id}/full`);
  const exitFull = () => go(`/s/${id}`);

  const refresh = useCallback(() => {
    // Fill in lists an older greenhouse server doesn't send yet (see App.tsx).
    api.get<SproutDetail>(`/sprouts/${id}`).then(d => setDetail({
      ...d, growth: d.growth ?? [], buds: d.buds ?? [], whispers: d.whispers ?? [], turns: d.turns ?? [], notifications: d.notifications ?? [],
    })).catch(() => {});
  }, [id]);
  useEffect(refresh, [refresh]);

  const status = detail?.sprout.status;
  useEffect(() => { if (status === 'removed') go('/'); }, [status]);
  useEffect(() => {
    if (status !== 'ready' || url) return;
    api.post<{ url: string }>(`/sprouts/${id}/start`).then(r => setUrl(r.url)).catch(err => setStartError((err as Error).message));
  }, [id, status, url]);

  const showToast = (t: Toast) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 7000);
  };

  useStream(msg => {
    if (msg.sproutId !== id) return;
    if (msg.type === 'sprout') refresh();
    if (msg.type === 'progress') setLines(l => [...l, msg.line].slice(-12));
    if (msg.type === 'turn') {
      if (msg.status === 'running') { setLines([]); openWorking(); }
      refresh();
    }
    if (msg.type === 'toast') showToast({ text: msg.text, undoGrowthId: msg.undoGrowthId });
    if (msg.type === 'notification') showToast({ text: msg.body ? `${msg.title}: ${msg.body}` : msg.title });
  });

  const bud = detail?.buds[0];
  const busy = !!detail?.sprout.busy;
  useEffect(() => {
    // A new suggestion or question folds itself away after it has been on
    // screen for a while (it stays hidden while the agent is working).
    if (!bud || busy) return;
    const t = setTimeout(() => setFoldedBuds(f => f.includes(bud.id) ? f : [...f, bud.id]), 15_000);
    return () => clearTimeout(t);
  }, [bud?.id, busy]);

  if (!detail) return <div className="app" />;
  const { sprout } = detail;
  if (sprout.status === 'removed') return <div className="app" />;

  if (sprout.status === 'planting' || (sprout.status === 'ready' && !url && !startError)) {
    return <Sprouting name={sprout.name} lines={lines} planting={sprout.status === 'planting'} />;
  }
  if (sprout.status === 'failed') {
    return (
      <div className="app"><main className="center"><div className="column" style={{ maxWidth: 520, gap: 16, textAlign: 'center', alignItems: 'center' }}>
        <h1 className="title-l">This one didn’t take root</h1>
        <p className="lede">Something went wrong while planting “{sprout.seed}”. Try planting it again; it usually works the second time.</p>
        <a className="btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} href="#/new">Plant again</a>
        <RemoveSprout id={id} name={sprout.name} />
        <a href="#/">Back to your sprouts</a>
      </div></main></div>
    );
  }

  const undo = async (growthId: number) => {
    setToast(null);
    try {
      await api.post(`/sprouts/${id}/rewind`, { growthId });
      showToast({ text: 'Rewound.' });
    } catch (err) {
      showToast({ text: (err as Error).message });
    }
  };

  return (
    <div className={full ? 'app full' : 'app'} style={{ height: '100%' }}>
      {full ? (
        <button className="exit-full" onClick={exitFull} aria-label="Show Sprout" title="Show Sprout"><Shrink /></button>
      ) : (
      <header className="topbar">
        <a className="brand" href="#/"><Leaf />Sprout</a>
        <span aria-hidden="true" style={{ color: '#AEB9B1' }}>/</span>
        <span style={{ fontWeight: 600 }}>{sprout.name || 'Your tool'}</span>
        <span className="status" role="status">
          <i className={sprout.busy ? 'busy' : sprout.growing ? 'on' : ''} />
          {sprout.busy ? 'Working…' : sprout.pending ? 'New growth waiting for a pause' : sprout.growing ? 'Growing' : 'Resting'}
        </span>
        <div className="right">
          <button className="switch" role="switch" aria-checked={sprout.growing} onClick={async () => {
            await api.post(`/sprouts/${id}/growing`, { on: !sprout.growing });
            showToast({ text: sprout.growing ? `Growth is resting. ${sprout.name || 'Your tool'} won’t change until you turn it back on.` : 'Growing again.' });
          }}>
            <span className="track" aria-hidden="true" />Growth
          </button>
          <button className="pill-btn" aria-expanded={historyOpen} onClick={() => setHistoryOpen(o => !o)}><History />History</button>
          <button className="pill-btn" onClick={enterFull} aria-label="Hide Sprout and fill the window" title="Hide Sprout and fill the window"><Expand /></button>
        </div>
      </header>
      )}

      <div className="stage">
        {url
          ? <ToolFrame id={id} url={url} name={sprout.name} growing={sprout.growing} full={full} onSent={text => showToast({ text })} />
          : <p className="error" role="alert">{startError}</p>}

        {sprout.busy && workingOpen && (
          <aside className="card-float working" aria-live="polite">
            <span className="pulse-dot" aria-hidden="true" />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{lines.at(-1) ?? 'Thinking about what you said…'}</span>
              <span className="muted" style={{ fontSize: 14 }}>Keep using it. Nothing will move while you’re in the middle of something.</span>
            </span>
            <button className="fold" aria-label="Hide" title="Hide" onClick={() => { clearTimeout(workingTimer.current); setWorkingOpen(false); }}><Close size={12} /></button>
          </aside>
        )}
        {!sprout.busy && bud && !foldedBuds.includes(bud.id) && (
          <BudCard key={bud.id} id={id} bud={bud} onDone={refresh} onFold={() => setFoldedBuds(f => [...f, bud.id])} />
        )}
        <div className="pills">
          {sprout.busy && !workingOpen && (
            <button className="pill" onClick={() => openWorking(15_000)} title="What Sprout is doing">
              <span className="pulse-dot small" aria-hidden="true" />
              <span className="pill-text">{lines.at(-1) ?? 'Working…'}</span>
            </button>
          )}
          {!sprout.busy && bud && foldedBuds.includes(bud.id) && (
            <button className="pill" onClick={() => setFoldedBuds(f => f.filter(x => x !== bud.id))}>
              {bud.kind === 'question' ? <Leaf size={14} /> : <BudIcon size={14} />}
              <span className="pill-text">{bud.kind === 'question' ? 'Sprout has a question' : 'Sprout has an idea'}</span>
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undoGrowthId && <button onClick={() => undo(toast.undoGrowthId!)}>Undo</button>}
        </div>
      )}

      {historyOpen && <HistoryDrawer detail={detail} onClose={() => setHistoryOpen(false)} onRewind={undo}
        footer={<RemoveSprout id={id} name={sprout.name} />}
        onCancelNotification={nid => api.post(`/sprouts/${id}/notify/cancel`, { id: nid }).then(refresh).catch(() => {})} />}
    </div>
  );
}

function Sprouting({ name, lines, planting }: { name: string; lines: string[]; planting: boolean }) {
  const shown = lines.length ? lines : ['Reading what you told me'];
  return (
    <div className="app"><main className="center"><div className="column" style={{ maxWidth: 460, alignItems: 'center', gap: 24 }}>
      <Grow />
      <h1 style={{ fontSize: 30 }}>{planting ? `Planting ${name || 'your tool'}` : 'Waking it up'}</h1>
      <ul className="steps" aria-live="polite">
        {shown.map((line, i) => (
          <li key={i} className={i < shown.length - 1 ? 'done' : ''}>
            {i < shown.length - 1 ? <Check /> : <span className="dot" aria-hidden="true" />}
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {planting && <p className="muted" style={{ fontSize: 14, textAlign: 'center' }}>This usually takes a few minutes. You can leave this page; it keeps growing.</p>}
    </div></main></div>
  );
}

/** The live tool, plus the whisper bar that talks to the observer inside it. */
function ToolFrame({ id, url, name, growing, full, onSent }: { id: string; url: string; name: string; growing: boolean; full: boolean; onSent: (text: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [pointing, setPointing] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [text, setText] = useState('');
  // In full screen the whisper bar folds into a small button until it's needed.
  const [open, setOpen] = useState(false);
  const folded = full && !open && !pointing && !target && !text;
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const msg = e.data as { source?: string; type?: string; events?: unknown[]; target?: Target };
      if (msg?.source !== 'sprout-observer') return;
      if (msg.type === 'events' && msg.events?.length) void api.post(`/sprouts/${id}/events`, { events: msg.events }).catch(() => {});
      if (msg.type === 'activity') void api.post(`/sprouts/${id}/activity`).catch(() => {});
      if (msg.type === 'point:result' && msg.target) { setTarget(msg.target); setPointing(false); input.current?.focus(); }
      if (msg.type === 'point:cancel') setPointing(false);
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, [id]);

  const togglePoint = () => {
    const next = !pointing;
    setPointing(next);
    if (next) setTarget(null);
    frame.current?.contentWindow?.postMessage({ source: 'greenhouse', type: next ? 'point:start' : 'point:stop' }, '*');
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    const sentTarget = target;
    setTarget(null);
    setOpen(false);
    try {
      await api.post(`/sprouts/${id}/whisper`, { text: t, target: sentTarget });
      onSent(growing ? 'Heard. Sprout will work on it, and change things when you pause.' : 'Saved. Sprout will look at it when growth is back on.');
    } catch (err) {
      onSent((err as Error).message);
      setText(t);
    }
  };

  const about = target ? (target.text || target.sproutId || target.tag) : '';
  return (
    <>
      <iframe ref={frame} className="frame" src={url} title={name || 'Your tool'} />
      {folded ? (
        <button className="whisper-fab" onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0); }} aria-label="Tell Sprout something" title="Tell Sprout something"><Leaf size={22} /></button>
      ) : (
      <div className="whisper-wrap">
        <div className="whisper">
          {pointing && (
            <div className="hint"><span>Click any part of {name || 'your tool'} to talk about it.</span><button className="ghost-dark" onClick={togglePoint}>Cancel</button></div>
          )}
          {target && (
            <span className="about">About: {about.length > 40 ? `${about.slice(0, 40)}…` : about}
              <button aria-label="Clear" onClick={() => setTarget(null)}><Close size={12} /></button>
            </span>
          )}
          <div className="row">
            <button className="icon-btn" aria-pressed={pointing} aria-label="Point at something" title="Point at something" onClick={togglePoint}
              style={{ background: pointing ? 'var(--gh-green)' : 'var(--gh-dark-2)', color: '#fff' }}><TargetIcon /></button>
            <label htmlFor="whisper" className="sr">Tell Sprout something</label>
            <input id="whisper" ref={input} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void send(); }}
              placeholder={!growing ? 'Growth is resting. Notes will wait for later.' : target ? 'What should change here?' : `Tell Sprout anything about ${name || 'your tool'}…`} />
            <button className="icon-btn" aria-label="Send to Sprout" style={{ background: 'var(--gh-green)', color: '#fff' }} onClick={send}><Send /></button>
            {full && <button className="icon-btn" aria-label="Hide" title="Hide" style={{ background: 'transparent', color: 'var(--gh-on-dark-muted)' }} onClick={() => { setOpen(false); setTarget(null); if (pointing) togglePoint(); }}><Close size={16} /></button>}
          </div>
        </div>
      </div>
      )}
    </>
  );
}

function BudCard({ id, bud, onDone, onFold }: { id: string; bud: Bud; onDone: () => void; onFold: () => void }) {
  const [answer, setAnswer] = useState('');
  const act = async (action: 'accept' | 'dismiss' | 'answer', value?: string) => {
    await api.post(`/sprouts/${id}/buds/${bud.id}`, { action, answer: value }).catch(() => {});
    onDone();
  };
  if (bud.kind === 'question') {
    return (
      <aside className="card-float" aria-label="A question from Sprout">
        <span className="kicker"><Leaf size={16} />A question<button className="fold" aria-label="Hide for now" title="Hide for now" onClick={onFold}><Close size={12} /></button></span>
        <p>{bud.text}</p>
        {bud.suggestions?.length ? <div className="actions">{bud.suggestions.map(s => <button key={s} className="btn quiet small" onClick={() => act('answer', s)}>{s}</button>)}</div> : null}
        <div className="composer">
          <label htmlFor={`answer-${bud.id}`} className="sr">Your answer</label>
          <input id={`answer-${bud.id}`} value={answer} onChange={e => setAnswer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && answer.trim()) void act('answer', answer); }} placeholder="Or in your own words" />
          <button className="icon-btn" aria-label="Send answer" style={{ background: 'var(--gh-green)', color: '#fff', width: 40, height: 40 }} onClick={() => answer.trim() && act('answer', answer)}><Send /></button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="card-float" aria-label="A suggestion from Sprout">
      <span className="kicker"><BudIcon />A bud<button className="fold" aria-label="Hide for now" title="Hide for now" onClick={onFold}><Close size={12} /></button></span>
      <p>{bud.text}</p>
      <div className="actions">
        <button className="btn small" onClick={() => act('accept')}>Grow it</button>
        <button className="btn quiet small" onClick={() => act('dismiss')}>Not now</button>
      </div>
    </aside>
  );
}

function HistoryDrawer({ detail, onClose, onRewind, onCancelNotification, footer }: {
  detail: SproutDetail; onClose: () => void; onRewind: (growthId: number) => void; onCancelNotification: (id: number) => void; footer: ReactNode;
}) {
  const day = (ts: number) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const whisperStatus: Record<string, string> = {
    new: detail.sprout.growing ? 'Waiting to be worked on' : 'Waiting until growth is back on',
    taken: 'Sprout is working on this',
    done: 'Done',
  };
  return (
    <aside className="drawer" aria-label="History">
      <header>
        <h2>History</h2>
        <button className="icon-btn" aria-label="Close history" style={{ background: '#F0F3F0', width: 40, height: 40 }} onClick={onClose}><Close size={16} /></button>
      </header>
      {detail.notifications.length > 0 && (
        <section>
          <h3>Coming up</h3>
          {detail.notifications.map(n => (
            <div key={n.id} className="entry">
              <span className="mark" aria-hidden="true" />
              <div className="body">
                <span className="t">{n.title}</span>
                {n.body && <span className="d">{n.body}</span>}
                <span className="w">{day(n.dueAt)}, {timeOf(n.dueAt)}</span>
              </div>
              <button className="btn quiet small" style={{ alignSelf: 'flex-start' }} onClick={() => onCancelNotification(n.id)}>Cancel</button>
            </div>
          ))}
        </section>
      )}
      <section>
        <h3>What grew</h3>
        {detail.growth.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Nothing yet.</p>}
        {detail.growth.map(g => (
          <div key={g.id} className={`entry ${g.kind}`}>
            <span className="mark" aria-hidden="true" />
            <div className="body">
              <span className="t">{g.title}</span>
              {g.detail && <span className="d">{g.detail}</span>}
              <span className="w">{day(g.ts)}, {timeOf(g.ts)}</span>
            </div>
            {g.rewindable ? <button className="btn quiet small" style={{ alignSelf: 'flex-start' }} onClick={() => onRewind(g.id)}>Rewind</button> : null}
          </div>
        ))}
      </section>
      <section>
        <h3>Things you’ve told Sprout</h3>
        {detail.whispers.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>Nothing yet. Point at any part of your tool and say what you think.</p>}
        {detail.whispers.map(w => (
          <div key={w.id} className="note">
            <span className="w muted" style={{ fontSize: 13 }}>{w.target ? `About ${w.target.text || w.target.sproutId || w.target.tag}` : 'In general'} · {timeOf(w.ts)}</span>
            <span className="q">“{w.text}”</span>
            <span className="s">{whisperStatus[w.status] ?? w.status}</span>
          </div>
        ))}
      </section>
      <section className="drawer-footer">{footer}</section>
    </aside>
  );
}

/** Moves a sprout to Removed on the home page, after one confirmation. Nothing is deleted. */
function RemoveSprout({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    try {
      await api.post(`/sprouts/${id}/remove`);
      go('/');
    } catch (err) {
      setError((err as Error).message);
    }
  };
  if (!confirming) {
    return <button className="btn quiet small" onClick={() => setConfirming(true)}>Remove this sprout…</button>;
  }
  return (
    <div className="confirm" role="group" aria-label="Confirm removal">
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
        Remove {name || 'this sprout'}? It stops running and moves to <strong>Removed</strong> on the home page, with its data, until you bring it back or delete it for good.
      </p>
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn small danger" onClick={remove}>Remove</button>
        <button className="btn quiet small" onClick={() => { setConfirming(false); setError(''); }}>Cancel</button>
      </div>
    </div>
  );
}
