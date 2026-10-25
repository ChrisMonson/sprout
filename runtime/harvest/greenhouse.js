// @sprout/greenhouse for a harvested sprout: notifications become Android
// notifications, scheduled on the phone, so they arrive even when the app is
// closed, and every() tasks also run when Android wakes the app in the background.
//
// In the background there's no Capacitor bridge; boot.js provides `SproutNative`
// (a small native helper the harvest adds to the app) instead.

import { LocalNotifications } from '@capacitor/local-notifications';
import { intervalMs } from './interval.js';

const KEYS = 'sprout-notification-keys';

function keys() {
  try { return JSON.parse(localStorage.getItem(KEYS) ?? '{}'); } catch { return {}; }
}

function saveKeys(map) {
  try { localStorage.setItem(KEYS, JSON.stringify(map)); } catch { /* keys are a convenience */ }
}

async function allowed() {
  const { display } = await LocalNotifications.checkPermissions();
  if (display === 'granted') return true;
  return (await LocalNotifications.requestPermissions()).display === 'granted';
}

const native = () => globalThis.__sproutBackground ? globalThis.SproutNative : null;

export async function notify({ title, body, at, key } = {}) {
  const when = at instanceof Date ? at.getTime() : at ? new Date(at).getTime() : Date.now();
  const bg = native();
  if (bg) {
    const id = key ?? `n-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    bg.notify(id, String(title ?? ''), String(body ?? ''), when);
    return 0;
  }
  if (!(await allowed())) return null;
  if (key) await cancelNotification(key);
  const id = Math.floor(Math.random() * 2 ** 31);
  await LocalNotifications.schedule({
    notifications: [{
      id,
      title: String(title ?? ''),
      body: String(body ?? ''),
      schedule: when > Date.now() + 1000 ? { at: new Date(when), allowWhileIdle: true } : undefined,
    }],
  });
  if (key) saveKeys({ ...keys(), [key]: id });
  return id;
}

export async function cancelNotification(key) {
  native()?.cancel(key);
  if (native()) return 1;
  const map = keys();
  const id = map[key];
  if (id === undefined) return 0;
  await LocalNotifications.cancel({ notifications: [{ id }] });
  delete map[key];
  saveKeys(map);
  return 1;
}

export { intervalMs };

/** Tasks the background wake-up runs; boot.js reads this. */
export const tasks = (globalThis.__sproutTasks ??= []);

export function every(interval, task) {
  const ms = Math.max(1000, intervalMs(interval));
  tasks.push({ ms, task });
  // In the background, boot.js runs each task once and the app goes back to sleep.
  if (globalThis.__sproutBackground) return () => {};
  const run = () => { Promise.resolve().then(task).catch(err => console.error('[sprout] every():', err)); };
  const first = setTimeout(run, Math.min(ms, 5000));
  const timer = setInterval(run, ms);
  return () => { clearTimeout(first); clearInterval(timer); };
}
