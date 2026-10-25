const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('staggered.js');

const st = CP.staggered;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);
const run = p => st.estimate(st.simulate(p));

test('staggered: one constant effect and no noise gives the true effect everywhere', () => {
  for (const neverGroup of [true, false]) {
    for (const base of [2, -0.7]) {
      const e = run({ noise: 0, growth: 0, earlyExtra: 0, base, neverGroup, seed: 4 });
      close(e.twfe, base, 1e-9, 'TWFE');
      for (const c of e.cells) if (c.att !== null) close(c.att, base, 1e-9, `ATT(${c.g},${c.t})`);
      for (const c of e.comparisons) close(c.estimate, base, 1e-9, c.type);
      close(e.csAvg, base, 1e-9, 'CS average');
    }
  }
});

test('staggered: decomposition weights are non-negative, sum to 1, and rebuild TWFE', () => {
  const cases = [
    { seed: 1 },
    { seed: 2, neverGroup: false },
    { seed: 3, noise: 1.5, growth: 0.4 },
    { seed: 4, noise: 2, growth: -0.3, earlyExtra: 1.5, neverGroup: false },
    { seed: 5, noise: 0.8, growth: 1, earlyExtra: -2 },
  ];
  for (const p of cases) {
    const e = run(p);
    for (const c of e.comparisons) assert.ok(c.weight >= 0, 'negative weight ' + c.weight);
    close(e.weightSum, 1, 1e-9, 'weights ' + JSON.stringify(p));
    close(e.decompSum, e.twfe, 1e-9, 'weighted sum ' + JSON.stringify(p));
  }
  assert.equal(run({}).comparisons.length, 4);
  assert.equal(run({ neverGroup: false }).comparisons.length, 2);
});

test('staggered: TWFE by demeaning matches a regression with store and period dummies', () => {
  const sim = st.simulate({ seed: 6, growth: 0.3, earlyExtra: 0.5, noise: 1 });
  const T = sim.params.periods;
  const units = [];
  sim.groups.forEach(g => g.units.forEach(u => units.push({ y: u.y, start: g.start })));
  const X = [], y = [];
  units.forEach((u, i) => {
    for (let t = 1; t <= T; t++) {
      const row = [1];
      for (let j = 1; j < units.length; j++) row.push(i === j ? 1 : 0);
      for (let s = 2; s <= T; s++) row.push(t === s ? 1 : 0);
      row.push(t >= u.start ? 1 : 0);
      X.push(row);
      y.push(u.y[t - 1]);
    }
  });
  const beta = CP.stats.ols(X, y, { se: 'none' }).beta;
  close(st.estimate(sim).twfe, beta[beta.length - 1], 1e-7);
});

test('staggered: with growing effects and no noise, ATT(g,t) is exact but TWFE is not', () => {
  for (const neverGroup of [true, false]) {
    const e = run({ noise: 0, base: 2, growth: 0.5, earlyExtra: 0, neverGroup, seed: 7 });
    for (const c of e.cells) if (c.att !== null) close(c.att, 2 + 0.5 * (c.t - c.g), 1e-9, `ATT(${c.g},${c.t})`);
    for (const r of e.eventTime) if (r.groups.length) close(r.estimate, 2 + 0.5 * r.e, 1e-9, 'event time ' + r.e);
    close(e.csAvg, e.csTruth, 1e-9);
    assert.ok(e.twfe < e.trueAll - 0.3, `TWFE ${e.twfe}, true average ${e.trueAll}`);
  }
});

