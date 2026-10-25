// Module 3: event studies and placebo dates.
// Part A (panel): treated and comparison units, one adoption date, leads and lags.
// Part B (daily): one daily series, the actual policy date ranked against placebo dates.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  // ---- Part A: event study with leads and lags ----

  const PANEL_DEFAULTS = {
    nPerGroup: 40,   // units in each group
    periods: 12,     // periods 1..periods
    start: 7,        // first period with the policy; event time e = t - start
    jump: 1,         // effect in the first period with the policy (e = 0)
    growth: 0.2,     // change in the effect per period after the start
    pretrend: 0,     // extra growth per period for the treated group without the policy
    noise: 1.5,      // standard deviation of unit-period noise
    seed: 1,
  };

  // True effect at event time e: zero before the policy, jump + growth * e after.
  function trueEffect(p, e) { return e >= 0 ? p.jump + p.growth * e : 0; }

  function simulatePanel(params) {
    const p = Object.assign({}, PANEL_DEFAULTS, params);
    const rng = CP.rng.makeRng(p.seed);
    const T = p.periods, t0 = p.start;
    // Period effects shared by both groups: steady growth plus small common shocks.
    const common = [];
    for (let t = 1; t <= T; t++) common.push(0.3 * t + rng.normal(0, 0.3));
    const units = [];
    for (let g = 0; g < 2; g++) {
      const treated = g === 1;
      for (let j = 0; j < p.nPerGroup; j++) {
        const level = (treated ? 12 : 10) + rng.normal(0, 1);
        const y0 = [], y = [];
        for (let t = 1; t <= T; t++) {
          const e = t - t0;
          let base = level + common[t - 1] + rng.normal(0, p.noise);
          if (treated) base += p.pretrend * e;
          y0.push(base);
          y.push(treated ? base + trueEffect(p, e) : base);
        }
        units.push({ treated, y0, y });
      }
    }
    return { params: p, units };
  }

  // Sample covariance of two equal-length arrays (n - 1 divisor).
  function covariance(a, b) {
    const ma = CP.stats.mean(a), mb = CP.stats.mean(b);
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
    return s / (a.length - 1);
  }

  function estimatePanel(sim) {
    const S = CP.stats, p = sim.params, T = p.periods, t0 = p.start;
    const ref = t0 - 2;   // array index of the reference period, event time -1
    // Each unit's change from the reference period: d[i][k] = y[i][k] - y[i][ref].
    const changes = treated => sim.units.filter(u => u.treated === treated).map(u => u.y.map(v => v - u.y[ref]));
    const dT = changes(true), dC = changes(false);
    const col = (d, k) => d.map(row => row[k]);

    // beta_e is a two-by-two DiD of period e against period -1.
    const rows = [];
    for (let k = 0; k < T; k++) {
      const e = k + 1 - t0, truth = trueEffect(p, e);
      if (k === ref) { rows.push({ e, est: 0, se: 0, lo: null, hi: null, truth, reference: true }); continue; }
      const est = S.mean(col(dT, k)) - S.mean(col(dC, k));
      const se = Math.sqrt(S.variance(col(dT, k)) / dT.length + S.variance(col(dC, k)) / dC.length);
      rows.push({ e, est, se, lo: est - 1.96 * se, hi: est + 1.96 * se, truth, reference: false });
    }

    // Joint test that all leads (e <= -2) are zero: W = b' V^-1 b, chi-square with one df per lead.
    // Without noise V is zero and the test is undefined (the page never sets noise to 0).
    const leadIdx = [];
    for (let k = 0; k < ref; k++) leadIdx.push(k);
    const b = leadIdx.map(k => rows[k].est);
    let wald = NaN, preP = NaN;
    if (p.noise > 0) {
      const V = leadIdx.map(a => leadIdx.map(c =>
        covariance(col(dT, a), col(dT, c)) / dT.length + covariance(col(dC, a), col(dC, c)) / dC.length));
      const Vb = S.solve(V, b);
      wald = 0;
      for (let i = 0; i < b.length; i++) wald += b[i] * Vb[i];
      preP = S.chiSquareSf(wald, b.length);
    }

    // Average of the post-policy estimates (e = 0 .. last) and of the true effects.
    const post = rows.filter(r => r.e >= 0);
    const avgEst = S.mean(post.map(r => r.est));
    const avgTrue = S.mean(post.map(r => r.truth));
    return { rows, wald, df: b.length, preP, avgEst, avgTrue, bias: avgEst - avgTrue };
  }

  // ---- Part B: placebo dates in daily data ----

  // Weekly pattern, Monday to Sunday. Mean zero; weekends are high.
  const WEEK_PATTERN = [-0.8, -0.6, -0.4, -0.2, 0.2, 1.0, 0.8];

  const DAILY_DEFAULTS = {
    days: 420,          // days 0..days-1 (60 weeks); day 0 is a Monday
    start: 364,         // first day with the policy (a Monday)
    base: 100,          // average daily orders without the policy
    effect: 1,          // true effect of the policy on daily orders
    weeklySize: 2,      // size of the weekly pattern
    rho: 0.6,           // day-to-day correlation of the noise
    sigma: 1,           // standard deviation of the daily noise shocks
    w: 14,              // window length in days
    sameWeekday: true,  // keep only placebo dates on the policy weekday
    seed: 1,
  };

  function simulateDaily(params) {
    const p = Object.assign({}, DAILY_DEFAULTS, params);
    const rng = CP.rng.makeRng(p.seed);
    const y = [];
    // Noise u_d = rho * u_(d-1) + e_d. The first value comes from the long-run distribution.
    let u = rng.normal(0, p.sigma / Math.sqrt(1 - p.rho * p.rho));
    for (let d = 0; d < p.days; d++) {
      if (d > 0) u = p.rho * u + rng.normal(0, p.sigma);
      y.push(p.base + p.weeklySize * WEEK_PATTERN[d % 7] + (d >= p.start ? p.effect : 0) + u);
    }
    return { params: p, y };
  }

  function meanOf(y, from, to) {   // mean of y[from .. to - 1]
    let s = 0;
    for (let d = from; d < to; d++) s += y[d];
    return s / (to - from);
  }

  // Mean of the w days from date c on, minus the mean of the w days before c.
  function windowEstimate(y, c, w) { return meanOf(y, c, c + w) - meanOf(y, c - w, c); }

  function estimateDaily(sim) {
    const S = CP.stats, p = sim.params, y = sim.y, D0 = p.start, w = p.w;
    const actual = windowEstimate(y, D0, w);

    // Placebo dates use only data before the policy: both windows end before D0.
    const dates = [];
    for (let c = w; c + w - 1 < D0; c++) {
      dates.push({ day: c, est: windowEstimate(y, c, w), sameWeekday: (D0 - c) % 7 === 0 });
    }
    const placebos = p.sameWeekday ? dates.filter(q => q.sameWeekday) : dates;

    // Rank p-value. The actual date counts in both the numerator and K.
    const K = placebos.length + 1;
    const rank = 1 + placebos.filter(q => Math.abs(q.est) >= Math.abs(actual)).length;

    // Naive pooled two-sample t-test: the w days after against the w days before, as if independent.
    const after = y.slice(D0, D0 + w), before = y.slice(D0 - w, D0);
    const pooledVar = (S.variance(after) + S.variance(before)) / 2;
    const t = actual / Math.sqrt(pooledVar * 2 / w);

    return {
      actual, dates, placebos, K, rank, pPlacebo: rank / K, pMin: 1 / K,
      placeboSd: S.sd(placebos.map(q => q.est)),
      t, pNaive: S.tTwoSidedP(t, 2 * w - 2),
    };
  }

  CP.eventstudy = {
    PANEL_DEFAULTS, trueEffect, simulatePanel, estimatePanel,
    WEEK_PATTERN, DAILY_DEFAULTS, simulateDaily, windowEstimate, estimateDaily,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.eventstudy;
})(typeof window !== 'undefined' ? window : globalThis);
