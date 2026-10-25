const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('eventstudy.js');
const es = CP.eventstudy;

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

// ---- Part A: event study with leads and lags ----

test('panel: without noise each estimate equals the true effect plus pretrend * (e + 1)', () => {
  for (const pretrend of [0, 0.14, -0.3]) {
    const p = { noise: 0, jump: 1.3, growth: -0.15, pretrend, seed: 6 };
    const est = es.estimatePanel(es.simulatePanel(p));
    assert.equal(est.rows.length, 12);
    for (const r of est.rows) {
      const truth = r.e >= 0 ? 1.3 - 0.15 * r.e : 0;
      close(r.truth, truth, 1e-12, `truth at e = ${r.e}`);
      close(r.est, truth + pretrend * (r.e + 1), 1e-9, `pretrend ${pretrend}, e = ${r.e}`);
    }
    // The average bias over e = 0..5 is pretrend times the mean of (e + 1), which is 3.5.
    close(est.bias, 3.5 * pretrend, 1e-9, 'average bias');
  }
});

test('panel: the reference period is e = -1 and has no interval', () => {
  const est = es.estimatePanel(es.simulatePanel({ seed: 2 }));
  assert.deepEqual(est.rows.map(r => r.e), [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
  const ref = est.rows.filter(r => r.reference);
  assert.equal(ref.length, 1);
  assert.equal(ref[0].e, -1);
  assert.equal(ref[0].est, 0);
  assert.equal(ref[0].lo, null);
  assert.equal(est.df, 5);
});

test('panel: estimates equal the regression with unit and period fixed effects that omits e = -1', () => {
  const sim = es.simulatePanel({ pretrend: 0.1, noise: 1.5, seed: 9 });
  const est = es.estimatePanel(sim);
  const T = sim.params.periods, t0 = sim.params.start;
  // Absorb the fixed effects by two-way demeaning (balanced panel), then regress
  // on the demeaned treated-by-event-time dummies, one per period except e = -1.
  const y = CP.stats.demeanTwoWay(sim.units.map(u => u.y)).flat();
  const cols = [];
  for (let t = 1; t <= T; t++) {
    if (t - t0 === -1) continue;
    const D = sim.units.map(u => u.y.map((_, k) => (u.treated && k + 1 === t ? 1 : 0)));
    cols.push(CP.stats.demeanTwoWay(D).flat());
  }
  const X = y.map((_, i) => cols.map(c => c[i]));
  const beta = CP.stats.ols(X, y, { se: 'none' }).beta;
  const fromTable = est.rows.filter(r => !r.reference).map(r => r.est);
  assert.equal(beta.length, 11);
  beta.forEach((b, j) => close(b, fromTable[j], 1e-9, 'coefficient ' + j));
});

test('panel: 95% intervals cover the true effect about 95% of the time', () => {
  let cover = 0, total = 0;
  for (let s = 1; s <= 400; s++) {
    const est = es.estimatePanel(es.simulatePanel({ seed: 1000 + s }));
    for (const r of est.rows) {
      if (r.reference) continue;
      total++;
      if (r.lo <= r.truth && r.truth <= r.hi) cover++;
    }
  }
  const rate = cover / total;
  assert.ok(rate > 0.91 && rate < 0.99, 'coverage ' + rate);
});

test('panel: pre-trend test p-values are roughly uniform without a pretrend', () => {
  // The chi-square reference is a large-sample approximation. With 40 units per group the
  // share below 0.05 is a little above 0.05 (0.0735 over 40,000 seeds). With 400 seeds the
  // Monte Carlo error is large enough that about one block in four falls outside the band below.
  // With 2000 seeds (standard error about 0.006), all 10 blocks of seeds 1 to 20,000 fall inside it.
  const R = 2000;
  let below = 0;
  const ps = [];
  for (let s = 1; s <= R; s++) {
    const p = es.estimatePanel(es.simulatePanel({ seed: 1000 + s })).preP;
    ps.push(p);
    if (p < 0.05) below++;
  }
  const share = below / R;
  assert.ok(share > 0.02 && share < 0.09, 'share below 0.05: ' + share);
  const median = CP.stats.quantile(ps, 0.5);
  assert.ok(median > 0.4 && median < 0.6, 'median p ' + median);
});

test('panel: the pre-trend test matches an independent Wald computation and the chi-square tail', () => {
  // P(chi-square with 5 df > x) in closed form (odd degrees of freedom).
  const chi2sf5 = x => 2 * (1 - CP.stats.normalCdf(Math.sqrt(x))) + Math.sqrt(2 * x / Math.PI) * Math.exp(-x / 2) * (1 + x / 3);
  const leads = [0, 1, 2, 3, 4];   // array indices of e = -6..-2; index 5 is e = -1
  for (const [seed, pretrend] of [[3, 0], [8, 0.05], [21, -0.1]]) {
    const sim = es.simulatePanel({ seed, pretrend });
    const est = es.estimatePanel(sim);
    const d = treated => sim.units.filter(u => u.treated === treated).map(u => leads.map(k => u.y[k] - u.y[5]));
    const dT = d(true), dC = d(false);
    const mT = leads.map(j => mean(dT.map(r => r[j]))), mC = leads.map(j => mean(dC.map(r => r[j])));
    const b = leads.map(j => mT[j] - mC[j]);
    const cov = (rows, m, a, c) => rows.reduce((s, r) => s + (r[a] - m[a]) * (r[c] - m[c]), 0) / (rows.length - 1) / rows.length;
    const V = leads.map(a => leads.map(c => cov(dT, mT, a, c) + cov(dC, mC, a, c)));
    // W = b' V^-1 b through a Cholesky factor V = L L': solve L z = b, then W = z'z.
    const L = V.map(() => new Array(5).fill(0));
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j <= i; j++) {
        let s = V[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j];
      }
    }
    const z = [];
    for (let i = 0; i < 5; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * z[k]; z.push(s / L[i][i]); }
    const W = z.reduce((s, v) => s + v * v, 0);
    leads.forEach(j => close(est.rows[j].est, b[j], 1e-12, 'lead ' + j));
    close(est.wald, W, 1e-8 * Math.max(1, W), 'Wald statistic, seed ' + seed);
    close(est.preP, chi2sf5(W), 1e-6, 'p-value, seed ' + seed);
  }
});

