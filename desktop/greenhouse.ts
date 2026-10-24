// The greenhouse inside the desktop app. It runs in its own utility process so
// agent turns, gates and SQLite never make the window stutter. The parts that
// need the main process (notifications, the hidden browser for checks) are
// requested over the parent port.

import { setPlatform } from '../server/platform.ts';
import { startGreenhouse, type Greenhouse } from '../server/start.ts';
import { AlreadyRunning } from '../server/lock.ts';
import { paths } from '../server/paths.ts';
import type { ToGreenhouse, FromGreenhouse } from './messages.ts';

const parent = process.parentPort;
const send = (msg: FromGreenhouse) => parent.postMessage(msg);

const checks = new Map<number, (problems: string[]) => void>();
let nextCheck = 0;

setPlatform({
  notify(notice) {
    send({ type: 'notify', notice });
  },
  browserCheck(url) {
    return new Promise(resolve => {
      const id = ++nextCheck;
      checks.set(id, resolve);
      send({ type: 'browser-check', id, url });
      setTimeout(() => {
        if (checks.delete(id)) resolve(['The browser check timed out.']);
      }, 90_000);
    });
  },
});

let greenhouse: Greenhouse | null = null;

parent.on('message', async ({ data }: { data: ToGreenhouse }) => {
  if (data.type === 'browser-check-result') {
    checks.get(data.id)?.(data.problems);
    checks.delete(data.id);
  } else if (data.type === 'stop') {
    await greenhouse?.stop();
    process.exit(0);
  }
});

try {
  greenhouse = await startGreenhouse({ port: Number(process.env.SPROUT_PORT), web: { staticDir: paths.webDist } });
  send({ type: 'ready', port: greenhouse.port });
} catch (err) {
  send({ type: 'fatal', message: (err as Error).message, alreadyRunning: err instanceof AlreadyRunning });
  process.exit(1);
}
