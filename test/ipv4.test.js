'use strict';
/**
 * ipv4.test.js — subnetting, and the three edges the generic formula gets wrong.
 *
 * 2^(32−p) − 2 is right for every prefix from 0 to 30 and wrong for the two
 * that matter most on real equipment: it says a /31 has 0 usable hosts and a
 * /32 has −1. A /31 is what every router-to-router link is numbered with
 * (RFC 3021), so that is not a tidy-away edge case, it is the common one.
 *
 * Run: node --test test/*.test.js
 */
const { test } = require('node:test');
const assert   = require('node:assert');
const I        = require('../public/scripts/ipv4.js');

const ok = r => { assert.ok(r.ok, r.error); return r; };

// ── The worked example ───────────────────────────────────────────────────────

test('192.168.1.130/26 lands where a router says it does', () => {
  const r = ok(I.subnet('192.168.1.130/26'));
  assert.equal(r.mask,      '255.255.255.192');
  assert.equal(r.wildcard,  '0.0.0.63');
  assert.equal(r.network,   '192.168.1.128');
  assert.equal(r.broadcast, '192.168.1.191');
  assert.equal(r.firstHost, '192.168.1.129');
  assert.equal(r.lastHost,  '192.168.1.190');
  assert.equal(r.usable, 62);
  assert.equal(r.total, 64);
  assert.equal(r.cidr, '192.168.1.128/26');
});

test('the working shows the borrow, not just the answer', () => {
  // The exam skill is the procedure. A tool that prints 192.168.1.128 and
  // nothing else teaches nobody anything.
  const r = ok(I.subnet('192.168.1.130/26'));
  const mask = r.steps.find(s => /mask from/.test(s.title));
  assert.match(mask.lines.join('\n'), /2 bits borrowed from octet 4/);
  assert.match(mask.note, /block size in that octet is 64/);
  assert.ok(r.steps.some(s => /AND mask/.test(s.title)));
  assert.ok(r.steps.some(s => /OR the wildcard/.test(s.title)));
});

test('the caret line lines up with the dotted binary above it', () => {
  // Both are 35 characters — four groups of eight with three separators. If
  // they drift apart the marker points at the wrong bit, which is worse than
  // no marker.
  const r = ok(I.subnet('10.0.0.1/13'));
  assert.equal(I.markPrefix(13, '^').length, I.dotBin(r.maskValue).length);
});

// ── The edges ────────────────────────────────────────────────────────────────

test('a /31 has two usable addresses and no broadcast — RFC 3021', () => {
  const r = ok(I.subnet('10.0.0.4/31'));
  assert.equal(r.usable, 2);
  assert.equal(r.broadcast, null);
  assert.equal(r.firstHost, '10.0.0.4');
  assert.equal(r.lastHost,  '10.0.0.5');
  assert.match(r.shape, /point-to-point/);
});

test('a /32 is one address, a host route rather than a network', () => {
  const r = ok(I.subnet('10.0.0.1/32'));
  assert.equal(r.usable, 1);
  assert.equal(r.broadcast, null);
  assert.equal(r.firstHost, '10.0.0.1');
  assert.match(r.shape, /host route/);
});

test('a /30 still follows the generic formula', () => {
  const r = ok(I.subnet('10.0.0.1/30'));
  assert.equal(r.usable, 2);
  assert.equal(r.broadcast, '10.0.0.3');
});

test('a /0 does not break on the shift that JS turns into a no-op', () => {
  // 0xFFFFFFFF << 32 is 0xFFFFFFFF in JS, not 0 — the shift count is taken mod
  // 32 — so /0 has to be spelled out rather than shifted.
  const r = ok(I.subnet('0.0.0.0/0'));
  assert.equal(r.mask, '0.0.0.0');
  assert.equal(r.usable, 4294967294);
});

test('the top of the address space does not go negative', () => {
  // Every bitwise result needs >>> 0; without it 255.255.255.255 & mask is a
  // negative int32 and formats as garbage.
  const r = ok(I.subnet('255.255.255.255/24'));
  assert.equal(r.network,   '255.255.255.0');
  assert.equal(r.broadcast, '255.255.255.255');
});

// ── Masks ────────────────────────────────────────────────────────────────────

test('every prefix round-trips through its dotted mask', () => {
  for (let p = 0; p <= 32; p++) {
    const mask = I.formatIp(I.prefixToMask(p));
    assert.equal(ok(I.maskToPrefix(mask)).prefix, p, `${mask} did not come back as /${p}`);
  }
});