test('panel: samples that pass the pre-trend test have a larger average bias (pretest conditioning)', () => {
  const pass = [], fail = [];
  for (let s = 1; s <= 1000; s++) {
    const est = es.estimatePanel(es.simulatePanel({ pretrend: 0.3, noise: 3, seed: 2000 + s }));
    (est.preP >= 0.05 ? pass : fail).push(est.bias);
  }
  assert.ok(pass.length > 600 && pass.length < 800, 'pass count ' + pass.length);
  assert.ok(CP.stats.mean(pass) > CP.stats.mean(fail) + 0.3, `bias pass ${CP.stats.mean(pass)}, fail ${CP.stats.mean(fail)}`);
});

// ---- Part B: placebo dates in daily data ----

test('daily: without noise, every same-weekday placebo estimate equals the actual estimate', () => {
  for (const w of [5, 10, 13]) {
    const est = es.estimateDaily(es.simulateDaily({ sigma: 1e-9, effect: 0, weeklySize: 3, w, seed: 4 }));
    assert.ok(est.placebos.length > 40);
    for (const q of est.placebos) close(q.est, est.actual, 1e-6, `w ${w}, day ${q.day}`);
  }
});

test('daily: the weekday mix of the windows explains the estimate without noise', () => {
  // A 10-day window from a Monday holds two Mondays, Tuesdays, and Wednesdays; the 10 days
  // before it hold two Fridays, Saturdays, and Sundays. The weekly part is size * (-1.8 - 2.0) / 10.
  const est = es.estimateDaily(es.simulateDaily({ sigma: 1e-9, effect: 1.5, weeklySize: 2, w: 10, seed: 4 }));
  close(est.actual, 1.5 + 2 * (-1.8 - 2.0) / 10, 1e-6);
  // A window of whole weeks cancels the weekly pattern at every date.
  const whole = es.estimateDaily(es.simulateDaily({ sigma: 1e-9, effect: 1.5, weeklySize: 4, w: 14, sameWeekday: false, seed: 4 }));
  close(whole.actual, 1.5, 1e-6);
  for (const q of whole.placebos) close(q.est, 0, 1e-6, 'day ' + q.day);
  // With all days and a 10-day window, the placebo estimates take one value per weekday.
  const mixed = es.estimateDaily(es.simulateDaily({ sigma: 1e-9, effect: 0, weeklySize: 2, w: 10, sameWeekday: false, seed: 4 }));
  const values = new Set(mixed.placebos.map(q => q.est.toFixed(6)));
  assert.equal(values.size, 7);
});

