import { useEffect, useRef } from 'react';

export interface Feel { id: string; name: string; blurb: string; tokens: Record<string, string>; fonts: string }
export interface SproutSummary { id: string; name: string; seed: string; status: string; growing: boolean; busy: boolean; createdAt: number; icon?: number }
export interface AppState {
  appearance?: 'system' | 'light' | 'dark';
  claudeEnabled?: boolean;
  signIn?: 'claude-code' | 'api-key';
  credentials: { ok: boolean; message: string; signedOut?: boolean } | null;
  git?: boolean;
  pausedUntil: number;
  feels: Feel[];
  sprouts: SproutSummary[];
  removed: { id: string; name: string; seed: string; removedAt: number }[];
}
export interface NextQuestion { done: boolean; question: string; suggestions: string[]; name: string; reply: string }
export interface Target { sproutId: string | null; path: string; tag: string; text: string; rect?: unknown }
export interface Growth { id: number; ts: number; kind: string; title: string; detail: string | null; rewindable: number }
export interface Bud { id: number; ts: number; kind: 'bud' | 'question'; text: string; why: string | null; suggestions: string[] | null }
export interface Whisper { id: number; ts: number; text: string; target: Target | null; status: string; files?: { name: string; size: number }[] }
export interface SproutDetail {
  sprout: { id: string; name: string; seed: string; status: string; growing: boolean; busy: boolean; pending: boolean; feel: { preset: string; note?: string } | null };
  growth: Growth[];
  buds: Bud[];
  whispers: Whisper[];
  turns: { id: number; kind: string; reason: string | null; status: string; summary: string | null; started_at: number }[];
  notifications: { id: number; title: string; body: string | null; dueAt: number }[];
  /** Estimated cost of every agent turn this sprout has had. */
  spent?: number;
}

export type BusMessage =
  | { type: 'sprout'; sproutId: string }
  | { type: 'progress'; sproutId: string; turnId: number; line: string }
  | { type: 'turn'; sproutId: string; turnId: number; kind: string; status: string }
  | { type: 'toast'; sproutId: string; text: string; undoGrowthId?: number }
  | { type: 'notification'; sproutId: string; title: string; body: string }
  | { type: 'harvest'; sproutId: string }
  | { type: 'setup' }
  | { type: 'usage' };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Something went wrong (${res.status}).`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => call<T>('PUT', path, body),
  delete: <T>(path: string) => call<T>('DELETE', path),
};

// One connection to the greenhouse's live messages, shared by every listener.
// A connection each would soon use up the browser's six per server, and then
// ordinary requests (a click's fetch) would wait for one to close.
const listeners = new Set<(msg: BusMessage) => void>();
let source: EventSource | null = null;

function listen(fn: (msg: BusMessage) => void) {
  listeners.add(fn);
  if (!source) {
    source = new EventSource('/api/stream');
    source.onmessage = e => {
      let msg: BusMessage;
      try { msg = JSON.parse(e.data); } catch { return; }
      for (const l of listeners) l(msg);
    };
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) { source?.close(); source = null; }
  };
}

/** Live messages from the greenhouse. */
export function useStream(onMessage: (msg: BusMessage) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => listen(msg => handler.current(msg)), []);
}

export function timeOf(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
