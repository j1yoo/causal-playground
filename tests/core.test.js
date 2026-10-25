const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load();

test('rng: same seed gives the same draws, different seeds differ', () => {
  const a = CP.rng.makeRng(42), b = CP.rng.makeRng(42), c = CP.rng.makeRng(43);
  const da = [a.uniform(), a.normal(), a.uniform()];
  const db = [b.uniform(), b.normal(), b.uniform()];
  assert.deepEqual(da, db);
  assert.notEqual(da[0], c.uniform());
});

test('rng: uniform and normal draws have the right mean and spread', () => {
  const r = CP.rng.makeRng(7);
  const u = [], z = [];
  for (let i = 0; i < 20000; i++) { u.push(r.uniform()); z.push(r.normal(3, 2)); }
  assert.ok(Math.abs(CP.stats.mean(u) - 0.5) < 0.01);
  assert.ok(Math.min(...u) >= 0 && Math.max(...u) < 1);
  assert.ok(Math.abs(CP.stats.mean(z) - 3) < 0.05);
  assert.ok(Math.abs(CP.stats.sd(z) - 2) < 0.05);
});

test('stats: mean, variance, quantile', () => {
  assert.equal(CP.stats.mean([1, 2, 3, 4]), 2.5);
  assert.ok(Math.abs(CP.stats.variance([1, 2, 3, 4]) - 1.6666666667) < 1e-9);
  assert.equal(CP.stats.quantile([4, 1, 3, 2], 0.5), 2.5);
  assert.equal(CP.stats.quantile([1, 2, 3, 4, 5], 0.25), 2);
});

test('stats: ols recovers exact coefficients and classical standard errors', () => {
  const X = [], y = [];
  for (let i = 0; i < 10; i++) { X.push([1, i]); y.push(2 + 3 * i); }
  const fit = CP.stats.ols(X, y);
  assert.ok(Math.abs(fit.beta[0] - 2) < 1e-10);
  assert.ok(Math.abs(fit.beta[1] - 3) < 1e-10);
  // Known textbook case: y = (1, 3, 2, 5, 4), x = (1..5). Slope 0.8, se 0.3464.
  const f2 = CP.stats.ols([[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]], [1, 3, 2, 5, 4]);
  assert.ok(Math.abs(f2.beta[1] - 0.8) < 1e-10);
  assert.ok(Math.abs(f2.se[1] - Math.sqrt(0.12)) < 1e-10);
});

test('stats: hc1 and cluster standard errors match hand calculations', () => {
  // With one regressor (a constant), HC1 variance of the mean is sum(e^2)/(n(n-1)).
  const y = [1, 4, 2, 8, 5];
  const X = y.map(() => [1]);
  const m = CP.stats.mean(y);
  const ss = y.reduce((s, v) => s + (v - m) * (v - m), 0);
  const hc1 = CP.stats.ols(X, y, { se: 'hc1' });
  assert.ok(Math.abs(hc1.se[0] - Math.sqrt(ss / (5 * 4))) < 1e-10);
  // Each observation its own cluster: CR1 equals HC1 here.
  const cl = CP.stats.ols(X, y, { cluster: [1, 2, 3, 4, 5] });
  assert.ok(Math.abs(cl.se[0] - hc1.se[0]) < 1e-10);
});

test('stats: logistic regression recovers coefficients on a large sample', () => {
  const r = CP.rng.makeRng(11);
  const X = [], y = [];
  for (let i = 0; i < 20000; i++) {
    const x = r.normal();
    X.push([1, x]);
    y.push(r.bernoulli(CP.stats.logistic(-0.5 + 1.2 * x)));
  }
  const b = CP.stats.logitFit(X, y);
  assert.ok(Math.abs(b[0] + 0.5) < 0.06, 'intercept ' + b[0]);
  assert.ok(Math.abs(b[1] - 1.2) < 0.06, 'slope ' + b[1]);
});

test('stats: normal CDF values', () => {
  assert.ok(Math.abs(CP.stats.normalCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(CP.stats.normalCdf(1.96) - 0.9750021) < 1e-6);
  assert.ok(Math.abs(CP.stats.normalCdf(-1) - 0.1586553) < 1e-6);
});

test('stats: two-way demeaning gives zero row and column means', () => {
  const m = [[1, 5, 2], [3, 3, 9], [0, 4, 4]];
  const d = CP.stats.demeanTwoWay(m);
  for (const row of d) assert.ok(Math.abs(CP.stats.sum(row)) < 1e-12);
  for (let t = 0; t < 3; t++) assert.ok(Math.abs(d[0][t] + d[1][t] + d[2][t]) < 1e-12);
});

test('stats: histogram counts every value once', () => {
  const c = CP.stats.histogram([0, 0.5, 1, 1.5, 2], [0, 1, 2]);
  assert.deepEqual(c, [2, 3]);
});

test('plot: ticks and nice domains are round numbers', () => {
  assert.deepEqual(CP.plot.ticks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(CP.plot.niceDomain(0.3, 9.2, 5), [0, 10]);
  assert.deepEqual(CP.plot.ticks(-1, 1, 4), [-1, -0.5, 0, 0.5, 1]);
  assert.equal(CP.plot.fmt(-1.234, 2), '−1.23');
  assert.equal(CP.plot.fmt(-0.001, 2), '0.00');
  assert.equal(CP.plot.fmt(NaN), 'n/a');
});

test('stats: chi-square and t p-values match table values', () => {
  const S = CP.stats;
  assert.ok(Math.abs(S.chiSquareSf(3.841459, 1) - 0.05) < 1e-6);
  assert.ok(Math.abs(S.chiSquareSf(11.0705, 5) - 0.05) < 1e-5);
  assert.ok(Math.abs(S.chiSquareSf(18.307, 10) - 0.05) < 1e-5);
  assert.ok(Math.abs(S.chiSquareSf(0.5, 3) - 0.918891) < 1e-5);
  assert.ok(Math.abs(S.tTwoSidedP(2.228139, 10) - 0.05) < 1e-6);
  assert.ok(Math.abs(S.tTwoSidedP(1.959964, 1e6) - 0.05) < 1e-5);
  assert.ok(Math.abs(S.tTwoSidedP(0, 7) - 1) < 1e-12);
  assert.ok(Math.abs(Math.exp(S.logGamma(5)) - 24) < 1e-9);
});
