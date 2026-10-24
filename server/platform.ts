// What differs between running the greenhouse from a terminal (`npm run dev`)
// and inside the desktop app. The host picks a platform at startup; the rest
// of the server only talks to these functions.

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { sep } from 'node:path';

export interface Notice { sproutId: string; app: string; title: string; body: string }

export interface Platform {
  /** Show the person a notification, even when no window is open. */
  notify(notice: Notice): void;
  /** Load a page in a real browser and report what went wrong (empty = fine). */
  browserCheck(url: string): Promise<string[]>;
}

let current: Platform | null = null;

export function setPlatform(platform: Platform) {
  current = platform;
}

export function platform(): Platform {
  if (!current) throw new Error('No platform set: call setPlatform() at startup.');
  return current;
}

export const inElectron = !!process.versions.electron;

/**
 * How to run a Node child process. Inside the app there may be no `node` on
 * the Mac at all, so the app's own binary runs as Node instead. This env is
 * only for Node children we start; never pass it on to git, osascript or the
 * agent, or they'd start as Node too.
 */
export function nodeCommand(): { cmd: string; env: Record<string, string> } {
  return { cmd: process.execPath, env: inElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
}

/**
 * The Claude Code binary the Agent SDK should run. Outside the app the SDK
 * finds it itself. Inside the app it lives in app.asar.unpacked, because a
 * binary inside an asar archive can't be executed.
 */
export function claudeExecutable(): string | undefined {
  if (!inElectron) return undefined;
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
    return path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
  } catch {
    return undefined;
  }
}

// ---------- the terminal platform ----------

export const cliPlatform: Platform = {
  notify({ app, title, body }) {
    if (process.platform !== 'darwin' || process.env.SPROUT_NATIVE_NOTIFICATIONS === '0') return;
    // JSON string escaping is valid AppleScript string escaping for quotes and backslashes.
    const script = `display notification ${JSON.stringify(body || title)} with title ${JSON.stringify(app)}${body ? ` subtitle ${JSON.stringify(title)}` : ''} sound name "default"`;
    execFile('osascript', ['-e', script], err => { if (err) console.error('[notify]', err.message); });
  },

  async browserCheck(url) {
    const { chromium } = await import('playwright');
    const problems: string[] = [];
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const origin = new URL(url).origin;
      page.on('console', msg => {
        // Fonts come from Google; being offline is not the change's fault.
        const where = msg.location().url ?? '';
        if (msg.type() === 'error' && !isFontNoise(where + msg.text())) problems.push(`Console error: ${msg.text().slice(0, 300)}`);
      });
      page.on('pageerror', err => problems.push(`Page crashed: ${err.message.slice(0, 300)}`));
      page.on('response', res => {
        if (res.url().startsWith(`${origin}/api`) && res.status() >= 500) problems.push(`${res.request().method()} ${res.url().slice(origin.length)} returned ${res.status()}`);
      });

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(800);
      if (!(await page.evaluate(RENDERED))) problems.push('The page rendered nothing.');

      const links = await page.evaluate<string[]>(LINKS);
      for (const href of links) {
        await page.goto(href.startsWith('#') ? `${origin}/${href}` : `${origin}${href}`, { waitUntil: 'networkidle', timeout: 15_000 });
        await page.waitForTimeout(300);
      }
    } catch (err) {
      problems.push((err as Error).message.split('\n')[0]);
    } finally {
      await browser.close();
    }
    return problems;
  },
};

// Shared by both browser checks.
export const isFontNoise = (text: string) => /fonts\.(googleapis|gstatic)\.com/.test(text);
export const RENDERED = '(document.getElementById("root")?.childElementCount ?? 0) > 0';
export const LINKS = '[...new Set([...document.querySelectorAll("a[href]")].map(a => a.getAttribute("href")).filter(h => h.startsWith("/") || h.startsWith("#")))].slice(0, 5)';