test('a mask with a gap in it is refused, not silently used', () => {
  // 255.255.0.255 is a wildcard someone typed wrong. Accepting it produces a
  // network address no router agrees with.
  const r = I.maskToPrefix('255.255.0.255');
  assert.equal(r.ok, false);
  assert.match(r.error, /not a contiguous subnet mask/);
});

test('an address and a dotted mask is accepted as well as CIDR', () => {
  const a = ok(I.subnet('192.168.1.130/26'));
  const b = ok(I.subnet('192.168.1.130 255.255.255.192'));
  assert.equal(b.network, a.network);
  assert.equal(b.prefix, 26);
});

// ── Refusals ─────────────────────────────────────────────────────────────────

test('an octet over 255 is refused, and the message says which octet', () => {
  const r = I.subnet('192.168.1.300/24');
  assert.equal(r.ok, false);
  assert.match(r.error, /Octet 4 is 300/);
});

test('three octets is refused with the count', () => {
  assert.match(I.subnet('192.168.1/24').error, /this has 3/);
});

test('a prefix over 32 is refused', () => {
  assert.match(I.subnet('10.0.0.1/33').error, /an IPv4 address is 32 bits/);
});

// ── Subdividing: the borrow-bits exercise, both directions ───────────────────

test('a /24 cut into /26 gives four blocks of 62', () => {
  const r = ok(I.subdivide('192.168.1.0/24', 26));
  assert.equal(r.count, 4);
  assert.equal(r.borrowed, 2);
  assert.equal(r.blockSize, 64);
  assert.equal(r.usableEach, 62);
  assert.deepEqual(r.subnets.map(s => s.network),
    ['192.168.1.0', '192.168.1.64', '192.168.1.128', '192.168.1.192']);
  assert.equal(r.truncated, false);
});

test('subdividing starts from the NETWORK, not from the address typed', () => {
  // 192.168.1.130/24 is a host inside 192.168.1.0/24. The blocks come from the
  // block, not from wherever the cursor happened to be.
  assert.equal(ok(I.subdivide('192.168.1.130/24', 26)).subnets[0].network, '192.168.1.0');
});

test('a shorter new prefix is refused, because that is not a piece of it', () => {
  const r = I.subdivide('192.168.1.0/24', 16);
  assert.equal(r.ok, false);
  assert.match(r.error, /bigger block/);
});

test('a listing too long to show is capped and says so', () => {
  const r = ok(I.subdivide('10.0.0.0/8', 24));
  assert.equal(r.count, 65536);
  assert.equal(r.shown, 256);
  assert.equal(r.truncated, true);
});

test('the smallest block for a host count is the other half of the exercise', () => {
  assert.equal(ok(I.prefixForHosts(500)).prefix, 23);      // 510 usable
  assert.equal(ok(I.prefixForHosts(510)).prefix, 23);      // exactly fits
  assert.equal(ok(I.prefixForHosts(511)).prefix, 22);      // one over, next block up
  assert.equal(ok(I.prefixForHosts(2)).prefix, 30);
  assert.equal(ok(I.prefixForHosts(500)).spare, 10);
  assert.equal(I.prefixForHosts(0).ok, false);
});

// ── Context a networking student is asked for ────────────────────────────────

test('the classful letter and the RFC 1918 range are both reported', () => {
  const r = ok(I.subnet('192.168.1.130/26'));
  assert.equal(r.klass, 'C');
  assert.equal(r.special.what, 'private (RFC 1918)');
  assert.equal(r.special.cidr, '192.168.0.0/16');
});

test('172.16 is private but 172.32 is not — the range that catches people', () => {
  // 172.16.0.0/12 stops at 172.31.255.255, which is not where the dotted
  // notation makes it look like it stops.
  assert.equal(ok(I.subnet('172.16.0.1/24')).special.what, 'private (RFC 1918)');
  assert.equal(ok(I.subnet('172.31.255.1/24')).special.what, 'private (RFC 1918)');
  assert.equal(ok(I.subnet('172.32.0.1/24')).special, null);
});

test('loopback, link-local and CGNAT are named', () => {
  assert.equal(ok(I.subnet('127.0.0.1/8')).special.what, 'loopback');
  assert.equal(ok(I.subnet('169.254.5.5/16')).special.what, 'link-local / APIPA');
  assert.equal(ok(I.subnet('100.64.0.1/10')).special.what, 'carrier-grade NAT (RFC 6598)');
});

test('typing the network or the broadcast address is flagged', () => {
  assert.equal(ok(I.subnet('192.168.1.0/24')).isNetworkAddress, true);
  assert.equal(ok(I.subnet('192.168.1.255/24')).isBroadcastAddress, true);
  assert.equal(ok(I.subnet('192.168.1.7/24')).isNetworkAddress, false);
});
