// Server-side helpers a sprout can import as '@sprout/greenhouse'.
// The greenhouse's Vite plugin sets SPROUT_GREENHOUSE_URL and SPROUT_ID.
// Outside the greenhouse (the gate's smoke test) calls are logged, not sent.

function target() {
  const url = process.env.SPROUT_GREENHOUSE_URL;
  const id = process.env.SPROUT_ID;
  return url && id ? `${url}/api/sprouts/${id}` : null;
}

async function post(path, body) {
  const base = target();
  if (!base) {
    console.log(`[sprout] ${path} (not sent outside the greenhouse):`, JSON.stringify(body));
    return null;
  }
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Greenhouse request failed (${res.status})`);
  return data;
}

export async function notify({ title, body, at, key } = {}) {
  const when = at instanceof Date ? at.getTime() : at;
  const data = await post('/notify', { title, body, at: when, key });
  return data ? data.id : null;
}

export async function cancelNotification(key) {
  const data = await post('/notify/cancel', { key });
  return data ? data.cancelled : 0;
}
