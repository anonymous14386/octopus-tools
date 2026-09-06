'use strict';

/**
 * Cache-busting and deploy verification for a site with no build step.
 *
 * Cloudflare caches CSS and JS for four hours and OVERRIDES the origin's
 * Cache-Control, so a shipped fix is invisible for that long and looks exactly
 * like a deploy that failed. nginx.conf already shortens the origin TTL to five
 * minutes, which helps and is not enough — the edge is what a visitor actually
 * talks to. The fix that works is on the URL: main.css?v=<content hash> is a
 * different resource, fetched fresh the moment it is deployed.
 *
 * That happened here for real. 2026-09-05: a menu fix on the public site,
 * correct, deployed, verified in a browser, and still broken for the person
 * looking at it — cf-cache-status HIT, age 1332, last-modified in August.
 *
 * There is no application process on this image, so /api/build is written by
 * the Dockerfile instead of computed at startup. These tests check the parts
 * that can be checked without building the image, and say which parts those
 * are.
 *
 * Run: node --test test/*.test.js
 */

const { test }      = require('node:test');
const assert        = require('node:assert');
const fs            = require('node:fs');
const path          = require('node:path');
const { execFileSync } = require('node:child_process');

const root   = path.join(__dirname, '..');
const pub    = path.join(root, 'public');
const pages  = fs.readdirSync(pub).filter(f => f.endsWith('.html'));

test('there are pages and assets to check — otherwise everything below passes vacuously', () => {
  assert.ok(pages.length >= 1, 'no HTML pages found');
  assert.ok(fs.existsSync(path.join(pub, 'styles')), 'no styles/ directory');
});

test('the stamper reports every page current', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'tools', 'stamp-assets.mjs'), '--check'],
    { cwd: root, encoding: 'utf8' });
  assert.match(out, /Asset stamps are current/);
});

/**
 * The guard that matters. Everything else can be right while one page still
 * links a bare URL — and that page is the one that goes stale, silently,
 * exactly as if the deploy had failed. Scanned rather than listed, so a page
 * added tomorrow is covered without anyone remembering.
 */
test('every local CSS and JS link on every page carries a content stamp', () => {
  const unstamped = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(pub, page), 'utf8');
    for (const m of html.matchAll(/(?:href|src)="([^"]+\.(?:css|js))(\?v=[0-9a-f]+)?"/g)) {
      const [, url, stamp] = m;
      if (/^https?:\/\//.test(url)) continue;   // a CDN's URL is its own problem
      if (!stamp) unstamped.push(`${page} → ${url}`);
    }
  }
  assert.deepEqual(unstamped, [],
    'these link an unversioned asset, so Cloudflare will keep serving the cached ' +
    'copy for four hours after a deploy — run `npm run stamp`');
});

test('a stamp is per file, so changing one asset does not re-download the other', () => {
  const html = fs.readFileSync(path.join(pub, 'speed-reader.html'), 'utf8');
  const found = [...html.matchAll(/(?:href|src)="\/(?:styles|scripts)\/[^"]+\?v=([0-9a-f]{8})"/g)].map(m => m[1]);
  assert.ok(found.length >= 2, 'expected this page to link both a stylesheet and a script');
  assert.notStrictEqual(found[0], found[1], 'both assets carry the same stamp — it is not per file');
});

// ── The parts the image builds ───────────────────────────────────────────────

test('the Dockerfile writes /api/build, and hashes before creating it', () => {
  const df = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(df, /html\/api\/build/, 'the Dockerfile does not write an /api/build document');
  assert.match(df, /sha256sum/, 'the stamp is not derived from the files');
  assert.match(df, /"service":"octopus-tools"/, 'the document does not name this service');

  // If api/ existed before the hash was taken, the stamp would cover its own
  // output and change for a reason that is not a deploy.
  assert.ok(df.indexOf('sha256sum') < df.indexOf('mkdir -p /usr/share/nginx/html/api'),
    'api/ is created before the hash is taken — the stamp would cover its own output');
});

test('nginx serves /api/build as JSON and never caches it', () => {
  const conf = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8');
  const at   = conf.indexOf('location = /api/build');
  assert.ok(at > 0, 'nginx has no /api/build location');
  const block = conf.slice(at, conf.indexOf('}', at));
  assert.match(block, /default_type application\/json/, '/api/build would be served as text');
  assert.match(block, /Cache-Control "no-store"/,
    'a cached deploy-check answers for the deploy before the one you are asking about');
});

test('HTML is still never cached — it is what points at the stamped URLs', () => {
  // A stamped URL is no help if the page carrying it is itself stale.
  const conf = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8');
  const at   = conf.indexOf('location ~* \\.html$');
  assert.ok(at > 0, 'no HTML cache rule');
  assert.match(conf.slice(at, conf.indexOf('}', at)), /Cache-Control "no-cache"/);
});
