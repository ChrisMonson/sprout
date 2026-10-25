import { EventEmitter } from 'node:events';

// Everything the greenhouse UI needs to hear about live goes through here,
// and out to the browser over server-sent events.
export type BusMessage =
  | { type: 'sprout'; sproutId: string }
  | { type: 'progress'; sproutId: string; turnId: number; line: string }
  | { type: 'turn'; sproutId: string; turnId: number; kind: string; status: string }
  | { type: 'toast'; sproutId: string; text: string; undoGrowthId?: number }
  | { type: 'notification'; sproutId: string; title: string; body: string }
  | { type: 'harvest'; sproutId: string }
  /** Claude sign-in (or other setup) changed. */
  | { type: 'setup' };

class Bus extends EventEmitter {
  send(msg: BusMessage) {
    this.emit('message', msg);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
