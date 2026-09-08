'use strict';
/**
 * bases.test.js — the base converter's arithmetic, and the refusals.
 *
 * The tests that matter here are not "does 13 become 1101". They are the four
 * ways a base converter is quietly wrong:
 *
 *   1. It uses Number, so it is exact on an IPv4 octet and wrong on IPv6.
 *   2. It accepts "12" as binary and answers anyway.
 *   3. It wraps a signed value that does not fit instead of refusing.
 *   4. It converts hex to binary by going via decimal, printing correct answers
 *      with working nobody uses.
 *
 * Run: node --test test/*.test.js
 */
const { test } = require('node:test');
const assert   = require('node:assert');
const B        = require('../public/scripts/bases.js');

const digitsOf = (raw, o) => { const r = B.convert(raw, o); assert.ok(r.ok, r.error && r.error.message); return r.digits; };
const titles   = (raw, o) => B.convert(raw, o).steps.map(s => s.title).join(' | ');

// ── Precision, which is the whole reason this is BigInt ──────────────────────

test('2^64 survives a round trip through hex — the test a Number-based converter fails', () => {
  // 2^53 is where a double stops being able to count. An IPv6 address is 128
  // bits, so a converter built on Number is wrong exactly where you would use
  // it, and wrong silently.
  const dec = (2n ** 64n).toString();
  const hex = digitsOf(dec, { fromBase: 10, toBase: 16 });
  assert.equal(hex, '10000000000000000');
  assert.equal(digitsOf(hex, { fromBase: 16, toBase: 10 }), dec);
});

test('the bit above 2^53 is not lost', () => {
  // 2^64 + 1. A double rounds this back to 2^64 and reports success.
  assert.equal(digitsOf('18446744073709551617', { fromBase: 10, toBase: 16 }), '10000000000000001');
});

test('a 128-bit value converts without loss', () => {
  const v = (2n ** 128n - 1n).toString();
  assert.equal(digitsOf(v, { fromBase: 10, toBase: 16 }), 'F'.repeat(32));
});

// ── The two textbook procedures ──────────────────────────────────────────────

test('positional expansion: 1101 in base 2 is 13, and the working says why', () => {
  const r = B.convert('1101', { fromBase: 2, toBase: 10 });
  assert.equal(r.digits, '13');
  const step = r.steps.find(s => /positional expansion/.test(s.title));
  assert.ok(step, 'no expansion shown');
  assert.match(step.lines[0], /1×2\^3 \+ 1×2\^2 \+ 0×2\^1 \+ 1×2\^0/);
  assert.match(step.lines[2], /= 13$/);
});

test('repeated division: the remainders are read upward', () => {
  const r = B.convert('13', { fromBase: 10, toBase: 2 });
  assert.equal(r.digits, '1101');
  const step = r.steps.find(s => /repeated division/.test(s.title));
  assert.equal(step.lines[0], '13 ÷ 2 = 6 r 1  → 1');
  assert.match(step.lines[step.lines.length - 1], /read the remainders upward → 1101/);
});

// ── Fractions: exact, and honest about not terminating ───────────────────────

test('0.625 terminates in binary and is reported exact', () => {
  const r = B.convert('0.625', { fromBase: 10, toBase: 2 });
  assert.equal(r.digits, '0.101');
  assert.equal(r.exact, true);
  assert.equal(r.repeating, null);
});

test('0.1 decimal repeats forever in base 3, and says so rather than truncating', () => {
  // The float version of this cannot tell a terminating expansion from one that
  // ran out of double. On exact integers it can, by noticing a remainder it has
  // already seen.
  const r = B.convert('0.1', { fromBase: 10, toBase: 3 });
  assert.equal(r.digits, '0.(0022)');
  assert.equal(r.exact, false);
  assert.deepEqual(r.repeating, { start: 0, length: 4 });
  assert.match(r.warnings.join(' '), /never terminates/);
});

