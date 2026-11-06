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
const ids = { lightlab: 'smw3s2llj2901', ailearn: 'smw14agpw9b05', game: 'smvojao2sc39d', lighting: 'smvm0rlpp6211', disaster: 'smvmt98rs0160', launch: 'smvpeuoly8e95', skyrim: 'smvmp77il7103', overhead: 'smvlxxx76ec2d' };
const page = join(import.meta.dirname, '..', 'docs', 'index.html');
let html = readFileSync(page, 'utf8');
const block = html.match(/(<script id="sprouts" type="application\/json">)([\s\S]*?)(<\/script>)/);
const data = JSON.parse(block[2]);

/**
 * What a sprout's history adds up to, newest first: changes that were undone
 * drop out. An old-style rewind (one "Revert "X"" per change) and a rollback
 * take out the change they name; "Rewound "X"" takes out X and everything after
 * it; "Brought back "X"" undoes the rewind before it, so those come back.
 */
function grown(oldestFirst) {
  const kept = [];
  let taken = [];          // the last rewind's changes, in case they're brought back
  let reverting = false;
  for (const title of oldestFirst) {
    const named = title.match(/^(Revert|Rewound|Brought back) "(.*)"$/s);
    if (!named) { kept.push(title); reverting = false; continue; }
    const [, how, what] = named;
    if (how === 'Brought back') { kept.push(...taken); taken = []; reverting = false; continue; }
    const at = kept.lastIndexOf(what);
    if (at < 0) continue;
    const out = how === 'Rewound' ? kept.splice(at) : kept.splice(at, 1);
    // A run of reverts is one old-style rewind; collect it in the order it was grown.
    taken = how === 'Revert' && reverting ? [...out, ...taken] : out;
    reverting = how === 'Revert';
  }
  return kept.reverse();
}

for (const [key, id] of Object.entries(ids)) {
  const titles = execFileSync('git', ['-C', join(home, 'sprouts', id, 'live'), 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
  // The oldest two are the template, then the first version planted from it.
  data[key].planted = titles.at(-2);
  data[key].log = grown(titles.slice(0, -2).reverse());
  delete data[key].changes;                  // counted from the log now
  console.log(`${data[key].name}: ${data[key].log.length} changes`);
}

// `<` is escaped so no title can end the script tag early.
html = html.replace(block[0], () => block[1] + JSON.stringify(data).replace(/</g, '\\u003c') + block[3]);
// The sprout shown first is also written out in the page, for browsers without JavaScript.
const shown = html.match(/aria-selected="true"[^>]*data-id="(\w+)"/)[1];
html = html.replace(/(<dt>Changes<\/dt><dd>)\d+/, (_, open) => open + data[shown].log.length);
writeFileSync(page, html);
