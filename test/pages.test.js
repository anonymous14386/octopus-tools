'use strict';
/**
 * pages.test.js — do the pages actually run?
 *
 * octopus-budget and octopus-shopper were both green — 22 and 102 tests — while
 * neither container could start, because every test imported the pieces and
 * none imported the entrypoint. One misplaced line threw at module load and the
 * suites had nothing to say about it.
 *
 * The same hole exists here in a different shape. bases.js and ipv4.js have 54
 * tests between them and none of that says whether baseconv.html RUNS: a typo in
 * the page's own script throws on load, renders nothing, and looks exactly like
 * a blank page — with no error anywhere a test can see.
 *
 * So this evaluates each page's inline script against a DOM small enough to live
 * in one file — the entrypoint under test, not the pieces. It is not a browser
 * and does not pretend to be. It checks that the script loads, wires itself up,
 * and puts a real answer on the page.
 */
const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('node:fs');
const path     = require('node:path');
const vm       = require('node:vm');

const pub = path.join(__dirname, '..', 'public');

// ── A DOM, in about sixty lines ──────────────────────────────────────────────

const VOID = new Set(['input', 'br', 'meta', 'link', 'img', 'hr', 'source']);

function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let node = root, i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) node.children.push({ text: html.slice(i, lt), parent: node });
    if (html.startsWith('<!--', lt)) { i = html.indexOf('-->', lt) + 3; continue; }
    if (html.startsWith('<!', lt))   { i = html.indexOf('>', lt) + 1; continue; }
    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    const raw = html.slice(lt + 1, gt);
    if (raw[0] === '/') { if (node.parent) node = node.parent; i = gt + 1; continue; }
    const tag = /^[\w-]+/.exec(raw)[0].toLowerCase();
    const attrs = {};
    for (const m of raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      if (m[1] === tag && m.index === 0) continue;
      attrs[m[1]] = m[2] === undefined ? '' : m[2];
    }
    const el = { tag, attrs, children: [], parent: node };
    node.children.push(el);
    i = gt + 1;
    if (raw.endsWith('/') || VOID.has(tag)) continue;
    if (tag === 'script' || tag === 'style') {           // raw text, not markup
      const close = html.indexOf(`</${tag}>`, i);
      el.children.push({ text: html.slice(i, close < 0 ? html.length : close), parent: el });
      i = close < 0 ? html.length : close + tag.length + 3;
      continue;
    }
    node = el;
  }
  return root;
}

const descendants = el => (el.children || []).flatMap(c => (c.tag ? [c, ...descendants(c)] : []));
const text        = el => (el.children || []).map(c => (c.tag ? text(c) : c.text)).join('');
const classesOf   = el => (el.attrs && el.attrs.class ? el.attrs.class.split(/\s+/).filter(Boolean) : []);

function matches(el, selector) {
  // Only what the pages use: ".a", ".a.b", and ".a .b" (descendant).
  const parts = selector.trim().split(/\s+/);
  const own   = parts[parts.length - 1].split('.').filter(Boolean);
  if (!own.every(c => classesOf(el).includes(c))) return false;
  let node = el.parent;
  for (let i = parts.length - 2; i >= 0; i--) {
    const want = parts[i].split('.').filter(Boolean);
    while (node && !want.every(c => classesOf(node).includes(c))) node = node.parent;
    if (!node) return false;
    node = node.parent;
  }
  return true;
}

function defaultValue(el) {
  if (el.tag === 'select') {
    const opts = descendants(el).filter(d => d.tag === 'option');
    const sel  = opts.find(o => 'selected' in o.attrs) || opts[0];
    return sel ? (sel.attrs.value !== undefined ? sel.attrs.value : text(sel)) : '';
  }
  return el.attrs.value !== undefined ? el.attrs.value : '';
}

function wrap(el) {
  if (el.el) return el.el;
  const api = {
    _node: el,
    tagName: (el.tag || '').toUpperCase(),
    style: {},
    dataset: Object.fromEntries(Object.entries(el.attrs || {})
      .filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5), v])),
    disabled: 'disabled' in (el.attrs || {}),
    checked:  'checked'  in (el.attrs || {}),
    onclick: null,
    classList: {
      add:    (...c) => { const s = new Set(classesOf(el)); c.forEach(x => s.add(x));    el.attrs.class = [...s].join(' '); },
      remove: (...c) => { const s = new Set(classesOf(el)); c.forEach(x => s.delete(x)); el.attrs.class = [...s].join(' '); },
      toggle: (c, on) => { on ? api.classList.add(c) : api.classList.remove(c); },
      contains: c => classesOf(el).includes(c)
    },
    addEventListener() {},
    appendChild(child) { el.children.push(child._node); child._node.parent = el; return child; },
    append(...kids) { kids.forEach(k => api.appendChild(k)); },
    querySelectorAll(sel) { return descendants(el).filter(d => matches(d, sel)).map(wrap); },
    querySelector(sel) { return api.querySelectorAll(sel)[0] || null; },
    get children() { return el.children.filter(c => c.tag).map(wrap); },
    get value() { return el._value !== undefined ? el._value : defaultValue(el); },
    set value(v) { el._value = String(v); },
    get textContent() { return text(el); },
    set textContent(v) { el.children = [{ text: String(v), parent: el }]; },
    get innerHTML() { return el._html || ''; },
    set innerHTML(v) { el._html = String(v); el.children = parse(String(v)).children.map(c => (c.parent = el, c)); }
  };
  el.el = api;
  return api;
}

