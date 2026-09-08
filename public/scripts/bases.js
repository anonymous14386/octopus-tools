'use strict';
/**
 * bases.js — arbitrary base conversion that shows its working.
 *
 * Pure: no DOM, no I/O, no globals beyond the one export. baseconv.html is a
 * thin layer over it, and test/bases.test.js requires it directly.
 *
 * ── Why this is a classic script and not an ES module ────────────────────────
 * There is no build step in this repo. The only cache-busting mechanism is the
 * ?v=<hash> stamp tools/stamp-assets.mjs writes onto href/src attributes in the
 * HTML. A static `import './other.js'` inside a module resolves against the
 * importer's URL *without* its query string, so the imported file keeps coming
 * from Cloudflare's four-hour cache after a deploy — one stale sibling, looking
 * exactly like a deploy that never landed. octopus-ee hit precisely that and had
 * to version the whole directory to escape it. A plain script that assigns a
 * global and, under Node, module.exports has no import graph to go stale.
 *
 * ── The arithmetic is exact in BOTH parts, and that is the whole point ───────
 * The integer part is BigInt end to end. A JS Number loses integer precision
 * above 2^53 and an IPv6 address is 128 bits, so a Number-based converter is
 * wrong exactly where you would reach for it — silently, with no error. Every
 * broken base converter looks fine on an IPv4 octet.
 *
 * The fraction is an exact RATIONAL: the digits after the point are a BigInt
 * numerator over base^length. The textbook method is repeated multiplication on
 * a float, which accumulates error and — worse — cannot tell "this terminated"
 * from "this ran out of double". On integers it can, and it can additionally
 * notice a remainder it has seen before, which is how it reports 0.1 decimal in
 * base 3 as the repeating 0.0(0220) rather than a truncated approximation.
 */
