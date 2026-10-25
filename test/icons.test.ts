import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SPROUT_HOME = mkdtempSync(join(tmpdir(), 'sprout-icons-'));
const { sproutPaths } = await import('../server/paths.ts');
const { cleanSvg, setCustomIcon, clearCustomIcon, iconFile, iconPng, iconVersion, readIcons, writeIcons } = await import('../server/icons.ts');

const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#3B7A70"/><circle cx="64" cy="64" r="30" fill="#fff"/></svg>';

describe('cleaning an SVG', () => {
  it('keeps a plain drawing as it is', () => {
    expect(cleanSvg(DRAWING)).toBe(DRAWING);
  });

  it('takes out scripts, handlers and anything loaded from elsewhere', () => {
    const svg = cleanSvg(`<?xml version="1.0"?>
<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><image href="https://example.com/x.png"/>
<rect width="10" height="10" fill="url(https://example.com/p)" onclick="x()"/><use href="#a"/><foreignObject><div/></foreignObject></svg>`);
    expect(svg).not.toMatch(/script|onload|onclick|example\.com|foreignObject|<image|<use/);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('<rect');
  });

  it('adds a viewBox from width and height when there isn’t one', () => {
    expect(cleanSvg('<svg width="48" height="48"><circle r="4"/></svg>')).toContain('viewBox="0 0 48 48"');
  });

  it('refuses things that aren’t SVGs', () => {
    expect(() => cleanSvg('<html><body/></html>')).toThrow();
    expect(() => cleanSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>')).toThrow();
    expect(() => cleanSvg(`<svg>${'x'.repeat(70_000)}</svg>`)).toThrow();
  });
});

describe('a sprout’s icon', () => {
  const id = 'sicon';
  mkdirSync(sproutPaths(id).base, { recursive: true });

  it('uses the person’s own icon over the drawn one, and goes back when it’s removed', () => {
    expect(iconFile(id)).toBeNull();
    expect(iconVersion(id)).toBe(0);
    writeIcons(id, { drawn: DRAWING });
    expect(iconFile(id)).toBe(sproutPaths(id).icon);
    setCustomIcon(id, DRAWING.replace('#3B7A70', '#8A4B24'));
    expect(iconFile(id)).toBe(sproutPaths(id).iconCustom);
    expect(readIcons(id).custom).toContain('#8A4B24');
    clearCustomIcon(id);
    expect(iconFile(id)).toBe(sproutPaths(id).icon);
  });

  it('turns into a PNG of the asked size', async () => {
    const png = await iconPng(id, 96);
    expect(png && existsSync(png)).toBe(true);
    expect(await iconPng(id, 96)).toBe(png);
  });
});