test('0.1 decimal repeats in binary too — the classic float surprise', () => {
  const r = B.convert('0.1', { fromBase: 10, toBase: 2 });
  assert.equal(r.digits, '0.0(0011)');
  assert.equal(r.exact, false);
});

test('a fraction in a power-of-two base converts exactly by regrouping', () => {
  assert.equal(digitsOf('DA.8', { fromBase: 16, toBase: 2 }), '11011010.1');
  assert.equal(digitsOf('0.101', { fromBase: 2, toBase: 16 }), '0.A');
});

// ── The power-of-two shortcut, which is a METHOD and not an optimisation ─────

test('hex ↔ binary regroups bits and never goes via decimal', () => {
  // Both answers would come out right either way. The working would not: the
  // exam wants four bits to a hex digit, not a division table.
  const t = titles('11011010', { fromBase: 2, toBase: 16 });
  assert.match(t, /regrouping bits/);
  assert.doesNotMatch(t, /repeated division/);
  assert.equal(digitsOf('11011010', { fromBase: 2, toBase: 16 }), 'DA');
});

test('octal groups three bits, hex four', () => {
  const r = B.convert('755', { fromBase: 8, toBase: 2 });
  assert.equal(r.digits, '111101101');
  assert.match(r.steps.find(s => /regrouping/.test(s.title)).lines[0], /3 bits per base-8 digit/);
});

test('a non-power-of-two base still goes via decimal, because it has to', () => {
  assert.match(titles('120', { fromBase: 3, toBase: 7 }), /repeated division/);
});

// ── Refusals: naming what is wrong beats answering anyway ────────────────────

test('an invalid digit is named, with its position and the legal digit set', () => {
  const r = B.convert('1834', { fromBase: 8, toBase: 10 });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /8 is not a digit in base 8/);
  assert.match(r.error.message, /position 2/);
  assert.match(r.error.message, /01234567/);
  assert.equal(r.error.position, 2);
});

test('"12" is refused as binary rather than answered', () => {
  assert.equal(B.convert('12', { fromBase: 2, toBase: 10 }).ok, false);
});

test('base 37 is refused, and the refusal explains the digit set', () => {
  const r = B.convert('1', { fromBase: 37, toBase: 10 });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /between 2 and 36/);
});

test('a prefix naming a different base is called out, not guessed at', () => {
  const r = B.convert('0x1F', { fromBase: 10, toBase: 2 });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /0x means base 16/);
});

test('but 0b1101 in base 16 is data, not a prefix — it is a valid hex number', () => {
  // Read as hex those are six digits, 0xB1101 = 725249. Stripping the
  // "prefix" would be a silent wrong answer two digits short, so a prefix is
  // honoured only when it names the base you actually asked for.
  assert.equal(digitsOf('0b1101', { fromBase: 16, toBase: 10 }), '725249');
  assert.equal(digitsOf('0b1101', { fromBase: 2,  toBase: 10 }), '13');
});

test('separators people actually paste are stripped', () => {
  assert.equal(digitsOf('1101_1010', { fromBase: 2, toBase: 16 }), 'DA');
  // A MAC address, both ways it gets written. The leading zeros vanish because
  // no width was set — see the padding test above.
  assert.equal(digitsOf('00:1B:44', { fromBase: 16, toBase: 2 }), '1101101000100');
  assert.equal(digitsOf('00-1B-44', { fromBase: 16, toBase: 10 }), '6980');
  assert.equal(digitsOf(' DE AD ',  { fromBase: 16, toBase: 10 }), '57005');
});

test('an interior minus outside hex is a mistake worth naming', () => {
  const r = B.convert('11-01', { fromBase: 2, toBase: 10 });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /minus sign belongs at the front/);
});

// ── Two's complement ─────────────────────────────────────────────────────────

test('both ends of the 8-bit signed range fit, and the next one does not', () => {
  assert.equal(digitsOf('127',  { fromBase: 10, toBase: 2, signed: true, width: 8 }), '01111111');
  assert.equal(digitsOf('-128', { fromBase: 10, toBase: 2, signed: true, width: 8 }), '10000000');
  const over = B.convert('128', { fromBase: 10, toBase: 2, signed: true, width: 8 });
  assert.equal(over.ok, false);
  assert.match(over.error.message, /-128 to 127/);
});