test('daily: placebo dates use only data before the policy', () => {
  for (const w of [5, 14, 28]) {
    for (const sameWeekday of [true, false]) {
      const est = es.estimateDaily(es.simulateDaily({ w, sameWeekday, seed: 3 }));
      for (const q of est.placebos) {
        assert.ok(q.day - w >= 0 && q.day + w - 1 < 364, `w ${w}, day ${q.day}`);
        if (sameWeekday) assert.equal((364 - q.day) % 7, 0);
      }
    }
  }
  // Counts for the default 14-day window: 49 same-weekday placebo dates or 337 days.
  assert.equal(es.estimateDaily(es.simulateDaily({})).K, 50);
  assert.equal(es.estimateDaily(es.simulateDaily({ sameWeekday: false })).K, 338);
});

test('daily: with no effect the placebo p-value has the right size and the naive t-test does not', () => {
  // Two settings. Without a weekly pattern, only the day-to-day correlation misleads the naive test.
  // The 10-day window with the default weekly pattern is the setting of the module brief.
  for (const over of [{ weeklySize: 0 }, { w: 10, weeklySize: 2 }]) {
    let placeboLow = 0, naiveLow = 0;
    const R = 300;
    for (let s = 1; s <= R; s++) {
      const est = es.estimateDaily(es.simulateDaily(Object.assign({ effect: 0, rho: 0.6, seed: s }, over)));
      if (est.pPlacebo <= 0.10) placeboLow++;
      if (est.pNaive < 0.05) naiveLow++;
    }
    const placeboShare = placeboLow / R, naiveShare = naiveLow / R;
    assert.ok(placeboShare > 0.05 && placeboShare < 0.16, JSON.stringify(over) + ' placebo share ' + placeboShare);
    assert.ok(naiveShare > 0.15, JSON.stringify(over) + ' naive share ' + naiveShare);
  }
});

