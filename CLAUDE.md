# octopus-tools — how this repo is put together

**This repo is public.** Anything written here is published documentation.

Static pages served by nginx. No backend, no build step, no framework, no
`node_modules`. Tests are `node --test` against the shipped files themselves.

## The shape every tool follows

A **pure module** in `public/scripts/`, and a **page that is a thin layer over
it**. The module holds the arithmetic and the refusals and knows nothing about
the DOM; the page reads inputs, calls one function, and renders what comes back.
`bases.js` + `baseconv.html` and `ipv4.js` + `subnet.html` are the two worked
examples.

Two conventions that came with that split and are worth keeping:

- **Every function returns its intermediate steps, not just the result.** These
  are teaching tools; the procedure is the product. `steps: [{title, lines,
  note}]` is the shape the pages know how to render.
- **Refuse, and name what is wrong.** A base converter that accepts `12` as
  binary is worse than one that errors, and a signed value that silently wraps
  is wrong in the confident direction. Refusals say which character, which
  position, and what the legal range was.

## The rules with a scar behind them

**Shared modules are classic scripts, not ES modules.** The only cache-busting
mechanism here is the `?v=` stamp `tools/stamp-assets.mjs` writes onto `href`
and `src` attributes. A static `import './other.js'` resolves *without* that
query string, so the imported file keeps coming from Cloudflare's four-hour
cache after a deploy — one stale sibling, indistinguishable from a deploy that
never landed. Each file is loaded by the page on its own and assigns a global
(and `module.exports`, so tests can require it). `test/assets.test.js` guards
this; the full reasoning is in the header of `public/scripts/bases.js`.

**Integers are BigInt.** A Number loses integer precision above 2^53 and an IPv6
address is 128 bits, so a Number-based converter is exact on everything you
would test it with and wrong on the thing you built it for.

**Test the page, not only the pieces.** `test/pages.test.js` evaluates each
page's inline script against a small DOM. Without it a typo in a page's own
script renders a blank page and every other test still passes — which is how
`octopus-budget` and `octopus-shopper` were both green while neither container
could start.

**Run `npm run check` before pushing.** An unstamped asset link is invisible for
four hours and looks exactly like a broken deploy. `npm test` includes it.

`/api/build` is written into the image by the Dockerfile, derived from the served
files. There is no application process here to compute one at startup, and it
reports `builtAt` rather than `startedAt` for the same reason.
