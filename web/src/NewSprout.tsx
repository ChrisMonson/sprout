import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { api, type Feel, type NextQuestion } from './api.ts';
import { Leaf, Send } from './icons.tsx';
import { go } from './App.tsx';

type Line = { who: 'you' | 'sprout'; text: string };

const EXAMPLES = [
  'Something to keep track of my sourdough starter',
  'Plan meals around what’s already in my fridge',
  'Remember what I talked about with each client',
];

export default function NewSprout({ feels, setup, canGoHome }: { feels: Feel[]; setup: ReactNode; canGoHome: boolean }) {
  const [step, setStep] = useState<'seed' | 'ask' | 'feel'>('seed');
  const [seed, setSeed] = useState('');
  const [id, setId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [next, setNext] = useState<NextQuestion | null>(null);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const [feel, setFeel] = useState(feels[0]?.id ?? 'calm');
  const [feelNote, setFeelNote] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const retry = useRef<() => void>(() => {});

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [lines, thinking]);

  // Once Sprout has enough, move on to the feel by itself, after a moment to
  // read its last reply.
  const done = step === 'ask' && !!next?.done;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      const show = () => flushSync(() => setStep('feel'));
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(show);
      else show();
    }, 1600);
    return () => clearTimeout(t);
  }, [done]);

  const take = (n: NextQuestion) => {
    setNext(n);
    setLines(l => [...l, ...[n.reply, n.done ? '' : n.question].filter(Boolean).map(text => ({ who: 'sprout' as const, text }))]);
  };

  const plantSeed = async () => {
    const text = seed.trim();
    if (!text || thinking) return;
    retry.current = () => void plantSeed();
    setError('');
    setStep('ask');
    setLines([{ who: 'you', text }]);
    setThinking(true);
    try {
      const res = await api.post<{ id: string; next: NextQuestion }>('/seed', { seed: text });
      setId(res.id);
      take(res.next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const answer = async (text: string) => {
    text = text.trim();
    if (!text || !id || !next || next.done || thinking) return;
    setDraft('');
    setLines(l => [...l, { who: 'you', text }]);
    setThinking(true);
    setError('');
    retry.current = () => { setLines(l => l.slice(0, -1)); void answer(text); };
    try {
      const res = await api.post<{ next: NextQuestion }>(`/sprouts/${id}/answer`, { question: next.question, answer: text });
      take(res.next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setThinking(false);
    }
  };

  const plantIt = async () => {
    if (!id) return;
    setThinking(true);
    try {
      await api.post(`/sprouts/${id}/plant`, { preset: feel, note: feelNote });
      go(`/s/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setThinking(false);
    }
  };

  if (step === 'seed') {
    return (
      <div className="app">
        <main className="center">
          <div className="column" style={{ maxWidth: 640, alignItems: 'center', gap: 24, textAlign: 'center' }}>
            <span style={{ color: 'var(--gh-green)' }}><Leaf size={44} /></span>
            <h1 className="title-xl">What do you want to grow?</h1>
            <p className="lede">Describe a tool you wish you had, in your own words. It starts small and grows the more you use it.</p>
            {setup}
            <div className="composer big" style={{ width: '100%' }}>
              <label htmlFor="seed" className="sr">Describe the tool you want</label>
              <input id="seed" autoFocus value={seed} onChange={e => setSeed(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void plantSeed(); }} placeholder="Something to keep track of my sourdough starter" />
              <button className="btn" onClick={plantSeed} disabled={!seed.trim()}>Plant</button>
            </div>
            <div className="chips" style={{ justifyContent: 'center' }}>
              {EXAMPLES.map(x => <button key={x} className="chip" onClick={() => setSeed(x)}>{x}</button>)}
            </div>
            {canGoHome && <a href="#/">Back to your sprouts</a>}
          </div>
        </main>
      </div>
    );
  }

  if (step === 'feel') {
    return (
      <div className="app">
        <main className="center">
          <div className="column" style={{ maxWidth: 980, gap: 28 }}>
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h1 className="title-l">How should it feel?</h1>
              <p className="lede">This sets the colors, type and shape of your tool. You can change it any time.</p>
            </div>
            <div className="feel-grid">
              {feels.map(f => <FeelCard key={f.id} feel={f} name={next?.name || 'Your tool'} selected={feel === f.id} onPick={() => setFeel(f.id)} />)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
              <div className="composer" style={{ flex: '1 1 360px', maxWidth: 520 }}>
                <label htmlFor="feelnote" className="sr">Or describe the feel in your own words</label>
                <input id="feelnote" value={feelNote} onChange={e => setFeelNote(e.target.value)} placeholder='Or describe it: "like a well-worn field notebook"' />
              </div>
              <button className="btn" style={{ minHeight: 52, padding: '0 24px' }} onClick={plantIt} disabled={thinking}>Plant it</button>
            </div>
            {error && <p className="error" role="alert" style={{ textAlign: 'center' }}>{error}</p>}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <main className="center" style={{ alignItems: 'stretch', paddingTop: 40, paddingBottom: 24 }}>
        <div className="column thread" style={{ margin: '0 auto' }}>
          {lines.map((line, i) => line.who === 'you'
            ? <div key={i} className="bubble you">{line.text}</div>
            : <div key={i} className="from-sprout"><span className="avatar"><Leaf size={18} /></span><div className="bubble">{line.text}</div></div>)}
          {thinking && <div className="from-sprout"><span className="avatar"><Leaf size={18} /></span><div className="bubble" aria-label="Thinking"><span className="typing"><span /><span /><span /></span></div></div>}
          {!thinking && next && !next.done && next.suggestions.length > 0 && (
            <div className="chips indent">{next.suggestions.map(s => <button key={s} className="chip green" onClick={() => answer(s)}>{s}</button>)}</div>
          )}
          {!thinking && next?.done && (
            <p className="muted indent" style={{ margin: 0, fontSize: 14 }} aria-live="polite">Next, how it should feel…</p>
          )}
          {error && <p className="error indent" role="alert">{error} <button className="chip" onClick={() => retry.current()}>Try again</button></p>}
          <div ref={bottom} style={{ marginTop: 'auto', paddingTop: 24 }}>
            <div className="composer">
              <label htmlFor="draft" className="sr">Answer in your own words</label>
              <input id="draft" autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void answer(draft); }}
                placeholder={next?.done ? 'That’s enough to start' : 'Or answer in your own words'} disabled={!next || next.done || thinking} />
              <button className="icon-btn" aria-label="Send" style={{ background: 'var(--gh-green)', color: '#fff' }} onClick={() => answer(draft)} disabled={!draft.trim() || !next || next.done || thinking}><Send /></button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function FeelCard({ feel, name, selected, onPick }: { feel: Feel; name: string; selected: boolean; onPick: () => void }) {
  const t = feel.tokens;
  return (
    <button className="feel-card" aria-pressed={selected} onClick={onPick}>
      <span className="feel-preview" style={{ background: t.bg }}>
        <span className="t" style={{ fontFamily: t['font-head'], fontWeight: Number(t['head-weight']), color: t.ink }}>{name}</span>
        <span className="c" style={{ background: t.surface, border: t.border, boxShadow: t.shadow, borderRadius: t.radius, fontFamily: t['font-body'], color: t.muted }}>A card in your tool</span>
        <span className="b" style={{ background: t.accent, color: t['accent-ink'], borderRadius: t.radius, fontFamily: t['font-body'] }}>A button</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 6px 6px' }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{feel.name}</span>
        <span className="muted" style={{ fontSize: 14 }}>{feel.blurb}</span>
      </span>
    </button>
  );
}