test('daily: an independent recount from the series gives the same K, rank, and p-values', () => {
  const D0 = 364;
  for (const effect of [0, 1, 3]) {
    for (const sameWeekday of [true, false]) {
      for (let s = 1; s <= 25; s++) {
        const w = 5 + s;
        const sim = es.simulateDaily({ effect, sameWeekday, w, seed: 50 + s });
        const est = es.estimateDaily(sim);
        // Window means straight from the series, and the candidate dates from their definition.
        const avg = (from, n) => mean(sim.y.slice(from, from + n));
        const at = c => avg(c, w) - avg(c - w, w);
        const sizes = [Math.abs(at(D0))];
        for (let c = 0; c < D0; c++) {
          if (c - w < 0 || c + w - 1 >= D0) continue;
          if (sameWeekday && (D0 - c) % 7 !== 0) continue;
          sizes.push(Math.abs(at(c)));
        }
        // Rank = position of the policy date when all candidates are sorted from largest to smallest
        // |estimate|, with ties placed before it.
        const rank = sizes.slice().sort((a, b) => b - a).lastIndexOf(sizes[0]) + 1;
        const tag = `effect ${effect}, same weekday ${sameWeekday}, w ${w}`;
        close(est.actual, at(D0), 1e-9, tag);
        assert.equal(est.K, sizes.length, 'K, ' + tag);
        assert.equal(est.rank, rank, 'rank, ' + tag);
        close(est.pPlacebo, rank / sizes.length, 1e-12, tag);
        close(est.pMin, 1 / sizes.length, 1e-12, tag);
        assert.ok(est.pPlacebo >= est.pMin, 'p below 1 / K, ' + tag);
      }
    }
  }
  // A large effect puts the policy date at rank 1, so the p-value equals its smallest possible value.
  const big = es.estimateDaily(es.simulateDaily({ effect: 3, sigma: 0.5, seed: 1 }));
  assert.equal(big.rank, 1);
  close(big.pPlacebo, 1 / big.K, 1e-12);
});

// ---- Claims in the What to notice box, checked for the first sample (seed 1) ----

test('page claims hold for the first sample', () => {
  const A = over => es.estimatePanel(es.simulatePanel(Object.assign({ seed: 1 }, over)));
  const a0 = A({});
  assert.ok(a0.preP > 0.05);
  assert.ok(a0.rows.filter(r => r.e <= -2 && r.lo <= 0 && 0 <= r.hi).length >= 4);
  const a1 = A({ pretrend: 0.2, noise: 0.5 });
  assert.ok(a1.preP < 0.001 && a1.bias > 0.5 && a1.bias < 0.9, 'tilt ' + a1.preP + ' ' + a1.bias);
  assert.ok(a1.rows.filter(r => r.e >= 0 && r.est > r.truth).length >= 4, 'most lags above the true effect');
  const a2 = A({ pretrend: 0.3, noise: 3 });
  assert.ok(a2.preP > 0.05 && a2.bias > 0.7, 'hidden ' + a2.preP + ' ' + a2.bias);

  const B = over => es.estimateDaily(es.simulateDaily(Object.assign({ seed: 1 }, over)));
  const b0 = B({ effect: 0, rho: 0.9 });
  assert.ok(b0.pNaive < 0.05 && b0.pPlacebo > 0.05);
  // Bullet 4 starts from Reset (the defaults), then sets w 10 and weekly pattern 4.
  const on = B({ w: 10, weeklySize: 4 }), off = B({ w: 10, weeklySize: 4, sameWeekday: false });
  assert.ok(on.actual < 0 && on.actual < B({}).actual - 0.5, 'weekday mix lowers the actual estimate');
  const centre = mean(on.placebos.map(q => q.est));
  assert.ok(centre > -1.7 && centre < -1.3, 'same-weekday placebo centre ' + centre);
  assert.ok(Math.abs(centre) > Math.abs(on.actual), 'placebo centre farther from zero than the actual estimate');
  assert.ok(on.pPlacebo > 0.5, 'large placebo p-value although the effect is 1: ' + on.pPlacebo);
  const sdUp = off.placeboSd - on.placeboSd;
  assert.ok(sdUp >= 0.3 && sdUp <= 0.5, 'spread grows by ' + sdUp);
  const on14 = B({ weeklySize: 4 }), off14 = B({ weeklySize: 4, sameWeekday: false });
  assert.ok(Math.abs(off14.placeboSd - on14.placeboSd) < 0.1);
  // Bullet 5 continues from bullet 4 (w 10): K and the smallest possible p-value, option off and on.
  assert.ok(off.K > 300 && CP.plot.fmt(off.pMin, 3) === '0.003', 'option off: K ' + off.K);
  assert.ok(on.K >= 46 && on.K <= 52 && CP.plot.fmt(on.pMin, 2) === '0.02', 'option on: K ' + on.K);
});
