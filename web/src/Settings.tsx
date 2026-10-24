import { useEffect, useState } from 'react';
import { api, type AppState } from './api.ts';
import { ChevronLeft, Leaf } from './icons.tsx';

type Step = 'questions' | 'plant' | 'grow' | 'observe';
interface StepModel { model: string; effort: string | null }
interface ModelChoice { value: string; displayName: string; description: string; resolvedModel: string; followsLatest: boolean; efforts: string[] }
interface View {
  settings: { claude: { enabled: boolean }; models: Record<Step, StepModel>; concurrency: number };
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
              <h2>Use Claude to grow sprouts</h2>
              <p className="muted">{enabled
                ? 'Claude plants new sprouts and grows them as you use them.'
                : 'Claude is off. Your tools keep working, reminders still arrive and you can import sprouts, but nothing grows and new sprouts can’t be planted. Things you tell Sprout are saved for when it’s back on.'}</p>
            </div>
            <button className="switch" role="switch" aria-checked={enabled} disabled={busy} onClick={() => save({ claude: { enabled: !enabled } })}>
              <span className="track" aria-hidden="true" />{enabled ? 'On' : 'Off'}
            </button>
          </div>
          {enabled && state.credentials && (
            <p className={state.credentials.ok ? 'muted small' : 'error small'}>{state.credentials.ok ? 'Signed in to Claude.' : state.credentials.message}</p>
          )}
        </section>

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
