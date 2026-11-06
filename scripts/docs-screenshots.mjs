// Screenshots for the project page (docs/), taken from a running greenhouse.
//   node scripts/docs-screenshots.mjs [home lightlab scenes ailearn game disaster whisper history settings usage grow …]
// Saves PNGs at 2x, light and dark, into docs/images/raw; scripts/docs-images.py
// crops and compresses them into the JPEGs the page uses.
// Icons: curl the greenhouse's /api/sprouts/<id>/icon.svg into docs/images/icons.
// SPROUT_URL picks the greenhouse (default http://localhost:4100); the sprout ids are the author's own.
import { chromium } from 'playwright';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
const out = join(import.meta.dirname, '..', 'docs', 'images');
const base = process.env.SPROUT_URL ?? 'http://localhost:4100';
const ids = { lightlab: 'smw3s2llj2901', ailearn: 'smw14agpw9b05', game: 'smvojao2sc39d', disaster: 'smvmt98rs0160', launch: 'smvpeuoly8e95', lighting: 'smvm0rlpp6211', skyrim: 'smvmp77il7103', overhead: 'smvlxxx76ec2d' };
// Overhead shows planes around its home: point it somewhere public (an airport) before shooting it.
const which = process.argv.slice(2);
const browser = await chromium.launch();
// Hex Harbor Fishing draws its sea in 3D, which headless Chromium renders without
// the GPU, leaving bright bars down the picture; it's shot in real Chrome instead.
let gpu;
const withGpu = async () => gpu ??= await chromium.launch({ channel: 'chrome', headless: false });
async function page(scheme = 'light', w = 1440, h = 900, from = browser) {
  const ctx = await from.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme });
  // The greenhouse remembers the last theme; start each shot in the one asked for.
  await ctx.addInitScript(s => { try { localStorage.setItem('sprout-theme', s); } catch {} }, scheme);
  return ctx.newPage();
}
// Shots leave out what Sprout happens to be doing at the time (its working notice and idea pills).
const open = async (scheme, path, wait = 6000, from) => {
  const p = await page(scheme, 1440, 900, from);
  await p.goto(`${base}/#${path}`);
  await p.addStyleTag({ content: '.card-float.working, .pills { display: none !important; }' });
  await p.waitForTimeout(wait);
  return p;
};
// Light Material Lab's saved bench setups: switch to one by name; returns the one that was showing.
async function setup(tool, name) {
  const was = await tool.locator('.setups-button .setups-name').textContent();
  await tool.locator('.setups-button').click();
  await tool.locator('.setups-item', { hasText: name }).click();
  await tool.locator('.setups-button .setups-name', { hasText: name }).waitFor();
  return was;
}
async function putBack(tool, name) {
  await tool.locator('.setups-button').click();
  await tool.locator('.setups-item', { hasText: name }).click();
}
// Every shot is taken twice, light and dark, as raw/<name>-<scheme>.png; a shot
// that saves its own pictures returns nothing.
const shots = {
  async home(s) {
    // The hero shows two rows of sprouts and the "Grow something new" row, so the
    // rest are left out of the tray (here, not in the greenhouse), and empty cells
    // fill out the last row.
    const p = await open(s, '/', 3500);
    await p.evaluate(leftOut => {
      for (const card of document.querySelectorAll('a.sprout-card')) {
        if (leftOut.some(name => card.textContent.includes(name))) card.remove();
      }
      const tray = document.querySelector('a.sprout-card').parentElement;
      for (const cell of tray.querySelectorAll('.cell-empty.extra')) cell.remove();
      const columns = getComputedStyle(tray).gridTemplateColumns.split(' ').length;
      while (tray.children.length % columns) {
        const filler = document.createElement('span');
        filler.className = 'cell-empty extra';
        tray.append(filler);
      }
    }, ['Song Scout', 'Llama Activation Lens', 'Skyrim Lore Journal', 'Overhead']);
    return p;
  },
  async lightlab(s) {
    const p = await open(s, `/s/${ids.lightlab}`, 8000, await withGpu());
    const tool = p.frameLocator('iframe');
    const was = await setup(tool, 'Basic Scene');
    await p.waitForTimeout(1500);
    await p.screenshot({ path: join(out, 'raw', `lightlab-${s}.png`) });
    await putBack(tool, was);
    await p.close();
  },
  // Three of Light Material Lab's setups, the bench alone. Its bench is dark in either theme.
  async scenes(s) {
    if (s === 'dark') return;
    const p = await open(s, `/s/${ids.lightlab}/full`, 8000, await withGpu());
    const tool = p.frameLocator('iframe');
    const frame = p.frames().find(f => f !== p.mainFrame());
    let was;
    for (const [name, file] of [['Black Hole', 'blackhole'], ['Fiber Optic', 'fiber'], ['Polarizers', 'polarizers']]) {
      const before = await setup(tool, name);
      was ??= before;
      await p.waitForTimeout(2000);
      // Just the light on the bench: the tool's own buttons laid over it are hidden for the shot.
      const hide = await frame.addStyleTag({ content: '.stage-wrap > :not(canvas.stage) { visibility: hidden !important; }' });
      await tool.locator('canvas.stage').screenshot({ path: join(out, 'raw', `scene-${file}.png`) });
      await hide.evaluate(el => el.remove());
    }
    await putBack(tool, was);
    await p.close();
  },
  async ailearn(s) {
    // The Attention lesson's "who does 'it' mean?" playground; then back to the lesson list.
    const p = await open(s, `/s/${ids.ailearn}`, 9000);
    const tool = p.frameLocator('iframe');
    await tool.getByRole('button', { name: 'Revisit' }).nth(5).click();
    await tool.getByText('Playground · Who does', { exact: false }).evaluate(el => { el.parentElement.scrollIntoView({ block: 'start' }); scrollBy(0, -90); });
    await p.waitForTimeout(800);
    await p.screenshot({ path: join(out, 'raw', `ailearn-${s}.png`) });
    await tool.getByRole('button', { name: /All lessons/ }).click();
    await p.close();
  },
  async game(s) { return open(s, `/s/${ids.game}`, 7000, await withGpu()); },
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
    if (!p) continue;
    await p.screenshot({ path: join(out, 'raw', `${name}-${scheme}.png`) });
    await p.close();
  }
  console.log('shot', name);
}
await browser.close();
await gpu?.close();
