// Every sprout gets an icon: drawn by Claude to fit what the tool does, in its
// feel's colors, unless the person gives it one of their own (an SVG). The SVG
// is the source; PNGs for the menu bar, notifications and phone apps are made
// from it with macOS's sips and cached.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { q, type Db } from './db.ts';
import { bus } from './bus.ts';
import { sproutPaths } from './paths.ts';
import { feelById } from './feel.ts';
import { claudeExecutable } from './platform.ts';
import { agentEnv } from './agent/credentials.ts';
import { resolveStep } from './agent/models.ts';
import { claudeEnabled, getSettings } from './settings.ts';

const run = promisify(execFile);
export const MAX_SVG_BYTES = 64 * 1024;

/** The icon in use: theirs if they chose one, else the drawn one. */
export function iconFile(id: string): string | null {
  const p = sproutPaths(id);
  if (existsSync(p.iconCustom)) return p.iconCustom;
  return existsSync(p.icon) ? p.icon : null;
}

/** Changes whenever the icon does, so pages can cache it by version. 0 = none yet. */
export function iconVersion(id: string): number {
  const file = iconFile(id);
  return file ? Math.round(statSync(file).mtimeMs) : 0;
}

export const hasCustomIcon = (id: string) => existsSync(sproutPaths(id).iconCustom);

/**
 * Accept an SVG only if it's a plain drawing: no scripts, event handlers,
 * embedded documents or anything loaded from elsewhere. Throws if it isn't an SVG.
 */
