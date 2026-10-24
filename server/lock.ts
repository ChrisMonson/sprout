// One greenhouse per SPROUT_HOME. Two would run agents against the same
// sprouts and database at once, e.g. `npm run dev` while the app is open.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export class AlreadyRunning extends Error {
  constructor(public pid: number) {
    super(`Sprout is already running (process ${pid}). Quit it first, or use that one.`);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Claims the lock for this process; a lock left by a process that died is taken over. */
export function acquireLock(file: string, pid = process.pid) {
  if (existsSync(file)) {
    const holder = Number(readFileSync(file, 'utf8').trim());
    if (holder && holder !== pid && alive(holder)) throw new AlreadyRunning(holder);
  }
  writeFileSync(file, String(pid));
}

export function releaseLock(file: string, pid = process.pid) {
  if (existsSync(file) && Number(readFileSync(file, 'utf8').trim()) === pid) rmSync(file);
}
