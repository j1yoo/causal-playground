// Module 2: staggered adoption. Groups of stores start a policy in different periods.
// The simulation keeps both potential outcomes, so the true effects are known.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  const DEFAULTS = {
    // Timing groups. start is the first period with the policy (Infinity: never adopts).
    groups: [
      { name: 'early', start: 4, n: 40, level: 10 },
      { name: 'late', start: 7, n: 40, level: 12 },
      { name: 'never', start: Infinity, n: 40, level: 11 },
    ],
    periods: 10,      // periods 1..periods
    base: 2,          // effect in the first period of the policy
    growth: 0,        // change in the effect per period after adoption
    earlyExtra: 0,    // extra effect in the group that adopts first
    neverGroup: true, // keep the stores that never adopt
    noise: 0.5,       // standard deviation of store-period noise
    seed: 1,
  };

  // True effect in period t for a store whose group adopts in period g (t >= g).
  function effect(p, g, t) {
    const first = Math.min.apply(null, p.groups.map(x => x.start));
    return p.base + p.growth * (t - g) + (g === first ? p.earlyExtra : 0);
  }

  function simulate(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const rng = CP.rng.makeRng(p.seed);
    const T = p.periods;
    // Period effects shared by all stores: steady growth plus small common shocks.
    const common = [];
    for (let t = 1; t <= T; t++) common.push(0.6 * t + rng.normal(0, 0.3));
    const groups = p.groups.map(g => {
      const units = [];
      for (let j = 0; j < g.n; j++) {
        const level = (g.level === undefined ? 11 : g.level) + rng.normal(0, 1);
        const y0 = [], y = [];
        for (let t = 1; t <= T; t++) {
          const base = level + common[t - 1] + rng.normal(0, p.noise);
          y0.push(base);
          y.push(t >= g.start ? base + effect(p, g.start, t) : base);
        }
        units.push({ y0, y });
      }
      return { name: g.name, start: g.start, n: g.n, units };
    });
    // Drop the never group after the draws, so the other stores stay the same.
    return { params: p, groups: p.neverGroup ? groups : groups.filter(g => isFinite(g.start)) };
  }

  function estimate(sim) {
    const S = CP.stats, p = sim.params, T = p.periods, G = sim.groups;
    // Goodman-Bacon (2021), Theorem 1, needs start periods in 2..T, one start period per group,
    // at most one group that never adopts, and at least two groups.
    const starts = G.map(g => g.start);
    if (starts.length < 2 || new Set(starts).size < starts.length || starts.some(a => isFinite(a) && (a < 2 || a > T))) {
      throw new Error('staggered: each group needs its own start period in 2 to ' + T + ' (Infinity for one never group), and there must be at least two groups');
    }
    const N = S.sum(G.map(g => g.n));
    // Mean outcome of group j in period t is ybar[j][t - 1].
    const ybar = G.map(g => {
      const out = [];
      for (let t = 0; t < T; t++) out.push(S.mean(g.units.map(u => u.y[t])));
      return out;
    });
    const win = (j, a, b) => S.mean(ybar[j].slice(a - 1, b)); // mean of group j over periods a..b

    // TWFE: in a balanced panel, store and period fixed effects equal two-way demeaning.
    const Y = [], D = [];
    G.forEach(g => g.units.forEach(u => {
      Y.push(u.y);
      D.push(u.y.map((_, i) => (i + 1 >= g.start ? 1 : 0)));
    }));
    const Yd = S.demeanTwoWay(Y), Dd = S.demeanTwoWay(D);
    let num = 0, den = 0;
    for (let i = 0; i < Y.length; i++) {
      for (let t = 0; t < T; t++) { num += Dd[i][t] * Yd[i][t]; den += Dd[i][t] * Dd[i][t]; }
    }
    const twfe = num / den;
    const V = den / (N * T); // variance of the demeaned treatment dummy

    // Goodman-Bacon (2021), Theorem 1: TWFE is a weighted average of 2x2 comparisons.
    const timing = G.map((g, j) => j).filter(j => isFinite(G[j].start))
      .sort((a, b) => G[a].start - G[b].start);
    const U = G.findIndex(g => !isFinite(g.start));
    const share = j => G[j].n / N;
    const dbar = j => (T - G[j].start + 1) / T; // share of periods with the policy
    const comparisons = [];
    if (U >= 0) {
      for (const k of timing) {
        const a = G[k].start;
        comparisons.push({
          type: 'never', treated: k, control: U, from: 1, to: T,
          weight: share(k) * share(U) * dbar(k) * (1 - dbar(k)) / V,
          estimate: (win(k, a, T) - win(k, 1, a - 1)) - (win(U, a, T) - win(U, 1, a - 1)),
        });
      }
    }
    for (let i = 0; i < timing.length; i++) {
      for (let m = i + 1; m < timing.length; m++) {
        const k = timing[i], l = timing[m], a = G[k].start, b = G[l].start;
        const nn = share(k) * share(l), dk = dbar(k), dl = dbar(l);
        // Earlier group k against later group l before l adopts: l is not yet treated.
        comparisons.push({
          type: 'notYet', treated: k, control: l, from: 1, to: b - 1,
          weight: nn * (dk - dl) * (1 - dk) / V,
          estimate: (win(k, a, b - 1) - win(k, 1, a - 1)) - (win(l, a, b - 1) - win(l, 1, a - 1)),
        });
        // Later group l against earlier group k after k adopted: k is already treated.
        comparisons.push({
          type: 'already', treated: l, control: k, from: a, to: T,
          weight: nn * dl * (dk - dl) / V,
          estimate: (win(l, b, T) - win(l, a, b - 1)) - (win(k, b, T) - win(k, a, b - 1)),
        });
      }
    }

    // Callaway and Sant'Anna (2021): ATT(g,t) from the long difference Y_t - Y_{g-1}.
    // Comparison: never-adopting stores if present, otherwise stores not yet treated in t.
    const cells = [];
    for (const k of timing) {
      const g = G[k].start;
      for (let t = g; t <= T; t++) {
        const ctrl = U >= 0 ? [U] : G.map((_, j) => j).filter(j => G[j].start > t);
        const change = j => ybar[j][t - 1] - ybar[j][g - 2];
        const ctrlChange = S.sum(ctrl.map(j => G[j].n * change(j))) / S.sum(ctrl.map(j => G[j].n));
        cells.push({
          group: k, g, t, e: t - g, n: G[k].n,
          att: ctrl.length ? change(k) - ctrlChange : null, // null: not identified
          truth: effect(p, g, t),
        });
      }
    }
    // Averages of cells with weights proportional to group size,
    // so each one is an average over treated store-periods.
    const avg = (cs, key) => S.sum(cs.map(c => c.n * c[key])) / S.sum(cs.map(c => c.n));
    const known = cells.filter(c => c.att !== null);
    const csAvg = avg(known, 'att');
    const csTruth = avg(known, 'truth');
    const trueAll = avg(cells, 'truth');

    // Event-time averages: groups observed e periods after adoption, weighted by size.
    const eventTime = [];
    for (let e = 0; e <= T - G[timing[0]].start; e++) {
      const cs = known.filter(c => c.e === e);
      eventTime.push({ e, groups: cs.map(c => c.group), estimate: avg(cs, 'att'), truth: avg(cs, 'truth') });
    }

    return {
      periods: Array.from({ length: T }, (_, i) => i + 1),
      groupMeans: ybar, twfe, V, comparisons,
      weightSum: S.sum(comparisons.map(c => c.weight)),
      decompSum: S.sum(comparisons.map(c => c.weight * c.estimate)),
      cells, csAvg, csTruth, trueAll, eventTime,
      biasTwfe: twfe - trueAll, biasCs: csAvg - csTruth,
      treatedCount: S.sum(cells.map(c => c.n)), csCount: S.sum(known.map(c => c.n)),
    };
  }

  CP.staggered = { DEFAULTS, effect, simulate, estimate };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.staggered;
})(typeof window !== 'undefined' ? window : globalThis);