test('staggered: the later-vs-earlier comparison is negative although every effect is at least 1', () => {
  const groups = [{ name: 'k', start: 3, n: 40 }, { name: 'l', start: 7, n: 25 }, { name: 'U', start: Infinity, n: 35 }];
  const e = run({ groups, periods: 10, base: 1, growth: 0.5, earlyExtra: 0, noise: 0, seed: 8 });
  for (const c of e.cells) assert.ok(c.truth >= 1, 'true effect ' + c.truth);
  const later = e.comparisons.find(c => c.type === 'already');
  // Group l: mean effect 1.75 in periods 7-10 and 0 before.
  // Group k (the control): mean effect 1.75 in periods 3-6 and 3.75 in periods 7-10.
  close(later.estimate, 1.75 - (3.75 - 1.75), 1e-9);
  assert.ok(later.estimate < 0);
  close(e.weightSum, 1, 1e-9);
  close(e.decompSum, e.twfe, 1e-9);
});

test('staggered: without the never group only the early group in periods 4 to 6 is identified', () => {
  const e = run({ neverGroup: false, seed: 9 });
  assert.deepEqual(e.cells.filter(c => c.att !== null).map(c => [c.g, c.t]), [[4, 4], [4, 5], [4, 6]]);
  assert.equal(e.csCount, 120);
  assert.equal(e.treatedCount, 440);
  assert.deepEqual(e.eventTime.filter(r => r.groups.length).map(r => r.e), [0, 1, 2]);
});

test('staggered: effects that differ by group but not over time bias no comparison, yet TWFE differs from the average', () => {
  const e = run({ noise: 0, base: 2, growth: 0, earlyExtra: 2, seed: 10 });
  for (const c of e.comparisons) close(c.estimate, c.treated === 0 ? 4 : 2, 1e-9, c.type);
  close(e.trueAll, (280 * 4 + 160 * 2) / 440, 1e-12);
  close(e.csAvg, e.trueAll, 1e-9);
  assert.ok(e.twfe < e.trueAll - 0.3, `TWFE ${e.twfe}, true average ${e.trueAll}`);
});

test('staggered: CS averages use group-size weights, also with unequal groups and pooled controls', () => {
  const groups = [{ name: 'a', start: 3, n: 17 }, { name: 'b', start: 5, n: 31 }, { name: 'c', start: 8, n: 9 }, { name: 'U', start: Infinity, n: 23 }];
  const p = { groups, periods: 10, base: 1, growth: 0.3, earlyExtra: 1.5 };
  const tau = (g, t) => 1 + 0.3 * (t - g) + (g === 3 ? 1.5 : 0);
  const wavg = cs => cs.reduce((s, c) => s + c.n * tau(c.g, c.t), 0) / cs.reduce((s, c) => s + c.n, 0);
  for (const neverGroup of [true, false]) {
    const e = run(Object.assign({ noise: 0, neverGroup, seed: 12 }, p));
    // Identified cells: every t >= g with a never group. Without it, only t < 8, the start of the last group.
    const cells = [];
    for (const g of groups.filter(x => isFinite(x.start))) {
      for (let t = g.start; t <= 10; t++) if (neverGroup || t < 8) cells.push({ g: g.start, t, n: g.n });
    }
    assert.deepEqual(e.cells.filter(c => c.att !== null).map(c => [c.g, c.t]), cells.map(c => [c.g, c.t]));
    close(e.csAvg, wavg(cells), 1e-9, 'simple weighted average, never group ' + neverGroup);
    for (const r of e.eventTime) {
      // Weights P(G = g | G + e <= T) among the groups with an estimate at e.
      const atE = cells.filter(c => c.t - c.g === r.e);
      assert.equal(r.groups.length, atE.length, 'groups at e = ' + r.e);
      if (atE.length) close(r.estimate, wavg(atE), 1e-9, 'theta_es(' + r.e + '), never group ' + neverGroup);
    }
  }
  // With noise, the control change pools all stores that do not have the policy yet in period t.
  const sim = st.simulate(Object.assign({ noise: 1, neverGroup: false, seed: 13 }, p));
  const e = st.estimate(sim);
  const change = (units, g, t) => units.reduce((s, u) => s + u.y[t - 1] - u.y[g - 2], 0) / units.length;
  for (const c of e.cells.filter(c => c.att !== null)) {
    const treated = sim.groups.find(x => x.start === c.g).units;
    const controls = [].concat(...sim.groups.filter(x => x.start > c.t).map(x => x.units));
    close(c.att, change(treated, c.g, c.t) - change(controls, c.g, c.t), 1e-9, `ATT(${c.g},${c.t})`);
  }
});

