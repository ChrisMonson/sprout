// Messages between the app's main process and the greenhouse utility process.

import type { Notice } from '../server/platform.ts';

export type FromGreenhouse =
  | { type: 'ready'; port: number }
  | { type: 'fatal'; message: string; alreadyRunning: boolean }
  | { type: 'notify'; notice: Notice }
  | { type: 'browser-check'; id: number; url: string }
  | { type: 'appearance'; appearance: 'system' | 'light' | 'dark' };

export type ToGreenhouse =
  | { type: 'browser-check-result'; id: number; problems: string[] }
  | { type: 'stop' };
