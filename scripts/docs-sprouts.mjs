// Refreshes "Meet the sprouts" on the project page from each sprout's history:
// every change, newest first, and what the first version planted. Writes them
// into the sprout data in docs/index.html (the counts come from the lists).
// Read the logs before publishing: they're the titles of your real changes.
//   node scripts/docs-sprouts.mjs
// SPROUT_HOME picks the greenhouse folder (default ~/Sprout); the sprout ids are the author's own.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = process.env.SPROUT_HOME ?? join(homedir(), 'Sprout');
const ids = { launch: 'smvpeuoly8e95', game: 'smvojao2sc39d', disaster: 'smvmt98rs0160', skyrim: 'smvmp77il7103', lighting: 'smvm0rlpp6211', overhead: 'smvlxxx76ec2d', song: 'smvlzhmbu0c65' };
const page = join(import.meta.dirname, '..', 'docs', 'index.html');
let html = readFileSync(page, 'utf8');
const block = html.match(/(<script id="sprouts" type="application\/json">)([\s\S]*?)(<\/script>)/);
const data = JSON.parse(block[2]);

for (const [key, id] of Object.entries(ids)) {
  const titles = execFileSync('git', ['-C', join(home, 'sprouts', id, 'live'), 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
  // The oldest two are the template, then the first version planted from it.
  data[key].planted = titles.at(-2);
  data[key].log = titles.slice(0, -2);
  delete data[key].changes;                  // counted from the log now
  console.log(`${data[key].name}: ${data[key].log.length} changes`);
}

// `<` is escaped so no title can end the script tag early.
html = html.replace(block[0], () => block[1] + JSON.stringify(data).replace(/</g, '\\u003c') + block[3]);
// The sprout shown first is also written out in the page, for browsers without JavaScript.
const shown = html.match(/aria-selected="true"[^>]*data-id="(\w+)"/)[1];
html = html.replace(/(<dt>Changes<\/dt><dd>)\d+/, (_, open) => open + data[shown].log.length);
writeFileSync(page, html);