test('staggered: designs outside the decomposition theorem throw an error', () => {
  const U = { name: 'U', start: Infinity, n: 10 };
  const bad = [
    [{ name: 'a', start: 1, n: 10 }, { name: 'b', start: 5, n: 10 }, U], // policy in period 1
    [{ name: 'a', start: 4, n: 10 }, { name: 'b', start: 4, n: 10 }, U], // two groups with one start
    [{ name: 'a', start: 4, n: 10 }, { name: 'b', start: 12, n: 10 }], // start after the last period
    [{ name: 'a', start: 4, n: 10 }], // one group only
  ];
  for (const groups of bad) assert.throws(() => run({ groups, seed: 3 }), /staggered/);
  assert.throws(() => run({ groups: [{ name: 'a', start: 4, n: 10 }, U], neverGroup: false, seed: 3 }), /staggered/);
});

test('staggered: dropping the never group keeps the other stores unchanged', () => {
  const a = st.simulate({ seed: 11 });
  const b = st.simulate({ seed: 11, neverGroup: false });
  assert.equal(b.groups.length, 2);
  assert.deepEqual(b.groups.map(g => g.units), a.groups.slice(0, 2).map(g => g.units));
});

test('staggered: over many samples CS is centered on the truth and TWFE keeps its noise-free bias', () => {
  const p = { growth: 0.5, noise: 1 };
  const noiseFree = run(Object.assign({}, p, { noise: 0 })).biasTwfe;
  const R = 300;
  let tw = 0, cs = 0;
  for (let s = 1; s <= R; s++) {
    const e = run(Object.assign({}, p, { seed: 500 + s }));
    tw += e.biasTwfe;
    cs += e.biasCs;
  }
  close(cs / R, 0, 0.04, 'mean CS bias');
  close(tw / R, noiseFree, 0.04, 'mean TWFE bias');
  assert.ok(noiseFree < -0.5);
});

test('staggered: decomposition matches hand-computed weights and comparisons', () => {
  // Groups treated from period 3 (40 stores) and period 7 (25 stores), 35 never treated, 10 periods,
  // effect 1 + 0.5 * (t - start), no noise. Weights come from the Goodman-Bacon (2021) formulas by hand:
  // with shares 0.4, 0.25, 0.35 and treated shares of periods 0.8 and 0.4, the unscaled weights are
  // 0.0224, 0.021, 0.008, 0.016, and their sum 0.0674 is the variance of the demeaned treatment dummy.
  const groups = [{ name: 'k', start: 3, n: 40 }, { name: 'l', start: 7, n: 25 }, { name: 'U', start: Infinity, n: 35 }];
  const e = run({ groups, noise: 0, base: 1, growth: 0.5, earlyExtra: 0, seed: 2 });
  const byType = t => e.comparisons.filter(c => c.type === t);
  const [kU, lU] = byType('never');
  const [kl] = byType('notYet');
  const [lk] = byType('already');
  close(kU.weight, 0.0224 / 0.0674, 1e-6, 'k vs never weight');
  close(lU.weight, 0.021 / 0.0674, 1e-6, 'l vs never weight');
  close(kl.weight, 0.008 / 0.0674, 1e-6, 'k vs l weight');
  close(lk.weight, 0.016 / 0.0674, 1e-6, 'l vs k weight');
  close(kU.estimate, 2.75, 1e-9, 'k vs never');
  close(lU.estimate, 1.75, 1e-9, 'l vs never');
  close(kl.estimate, 1.75, 1e-9, 'k vs l');
  close(lk.estimate, -0.25, 1e-9, 'l vs k');
  close(e.twfe, 1.607567, 1e-6, 'TWFE');
  close(e.V, 0.0674, 1e-9, 'variance of the demeaned dummy');
});
