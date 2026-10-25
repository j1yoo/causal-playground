// Proposed tests for the fixes. They fail on the current code and pass after the fixes.
const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load();
const S = CP.stats, P = CP.plot;

test('fix: tTwoSidedP is NaN for a NaN statistic or a df of 0 or less', () => {
  assert.ok(Number.isNaN(S.tTwoSidedP(NaN, 10)));
  assert.ok(Number.isNaN(S.tTwoSidedP(2, 0)));
  assert.equal(S.tTwoSidedP(Infinity, 10), 0);
  assert.equal(S.chiSquareSf(Infinity, 3), 0);
});

test('fix: ticks ends quickly for spans below rounding error', () => {
  const t0 = Date.now();
  assert.deepEqual(P.ticks(0.3, 0.1 + 0.2, 5), [0.3]);
  const dom = P.extent([0.1 * 3, 0.3]);
  assert.ok(dom[1] - dom[0] >= 1, 'domain ' + dom);
  assert.ok(P.ticks(dom[0], dom[1], 5).length >= 2);
  assert.ok(Date.now() - t0 < 50);
});

test('fix: decimalsFor shows steps of 0.25 and 2.5 exactly, and stays within toFixed limits', () => {
  assert.deepEqual([0.25, 2.5, 1e-101].map(P.decimalsFor), [2, 1, 10]);
});

test('fix: extent ignores non-finite include values', () => {
  assert.deepEqual(P.extent([1, 2], { include: [Infinity] }), P.extent([1, 2]));
});

test('fix: solve rejects collinear designs at any sample size', () => {
  for (const n of [10, 1000, 50000]) {
    const X = [], y = [];
    for (let i = 0; i < n; i++) { const dd = (i * 7919) % 3 === 0 ? 1 : 0; X.push([1, dd, 1 - dd]); y.push(dd + Math.sin(i)); }
    assert.throws(() => S.ols(X, y), /singular/, 'n = ' + n);
  }
});

test('fix: seed 0 and seed 1 give different streams', () => {
  assert.notEqual(CP.rng.makeRng(0).uniform(), CP.rng.makeRng(1).uniform());
});
