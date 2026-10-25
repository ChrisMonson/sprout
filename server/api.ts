import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { q, type Db } from './db.ts';
import { bus, type BusMessage } from './bus.ts';
import { createSproutRow, plantFiles, ensureDevServer } from './sprouts.ts';
import { feelById, FEELS } from './feel.ts';
import { nextQuestion, type Exchange } from './agent/questions.ts';
import { useSignIn, type CredentialStatus } from './agent/credentials.ts';
import { keyHint, readApiKey, removeApiKey, saveApiKey } from './agent/apikey.ts';
import { plant, isBusy, pausedUntil } from './scheduler.ts';
import { rewind } from './apply.ts';
import { removeSprout, restoreSprout, deleteForever, listRemoved } from './remove.ts';
import { exportSprout, importSprout } from './transfer.ts';
import { readFileSync, existsSync } from 'node:fs';
import { androidTools, listDevices, listEmulators, startEmulator } from './harvest/android.ts';
import { checkPortability } from './harvest/check.ts';
import { apkPath, harvestState, startHarvest } from './harvest/harvest.ts';
import { sproutPaths } from './paths.ts';
import { clearCustomIcon, drawIcon, hasCustomIcon, iconFile, iconPng, iconVersion, isDrawing, setCustomIcon } from './icons.ts';
import { platform } from './platform.ts';
import { addNote, addRequestNote } from './memory.ts';
import { getSettings, updateSettings, claudeEnabled, PRESETS, STEPS } from './settings.ts';
import { listModels, knownModels, resolveStep } from './agent/models.ts';
import { schedule, cancel, cancelById, upcoming, type NotificationRequest } from './notifications.ts';

const EVENT_KINDS = new Set(['click', 'input', 'submit', 'nav', 'rage', 'error', 'console_error', 'api_error']);
const REPORT_KINDS = new Set(['server_error', 'build_error']);

export interface Host {
  credentials(): CredentialStatus | null;
  recheck(): Promise<CredentialStatus>;
  signIn(): void;
  git: boolean;
}