export function cleanSvg(text: string): string {
  if (Buffer.byteLength(text) > MAX_SVG_BYTES) throw new Error('That SVG is too big; keep icons under 64 KB.');
  let svg = text.trim().replace(/^<\?xml[^>]*>\s*/i, '').replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
  if (/<!(DOCTYPE|ENTITY)/i.test(svg)) throw new Error('That SVG uses features icons can’t have.');
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) throw new Error('That isn’t an SVG file.');
  svg = svg
    .replace(/<(script|foreignObject|iframe|image|use|a)\b[^>]*\/>/gi, '')
    .replace(/<(script|foreignObject|iframe|image|use|a)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|foreignObject|iframe|image|use|a)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
  if (!/^<svg[^>]*\sxmlns=/i.test(svg)) svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/^<svg[^>]*\sviewBox=/i.test(svg)) {
    const w = svg.match(/^<svg[^>]*\swidth=["']?([\d.]+)/i)?.[1];
    const h = svg.match(/^<svg[^>]*\sheight=["']?([\d.]+)/i)?.[1];
    if (w && h) svg = svg.replace(/^<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }
  return svg;
}

export function setCustomIcon(id: string, text: string) {
  const svg = cleanSvg(text);
  writeFileSync(sproutPaths(id).iconCustom, svg);
  bus.send({ type: 'sprout', sproutId: id });
}

export function clearCustomIcon(id: string) {
  rmSync(sproutPaths(id).iconCustom, { force: true });
  bus.send({ type: 'sprout', sproutId: id });
}

/** A square PNG of the icon, made from the SVG and cached until the icon changes. */
export async function iconPng(id: string, size: number): Promise<string | null> {
  const file = iconFile(id);
  if (!file) return null;
  const cache = sproutPaths(id).iconCache;
  const out = join(cache, `${size}-${iconVersion(id)}.png`);
  if (existsSync(out)) return out;
  mkdirSync(cache, { recursive: true });
  for (const old of readdirSync(cache).filter(f => f.startsWith(`${size}-`))) rmSync(join(cache, old), { force: true });
  await run('sips', ['-s', 'format', 'png', '-z', String(size), String(size), file, '--out', out]);
  return out;
}

// ---- drawing ----

const SYSTEM = `You draw app icons for small personal tools. Reply with a single SVG.
Rules:
- viewBox="0 0 128 128". The background is one rounded square covering it: <rect width="128" height="128" rx="28">.
- On it, one bold, simple symbol for what the tool is about, centred, about 60% of the icon. It must read at 32 pixels: few shapes, thick strokes, strong contrast.
- Flat shapes only: rect, circle, ellipse, path, polygon, polyline, line, g. Fills and strokes in the given colors; a subtle second shade is fine.
- No text or letters, no images, no filters, no gradients, nothing loaded from elsewhere.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['svg'],
  properties: { svg: { type: 'string', description: 'The complete SVG document' } },
};

/** The tool's colors as they are now (its feel.css grows with it), else its starting feel's. */
function colorsOf(id: string, feelJson: string | null): Record<string, string> {
  let preset: string | undefined;
  try { preset = JSON.parse(feelJson ?? '{}').preset; } catch { /* older rows */ }
  const colors = { ...feelById(preset).tokens };
  const css = join(sproutPaths(id).live, 'src', 'feel.css');
  if (existsSync(css)) {
    const text = readFileSync(css, 'utf8');
    for (const key of ['accent', 'accent-ink', 'accent-soft']) {
      const found = text.match(new RegExp(`--${key}:\\s*(#[0-9a-fA-F]{3,8})`))?.[1];
      if (found) colors[key] = found;
    }
  }
  return colors;
}

const drawing = new Set<string>();
const triedOnce = new Set<string>();

export const isDrawing = (id: string) => drawing.has(id);

/** Draw (or redraw) a sprout's icon with Claude. Quietly does nothing if Claude is off. */
export async function drawIcon(db: Db, id: string): Promise<void> {
  const row = q.sprout(db, id);
  if (!row || drawing.has(id) || !claudeEnabled(db)) return;
  drawing.add(id);
  bus.send({ type: 'sprout', sproutId: id });
  try {
    const feel = colorsOf(id, row.feel);
    const { model } = resolveStep('plant', getSettings(db).models.plant);
    const prompt = [
      `The tool is called "${row.name || 'Untitled'}". The person described it as: "${row.seed}".`,
      `Colors: background ${feel.accent}, symbol ${feel['accent-ink']}, second shade ${feel['accent-soft']}.`,
      'Draw its icon.',
    ].join('\n');
    const result = query({
      prompt,
      options: {
        model,
        effort: 'medium',
        systemPrompt: SYSTEM,
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        maxTurns: 3,
        env: agentEnv(),
        pathToClaudeCodeExecutable: claudeExecutable(),
        outputFormat: { type: 'json_schema', schema: SCHEMA },
      },
    });
    for await (const msg of result) {
      if (msg.type !== 'result') continue;
      if (msg.subtype !== 'success' || !msg.structured_output) throw new Error(`no icon (${msg.subtype})`);
      const svg = cleanSvg((msg.structured_output as { svg: string }).svg);
      if (existsSync(sproutPaths(id).base)) writeFileSync(sproutPaths(id).icon, svg);
    }
  } catch (err) {
    console.error('[icon]', id, (err as Error).message);
  } finally {
    drawing.delete(id);
    triedOnce.add(id);
    bus.send({ type: 'sprout', sproutId: id });
  }
}

/** Give every planted sprout without an icon one, one at a time, once per run. */
export async function drawMissingIcons(db: Db) {
  for (const row of q.sprouts(db)) {
    if (row.status !== 'ready' || triedOnce.has(row.id) || existsSync(sproutPaths(row.id).icon)) continue;
    await drawIcon(db, row.id);
  }
}

/** For export: the icons as text. */
export function readIcons(id: string): { drawn: string | null; custom: string | null } {
  const p = sproutPaths(id);
  const read = (file: string) => existsSync(file) ? readFileSync(file, 'utf8') : null;
  return { drawn: read(p.icon), custom: read(p.iconCustom) };
}

/** For import: put them back, cleaned again since the file came from elsewhere. */
export function writeIcons(id: string, icons: { drawn?: string | null; custom?: string | null } | undefined) {
  const p = sproutPaths(id);
  for (const [text, file] of [[icons?.drawn, p.icon], [icons?.custom, p.iconCustom]] as const) {
    if (!text) continue;
    try { writeFileSync(file, cleanSvg(text)); } catch { /* skip an icon that isn't valid */ }
  }
}
