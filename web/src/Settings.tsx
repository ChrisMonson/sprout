import { useEffect, useState } from 'react';
import { api, type AppState } from './api.ts';
import { ChevronLeft, Leaf } from './icons.tsx';
import { UsageDetails, useUsage } from './Usage.tsx';

type Step = 'questions' | 'plant' | 'grow' | 'observe';
interface StepModel { model: string; effort: string | null }
interface ModelChoice { value: string; displayName: string; description: string; resolvedModel: string; followsLatest: boolean; efforts: string[] }
interface View {
  settings: { appearance: 'system' | 'light' | 'dark'; claude: { enabled: boolean; signIn: 'claude-code' | 'api-key'; keyHint: string | null }; models: Record<Step, StepModel>; concurrency: number };
  presets: Record<string, { label: string; blurb: string; models: Record<Step, StepModel> }>;
  models: ModelChoice[];
  modelsError: string;
  effective: Record<Step, { model: string; effort?: string; fellBack: boolean }>;
}

const STEPS: { step: Step; label: string; what: string }[] = [
  { step: 'questions', label: 'Questions', what: 'The short conversation before planting' },
  { step: 'plant', label: 'Planting', what: 'Builds the first version' },
  { step: 'grow', label: 'Growing', what: 'Makes the changes you ask for, and fixes' },
  { step: 'observe', label: 'Observing', what: 'Looks at how a tool is used; never changes it' },
];

const same = (a: Record<Step, StepModel>, b: Record<Step, StepModel>) =>
  STEPS.every(({ step }) => a[step].model === b[step].model && (a[step].effort ?? null) === (b[step].effort ?? null));

function UsageCard() {
  const usage = useUsage();
  if (!usage) return null;
  return (
    <section className="settings-card">
      <h2>Usage</h2>
      <UsageDetails usage={usage} />
    </section>
  );
}

