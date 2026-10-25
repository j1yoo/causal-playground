// Module 1: difference-in-differences with two groups and one start date.
// The simulation keeps both potential outcomes, so the true effect is known.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  const DEFAULTS = {
    nPerGroup: 50,   // units in each group
    periods: 10,     // periods 1..periods
    start: 6,        // first period with the policy
    effect: 2,       // true effect of the policy on treated units
    trendGap: 0,     // extra growth per period for the treated group without the policy
    shock: 0,        // other change in the treated group from the start period on
    noise: 1,        // standard deviation of unit-period noise
    seed: 1,
  };

  function simulate(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const rng = CP.rng.makeRng(p.seed);
    const T = p.periods, t0 = p.start;
    // Period effects shared by both groups: steady growth plus small common shocks.
    const common = [];
    for (let t = 1; t <= T; t++) common.push(0.5 * t + rng.normal(0, 0.3));
    const units = [];
    for (let g = 0; g < 2; g++) {
      const treated = g === 1;
      for (let j = 0; j < p.nPerGroup; j++) {
        const level = (treated ? 12 : 10) + rng.normal(0, 1);
        const y0 = [], y = [];
        for (let t = 1; t <= T; t++) {
          const post = t >= t0;
          let base = level + common[t - 1] + rng.normal(0, p.noise);
          if (treated) base += p.trendGap * (t - t0) + (post ? p.shock : 0);
          y0.push(base);
          y.push(treated && post ? base + p.effect : base);
        }
        units.push({ treated, y0, y });
      }
    }
    return { params: p, units };
  }

  // Bias that the design builds in when noise is zero:
  // trend gap times the distance between the average after and before periods, plus the shock.
  function builtInBias(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const pre = [], post = [];
    for (let t = 1; t <= p.periods; t++) (t < p.start ? pre : post).push(t - p.start);
    return p.trendGap * (CP.stats.mean(post) - CP.stats.mean(pre)) + p.shock;
  }

  function estimate(sim) {
    const S = CP.stats, p = sim.params, T = p.periods, t0 = p.start;
    const groupMean = (treated, key) => {
      const us = sim.units.filter(u => u.treated === treated);
      const out = [];
      for (let t = 0; t < T; t++) out.push(S.mean(us.map(u => u[key][t])));
      return out;
    };
    const treatedObs = groupMean(true, 'y');
    const controlObs = groupMean(false, 'y');
    const treatedNoPolicy = groupMean(true, 'y0');
    const preIdx = [], postIdx = [];
    for (let t = 1; t <= T; t++) (t < t0 ? preIdx : postIdx).push(t - 1);
    const avg = (arr, idx) => S.mean(idx.map(i => arr[i]));
    const table = {
      treated: { before: avg(treatedObs, preIdx), after: avg(treatedObs, postIdx) },
      control: { before: avg(controlObs, preIdx), after: avg(controlObs, postIdx) },
    };
    table.treated.change = table.treated.after - table.treated.before;
    table.control.change = table.control.after - table.control.before;
    const did = table.treated.change - table.control.change;

    // Standard error from unit-level before-after changes (collapsing to two periods).
    const change = u => avg(u.y, postIdx) - avg(u.y, preIdx);
    const dT = sim.units.filter(u => u.treated).map(change);
    const dC = sim.units.filter(u => !u.treated).map(change);
    const se = Math.sqrt(S.variance(dT) / dT.length + S.variance(dC) / dC.length);

    // True average effect on the treated in the after periods.
    const effects = [];
    for (const u of sim.units) if (u.treated) for (const i of postIdx) effects.push(u.y[i] - u.y0[i]);
    const att = S.mean(effects);

    // What DiD assumes the treated group would look like without the policy.
    const gapBefore = table.treated.before - table.control.before;
    const assumed = controlObs.map(v => v + gapBefore);

    // Slope of the treated-minus-comparison gap over the before periods.
    const X = preIdx.map(i => [1, i + 1]);
    const yGap = preIdx.map(i => treatedObs[i] - controlObs[i]);
    const preSlope = S.ols(X, yGap, { se: 'none' }).beta[1];

    return {
      periods: Array.from({ length: T }, (_, i) => i + 1),
      treatedObs, controlObs, treatedNoPolicy, assumed,
      table, did, se, ciLow: did - 1.96 * se, ciHigh: did + 1.96 * se,
      att, bias: did - att, preSlope,
    };
  }

  CP.did = { DEFAULTS, simulate, estimate, builtInBias };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.did;
})(typeof window !== 'undefined' ? window : globalThis);
