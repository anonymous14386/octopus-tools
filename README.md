# octopus-tools

Static browser utilities — speed reader, hash generator, base converter, subnet
calculator and password generator.

Plain HTML and JS in `public/`, served by nginx. No backend, no accounts, no
build step, and no data leaves the browser.

The two calculators aimed at coursework show their working rather than only
their answer: the base converter prints the positional expansion, the division
table and the bit regrouping; the subnet calculator prints the AND, the OR and
the borrowed bits.

```sh
npm test          # node --test test/*.test.js
npm run stamp     # rewrite the ?v= content stamps on CSS and JS links
npm run check     # fail if any stamp is stale (pre-push gate)
```