(function (global) {

  const DIGITS   = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const MIN_BASE = 2;
  const MAX_BASE = DIGITS.length;              // 36. Past this you need a
                                               // separator notation like
                                               // [12].[35].[7], which is a
                                               // different tool, so we refuse
                                               // rather than invent one.

  const digitVal  = ch => DIGITS.indexOf(String(ch).toUpperCase());
  const digitChar = v  => DIGITS[v];
  const isPow2    = b  => b >= 2 && (b & (b - 1)) === 0;
  const bitsPer   = b  => Math.log2(b) | 0;

  const fail = (message, extra) => ({ ok: false, error: Object.assign({ message }, extra || {}) });

  function baseProblem(base, what) {
    if (!Number.isInteger(base)) return `${what} must be a whole number.`;
    if (base < MIN_BASE || base > MAX_BASE)
      return `${what} must be between ${MIN_BASE} and ${MAX_BASE} — the digit set is 0-9 then A-Z, ` +
             `so base ${MAX_BASE} is the last one with a character per digit.`;
    return null;
  }

  /** Are all of these characters digits in this base? Used to tell a prefix from data. */
  function looksValid(str, base) {
    const body = str.replace(/[\s_:.-]/g, '');
    if (!body) return false;
    for (const ch of body) { const d = digitVal(ch); if (d < 0 || d >= base) return false; }
    return true;
  }

  /**
   * Strip what people actually paste, and refuse what we cannot read.
   *
   * Separators: `_` and whitespace anywhere, `:` anywhere (IPv6, MAC), and `-`
   * in the interior of a base-16 number only (MAC addresses are written
   * 00-1B-44). Everywhere else an interior `-` is a mistake worth naming.
   *
   * Prefixes: 0b / 0o / 0d / 0x are stripped only when they name the base you
   * asked for. That is not timidity — `0b1101` is a perfectly good HEX number
   * (45313), so in base 16 those characters are data, not a prefix. When the
   * prefix names a different base and the rest would be valid there, we say so
   * instead of guessing.
   */
  function clean(raw, base) {
    const bad = baseProblem(base, 'The base'); if (bad) return fail(bad);

    let s = String(raw == null ? '' : raw).trim();
    if (!s) return fail('Enter a number.');

    let negative = false;
    if (s[0] === '+') s = s.slice(1);
    else if (s[0] === '-') { negative = true; s = s.slice(1); }
    s = s.trim();

    const PREFIX = { b: 2, o: 8, d: 10, x: 16 };
    const pm = /^0([bodx])/i.exec(s);
    if (pm) {
      const named = PREFIX[pm[1].toLowerCase()];
      const rest  = s.slice(2);
      if (named === base) s = rest;
      else if (looksValid(rest, named) && !looksValid(s, base))
        return fail(`0${pm[1].toLowerCase()} means base ${named}, but you asked for base ${base}. ` +
                    `Change the base, or drop the prefix.`);
      // else: they really are digits in the base you asked for. Read them.
    }

    const sepRe = base === 16 ? /[\s_:-]/g : /[\s_:]/g;
    if (base !== 16 && /\S-/.test(s))
      return fail('A minus sign belongs at the front. Inside the digits it is only read as a ' +
                  'separator for hex, where MAC addresses use it.');
    const cleaned = s.replace(sepRe, '');

    const parts = cleaned.split('.');
    if (parts.length > 2) return fail('More than one radix point.');
    const intPart  = parts[0] || '';
    const fracPart = parts[1] || '';
    if (!intPart && !fracPart) return fail('Enter a number.');

    // Name the offending character AND where it is. A converter that silently
    // accepts "12" as binary is worse than one that errors: it teaches the
    // wrong thing and it is wrong.
    const shown = (intPart || '0') + (parts.length > 1 ? '.' + fracPart : '');
    const all   = intPart + fracPart;
    for (let i = 0; i < all.length; i++) {
      const ch = all[i], d = digitVal(ch);
      if (d < 0)      return fail(`"${ch}" is not a digit at all — position ${i + 1} of ${shown}.`,
                                  { char: ch, position: i + 1 });
      if (d >= base)  return fail(`${ch.toUpperCase()} is not a digit in base ${base} — position ` +
                                  `${i + 1} of ${shown}. Base ${base} uses ${DIGITS.slice(0, base)}.`,
                                  { char: ch, position: i + 1 });
    }

    return { ok: true, negative, intDigits: intPart.toUpperCase() || '0',
             fracDigits: fracPart.toUpperCase(), cleaned: shown, base };
  }

  /** Digits → BigInt, plus the positional expansion that justifies it. */
  function readInt(intDigits, base) {
    const b = BigInt(base);
    let value = 0n;
    const terms = [];
    const n = intDigits.length;
    for (let i = 0; i < n; i++) {
      const d = digitVal(intDigits[i]);
      const power = n - 1 - i;
      value = value * b + BigInt(d);
      terms.push({ digit: intDigits[i], d, power, term: BigInt(d) * b ** BigInt(power) });
    }
    return { value, terms };
  }

  /** Fraction digits → an exact rational num/den, den = base^len. */
  function readFrac(fracDigits, base) {
    if (!fracDigits) return { num: 0n, den: 1n };
    const b = BigInt(base);
    let num = 0n;
    for (const ch of fracDigits) num = num * b + BigInt(digitVal(ch));
    return { num, den: b ** BigInt(fracDigits.length) };
  }

  /** Magnitude → digits, by repeated division, keeping every row of the working. */
  function toBase(value, base) {
    const bad = baseProblem(base, 'The base'); if (bad) throw new Error(bad);
    let v = value < 0n ? -value : value;
    const b = BigInt(base);
    const rows = [];
    if (v === 0n) return { digits: '0', rows };
    let out = '';
    while (v > 0n) {
      const q = v / b, r = v % b;
      rows.push({ from: v, quotient: q, remainder: r, digit: digitChar(Number(r)) });
      out = digitChar(Number(r)) + out;
      v = q;
    }
    return { digits: out, rows };
  }

  /** num/den (an exact rational, 0 ≤ x < 1) → digits in `base`, by repeated multiplication. */
  function fracToBase(num, den, base, precision) {
    const b = BigInt(base);
    const rows = [];
    const seen = new Map();          // remainder → index, so a cycle is detectable
    let out = '', n = num;
    let terminates = false, repeating = null, truncated = false;

    while (out.length < precision) {
      if (n === 0n) { terminates = true; break; }
      const key = n.toString();
      if (seen.has(key)) { repeating = { start: seen.get(key), length: out.length - seen.get(key) }; break; }
      seen.set(key, out.length);
      const prod = n * b;
      const d    = prod / den;
      n          = prod % den;
      rows.push({ digit: digitChar(Number(d)), product: prod, remainder: n });
      out += digitChar(Number(d));
    }
    if (!terminates && !repeating) truncated = true;
    return { digits: out, rows, terminates, repeating, truncated };
  }

  /** A decimal rendering of num/den for display only; the maths above is exact. */
  function decimalApprox(num, den, dp) {
    const scale  = 10n ** BigInt(dp);
    const scaled = (num * scale) / den;
    const exact  = (num * scale) % den === 0n;
    const s      = scaled.toString().padStart(dp + 1, '0');
    return { text: s.slice(0, s.length - dp) + '.' + s.slice(s.length - dp), exact };
  }

  // ── Two's complement ───────────────────────────────────────────────────────
  //
  // Encoding is P = 2^n + x for x < 0, which is the same answer as invert and
  // add one. Both are shown, because the exam wants the bitwise one and the
  // arithmetic one is the check.

  const twosRange = width => ({ min: -(2n ** BigInt(width - 1)), max: 2n ** BigInt(width - 1) - 1n });

  function widthProblem(width) {
    if (!Number.isInteger(width) || width < 2) return 'A signed width must be a whole number of at least 2 bits.';
    if (width > 512) return 'Widths above 512 bits are refused — nothing you are studying needs one.';
    return null;
  }

  function encodeTwos(value, width) {
    const bad = widthProblem(width); if (bad) return fail(bad);
    const { min, max } = twosRange(width);
    if (value < min || value > max) {
      const fitsUnsigned = value >= 0n && value < 2n ** BigInt(width);
      return fail(`${value} does not fit in ${width}-bit signed (${min} to ${max})` +
                  (fitsUnsigned ? '; it does fit unsigned.' : '.'));
    }
    const mod = 2n ** BigInt(width);
    return { ok: true, pattern: ((value % mod) + mod) % mod, width };
  }

  function decodeTwos(pattern, width) {
    const bad = widthProblem(width); if (bad) return fail(bad);
    const mod = 2n ** BigInt(width);
    if (pattern < 0n || pattern >= mod)
      return fail(`That pattern needs ${pattern.toString(2).length} bits; the width is ${width}. ` +
                  `Widen it, or shorten the number.`);
    const msb = pattern >= mod / 2n;
    return { ok: true, value: msb ? pattern - mod : pattern, negative: msb, width };
  }

  const toBits = (v, n) => v.toString(2).padStart(n, '0');

  /** Group digits for reading: from the right for integers, from the left for fractions. */
  function group(digits, size, fromLeft) {
    if (!size || digits.length <= size) return digits;
    const out = [];
    if (fromLeft) for (let i = 0; i < digits.length; i += size) out.push(digits.slice(i, i + size));
    else for (let i = digits.length; i > 0; i -= size) out.push(digits.slice(Math.max(0, i - size), i));
    return (fromLeft ? out : out.reverse()).join(' ');
  }

  const groupSizeFor = base => (base === 2 ? 4 : base === 16 ? 2 : base === 8 ? 3 : 0);

  /**
   * Both bases powers of two → regroup the bits directly, no arithmetic.
   *
   * This is not only a shortcut, it is the METHOD networking teaches, and going
   * via decimal would print working nobody uses even though the answer matches.
   * Three bits to an octal digit, four to a hex digit.
   */
  function regroup(intDigits, fracDigits, fromBase, toBase_) {
    const bf = bitsPer(fromBase), bt = bitsPer(toBase_);
    const bitsOf = ds => [...ds].map(ch => toBits(BigInt(digitVal(ch)), bf));

    const srcInt  = bitsOf(intDigits);            // one group per SOURCE digit
    const srcFrac = bitsOf(fracDigits);

    let iBits = srcInt.join('').replace(/^0+(?=.)/, '');
    if (iBits.length % bt) iBits = iBits.padStart(iBits.length + (bt - iBits.length % bt), '0');
    const dstInt = iBits.match(new RegExp(`.{${bt}}`, 'g')) || ['0'.repeat(bt)];
    const intOut = dstInt.map(g => digitChar(parseInt(g, 2))).join('').replace(/^0+(?=.)/, '');

    let fracOut = '', dstFrac = [];
    if (fracDigits) {
      let fBits = srcFrac.join('');
      if (fBits.length % bt) fBits = fBits.padEnd(fBits.length + (bt - fBits.length % bt), '0');
      dstFrac = fBits.match(new RegExp(`.{${bt}}`, 'g')) || [];
      // A trailing zero DIGIT adds nothing; it is only there because the last
      // group had to be padded out to a whole digit.
      fracOut = dstFrac.map(g => digitChar(parseInt(g, 2))).join('').replace(/0+$/, '');
    }
    return { intDigits: intOut, fracDigits: fracOut,
             srcInt, srcFrac, dstInt, dstFrac, bitsFrom: bf, bitsTo: bt };
  }

  const powersOfTwo = (from, to) => {
    const rows = [];
    for (let n = from; n <= to; n++) rows.push({ n, value: 2n ** BigInt(n) });
    return rows;
  };

  // ── The one entry point the page calls ─────────────────────────────────────
  //
  // In signed mode the reading is asymmetric, deliberately, and it is the same
  // asymmetry every hardware calculator uses: BASE 10 IS THE VALUE, EVERY OTHER
  // BASE IS THE WIDTH-BIT PATTERN. -13 is what you type in decimal; F3 is what
  // the register holds. Saying that out loud is cheaper than a mode switch.
  function convert(raw, opts) {
    const o = Object.assign({ fromBase: 10, toBase: 2, signed: false, width: null,
                              precision: 32, steps: true }, opts || {});
    const from = o.fromBase, to = o.toBase;

    const badTo = baseProblem(to, 'The output base'); if (badTo) return fail(badTo);
    const rd = clean(raw, from); if (!rd.ok) return rd;

    if (o.signed) {
      const bad = widthProblem(o.width); if (bad) return fail(bad);
      if (rd.fracDigits)
        return fail("Two's complement is defined for whole numbers. Drop the fractional part, " +
                    'or turn the signed width off.');
    }

    const steps = [];
    const add = (title, lines, note) => { if (o.steps) steps.push({ title, lines, note }); };
    const warnings = [];

    // 1 ─ read the input
    const { value: magnitude, terms } = readInt(rd.intDigits, from);
    const frac = readFrac(rd.fracDigits, from);

    if (from !== 10) {
      add(`Base ${from} → decimal, by positional expansion`,
          [ terms.map(t => `${t.digit}×${from}^${t.power}`).join(' + '),
            '= ' + terms.map(t => t.term.toString()).join(' + '),
            '= ' + magnitude.toString() ],
          'Each digit is worth its face value times the base raised to its position, counting from 0 at the right.');
    }

    // 2 ─ resolve sign / pattern
    let signedValue = null, pattern = null;
    if (o.signed) {
      if (from === 10) {
        signedValue = rd.negative ? -magnitude : magnitude;
        const enc = encodeTwos(signedValue, o.width); if (!enc.ok) return enc;
        pattern = enc.pattern;
        if (signedValue < 0n) {
          const mag  = -signedValue;
          const inv  = (2n ** BigInt(o.width) - 1n) ^ mag;
          add(`${signedValue} as a ${o.width}-bit two's complement pattern`,
              [ `${mag} = ${group(toBits(mag, o.width), 4)}`,
                `invert  = ${group(toBits(inv, o.width), 4)}   (one's complement)`,
                `add 1   = ${group(toBits(pattern, o.width), 4)}`,
                `check: 2^${o.width} + (${signedValue}) = ${pattern}` ],
              'Invert-and-add-one and P = 2^n + x are the same operation. The check is the one to trust.');
        } else {
          add(`${signedValue} as a ${o.width}-bit pattern`,
              [ `${group(toBits(pattern, o.width), 4)}   (non-negative: the pattern is the value, zero-padded)` ]);
        }
      } else {
        pattern = magnitude;
        if (rd.negative) return fail('In signed mode a non-decimal input is read as the stored bit pattern, ' +
                                     'which has no minus sign. Type the value in decimal instead.');
        const dec = decodeTwos(pattern, o.width); if (!dec.ok) return dec;
        signedValue = dec.value;
        add(`Reading ${group(toBits(pattern, o.width), 4)} as ${o.width}-bit signed`,
            dec.negative
              ? [ `top bit is 1 → negative`,
                  `${pattern} − 2^${o.width} = ${pattern} − ${2n ** BigInt(o.width)} = ${signedValue}` ]
              : [ `top bit is 0 → the value is the pattern: ${signedValue}` ],
            'The same 8 bits are 243 unsigned and −13 signed. Nothing in the bits says which; the width and the mode do.');
      }
    }

    // 3 ─ produce the answer
    const useValue = o.signed ? (to === 10 ? signedValue : pattern)
                              : (rd.negative ? -magnitude : magnitude);
    let digits, fracDigits = '', exact = true, repeating = null, truncated = false;

    const pow2Path = !o.signed && isPow2(from) && isPow2(to) && from !== to;
    if (pow2Path) {
      const g = regroup(rd.intDigits, rd.fracDigits, from, to);
      digits = g.intDigits; fracDigits = g.fracDigits;
      const bothSides = (gi, gf) => gi.join(' ') + (gf.length ? ' . ' + gf.join(' ') : '');
      add(`Base ${from} → base ${to} by regrouping bits`,
          [ `${rd.intDigits}${rd.fracDigits ? '.' + rd.fracDigits : ''}` +
            `   →   ${bothSides(g.srcInt, g.srcFrac)}` +
            `   (${g.bitsFrom} bit${g.bitsFrom > 1 ? 's' : ''} per base-${from} digit)`,
            // Regrouping into base 2 is a no-op — the groups on the line above
            // ARE the answer — so printing them one bit apart says nothing.
            g.bitsTo === 1
              ? `   →   ${digits}${fracDigits ? '.' + fracDigits : ''}`
              : `${bothSides(g.dstInt, g.dstFrac)}` +
                `   →   ${digits}${fracDigits ? '.' + fracDigits : ''}` +
                `   (${g.bitsTo} bit${g.bitsTo > 1 ? 's' : ''} per base-${to} digit)` ],
          'Both bases are powers of two, so the bits line up and there is no arithmetic to do at all. ' +
          'This is the method to use on a MAC address or an IPv6 field — and the one the exam wants.');
    } else {
      const t = toBase(useValue < 0n ? -useValue : useValue, to);
      digits = t.digits;
      if (to !== 10) {
        add(`Decimal → base ${to}, by repeated division`,
            t.rows.length
              ? t.rows.map(r => `${r.from} ÷ ${to} = ${r.quotient} r ${r.remainder}  → ${r.digit}`)
                     .concat([`read the remainders upward → ${t.digits}`])
              : ['the whole part is 0, so there is nothing to divide → 0'],
            'Divide, keep the remainder, repeat on the quotient until it reaches 0. The answer is the ' +
            'remainders read from the bottom up.');
      }
      if (frac.num) {
        const f = fracToBase(frac.num, frac.den, to, o.precision);
        fracDigits = f.digits; repeating = f.repeating; truncated = f.truncated;
        exact = f.terminates;
        const lines = []; let n = frac.num;
        for (const r of f.rows) {
          const before = decimalApprox(n, frac.den, 6), after = decimalApprox(r.remainder, frac.den, 6);
          // The product is the digit taken out plus what is left over, so it
          // renders as the digit followed by the remainder's decimal tail.
          lines.push(`${before.exact ? '' : '≈'}${before.text} × ${to} = ` +
                     `${after.exact ? '' : '≈'}${r.digit}${after.text.slice(1)}  → ${r.digit}`);
          n = r.remainder;
        }
        add(`The fraction → base ${to}, by repeated multiplication`, lines,
            'Multiply by the base, take the whole part as the next digit, repeat on what is left. ' +
            'Read downward. Shown to 6 dp; the arithmetic underneath is exact integer maths.');
        if (repeating) warnings.push(
          `The fraction repeats and never terminates in base ${to} — the block in brackets goes on forever.`);
        else if (truncated) warnings.push(
          `Truncated at ${o.precision} digits; the exact value has more.`);
      }
    }

    // In signed mode this is only ever true for the decimal column, which is
    // the one showing the VALUE; the pattern columns are non-negative by
    // construction.
    const negativeOut = useValue < 0n;
    const gs = groupSizeFor(to);
    let shownFrac = fracDigits;
    if (repeating) shownFrac = fracDigits.slice(0, repeating.start) + '(' + fracDigits.slice(repeating.start) + ')';

    // In signed mode a non-decimal column shows the register, so it is padded to
    // the width. Unsigned output is never padded — leading zeros would be a
    // claim about a width nobody set.
    if (o.signed && to !== 10 && isPow2(to))
      digits = digits.padStart(Math.ceil(o.width / bitsPer(to)), '0');

    const text = (negativeOut ? '-' : '') + digits + (shownFrac ? '.' + shownFrac : '');

    return {
      ok: true,
      from, to,
      cleaned: rd.cleaned,
      signed: !!o.signed, width: o.signed ? o.width : null,
      interpretation: o.signed ? (from === 10 ? 'value' : 'pattern') : 'magnitude',
      decimal: (o.signed ? signedValue : (rd.negative ? -magnitude : magnitude)).toString(),
      value: o.signed ? signedValue : (rd.negative ? -magnitude : magnitude),
      pattern,
      digits: text,
      grouped: (negativeOut ? '-' : '') + group(digits, gs, false) +
               (shownFrac ? '.' + group(shownFrac, gs, true) : ''),
      exact, repeating, truncated,
      steps, warnings
    };
  }

  const API = { DIGITS, MIN_BASE, MAX_BASE, digitVal, digitChar, isPow2, bitsPer,
                clean, readInt, readFrac, toBase, fracToBase, decimalApprox,
                encodeTwos, decodeTwos, twosRange, toBits, group, groupSizeFor,
                regroup, powersOfTwo, convert };

  if (typeof module === 'object' && module.exports) module.exports = API;
  global.Bases = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