/** Claude Code's sign-in (your Claude plan), or an Anthropic API key (pay per use) kept in the keychain. */
function SignInChoice({ view, state, busy, save, replace, onChange }: {
  view: View; state: AppState; busy: boolean; save: (patch: unknown) => Promise<void>; replace: (view: View) => void; onChange: () => void;
}) {
  const { signIn, keyHint } = view.settings.claude;
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const call = async (work: () => Promise<View>) => {
    setSaving(true);
    setError('');
    try {
      replace(await work());
      setDraft('');
      setEditing(false);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const status = state.credentials;
  return (
    <div className="sign-in">
      <div className="settings-row">
        <span className="muted small">Sign in with</span>
        <div className="segmented" role="radiogroup" aria-label="Sign in with">
          {(['claude-code', 'api-key'] as const).map(value => (
            <button key={value} role="radio" aria-checked={signIn === value} disabled={busy || saving} onClick={() => save({ claude: { signIn: value } })}>
              {value === 'claude-code' ? 'Claude Code' : 'API key'}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">{signIn === 'claude-code'
        ? 'Uses your Claude plan, through the sign-in of Claude Code (the claude command).'
        : 'Billed per use to your Anthropic Console account, instead of your Claude plan. The key is kept in your Mac’s keychain.'}</p>
      {signIn === 'api-key' && (keyHint && !editing ? (
        <div className="key-row">
          <span className="small">Key ending in <code>{keyHint}</code></span>
          <button className="link-btn small" onClick={() => setEditing(true)} disabled={saving}>Replace</button>
          <button className="link-btn small" onClick={() => call(() => api.delete<View>('/settings/api-key'))} disabled={saving}>Remove</button>
        </div>
      ) : (
        <form className="key-row" onSubmit={e => { e.preventDefault(); void call(() => api.put<View>('/settings/api-key', { key: draft })); }}>
          <label className="sr" htmlFor="api-key">Anthropic API key</label>
          <input id="api-key" className="text-field" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={draft} onChange={e => setDraft(e.target.value)} />
          <button className="btn small" type="submit" disabled={saving || !draft.trim()}>{saving ? 'Checking…' : 'Save'}</button>
          {keyHint && <button className="btn quiet small" type="button" onClick={() => { setEditing(false); setDraft(''); }}>Cancel</button>}
        </form>
      ))}
      {error && <p className="error small" role="alert">{error}</p>}
      {status && !(signIn === 'api-key' && !keyHint) && <p className={status.ok ? 'muted small' : 'error small'}>{status.ok ? (signIn === 'api-key' ? 'Connected with your API key.' : 'Signed in to Claude.') : status.message}</p>}
    </div>
  );
}

/** Greenhouse Settings: Claude on or off, which model each step uses, and how many agents work at once. */
export default function SettingsPage({ state, onChange }: { state: AppState; onChange: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.get<View>('/settings').then(setView).catch(err => setError((err as Error).message)); }, []);

  const save = async (patch: unknown) => {
    setBusy(true);
    setError('');
    try {
      setView(await api.post<View>('/settings', patch));
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try { setView(await api.post<View>('/settings/models/refresh')); } finally { setBusy(false); }
  };

  if (!view) return <div className="app">{error && <p className="error" role="alert">{error}</p>}</div>;
  const { settings, presets, models } = view;
  const enabled = settings.claude.enabled;
  const preset = Object.entries(presets).find(([, p]) => same(p.models, settings.models))?.[0];
  const families = models.filter(m => m.followsLatest);
  const pinned = models.filter(m => !m.followsLatest);
  const nameOf = (value: string) => models.find(m => m.value === value)?.displayName ?? value;

  return (
    <div className="app">
      <main className="home settings-page">
        <div className="home-head">
          <a className="brand back" href="#/" aria-label="Back to your sprouts" title="Back to your sprouts"><ChevronLeft /><Leaf />Sprout</a>
        </div>
        <h1 className="title-l">Settings</h1>

        <section className="settings-card">
          <div className="settings-row">
            <div>
              <h2>Appearance</h2>
              <p className="muted">For Sprout’s own screens. Each sprout keeps the look it was planted with.</p>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Appearance">
              {(['system', 'light', 'dark'] as const).map(value => (
                <button key={value} role="radio" aria-checked={settings.appearance === value} disabled={busy} onClick={() => save({ appearance: value })}>
                  {value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-row">
            <div>
              <h2>Use Claude to grow sprouts</h2>
              <p className="muted">{enabled
                ? 'Claude plants new sprouts and grows them as you use them.'
                : 'Claude is off. Your tools keep working, reminders still arrive and you can import sprouts, but nothing grows and new sprouts can’t be planted. Things you tell Sprout are saved for when it’s back on.'}</p>
            </div>
            <button className="switch" role="switch" aria-checked={enabled} disabled={busy} onClick={() => save({ claude: { enabled: !enabled } })}>
              <span className="track" aria-hidden="true" />{enabled ? 'On' : 'Off'}
            </button>
          </div>
          {enabled && <SignInChoice view={view} state={state} busy={busy} save={save} replace={setView} onChange={onChange} />}
        </section>

        {enabled && state.credentials?.ok && <UsageCard />}

        {enabled && (
          <section className="settings-card">
            <h2>Models</h2>
            <p className="muted">These come from your Claude account. A family like Opus always uses its newest version, so new models arrive by themselves; a specific version stays exactly as chosen.</p>
            {view.modelsError && <p className="error small" role="alert">{view.modelsError}</p>}
            <div className="presets" role="radiogroup" aria-label="Model presets">
              {Object.entries(presets).map(([id, p]) => (
                <button key={id} role="radio" aria-checked={preset === id} className="preset" disabled={busy} onClick={() => save({ models: p.models })}>
                  <span className="n">{p.label}</span>
                  <span className="muted">{p.blurb}</span>
                </button>
              ))}
            </div>
            <details className="steps-detail" open={!preset}>
              <summary>{preset ? 'Choose for each step' : 'Custom: chosen for each step'}</summary>
              <div className="step-rows">
                {STEPS.map(({ step, label, what }) => {
                  const chosen = settings.models[step];
                  const model = models.find(m => m.value === chosen.model);
                  const effective = view.effective[step];
                  return (
                    <div key={step} className="step-row">
                      <div className="step-name"><span className="n">{label}</span><span className="muted">{what}</span></div>
                      <label className="sr" htmlFor={`model-${step}`}>{label} model</label>
                      <select id={`model-${step}`} className="text-field" value={chosen.model} disabled={busy}
                        onChange={e => save({ models: { [step]: { model: e.target.value } } })}>
                        {!model && <option value={chosen.model}>{chosen.model} (not offered)</option>}
                        <optgroup label="Always the newest">
                          {families.map(m => <option key={m.value} value={m.value}>{m.displayName.replace(/\s[\d.]+$/, '')} (now {m.displayName})</option>)}
                        </optgroup>
                        <optgroup label="Specific versions">
                          {pinned.map(m => <option key={m.value} value={m.value}>{m.displayName}</option>)}
                        </optgroup>
                      </select>
                      <label className="sr" htmlFor={`effort-${step}`}>{label} effort</label>
                      <select id={`effort-${step}`} className="text-field" value={chosen.effort ?? ''} disabled={busy || !model?.efforts.length}
                        onChange={e => save({ models: { [step]: { effort: e.target.value || null } } })}>
                        <option value="">Default effort</option>
                        {(model?.efforts ?? []).map(level => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)} effort</option>)}
                      </select>
                      {effective.fellBack && <p className="error small step-note">{chosen.model} isn’t offered anymore, so this uses {nameOf(effective.model)}.</p>}
                    </div>
                  );
                })}
              </div>
            </details>
            <button className="btn quiet small" onClick={refresh} disabled={busy}>Check for new models</button>
          </section>
        )}

        {enabled && (
          <section className="settings-card">
            <div className="settings-row">
              <div>
                <h2>Agents working at once</h2>
                <p className="muted">How many sprouts can grow at the same time. More uses your Claude plan’s limits faster.</p>
              </div>
              <label className="sr" htmlFor="concurrency">Agents working at once</label>
              <select id="concurrency" className="text-field narrow" value={settings.concurrency} disabled={busy}
                onChange={e => save({ concurrency: Number(e.target.value) })}>
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </section>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