function makeDocument(html) {
  const root = parse(html);
  const all  = descendants(root);
  return {
    getElementById: id  => { const n = all.find(e => e.attrs && e.attrs.id === id); return n ? wrap(n) : null; },
    createElement:  tag => wrap({ tag, attrs: {}, children: [], parent: null }),
    querySelector:  sel => { const n = all.find(e => matches(e, sel)); return n ? wrap(n) : null; },
    addEventListener() {}
  };
}

// ── Boot each page the way a browser would ───────────────────────────────────

function boot(page) {
  const html = fs.readFileSync(path.join(pub, page), 'utf8');
  const sandbox = {
    document: makeDocument(html),
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    setTimeout: () => 0, clearTimeout: () => {},
    console, Math, JSON, Array, Object, String, Number, BigInt, RegExp, Error, Promise
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // The <script src> tags first, in order, exactly as the browser would.
  for (const m of html.matchAll(/<script src="\/scripts\/([\w.-]+\.js)(?:\?[^"]*)?"><\/script>/g))
    vm.runInContext(fs.readFileSync(path.join(pub, 'scripts', m[1]), 'utf8'), sandbox, { filename: m[1] });

  // Then the page's own script — the thing under test.
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(inline.length, `${page} has no inline script to run`);
  for (const src of inline) vm.runInContext(src, sandbox, { filename: page });
  return sandbox;
}

test('baseconv.html loads its module, runs, and shows an answer', () => {
  const s = boot('baseconv.html');
  assert.ok(s.Bases, 'bases.js did not attach to the page');
  const d = s.document;
  // The page ships showing 192 in decimal converted to binary, so a page that
  // ran has already done it. A page that threw still has the placeholder.
  assert.equal(d.getElementById('answerValue').textContent, '1100 0000');
  assert.equal(d.getElementById('errorMsg').textContent, '');
  assert.match(d.getElementById('answerSub').textContent, /decimal 192/);
  assert.ok(d.getElementById('steps').children.length, 'no working was rendered');
  const cells = d.getElementById('grid').querySelectorAll('.cell-value');
  assert.equal(cells.length, 4, 'the four usual bases were not rendered');
  assert.equal(cells[3].textContent, 'C0');
  assert.match(d.getElementById('powTable').innerHTML, /2\^10/);
});

test('subnet.html loads its module, runs, and shows the block', () => {
  const s = boot('subnet.html');
  assert.ok(s.IPv4, 'ipv4.js did not attach to the page');
  const d = s.document;
  assert.equal(d.getElementById('errorMsg').textContent, '');
  assert.equal(d.getElementById('prefixBadge').textContent, '/26');
  const facts = d.getElementById('facts').innerHTML;
  assert.match(facts, /192\.168\.1\.128\/26/, 'the network address is not on the page');
  assert.match(facts, /192\.168\.1\.191/, 'the broadcast address is not on the page');
  assert.ok(d.getElementById('steps').children.length >= 4, 'the working was not rendered');
  assert.match(d.getElementById('cutTable').innerHTML, /192\.168\.1\.160\/28/,
    'the subdivision table did not render');
  assert.match(d.getElementById('maskTable').innerHTML, /255\.255\.255\.192/);
  assert.match(d.getElementById('hostsResult').textContent, /\/23/);
});

test('each page loads the script it uses, and uses the script it loads', () => {
  // A page that reaches for Bases without loading bases.js is a blank page in a
  // browser and a passing test everywhere else.
  for (const page of ['baseconv.html', 'subnet.html']) {
    const html   = fs.readFileSync(path.join(pub, page), 'utf8');
    const loaded = [...html.matchAll(/<script src="\/scripts\/([\w.-]+)\.js/g)].map(m => m[1]);
    const body   = html.replace(/<script src[^>]*><\/script>/g, '');
    for (const [file, name] of Object.entries({ bases: 'Bases', ipv4: 'IPv4' })) {
      const used = new RegExp(`\\b${name}\\.`).test(body);
      assert.equal(used, loaded.includes(file),
        `${page}: ${name} is ${used ? 'used' : 'unused'} but ${file}.js is ${loaded.includes(file) ? '' : 'not '}loaded`);
    }
  }
});
