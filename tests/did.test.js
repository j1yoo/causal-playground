const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('did.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);

test('did: no noise and parallel trends gives the true effect exactly', () => {
  const est = CP.did.estimate(CP.did.simulate({ noise: 0, effect: 1.7, seed: 3 }));
  close(est.did, 1.7, 1e-9);
  close(est.att, 1.7, 1e-12);
  close(est.bias, 0, 1e-9);
});

test('did: trend gap and shock create the built-in bias', () => {
  for (const [trendGap, shock] of [[0.3, 0], [0, -1.5], [-0.2, 0.8]]) {
    const p = { noise: 0, effect: 2, trendGap, shock, seed: 5 };
    const est = CP.did.estimate(CP.did.simulate(p));
    close(est.bias, CP.did.builtInBias(p), 1e-9, `trendGap ${trendGap} shock ${shock}`);
  }
  // With 10 periods and a start in period 6 the built-in bias is 5 * trendGap + shock.
  close(CP.did.builtInBias({ trendGap: 0.3, shock: 0.5 }), 0.3 * 5 + 0.5, 1e-12);
});

test('did: pre-period slope sees a trend gap but not a shock', () => {
  const a = CP.did.estimate(CP.did.simulate({ noise: 0, trendGap: 0.4, seed: 2 }));
  close(a.preSlope, 0.4, 1e-9);
  const b = CP.did.estimate(CP.did.simulate({ noise: 0, shock: 2, seed: 2 }));
  close(b.preSlope, 0, 1e-9);
  close(b.bias, 2, 1e-9);
});

test('did: the 2x2 table matches the regression with unit and period fixed effects', () => {
  const sim = CP.did.simulate({ noise: 1, trendGap: 0.1, seed: 9 });
  const est = CP.did.estimate(sim);
  // TWFE on the balanced panel: double-demean y and the treatment dummy, then regress.
  const T = sim.params.periods, t0 = sim.params.start;
  const Y = sim.units.map(u => u.y);
  const D = sim.units.map(u => u.y.map((_, t) => (u.treated && t + 1 >= t0 ? 1 : 0)));
  const y = CP.stats.demeanTwoWay(Y).flat();
  const d = CP.stats.demeanTwoWay(D).flat();
  let num = 0, den = 0;
  for (let i = 0; i < y.length; i++) { num += d[i] * y[i]; den += d[i] * d[i]; }
  close(est.did, num / den, 1e-9);
  assert.equal(T, 10);
});

test('did: confidence interval covers the true effect about 95% of the time', () => {
  let cover = 0;
  const R = 400;
  for (let s = 1; s <= R; s++) {
    const est = CP.did.estimate(CP.did.simulate({ noise: 1.5, seed: 1000 + s }));
    if (est.ciLow <= est.att && est.att <= est.ciHigh) cover++;
  }
  const rate = cover / R;
  assert.ok(rate > 0.91 && rate < 0.99, 'coverage ' + rate);
});

test('did: the assumed counterfactual matches the treated group before the start', () => {
  const est = CP.did.estimate(CP.did.simulate({ noise: 1, seed: 4 }));
  const pre = est.periods.filter(t => t < 6).map(t => t - 1);
  const m = a => pre.reduce((s, i) => s + a[i], 0) / pre.length;
  close(m(est.assumed), m(est.treatedObs), 1e-9);
});

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const variance = a => { const m = mean(a); return a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1); };


test('did: standard error and 95% interval follow the two-sample formula on unit-level changes', () => {
  const sim = CP.did.simulate({ noise: 1.3, trendGap: 0.2, shock: -0.4, seed: 11 });
  const est = CP.did.estimate(sim);
  const change = u => mean(u.y.slice(5)) - mean(u.y.slice(0, 5));
  const dT = sim.units.filter(u => u.treated).map(change);
  const dC = sim.units.filter(u => !u.treated).map(change);
  close(est.did, mean(dT) - mean(dC), 1e-9, 'DiD equals the difference in mean unit-level changes');
  const se = Math.sqrt(variance(dT) / dT.length + variance(dC) / dC.length);
  close(est.se, se, 1e-12);
  close(est.ciHigh - est.did, 1.96 * se, 1e-12);
  close(est.did - est.ciLow, 1.96 * se, 1e-12);
});

