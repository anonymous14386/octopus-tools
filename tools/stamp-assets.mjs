/**
 * stamp-assets.mjs — put a content hash on the CSS and JS links.
 *
 * Cloudflare caches these for four hours (`max-age=14400`) and overrides the
 * origin, so a deployed CSS change is invisible for that long and looks exactly
 * like a deploy that failed. On 2026-09-05 a menu fix on the public site was
 * shipped, verified in a real browser, deployed — and still reported as broken,
 * because the browser was being served August's stylesheet.
 * `cf-cache-status: HIT`, `age: 1332`, `last-modified: Mon, 17 Aug 2026`.
 *
 * nginx.conf here already shortens the origin's TTL to five minutes with
 * revalidation, which helps and is not enough: Cloudflare's edge is what the
 * visitor actually talks to. Changing the URL sidesteps the cache entirely —
 * `main.css?v=ab12cd34` is a different resource, so it is fetched fresh the
 * moment it is deployed. No purge, no API token, nothing to remember.
 *
 * The stamp is a hash of the file's own CONTENT, so it changes when and only
 * when the asset does — a timestamp would bust the cache on every build and
 * throw away caching that is doing its job.
 *
 *   node tools/stamp-assets.mjs           # rewrite the links
 *   node tools/stamp-assets.mjs --check   # fail if any is stale (for CI/pre-push)
 *
 * Ported from OctopusTechnology/tools/stamp-assets.mjs, which is the same
 * problem in the same shape: a hand-maintained static site with no build step.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const CHECK  = process.argv.includes('--check');

/**
 * Found by walking, not listed. A written list stops covering the file just
 * added, and the failure is silent: the new asset is the one most likely to
 * have changed, and it is the one that goes stale.
 */
function assetsUnder(dir, prefix = '') {
  return readdirSync(join(PUBLIC, dir), { withFileTypes: true })
    .filter(e => e.isFile() && /\.(css|js)$/.test(e.name))
    .map(e => `${prefix}${dir}/${e.name}`)
    .sort();
}
const ASSETS = [...assetsUnder('styles'), ...assetsUnder('scripts')];

const hashOf = rel =>
  createHash('sha256').update(readFileSync(join(PUBLIC, rel))).digest('hex').slice(0, 8);

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(full);
    return e.name.endsWith('.html') ? [full] : [];
  });
}

const stamps = Object.fromEntries(ASSETS.map(a => [a, hashOf(a)]));
const stale = [];
let changed = 0;

for (const file of htmlFiles(PUBLIC)) {
  const before = readFileSync(file, 'utf8');
  let after = before;

  for (const asset of ASSETS) {
    // Matches the asset with or without an existing ?v=, absolute or relative.
    // The prefix is preserved exactly.
    const escaped = asset.replace(/[/.]/g, ch => `\\${ch}`);
    const re = new RegExp(`((?:href|src)=")((?:\\.\\./)*/?${escaped})(\\?v=[a-f0-9]+)?(")`, 'g');
    after = after.replace(re, (_m, lead, path, _old, tail) => `${lead}${path}?v=${stamps[asset]}${tail}`);
  }

  if (after !== before) {
    stale.push(relative(ROOT, file));
    if (!CHECK) { writeFileSync(file, after); changed++; }
  }
}

if (CHECK) {
  if (stale.length) {
    console.error('Asset stamps are out of date in:');
    for (const f of stale) console.error(`  ${f}`);
    console.error('\nRun: node tools/stamp-assets.mjs');
    process.exit(1);
  }
  console.log(`Asset stamps are current (${ASSETS.length} asset(s), ${htmlFiles(PUBLIC).length} page(s)).`);
} else {
  console.log(`Stamped ${ASSETS.map(a => `${a} → ${stamps[a]}`).join(', ')}`);
  console.log(changed ? `Updated ${changed} page(s).` : 'All pages already current.');
}
