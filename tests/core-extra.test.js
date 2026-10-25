// Proposed extra tests for the shared core. They pass on the current code.
// Reference values come from R 4.6.1: lm, sandwich::vcovHC(type = "HC1"),
// sandwich::vcovCL(type = "HC1", cadjust = TRUE), lm(weights = w) on the rows with w > 0, glm(binomial),
// and quantile(type = 7).
const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load();
const S = CP.stats, P = CP.plot;
const close = (got, want, tol) => want.forEach((v, i) =>
  assert.ok(Math.abs(got[i] - v) <= tol * Math.max(1, Math.abs(v)), 'index ' + i + ': ' + got[i] + ' vs ' + v));

const x = [0.3, -1.2, 0.8, 1.5, -0.4, 2.1, -0.9, 0.0, 1.1, -1.7, 0.6, 1.9];
const d = [1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1];
const y = [1.9, -1.1, 3.2, 2.0, 0.1, 4.8, 1.0, 0.4, 3.5, -2.2, 1.3, 4.1];
const cl = [1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4];
const w = [1, 0.5, 2, 0, 1.5, 1, 0.8, 0, 1.2, 0.7, 1, 2];
const X = x.map((v, i) => [1, v, d[i]]);

test('stats: ols matches R for classical, HC1, and CR1 standard errors', () => {
  close(S.ols(X, y).beta, [0.33832110524735, 1.27493885957009, 1.61881623546574], 1e-10);
  close(S.ols(X, y).se, [0.117305660385989, 0.0791224335497184, 0.18538509814952], 1e-10);
  close(S.ols(X, y, { se: 'hc1' }).se, [0.10808455726516, 0.0812946593526608, 0.18382359615454], 1e-10);
  close(S.ols(X, y, { cluster: cl }).se, [0.0372788290765065, 0.0614410004762782, 0.204287401406013], 1e-10);
});

test('stats: weighted least squares with zero weights matches R', () => {
  const fit = S.ols(X, y, { weights: w });
  close(fit.beta, [0.452589426252276, 1.29306194253264, 1.47719553408845], 1e-10);
  close(fit.se, [0.17649785331633, 0.109442258487269, 0.263887166745729], 1e-10);
  close(S.ols(X, y, { weights: w, se: 'hc1' }).se, [0.124746938855109, 0.111321931871145, 0.215440752775505], 1e-10);
  close(S.ols(X, y, { weights: w, cluster: cl }).se, [0.1324948808803, 0.0716988370338602, 0.199026088699798], 1e-10);
  assert.equal(fit.n, 10);
});

test('stats: logitFit matches R glm', () => {
  const yb = [1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0];
  close(S.logitFit(X, yb), [0.0534594279102423, 0.265952312983635, -0.289157680541545], 1e-5);
});

test('stats: quantile matches R type 7 in the tails', () => {
  const a = [3, 1, 2, 2, 2, 5, 5, 1, 9, 2];
  close([0, 0.1, 0.9, 0.95, 1].map(p => S.quantile(a, p)), [1, 1, 5.4, 7.2, 9], 1e-12);
});

test('stats: two-way demeaning equals residuals from unit and period dummies', () => {
  const m = [[1, 5, 2, 7], [3, 3, 9, 1], [0, 4, 4, 6]];
  const rows = [], ys = [];
  m.forEach((r, i) => r.forEach((v, t) => {
    rows.push([1, i === 1 ? 1 : 0, i === 2 ? 1 : 0, t === 1 ? 1 : 0, t === 2 ? 1 : 0, t === 3 ? 1 : 0]);
    ys.push(v);
  }));
  const resid = S.ols(rows, ys, { se: 'none' }).resid;
  S.demeanTwoWay(m).forEach((r, i) => r.forEach((v, t) => assert.ok(Math.abs(v - resid[i * 4 + t]) < 1e-12)));
});

test('stats: solve handles a zero on the diagonal', () => {
  close(S.solve([[0, 2], [3, 0]], [4, 9]), [3, 2], 1e-15);
});

test('rng: int and shuffle are uniform, and normal draws do not repeat in pairs', () => {
  const r = CP.rng.makeRng(3);
  const c = new Array(6).fill(0);
  for (let i = 0; i < 60000; i++) c[r.int(6)]++;
  const chi = c.reduce((s, o) => s + (o - 10000) ** 2 / 10000, 0);
  assert.ok(S.chiSquareSf(chi, 5) > 0.001, 'int(6) counts ' + c);
  const perms = new Map();
  for (let i = 0; i < 24000; i++) { const k = r.shuffle([0, 1, 2, 3]).join(''); perms.set(k, (perms.get(k) || 0) + 1); }
  assert.equal(perms.size, 24);
  let chi2 = 0; for (const v of perms.values()) chi2 += (v - 1000) ** 2 / 1000;
  assert.ok(S.chiSquareSf(chi2, 23) > 0.001, 'shuffle chi-square ' + chi2);
  const z = Array.from({ length: 2000 }, () => r.stdNormal());
  let same = 0; for (let i = 0; i < z.length; i += 2) if (z[i] === z[i + 1]) same++;
  assert.equal(same, 0);
});

test('plot: decimalsFor, extent padding, and include', () => {
  assert.deepEqual([0.5, 0.2, 0.05, 1, 20].map(P.decimalsFor), [1, 1, 2, 0, 0]);
  assert.deepEqual(P.extent([0, 10]), [-2, 12]);
  assert.deepEqual(P.extent([0, 9.5], { pad: 0 }), [0, 10]);
  assert.deepEqual(P.extent([2, 3], { include: [0] }), [-0.5, 3.5]);
});
