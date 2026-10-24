// The gate's "does it run?" check, in a hidden window of the app's own
// Chromium, so nothing needs to be downloaded. Mirrors the Playwright check in
// server/platform.ts: console errors, crashes, failed loads, /api 5xx, an
// empty page, and up to five in-app links.

import { BrowserWindow, session } from 'electron';
import { isFontNoise, RENDERED, LINKS } from '../server/platform.ts';

const SETTLE_MS = 1200;

export async function browserCheck(url: string): Promise<string[]> {
  const problems: string[] = [];
  const origin = new URL(url).origin;
  const ses = session.fromPartition(`sprout-check-${Date.now()}-${Math.random()}`);
  ses.webRequest.onCompleted({ urls: [`${origin}/api/*`] }, details => {
    if (details.statusCode >= 500) problems.push(`${details.method} ${details.url.slice(origin.length)} returned ${details.statusCode}`);
  });

  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses, backgroundThrottling: false } });
  const contents = win.webContents;
  contents.on('console-message', event => {
    const { level, message, sourceId } = event as unknown as { level: string; message: string; sourceId: string };
    if (level === 'error' && !isFontNoise(`${sourceId} ${message}`)) problems.push(`Console error: ${message.slice(0, 300)}`);
  });
  contents.on('render-process-gone', (_e, details) => problems.push(`Page crashed: ${details.reason}`));
  contents.on('did-fail-load', (_e, code, description, failedUrl, isMainFrame) => {
    if (isMainFrame) problems.push(`Could not load ${failedUrl.slice(origin.length) || '/'}: ${description} (${code})`);
  });

  const settle = () => new Promise(resolve => setTimeout(resolve, SETTLE_MS));
  try {
    await withTimeout(contents.loadURL(url), 30_000);
    await settle();
    if (!(await contents.executeJavaScript(RENDERED))) problems.push('The page rendered nothing.');
    const links = await contents.executeJavaScript(LINKS) as string[];
    for (const href of links) {
      // A hash link is an in-page navigation: it never fires a page load to wait for.
      if (href.startsWith('#')) await contents.executeJavaScript(`location.hash = ${JSON.stringify(href)}`);
      else await withTimeout(contents.loadURL(`${origin}${href}`), 15_000);
      await settle();
    }
  } catch (err) {
    problems.push((err as Error).message.split('\n')[0]);
  } finally {
    win.destroy();
    await ses.clearStorageData().catch(() => {});
  }
  return [...new Set(problems)];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms))]);
}
