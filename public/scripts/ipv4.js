'use strict';
/**
 * ipv4.js — subnetting that shows the borrow, not just the answer.
 *
 * Pure: no DOM, no I/O. subnet.html is a thin layer over it, and
 * test/ipv4.test.js requires it directly. A classic script rather than an ES
 * module for the reason spelled out at the top of bases.js: a static import
 * would resolve without the ?v= stamp and go stale behind Cloudflare.
 *
 * It deliberately does NOT route through bases.js. Generic base conversion is
 * that file's job and is not duplicated here — but an IPv4 address is not a
 * number people convert, it is four fixed 8-bit fields, and the working the
 * exam wants is octet by octet with the mask boundary visible. Running it
 * through the general converter would print correct answers with the wrong
 * working, which for a teaching tool is the failure that matters.
 *
 * Everything is a 32-bit unsigned integer held in a Number — exact below 2^53 —
 * with `>>> 0` after every bitwise step, because JS bitwise operators are
 * signed and 0xFFFFFFFF << 0 is -1 without it.
 */
(function (global) {

  const U32 = n => n >>> 0;

  function parseIp(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return { ok: false, error: 'Enter an address.' };
    const parts = s.split('.');
    if (parts.length !== 4)
      return { ok: false, error: `An IPv4 address has four octets separated by dots; this has ${parts.length}.` };
    const octets = [];
    for (let i = 0; i < 4; i++) {
      const p = parts[i];
      if (!/^\d{1,3}$/.test(p))
        return { ok: false, error: `Octet ${i + 1} is "${p}" — each octet is 1 to 3 digits.` };
      const v = Number(p);
      if (v > 255) return { ok: false, error: `Octet ${i + 1} is ${v}; an octet is 8 bits, so 0 to 255.` };
      octets.push(v);
    }
    return { ok: true, octets, value: U32((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) };
  }

  const formatIp = v => [24, 16, 8, 0].map(sh => (U32(v) >>> sh) & 255).join('.');
  const octetsOf = v => [24, 16, 8, 0].map(sh => (U32(v) >>> sh) & 255);
  const bin8     = n => n.toString(2).padStart(8, '0');
  const dotBin   = v => octetsOf(v).map(bin8).join('.');

  /** Shift by 32 is a no-op in JS, so /0 has to be spelled out rather than shifted. */
  const prefixToMask = p => (p === 0 ? 0 : U32(0xFFFFFFFF << (32 - p)));

  function maskToPrefix(text) {
    const ip = parseIp(text);
    if (!ip.ok) return ip;
    const v = ip.value;
    // A mask is contiguous ones then contiguous zeros. 255.255.0.255 is a
    // wildcard someone typed wrong, and accepting it would produce a network
    // address that no router agrees with.
    const inv = U32(~v);
    if (U32(inv & (inv + 1)) !== 0)
      return { ok: false, error: `${formatIp(v)} is not a contiguous subnet mask — a mask is all ones ` +
                                 `then all zeros, with no gap. Binary: ${dotBin(v)}` };
    let p = 0; for (let i = 31; i >= 0 && (v >>> i) & 1; i--) p++;
    return { ok: true, prefix: p, mask: v };
  }

  const CLASSES = [
    { max: 0,   name: 'this network',  note: '0.0.0.0/8 — "this network", not routable' },
    { max: 126, name: 'A',             note: 'classful default /8' },
    { max: 127, name: 'loopback',      note: '127.0.0.0/8 — never leaves the host' },
    { max: 191, name: 'B',             note: 'classful default /16' },
    { max: 223, name: 'C',             note: 'classful default /24' },
    { max: 239, name: 'D (multicast)', note: '224.0.0.0/4 — multicast, no subnetting' },
    { max: 255, name: 'E (reserved)',  note: '240.0.0.0/4 — reserved' }
  ];
  const classOf = v => CLASSES.find(c => octetsOf(v)[0] <= c.max);

  const SPECIAL = [
    { cidr: '10.0.0.0/8',      net: 0x0A000000, p: 8,  what: 'private (RFC 1918)' },
    { cidr: '172.16.0.0/12',   net: 0xAC100000, p: 12, what: 'private (RFC 1918)' },
    { cidr: '192.168.0.0/16',  net: 0xC0A80000, p: 16, what: 'private (RFC 1918)' },
    { cidr: '100.64.0.0/10',   net: 0x64400000, p: 10, what: 'carrier-grade NAT (RFC 6598)' },
    { cidr: '169.254.0.0/16',  net: 0xA9FE0000, p: 16, what: 'link-local / APIPA' },
    { cidr: '127.0.0.0/8',     net: 0x7F000000, p: 8,  what: 'loopback' }
  ];
  const specialOf = v => SPECIAL.find(s => U32(v & prefixToMask(s.p)) === s.net) || null;

  /** A caret line under dotted binary, marking the bits the prefix covers. */
  function markPrefix(prefix, ch) {
    let out = '';
    for (let i = 0; i < 32; i++) { if (i && i % 8 === 0) out += ' '; out += i < prefix ? (ch || '^') : ' '; }
    return out;
  }

  function splitCidr(text) {
    const s = String(text == null ? '' : text).trim();
    const m = /^([^/\s]+)\s*\/\s*(\d{1,2})$/.exec(s);
    if (m) {
      const p = Number(m[2]);
      if (p > 32) return { ok: false, error: `/${p} is impossible — an IPv4 address is 32 bits.` };
      return { ok: true, addr: m[1], prefix: p };
    }
    // "192.168.1.130 255.255.255.192" is the other way people write it.
    const two = s.split(/[\s,]+/);
    if (two.length === 2) {
      const mp = maskToPrefix(two[1]);
      if (!mp.ok) return mp;
      return { ok: true, addr: two[0], prefix: mp.prefix };
    }
    return { ok: false, error: 'Write it as 192.168.1.130/26, or as an address and a dotted mask.' };
  }

  /**
   * The whole analysis, with the working.
   *
   * /31 and /32 are the two the generic 2^(32-p) − 2 gets wrong, returning 0 and
   * −1 usable hosts. /31 is a point-to-point link (RFC 3021): both addresses are
   * usable and there is no network or broadcast address to subtract. /32 is a
   * single host route. They are not edge cases to tidy away — /31 is what every
   * router-to-router link is numbered with.
   */
  function subnet(input, prefixArg) {
    let addr = input, prefix = prefixArg;
    if (prefix == null) {
      const sp = splitCidr(input); if (!sp.ok) return sp;
      addr = sp.addr; prefix = sp.prefix;
    }
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32)
      return { ok: false, error: 'The prefix must be a whole number from 0 to 32.' };

    const ip = parseIp(addr); if (!ip.ok) return ip;

    const mask      = prefixToMask(prefix);
    const wildcard  = U32(~mask);
    const network   = U32(ip.value & mask);
    const broadcast = U32(network | wildcard);
    const hostBits  = 32 - prefix;
    const total     = Math.pow(2, hostBits);

    let usable, firstHost, lastHost, shape;
    if (prefix === 32)      { usable = 1; firstHost = lastHost = network; shape = 'host route'; }
    else if (prefix === 31) { usable = 2; firstHost = network; lastHost = broadcast; shape = 'point-to-point (RFC 3021)'; }
    else                    { usable = total - 2; firstHost = U32(network + 1); lastHost = U32(broadcast - 1); shape = 'subnet'; }

    const steps = [];
    const cls   = classOf(ip.value);
    const wholeOctets = Math.floor(prefix / 8), spare = prefix % 8;

    steps.push({
      title: `The mask from /${prefix}`,
      lines: [
        `/${prefix} → ${formatIp(mask)}`,
        `  ${dotBin(mask)}`,
        `  ${markPrefix(prefix, '^')}`,
        `  ${prefix} network bits, ${hostBits} host bits` +
        (spare ? ` — ${wholeOctets} whole octet${wholeOctets === 1 ? '' : 's'} plus ${spare} bit${spare === 1 ? '' : 's'} borrowed from octet ${wholeOctets + 1}` : '')
      ],
      note: spare
        ? `The borrowed bits are worth ${Array.from({ length: spare }, (_, i) => 128 >> i).join(' + ')} = ` +
          `${256 - Math.pow(2, 8 - spare)}, which is why the octet reads ${octetsOf(mask)[wholeOctets]}. ` +
          `The block size in that octet is ${Math.pow(2, 8 - spare)}.`
        : 'The prefix lands on an octet boundary, so no octet is split.'
    });

    steps.push({
      title: 'The address in binary',
      lines: [ `${formatIp(ip.value)}`,
               `  = ${dotBin(ip.value)}`,
               `    ${markPrefix(prefix, '─')}  ← network part` ]
    });

    steps.push({
      title: 'Network address: address AND mask',
      lines: [ `    ${dotBin(ip.value)}   ${formatIp(ip.value)}`,
               `AND ${dotBin(mask)}   ${formatIp(mask)}`,
               `  = ${dotBin(network)}   ${formatIp(network)}` ],
      note: 'AND keeps a bit only where both have one, so every host bit is cleared. That is all "the network address" means.'
    });

    if (prefix <= 30) steps.push({
      title: 'Broadcast: network OR the wildcard',
      lines: [ `    ${dotBin(network)}   ${formatIp(network)}`,
               `OR  ${dotBin(wildcard)}   ${formatIp(wildcard)}  (the inverted mask)`,
               `  = ${dotBin(broadcast)}   ${formatIp(broadcast)}` ],
      note: 'OR sets every host bit, which is the last address in the block.'
    });

    steps.push({
      title: 'How many hosts',
      lines: prefix <= 30
        ? [ `2^${hostBits} = ${total} addresses in the block`,
            `minus the network address and the broadcast address`,
            `= ${usable} usable host${usable === 1 ? '' : 's'}` ]
        : prefix === 31
          ? [ '2^1 = 2 addresses',
              'no network or broadcast address on a /31 — RFC 3021 gives both ends to the link',
              '= 2 usable' ]
          : [ 'a /32 is one address: a single host route, not a network', '= 1 usable' ]
    });

    return {
      ok: true,
      input: formatIp(ip.value), prefix, cidr: `${formatIp(network)}/${prefix}`,
      mask: formatIp(mask), maskValue: mask,
      wildcard: formatIp(wildcard),
      network: formatIp(network), networkValue: network,
      broadcast: prefix <= 30 ? formatIp(broadcast) : null, broadcastValue: prefix <= 30 ? broadcast : null,
      firstHost: formatIp(firstHost), lastHost: formatIp(lastHost),
      usable, total, hostBits, shape,
      isNetworkAddress: prefix <= 30 && ip.value === network,
      isBroadcastAddress: prefix <= 30 && ip.value === broadcast,
      klass: cls ? cls.name : null, klassNote: cls ? cls.note : null,
      special: specialOf(ip.value),
      binary: { address: dotBin(ip.value), mask: dotBin(mask), network: dotBin(network),
                broadcast: dotBin(broadcast), wildcard: dotBin(wildcard) },
      steps
    };
  }

  /** Cut a block into equal smaller blocks — the borrow-bits exercise, listed out. */
  function subdivide(input, newPrefix, limit) {
    const base = subnet(input); if (!base.ok) return base;
    if (!Number.isInteger(newPrefix) || newPrefix < 0 || newPrefix > 32)
      return { ok: false, error: 'The new prefix must be a whole number from 0 to 32.' };
    if (newPrefix < base.prefix)
      return { ok: false, error: `/${newPrefix} is a bigger block than /${base.prefix}, not a piece of it. ` +
                                 `Subdividing borrows bits, so the new prefix has to be longer.` };
    const borrowed = newPrefix - base.prefix;
    const count    = Math.pow(2, borrowed);
    const cap      = limit || 256;
    const step     = Math.pow(2, 32 - newPrefix);
    const subnets  = [];
    for (let i = 0; i < Math.min(count, cap); i++) {
      const s = subnet(formatIp(base.networkValue + i * step), newPrefix);
      subnets.push({ index: i, cidr: s.cidr, network: s.network, firstHost: s.firstHost,
                     lastHost: s.lastHost, broadcast: s.broadcast, usable: s.usable });
    }
    return { ok: true, from: base.cidr, newPrefix, borrowed, count,
             usableEach: subnets.length ? subnets[0].usable : 0,
             blockSize: step, subnets, truncated: count > cap, shown: subnets.length };
  }

  /** Smallest block that houses this many hosts — the other half of the exercise. */
  function prefixForHosts(hosts) {
    const n = Number(hosts);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'Enter a whole number of hosts, 1 or more.' };
    if (n > Math.pow(2, 32) - 2) return { ok: false, error: 'That is more hosts than IPv4 has addresses.' };
    let bits = 1;
    while (Math.pow(2, bits) - 2 < n && bits < 32) bits++;
    const prefix = 32 - bits;
    return { ok: true, hosts: n, hostBits: bits, prefix, mask: formatIp(prefixToMask(prefix)),
             usable: Math.pow(2, bits) - 2, spare: Math.pow(2, bits) - 2 - n };
  }

  const API = { parseIp, formatIp, octetsOf, bin8, dotBin, prefixToMask, maskToPrefix,
                classOf, specialOf, markPrefix, splitCidr, subnet, subdivide, prefixForHosts };

  if (typeof module === 'object' && module.exports) module.exports = API;
  global.IPv4 = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