test('did: with noise, estimate minus true effect equals the treated change in Y(0) minus the comparison change', () => {
  for (const seed of [1, 2, 3]) {
    const sim = CP.did.simulate({ noise: 2, trendGap: -0.3, shock: 1.1, seed });
    const est = CP.did.estimate(sim);
    const tr = sim.units.filter(u => u.treated), co = sim.units.filter(u => !u.treated);
    const ch = (us, key) => mean(us.map(u => mean(u[key].slice(5)) - mean(u[key].slice(0, 5))));
    close(est.bias, ch(tr, 'y0') - ch(co, 'y'), 1e-9, 'seed ' + seed);
  }
});

test('did: after the start, the dashed line minus the dotted line averages to estimate minus true effect', () => {
  const est = CP.did.estimate(CP.did.simulate({ noise: 1, trendGap: 0.3, shock: 0.7, seed: 4 }));
  const post = [5, 6, 7, 8, 9];
  close(mean(post.map(i => est.treatedNoPolicy[i] - est.assumed[i])), est.bias, 1e-9);
  close(est.table.treated.after - mean(post.map(i => est.assumed[i])), est.did, 1e-9);
  // Before the start, the true no-policy line equals the observed treated line (no anticipation).
  for (let i = 0; i < 5; i++) close(est.treatedNoPolicy[i], est.treatedObs[i], 1e-12);
});

test('did: the pre-period slope uses only periods 1 to 5', () => {
  // A trend gap that exists only after the start must not move the pre-period slope.
  const sim = CP.did.simulate({ noise: 1, seed: 6 });
  const before = CP.did.estimate(sim).preSlope;
  for (const u of sim.units) if (u.treated) for (let t = 5; t < 10; t++) { u.y[t] += 0.7 * (t - 4); u.y0[t] += 0.7 * (t - 4); }
  close(CP.did.estimate(sim).preSlope, before, 1e-12);
});

test('did: moving a slider keeps the same sample', () => {
  const base = CP.did.estimate(CP.did.simulate({ noise: 1, seed: 8 }));
  const tg = CP.did.estimate(CP.did.simulate({ noise: 1, seed: 8, trendGap: 0.3 }));
  const sh = CP.did.estimate(CP.did.simulate({ noise: 1, seed: 8, shock: -1.2 }));
  const ef = CP.did.estimate(CP.did.simulate({ noise: 1, seed: 8, effect: -0.5 }));
  close(tg.did - base.did, 1.5, 1e-9);
  close(sh.did - base.did, -1.2, 1e-9);
  close(ef.did - base.did, -2.5, 1e-9);
  close(sh.preSlope, base.preSlope, 1e-12);
  // The noise slider only scales the same noise draws: y0 is linear in the noise setting.
  const s0 = CP.did.simulate({ noise: 0, seed: 8 }), s1 = CP.did.simulate({ noise: 1, seed: 8 }), s2 = CP.did.simulate({ noise: 2, seed: 8 });
  for (let i = 0; i < s0.units.length; i++) for (let t = 0; t < 10; t++) {
    const d1 = s1.units[i].y0[t] - s0.units[i].y0[t], d2 = s2.units[i].y0[t] - s0.units[i].y0[t];
    close(d2, 2 * d1, 1e-9, 'unit ' + i + ' period ' + (t + 1));
  }
});

test('did: 95% intervals cover the true effect 93% to 96.5% of the time over 4000 samples', () => {
  let cover = 0;
  const R = 4000;
  for (let s = 1; s <= R; s++) {
    const est = CP.did.estimate(CP.did.simulate({ noise: 1, seed: 20000 + s }));
    if (est.ciLow <= est.att && est.att <= est.ciHigh) cover++;
  }
  const rate = cover / R;
  assert.ok(rate > 0.93 && rate < 0.965, 'coverage ' + rate);
});
