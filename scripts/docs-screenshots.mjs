// Screenshots for the project page (docs/), taken from a running greenhouse.
//   node scripts/docs-screenshots.mjs [home game disaster whisper history settings usage grow greenhouse]
// Saves PNGs at 2x, light and dark, into docs/images/raw; scripts/docs-images.py
// crops and compresses them into the JPEGs the page uses.
// Icons: curl the greenhouse's /api/sprouts/<id>/icon.svg into docs/images/icons.
// SPROUT_URL picks the greenhouse (default http://localhost:4100); the sprout ids are the author's own.
import { chromium } from 'playwright';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
const out = join(import.meta.dirname, '..', 'docs', 'images');
const base = process.env.SPROUT_URL ?? 'http://localhost:4100';
const ids = { game: 'smvojao2sc39d', disaster: 'smvmt98rs0160', song: 'smvlzhmbu0c65', launch: 'smvpeuoly8e95', lighting: 'smvm0rlpp6211', skyrim: 'smvmp77il7103', overhead: 'smvlxxx76ec2d' };
// Overhead shows planes around its home: point it somewhere public (an airport) before shooting it.
const which = process.argv.slice(2);
const browser = await chromium.launch();
async function page(scheme = 'light', w = 1440, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme });
  // The greenhouse remembers the last theme; start each shot in the one asked for.
  await ctx.addInitScript(s => { try { localStorage.setItem('sprout-theme', s); } catch {} }, scheme);
  return ctx.newPage();
}
const settle = p => p.waitForTimeout(3500);
const open = async (scheme, path, wait = 6000) => { const p = await page(scheme); await p.goto(`${base}/#${path}`); await p.waitForTimeout(wait); return p; };
// Every shot is taken twice, light and dark, as raw/<name>-<scheme>.png.
const shots = {
  async home(s) { return open(s, '/', 3500); },
  async game(s) { return open(s, `/s/${ids.game}`, 7000); },
  async disaster(s) { return open(s, `/s/${ids.disaster}`, 9000); },
  async lighting(s) {
    // With fixtures selected, the Colour, Position and Intensity panels fill in.
    const p = await open(s, `/s/${ids.lighting}/full`, 7000);
    const tool = p.frameLocator('iframe');
    await tool.getByText('Front Par 2', { exact: true }).first().click();
    for (const name of ['Front Par 3', 'Wash 2', 'Wash 3']) await tool.getByText(name, { exact: true }).first().click({ modifiers: ['Shift'] });
    await p.waitForTimeout(800);
    return p;
  },
  async launch(s) { return open(s, `/s/${ids.launch}`, 7000); },
  async song(s) { return open(s, `/s/${ids.song}`, 6000); },
  async skyrim(s) { return open(s, `/s/${ids.skyrim}/full`, 7000); },
  async whisper(s) {
    const p = await open(s, `/s/${ids.overhead}`, 9000);
    await p.fill('#whisper', 'Show which airline each flight is with');
    return p;
  },
  async history(s) {
    const p = await open(s, `/s/${ids.launch}`, 6000);
    await p.getByRole('button', { name: 'History' }).click(); await p.waitForTimeout(900);
    return p;
  },
  async settings(s) {
    const p = await open(s, `/s/${ids.disaster}`, 7000);
    await p.getByRole('button', { name: 'Settings' }).click(); await p.waitForTimeout(1200);
    return p;
  },
  async usage(s) {
    const p = await open(s, `/s/${ids.launch}`, 6000);
    await p.locator('.usage-meter .pill-btn').click(); await p.waitForTimeout(900);
    return p;
  },
  async grow(s) {
    const p = await open(s, '/new', 3500);
    await p.fill('#seed', 'A tide chart that tells me when to go tide-pooling');
    return p;
  },
};
mkdirSync(join(out, 'raw'), { recursive: true });
for (const name of which.length ? which : Object.keys(shots)) {
  for (const scheme of ['light', 'dark']) {
    const p = await shots[name](scheme);
    await p.screenshot({ path: join(out, 'raw', `${name}-${scheme}.png`) });
    await p.close();
  }
  console.log('shot', name);
}
await browser.close();
