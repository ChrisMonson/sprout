import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useStream } from './api.ts';

interface Window { percent: number; resetsAt: number | null }
export interface Usage {
  signIn: 'claude-code' | 'api-key';
  plan: { session: Window | null; week: Window | null; models: (Window & { name: string })[]; plan: string | null; checkedAt: number } | null;
  spend: { today: number; month: number };
}

/** Claude usage, kept current: asks for fresh plan numbers when shown, then follows live updates. */
export function useUsage(): Usage | null {
  const [usage, setUsage] = useState<Usage | null>(null);
  const load = useCallback((refresh: boolean) => {
    api.get<Usage>(`/usage${refresh ? '?refresh=1' : ''}`).then(setUsage).catch(() => {});
  }, []);
  useEffect(() => load(true), [load]);
  useStream(msg => { if (msg.type === 'usage') load(false); });
  return usage;
}

const dollars = (n: number) => n < 0.01 && n > 0 ? 'under $0.01' : `$${n.toFixed(2)}`;

function resetsAt(at: number | null) {
  if (!at) return '';
  const soon = at - Date.now() < 20 * 3600_000;
  return new Date(at).toLocaleString([], soon ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Near the end of a plan's session window: growing may pause until it resets. */
export const nearLimit = (usage: Usage | null) => (usage?.plan?.session?.percent ?? 0) >= 80;

function Bar({ label, window }: { label: string; window: Window }) {
  return (
    <div className="usage-row">
      <div className="usage-label"><span>{label}</span><span className="muted">{window.percent}% used{window.resetsAt ? ` · resets ${resetsAt(window.resetsAt)}` : ''}</span></div>
      <div className="usage-bar" role="meter" aria-label={label} aria-valuenow={window.percent} aria-valuemin={0} aria-valuemax={100}>
        <span className={window.percent >= 80 ? 'warn' : ''} style={{ width: `${Math.min(100, window.percent)}%` }} />
      </div>
    </div>
  );
}

/** The full picture: plan windows on a Claude plan, spend with an API key. */
export function UsageDetails({ usage, sproutSpent }: { usage: Usage; sproutSpent?: number }) {
  if (usage.signIn === 'api-key') {
    return (
      <div className="usage-details">
        <p className="small" style={{ margin: 0 }}>Sprout has spent <strong>{dollars(usage.spend.today)}</strong> today and <strong>{dollars(usage.spend.month)}</strong> this month on your API key.</p>
        {sproutSpent !== undefined && <p className="muted small" style={{ margin: 0 }}>Growing this sprout has cost {dollars(sproutSpent)} so far.</p>}
        <p className="muted small" style={{ margin: 0 }}>Estimates from each turn; your Anthropic Console has the exact bill.</p>
      </div>
    );
  }
  const plan = usage.plan;
  if (!plan) return <p className="muted small" style={{ margin: 0 }}>Claude didn’t share your plan’s usage just now.</p>;
  return (
    <div className="usage-details">
      {plan.session && <Bar label="This session" window={plan.session} />}
      {plan.week && <Bar label="This week" window={plan.week} />}
      {plan.models.filter(m => m.percent > 0).map(m => <Bar key={m.name} label={`${m.name} this week`} window={m} />)}
      <p className="muted small" style={{ margin: 0 }}>Your whole Claude plan, including your own use of Claude and Claude Code, not just Sprout.</p>
    </div>
  );
}

/** A small readout for a sprout's top bar that opens to the details. */
export function UsageMeter({ sproutSpent }: { sproutSpent?: number }) {
  const usage = useUsage();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', away);
    addEventListener('keydown', escape);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', escape); };
  }, [open]);
  if (!usage) return null;
  const session = usage.plan?.session;
  if (usage.signIn === 'claude-code' && !session) return null;
  const label = usage.signIn === 'api-key' ? `${dollars(usage.spend.today)} today` : `${session!.percent}%`;
  const title = usage.signIn === 'api-key' ? 'Spent on your API key today' : `Claude session ${session!.percent}% used${session!.resetsAt ? `, resets ${resetsAt(session!.resetsAt)}` : ''}`;
  return (
    <div className="usage-meter" ref={box}>
      <button className={`pill-btn${nearLimit(usage) ? ' warn' : ''}`} aria-expanded={open} title={title} aria-label={title} onClick={() => setOpen(o => !o)}>
        {session && <Ring percent={session.percent} />}{label}
      </button>
      {open && (
        <div className="usage-pop" role="dialog" aria-label="Claude usage">
          <h3>Claude usage</h3>
          <UsageDetails usage={usage} sproutSpent={sproutSpent} />
        </div>
      )}
    </div>
  );
}

function Ring({ percent }: { percent: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="usage-ring">
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className="track" />
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className={percent >= 80 ? 'fill warn' : 'fill'}
        strokeDasharray={`${(Math.min(100, percent) / 100) * c} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round" />
    </svg>
  );
}