export function createApi(db: Db, host: Host) {
  const app = new Hono().basePath('/api');

  const sproutOr404 = (id: string) => {
    const row = q.sprout(db, id);
    if (!row) throw new HttpError(404, 'No such sprout.');
    return row;
  };

  app.onError((err, c) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('[api]', err);
    return c.json({ error: err.message }, status as 404);
  });

  // ---- greenhouse settings ----

  const settingsView = async (refresh = false) => {
    const settings = getSettings(db);
    let models = knownModels();
    let modelsError = '';
    if (settings.claude.enabled && (refresh || !models.length)) {
      try { models = await listModels(refresh); } catch (err) { modelsError = `Couldn’t get the list of models from Claude: ${(err as Error).message.split('\n')[0]}`; }
    }
    const effective = Object.fromEntries(STEPS.map(step => [step, resolveStep(step, settings.models[step], models)]));
    return { settings, presets: PRESETS, models, modelsError, effective };
  };

  app.get('/settings', async c => c.json(await settingsView()));
  app.post('/settings/models/refresh', async c => c.json(await settingsView(true)));

  app.post('/settings', async c => {
    const patch = await c.req.json();
    const wasEnabled = claudeEnabled(db);
    const wasSignIn = getSettings(db).claude.signIn;
    if (patch?.claude) delete patch.claude.keyHint; // only set by saving a key
    try { updateSettings(db, patch); } catch (err) { throw new HttpError(400, (err as Error).message); }
    useSignIn(getSettings(db).claude.signIn);
    if (claudeEnabled(db) !== wasEnabled || getSettings(db).claude.signIn !== wasSignIn) await host.recheck();
    if (patch?.appearance) platform().setAppearance?.(getSettings(db).appearance);
    bus.send({ type: 'sprout', sproutId: '' });
    return c.json(await settingsView());
  });

  // An API key goes straight to the macOS keychain; settings keep only its last four characters.
  app.put('/settings/api-key', async c => {
    const { key } = await c.req.json<{ key: string }>();
    try { saveApiKey(key ?? ''); } catch (err) { throw new HttpError(400, (err as Error).message); }
    updateSettings(db, { claude: { signIn: 'api-key', keyHint: keyHint(readApiKey() ?? '') } });
    useSignIn('api-key');
    await host.recheck();
    return c.json(await settingsView());
  });

  app.delete('/settings/api-key', async c => {
    removeApiKey();
    updateSettings(db, { claude: { signIn: 'claude-code', keyHint: null } });
    useSignIn('claude-code');
    await host.recheck();
    return c.json(await settingsView());
  });

  const needsClaude = () => {
    if (!claudeEnabled(db)) throw new HttpError(409, 'Planting a new sprout needs Claude. Turn Claude on in Settings, or import a .sprout file instead.');
  };

  app.get('/state', c => c.json({
    appearance: getSettings(db).appearance,
    claudeEnabled: claudeEnabled(db),
    signIn: getSettings(db).claude.signIn,
    credentials: host.credentials(),
    git: host.git,
    pausedUntil: pausedUntil(),
    feels: FEELS.map(f => ({ id: f.id, name: f.name, blurb: f.blurb, tokens: f.tokens, fonts: f.fonts })),
    removed: listRemoved(db),
    sprouts: q.sprouts(db).filter(s => s.status !== 'seeding' && s.status !== 'removed').map(s => ({
      id: s.id, name: s.name, seed: s.seed, status: s.status, growing: !!s.growing, busy: isBusy(s.id), createdAt: s.created_at,
      icon: iconVersion(s.id),
    })),
  }));

  app.post('/sign-in', c => {
    host.signIn();
    return c.json({ ok: true });
  });

  app.post('/sign-in/check', async c => c.json(await host.recheck()));

  app.get('/stream', c => streamSSE(c, async stream => {
    const send = (msg: BusMessage) => { void stream.writeSSE({ data: JSON.stringify(msg) }); };
    bus.on('message', send);
    const ping = setInterval(() => { void stream.writeSSE({ event: 'ping', data: '' }); }, 20_000);
    await new Promise<void>(resolve => stream.onAbort(resolve));
    clearInterval(ping);
    bus.off('message', send);
  }));

  // ---- seeding: the conversation before planting ----

  app.post('/seed', async c => {
    needsClaude();
    const { seed } = await c.req.json<{ seed: string }>();
    if (!seed?.trim()) throw new HttpError(400, 'Say what you want to grow.');
    const id = createSproutRow(db, seed.trim().slice(0, 500));
    const next = await nextQuestion(seed.trim(), [], getSettings(db).models.questions);
    if (next.name) q.update(db, id, { name: next.name });
    return c.json({ id, next });
  });

  app.post('/sprouts/:id/answer', async c => {
    needsClaude();
    const row = sproutOr404(c.req.param('id'));
    const { question, answer } = await c.req.json<{ question: string; answer: string }>();
    const exchange = JSON.parse(row.conversation) as Exchange[];
    exchange.push({ q: question, a: answer.slice(0, 500) });
    q.update(db, row.id, { conversation: JSON.stringify(exchange) });
    const next = await nextQuestion(row.seed, exchange, getSettings(db).models.questions);
    if (next.done && next.name) q.update(db, row.id, { name: next.name });
    return c.json({ next });
  });

  app.post('/sprouts/:id/plant', async c => {
    const row = sproutOr404(c.req.param('id'));
    if (row.status !== 'seeding') throw new HttpError(409, 'Already planted.');
    needsClaude();
    const { preset, note } = await c.req.json<{ preset: string; note?: string }>();
    const feel = feelById(preset);
    q.update(db, row.id, { feel: JSON.stringify({ preset: feel.id, note: note?.trim().slice(0, 200) || undefined }), status: 'planting' });
    await plantFiles(row.id, feel);
    void plant(db, row.id);
    return c.json({ ok: true });
  });

  // ---- a sprout ----

  app.get('/sprouts/:id', c => {
    const row = sproutOr404(c.req.param('id'));
    const parse = (rows: Record<string, unknown>[], ...keys: string[]) => rows.map(r => {
      for (const k of keys) if (typeof r[k] === 'string') r[k] = JSON.parse(r[k] as string);
      return r;
    });
    return c.json({
      sprout: {
        id: row.id, name: row.name, seed: row.seed, status: row.status, growing: !!row.growing,
        feel: row.feel ? JSON.parse(row.feel) : null, busy: isBusy(row.id), pending: !!row.pending_apply,
      },
      growth: db.prepare('SELECT id, ts, kind, title, detail, rewindable FROM growth WHERE sprout_id = ? ORDER BY id DESC').all(row.id),
      buds: parse(db.prepare("SELECT id, ts, kind, text, why, suggestions, status FROM buds WHERE sprout_id = ? AND status = 'proposed' ORDER BY id").all(row.id) as Record<string, unknown>[], 'suggestions'),
      whispers: parse(db.prepare('SELECT id, ts, text, target, status FROM whispers WHERE sprout_id = ? ORDER BY id DESC LIMIT 30').all(row.id) as Record<string, unknown>[], 'target'),
      turns: db.prepare('SELECT id, kind, reason, started_at, ended_at, status, summary, cost_usd FROM turns WHERE sprout_id = ? ORDER BY id DESC LIMIT 10').all(row.id),
      notifications: upcoming(db, row.id).map(n => ({ id: n.id, title: n.title, body: n.body, dueAt: n.due_at })),
    });
  });

  app.post('/sprouts/:id/start', async c => {
    const row = sproutOr404(c.req.param('id'));
    if (row.status === 'seeding') throw new HttpError(409, 'Not planted yet.');
    if (row.status === 'removed') throw new HttpError(409, 'This sprout was removed.');
    const port = await ensureDevServer(db, row.id);
    return c.json({ url: `http://127.0.0.1:${port}/` });
  });

  app.post('/sprouts/:id/events', async c => {
    const row = sproutOr404(c.req.param('id'));
    const { events } = await c.req.json<{ events: { kind: string; ts: number; target?: unknown; detail?: unknown }[] }>();
    const insert = db.prepare('INSERT INTO events (sprout_id, ts, kind, target, detail) VALUES (?, ?, ?, ?, ?)');
    for (const e of (events ?? []).slice(0, 200)) {
      if (!EVENT_KINDS.has(e.kind)) continue;
      insert.run(row.id, Number(e.ts) || Date.now(), e.kind, e.target ? JSON.stringify(e.target).slice(0, 1000) : null, e.detail ? JSON.stringify(e.detail).slice(0, 2000) : null);
    }
    q.update(db, row.id, { last_activity: Date.now() });
    return c.json({ ok: true });
  });

  app.post('/sprouts/:id/activity', c => {
    const row = sproutOr404(c.req.param('id'));
    q.update(db, row.id, { last_activity: Date.now() });
    return c.json({ ok: true });
  });

  // From the sprout's dev server plugin.
  app.post('/sprouts/:id/report', async c => {
    const row = sproutOr404(c.req.param('id'));
    const { kind, detail } = await c.req.json<{ kind: string; detail: unknown }>();
    if (REPORT_KINDS.has(kind)) {
      db.prepare('INSERT INTO events (sprout_id, ts, kind, detail) VALUES (?, ?, ?, ?)').run(row.id, Date.now(), kind, JSON.stringify(detail).slice(0, 2000));
    }
    return c.json({ ok: true });
  });

  // From a sprout's own server code, via @sprout/greenhouse.
  app.post('/sprouts/:id/notify', async c => {
    const row = sproutOr404(c.req.param('id'));
    const req = await c.req.json<NotificationRequest>();
    try {
      const id = schedule(db, row.id, req);
      bus.send({ type: 'sprout', sproutId: row.id });
      return c.json({ id });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post('/sprouts/:id/notify/cancel', async c => {
    const row = sproutOr404(c.req.param('id'));
    const { key, id } = await c.req.json<{ key?: string; id?: number }>();
    const cancelled = key ? cancel(db, row.id, key) : id ? cancelById(db, row.id, id) : 0;
    bus.send({ type: 'sprout', sproutId: row.id });
    return c.json({ cancelled });
  });

  app.post('/sprouts/:id/whisper', async c => {
    const row = sproutOr404(c.req.param('id'));
    const { text, target } = await c.req.json<{ text: string; target?: unknown }>();
    if (!text?.trim()) throw new HttpError(400, 'Say something first.');
    db.prepare('INSERT INTO whispers (sprout_id, ts, text, target) VALUES (?, ?, ?, ?)').run(row.id, Date.now(), text.trim().slice(0, 1000), target ? JSON.stringify(target) : null);
    bus.send({ type: 'sprout', sproutId: row.id });
    return c.json({ ok: true, growing: !!row.growing, claude: claudeEnabled(db) });
  });

  app.post('/sprouts/:id/buds/:budId', async c => {
    const row = sproutOr404(c.req.param('id'));
    const { action, answer } = await c.req.json<{ action: 'accept' | 'dismiss' | 'answer'; answer?: string }>();
    const bud = db.prepare("SELECT id, kind FROM buds WHERE id = ? AND sprout_id = ? AND status = 'proposed'").get(Number(c.req.param('budId')), row.id) as { id: number; kind: string } | undefined;
    if (!bud) throw new HttpError(404, 'That suggestion is no longer open.');
    if (action === 'answer') {
      if (!answer?.trim()) throw new HttpError(400, 'Answer first.');
      db.prepare("UPDATE buds SET status = 'answered', answer = ? WHERE id = ?").run(answer.trim().slice(0, 500), bud.id);
    } else {
      db.prepare('UPDATE buds SET status = ? WHERE id = ?').run(action === 'accept' ? 'accepted' : 'dismissed', bud.id);
    }
    bus.send({ type: 'sprout', sproutId: row.id });
    return c.json({ ok: true });
  });

  app.post('/sprouts/:id/details', async c => {
    const row = sproutOr404(c.req.param('id'));
    const body = await c.req.json<{ name?: string; seed?: string }>();
    const name = String(body.name ?? row.name).trim();
    const seed = String(body.seed ?? row.seed).trim();
    if (!name) throw new HttpError(400, 'Give it a name.');
    if (name.length > 60) throw new HttpError(400, 'Keep the name under 60 characters.');
    if (seed.length > 500) throw new HttpError(400, 'Keep the description under 500 characters.');
    if (name !== row.name) {
      // The tool's own screen shows its name too, so the agent wakes to bring it in line (even with growth off).
      addRequestNote(row.id, `The person renamed the tool from "${row.name}" to "${name}". Update the name shown in the tool to match, if it shows one.`);
    }
    if (seed !== row.seed) addNote(row.id, `The person changed how they describe the tool to: "${seed}".`);
    q.update(db, row.id, { name, seed });
    bus.send({ type: 'sprout', sproutId: row.id });
    return c.json({ ok: true });
  });

  app.post('/sprouts/:id/growing', async c => {
    const row = sproutOr404(c.req.param('id'));
    const { on } = await c.req.json<{ on: boolean }>();
    q.update(db, row.id, { growing: on ? 1 : 0 });
    bus.send({ type: 'sprout', sproutId: row.id });
    return c.json({ ok: true });
  });

  // ---- icons ----

  app.get('/sprouts/:id/icon', c => {
    const row = sproutOr404(c.req.param('id'));
    return c.json({ version: iconVersion(row.id), custom: hasCustomIcon(row.id), drawing: isDrawing(row.id) });
  });

  app.get('/sprouts/:id/icon.svg', c => {
    const file = iconFile(sproutOr404(c.req.param('id')).id);
    if (!file) throw new HttpError(404, 'No icon yet.');
    return new Response(readFileSync(file), {
      headers: { 'content-type': 'image/svg+xml', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'cache-control': 'no-cache' },
    });
  });

  app.get('/sprouts/:id/icon.png', async c => {
    const size = Math.min(1024, Math.max(16, Number(c.req.query('size') ?? 64) || 64));
    const png = await iconPng(sproutOr404(c.req.param('id')).id, size);
    if (!png) throw new HttpError(404, 'No icon yet.');
    return new Response(new Uint8Array(readFileSync(png)), { headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' } });
  });

  app.put('/sprouts/:id/icon', async c => {
    const row = sproutOr404(c.req.param('id'));
    try { setCustomIcon(row.id, await c.req.text()); } catch (err) { throw new HttpError(400, (err as Error).message); }
    return c.json({ version: iconVersion(row.id), custom: true, drawing: isDrawing(row.id) });
  });

  app.delete('/sprouts/:id/icon', c => {
    const row = sproutOr404(c.req.param('id'));
    clearCustomIcon(row.id);
    return c.json({ version: iconVersion(row.id), custom: false, drawing: isDrawing(row.id) });
  });

  app.post('/sprouts/:id/icon/draw', c => {
    const row = sproutOr404(c.req.param('id'));
    if (!claudeEnabled(db)) throw new HttpError(409, 'Claude is off, so Sprout can’t draw a new icon right now.');
    void drawIcon(db, row.id);
    return c.json({ version: iconVersion(row.id), custom: hasCustomIcon(row.id), drawing: true });
  });

  // ---- harvest: the sprout as an Android app ----

  app.get('/harvest/devices', async c => {
    const tools = await androidTools();
    if ('missing' in tools) return c.json({ devices: [], emulators: [], missing: tools.missing });
    return c.json({ devices: await listDevices(tools), emulators: tools.emulator ? listEmulators() : [], missing: null });
  });

  app.post('/harvest/emulator', async c => {
    const { name } = await c.req.json<{ name: string }>();
    const tools = await androidTools();
    if ('missing' in tools) throw new HttpError(409, tools.missing);
    try { startEmulator(tools, name); } catch (err) { throw new HttpError(400, (err as Error).message); }
    return c.json({ ok: true });
  });

  const harvestInfo = (row: { id: string; name: string }) => ({ ...harvestState(row.id), ...checkPortability(sproutPaths(row.id).live, row.name) });

  app.get('/sprouts/:id/harvest', c => c.json(harvestInfo(sproutOr404(c.req.param('id')))));

  app.post('/sprouts/:id/harvest', async c => {
    const row = sproutOr404(c.req.param('id'));
    const { serial, includeData } = await c.req.json<{ serial: string | null; includeData: boolean }>();
    try { startHarvest(db, row.id, { serial, includeData: !!includeData }); } catch (err) { throw new HttpError(409, (err as Error).message); }
    return c.json(harvestInfo(row));
  });

  app.get('/sprouts/:id/harvest/apk', c => {
    const row = sproutOr404(c.req.param('id'));
    if (!existsSync(apkPath(row.id))) throw new HttpError(404, 'Harvest it first.');
    const slug = (row.name || 'sprout').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sprout';
    return new Response(new Uint8Array(readFileSync(apkPath(row.id))), {
      headers: { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': `attachment; filename="${slug}.apk"` },
    });
  });

  app.get('/sprouts/:id/export', async c => {
    const row = sproutOr404(c.req.param('id'));
    try {
      const { filename, bytes } = await exportSprout(db, row.id, c.req.query('data') !== '0');
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${filename}"` },
      });
    } catch (err) {
      throw new HttpError(409, (err as Error).message);
    }
  });

  app.post('/order', async c => {
    const { ids } = await c.req.json<{ ids: string[] }>();
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new HttpError(400, 'Send the sprouts in their new order.');
    const known = new Set(q.sprouts(db).map(s => s.id));
    q.reorder(db, ids.filter(id => known.has(id)));
    bus.send({ type: 'sprout', sproutId: ids[0] ?? '' });
    return c.json({ ok: true });
  });

  app.post('/import', async c => {
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (!bytes.length) throw new HttpError(400, 'Choose a .sprout file to import.');
    try {
      const id = await importSprout(db, bytes);
      bus.send({ type: 'sprout', sproutId: id });
      return c.json({ id });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post('/sprouts/:id/remove', c => {
    const row = sproutOr404(c.req.param('id'));
    try { removeSprout(db, row.id, isBusy(row.id)); } catch (err) { throw new HttpError(409, (err as Error).message); }
    return c.json({ ok: true });
  });

  app.post('/sprouts/:id/restore', c => {
    const row = sproutOr404(c.req.param('id'));
    try { restoreSprout(db, row.id); } catch (err) { throw new HttpError(409, (err as Error).message); }
    return c.json({ ok: true });
  });

  app.delete('/sprouts/:id', c => {
    const row = sproutOr404(c.req.param('id'));
    try { deleteForever(db, row.id); } catch (err) { throw new HttpError(409, (err as Error).message); }
    return c.json({ ok: true });
  });

  app.post('/sprouts/:id/rewind', async c => {
    const row = sproutOr404(c.req.param('id'));
    const { growthId } = await c.req.json<{ growthId: number }>();
    try {
      await rewind(db, row.id, growthId);
    } catch (err) {
      throw new HttpError(409, (err as Error).message);
    }
    return c.json({ ok: true });
  });

  return app;
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
