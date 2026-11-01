// The project page's link-preview image (docs/images/card.jpg, 1200x630): the
// headline beside the greenhouse screenshot. Run after docs-images.py.
//   node scripts/docs-card.mjs
import { chromium } from 'playwright';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const images = join(import.meta.dirname, '..', 'docs', 'images');
// Inline, since a page set from a string can't load local files.
const shot = `data:image/jpeg;base64,${readFileSync(join(images, 'home-light.jpg')).toString('base64')}`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=DM+Sans:opsz,wght@9..40,500;9..40,600&display=swap">
<style>
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #F7F8F6; color: #18201B; font-family: 'DM Sans', sans-serif; position: relative; }
  .text { position: absolute; left: 72px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 30px; color: #2F6B45; margin-bottom: 34px; }
  .brand svg { width: 40px; height: 40px; fill: none; stroke: #2F6B45; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  h1 { font: 800 70px/0.98 'Bricolage Grotesque', sans-serif; letter-spacing: -0.035em; margin: 0 0 26px; }
  p { margin: 0; font-size: 24px; line-height: 1.4; color: #56615A; }
  .shot { position: absolute; left: 600px; top: 92px; width: 700px; padding: 12px; border-radius: 30px; background: #ECE5D9; transform: rotate(2deg); box-shadow: 0 30px 60px rgba(24, 32, 27, 0.16); }
  .shot img { display: block; width: 100%; border-radius: 20px; }
</style></head><body>
  <div class="text">
    <div class="brand"><svg viewBox="0 0 24 24"><path d="M12 21v-9" /><path d="M12 12c0-4 3-7 8-7 0 4-3 7-8 7z" /><path d="M12 14c0-3-2.5-5.5-7-5.5 0 3 2.5 5.5 7 5.5z" /></svg>Sprout</div>
    <h1>Grow the tools you wish you had.</h1>
    <p>Describe a small tool in your own words. Sprout plants it, then keeps it growing.</p>
  </div>
  <div class="shot"><img src="${shot}"></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(images, 'card.jpg'), type: 'jpeg', quality: 86 });
await browser.close();
console.log('card', join(images, 'card.jpg'));