test('a refusal that would have fit unsigned says so', () => {
  // Silently wrapping 200 to −56 is the classic version of this tool being
  // wrong, and it is wrong in the confident direction.
  const r = B.convert('200', { fromBase: 10, toBase: 2, signed: true, width: 8 });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /it does fit unsigned/);
});

test('-13 encodes to F3, showing invert-and-add-one AND the arithmetic check', () => {
  const r = B.convert('-13', { fromBase: 10, toBase: 16, signed: true, width: 8 });
  assert.equal(r.digits, 'F3');
  const step = r.steps.find(s => /two's complement pattern/.test(s.title));
  assert.match(step.lines.join('\n'), /invert  = 1111 0010/);
  assert.match(step.lines.join('\n'), /add 1   = 1111 0011/);
  assert.match(step.lines.join('\n'), /2\^8 \+ \(-13\) = 243/);
});

test('the same bits decode to −13 signed and 243 unsigned', () => {
  assert.equal(digitsOf('11110011', { fromBase: 2, toBase: 10, signed: true, width: 8 }), '-13');
  assert.equal(digitsOf('11110011', { fromBase: 2, toBase: 10 }), '243');
});

test('in signed mode decimal is the value and every other base is the pattern', () => {
  // Asymmetric on purpose, and the same asymmetry every hardware calculator
  // uses. The result says which reading it applied so the page can label it.
  assert.equal(B.convert('-13', { fromBase: 10, toBase: 16, signed: true, width: 8 }).interpretation, 'value');
  assert.equal(B.convert('F3',  { fromBase: 16, toBase: 10, signed: true, width: 8 }).interpretation, 'pattern');
  assert.equal(digitsOf('F3', { fromBase: 16, toBase: 10, signed: true, width: 8 }), '-13');
});

test('a pattern too wide for the width is refused with both numbers named', () => {
  const r = B.convert('100000000', { fromBase: 2, toBase: 10, signed: true, width: 8 });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /needs 9 bits; the width is 8/);
});

test('a signed pattern is padded to the width; an unsigned answer never is', () => {
  // A leading zero is a claim about a width. Unsigned, nobody set one.
  assert.equal(digitsOf('5', { fromBase: 10, toBase: 2, signed: true, width: 8 }), '00000101');
  assert.equal(digitsOf('5', { fromBase: 10, toBase: 2 }), '101');
});

test("two's complement refuses a fraction instead of silently dropping it", () => {
  const r = B.convert('1.5', { fromBase: 10, toBase: 2, signed: true, width: 8 });
  assert.equal(r.ok, false);
  assert.match(r.error.message, /defined for whole numbers/);
});

test('a signed width below 2 bits is refused', () => {
  assert.equal(B.convert('0', { fromBase: 10, toBase: 2, signed: true, width: 1 }).ok, false);
});

// ── Plain negatives, which are not two's complement ──────────────────────────

test('unsigned mode keeps a leading minus as a sign, at any size', () => {
  assert.equal(digitsOf('-255', { fromBase: 10, toBase: 16 }), '-FF');
  assert.equal(digitsOf('-FF', { fromBase: 16, toBase: 10 }), '-255');
});

// ── Display helpers ──────────────────────────────────────────────────────────

test('grouping runs from the right for integers and the left for fractions', () => {
  assert.equal(B.group('11011010', 4, false), '1101 1010');
  assert.equal(B.group('110110', 4, false), '11 0110');
  assert.equal(B.group('10111', 4, true), '1011 1');
});

test('powersOfTwo is generated, not typed', () => {
  const rows = B.powersOfTwo(0, 32);
  assert.equal(rows.length, 33);
  assert.equal(rows[10].value, 1024n);
  assert.equal(rows[32].value, 4294967296n);
});
