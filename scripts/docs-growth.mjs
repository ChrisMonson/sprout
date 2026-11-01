// The project page's before-and-after: Hex Harbor Fishing as it was planted, and
// as it is now. Copies both versions out of the sprout's history (the sprout
// itself isn't touched), runs each on its own dev server with Sprout's runtime,
// and saves docs/images/raw/hex-before.png and hex-after.png; then run
// scripts/docs-images.py. The game has one look, so there's no dark version.
//   node scripts/docs-growth.mjs
// SPROUT_HOME picks the greenhouse folder (default ~/Sprout); the sprout id is the author's own.
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const home = process.env.SPROUT_HOME ?? join(homedir(), 'Sprout');
const sprout = join(home, 'sprouts', 'smvojao2sc39d');
const versions = { before: '01799a8', after: 'HEAD' };   // planted, and now
const out = join(import.meta.dirname, '..', 'docs', 'images', 'raw');
const scratch = mkdtempSync(join(tmpdir(), 'sprout-growth-'));
symlinkSync(join(home, 'node_modules'), join(scratch, 'node_modules'));
mkdirSync(out, { recursive: true });

// Real Chrome with a window: the game draws its sea in 3D, which headless
// Chromium renders without the GPU, leaving bright bars down the picture.
const browser = await chromium.launch({ channel: 'chrome', headless: false });
let port = 4791;
for (const [name, commit] of Object.entries(versions)) {
  const root = join(scratch, name);
  mkdirSync(root);
  execFileSync('sh', ['-c', `git -C "${join(sprout, 'live')}" archive ${commit} | tar -x -C "${root}"`]);
  // The first version starts a new game; today's gets a copy of the game in progress.
  const db = join(scratch, `${name}.db`);
  if (commit === 'HEAD') execFileSync('sqlite3', [join(sprout, 'data', 'app.db'), `.backup ${db}`]);
  const runner = spawn(process.execPath, ['--no-warnings', join(home, '.runtime', 'runner.mjs'), '--root', root, '--port', String(port), '--db', db, '--sprout', `docs-${name}`, '--cache', join(scratch, `cache-${name}`)], { cwd: home });
  await new Promise((resolve, reject) => {
    runner.stdout.on('data', chunk => { if (String(chunk).includes('SPROUT_READY')) resolve(); });
    runner.once('exit', code => reject(new Error(`${name} didn't start (${code})`)));
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(out, `hex-${name}.png`) });
  runner.kill();
  port++;
  console.log('shot', name);
}
await browser.close();
rmSync(scratch, { recursive: true, force: true });
