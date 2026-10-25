// Module 8: randomization inference in a small completely randomized experiment.
// The simulation keeps both potential outcomes of every customer, so it knows the true effect.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  const DEFAULTS = {
    n: 10,           // customers; half of them see the new page
    effect: 15,      // true effect of the new page on spending, the same for every customer
    outlier: 0,      // extra spending of customer 1 (the large customer) under both pages
    base: 40,        // average spending without the new page
    sd: 10,          // standard deviation of spending without the new page
    maxExact: 3432,  // list every assignment up to this number (14 customers)
    draws: 2000,     // above it: the actual assignment plus 1,999 random assignments
    seed: 1,
  };
  const KINDS = ['mean', 'median', 'rank'];
  const LABELS = { mean: 'Difference in means', median: 'Difference in medians', rank: 'Difference in mean ranks' };

  // Number of ways to choose k units out of n.
  function choose(n, k) {
    let c = 1;
    for (let i = 1; i <= k; i++) c = c * (n - k + i) / i;
    return Math.round(c);
  }

  function simulate(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const n = p.n, n1 = Math.floor(n / 2);
    const rng = CP.rng.makeRng(p.seed);
    const y0 = new Float64Array(n), y1 = new Float64Array(n);
    for (let i = 0; i < n; i++) y0[i] = p.base + p.sd * rng.normal();
    y0[0] += p.outlier;
    for (let i = 0; i < n; i++) y1[i] = y0[i] + p.effect;
    // Complete randomization: a random half of the customers see the new page.
    const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    const d = new Uint8Array(n);
    for (let j = 0; j < n1; j++) d[order[j]] = 1;
    const y = new Float64Array(n);
    let mask = 0;
    for (let i = 0; i < n; i++) {
      y[i] = d[i] ? y1[i] : y0[i];
      if (d[i]) mask |= 1 << i;
    }
    return { params: p, n, n1, n0: n - n1, y0, y1, d, y, mask: mask >>> 0 };
  }

  // The assignments that the test compares with the actual one, as bit masks (bit i = customer i
  // saw the new page). With at most maxExact assignments, all of them. Otherwise the actual
  // assignment plus random assignments, so that the p-value still counts the actual one.
  function assignments(sim) {
    const p = sim.params, n = sim.n, n1 = sim.n1;
    const K = choose(n, n1);
    if (K <= p.maxExact) {
      const masks = new Uint32Array(K);
      let k = 0;
      const rec = (start, left, m) => {
        if (left === 0) { masks[k++] = m >>> 0; return; }
        for (let i = start; i <= n - left; i++) rec(i + 1, left - 1, m | (1 << i));
      };
      rec(0, n1, 0);
      return { masks, K, exact: true };
    }
    const rng = CP.rng.makeRng((Math.imul(p.seed, 2654435761) ^ 0x5bd1e995) >>> 0);
    const masks = new Uint32Array(p.draws);
    masks[0] = sim.mask;
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let r = 1; r < p.draws; r++) {
      for (let j = 0; j < n1; j++) {
        const t = j + rng.int(n - j);
        const tmp = idx[j]; idx[j] = idx[t]; idx[t] = tmp;
      }
      let m = 0;
      for (let j = 0; j < n1; j++) m |= 1 << idx[j];
      masks[r] = m >>> 0;
    }
    return { masks, K, exact: false };
  }

  // Ranks from 1 (smallest) to n. Tied values share their average rank.
  function ranks(y) {
    const n = y.length;
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => y[a] - y[b]);
    const r = new Float64Array(n);
    for (let j = 0; j < n;) {
      let k = j;
      while (k + 1 < n && y[idx[k + 1]] === y[idx[j]]) k++;
      for (let t = j; t <= k; t++) r[idx[t]] = (j + k) / 2 + 1;
      j = k + 1;
    }
    return r;
  }

  // Value of the test statistic for every assignment in masks, with the outcomes y held fixed.
  // Each statistic is a treated-group summary minus the same summary for the comparison group.
  function values(kind, y, masks, n1) {
    const n = y.length, n0 = n - n1, K = masks.length;
    const out = new Float64Array(K);
    if (kind === 'median') {
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => y[a] - y[b]);
      const t1a = (n1 - 1) >> 1, t1b = n1 >> 1, t0a = (n0 - 1) >> 1, t0b = n0 >> 1;
      for (let k = 0; k < K; k++) {
        const m = masks[k];
        let c1 = 0, c0 = 0, a1 = 0, b1 = 0, a0 = 0, b0 = 0;
        for (let j = 0; j < n; j++) {
          const i = order[j], v = y[i];
          if ((m >>> i) & 1) { if (c1 === t1a) a1 = v; if (c1 === t1b) b1 = v; c1++; }
          else { if (c0 === t0a) a0 = v; if (c0 === t0b) b0 = v; c0++; }
        }
        out[k] = (a1 + b1) / 2 - (a0 + b0) / 2;
      }
      return out;
    }
    const z = kind === 'rank' ? ranks(y) : y;
    let all = 0;
    for (let i = 0; i < n; i++) all += z[i];
    for (let k = 0; k < K; k++) {
      const m = masks[k];
      let s = 0;
      for (let i = 0; i < n; i++) if ((m >>> i) & 1) s += z[i];
      out[k] = s / n1 - (all - s) / n0;
    }
    return out;
  }

  function statistic(kind, y, mask, n1) { return values(kind, y, Uint32Array.of(mask), n1)[0]; }

  // Share of assignments whose statistic is at least as extreme as the observed one.
  // Two-sided: compare absolute values. One-sided: large positive values count as evidence.
  function pValue(vals, obs, twoSided) {
    const tol = 1e-9 * (1 + Math.abs(obs));
    let b = 0;
    if (twoSided) {
      const a = Math.abs(obs) - tol;
      for (let k = 0; k < vals.length; k++) if (Math.abs(vals[k]) >= a) b++;
    } else {
      const a = obs - tol;
      for (let k = 0; k < vals.length; k++) if (vals[k] >= a) b++;
    }
    return { p: b / vals.length, count: b, used: vals.length };
  }

  // The p-value that the most extreme assignment would get.
  function smallestP(vals, twoSided) {
    let top = -Infinity;
    for (let k = 0; k < vals.length; k++) top = Math.max(top, twoSided ? Math.abs(vals[k]) : vals[k]);
    return pValue(vals, top, twoSided).p;
  }

  // Outcomes that every customer would have without the new page if the effect were tau0 for everyone.
  function adjusted(sim, tau0) {
    const y = new Float64Array(sim.n);
    for (let i = 0; i < sim.n; i++) y[i] = sim.y[i] - sim.d[i] * tau0;
    return y;
  }

  // Test of the sharp null that the effect is tau0 (default 0) for every customer.
  function test(sim, A, kind, opts) {
    opts = opts || {};
    const twoSided = opts.alternative !== 'greater';
    const y = opts.tau0 ? adjusted(sim, opts.tau0) : sim.y;
    const vals = values(kind, y, A.masks, sim.n1);
    const obs = statistic(kind, y, sim.mask, sim.n1);
    const r = pValue(vals, obs, twoSided);
    return { kind, obs, vals, p: r.p, count: r.count, used: r.used, pMin: smallestP(vals, twoSided) };
  }

  // Median of all differences between a treated outcome and a comparison outcome.
  function hodgesLehmann(sim) {
    const diffs = [];
    for (let i = 0; i < sim.n; i++) if (sim.d[i]) for (let j = 0; j < sim.n; j++) if (!sim.d[j]) diffs.push(sim.y[i] - sim.y[j]);
    return CP.stats.quantile(diffs, 0.5);
  }

  // Where the search for the confidence interval starts: the natural estimate of each statistic.
  function center(sim, kind) {
    if (kind === 'rank') return hodgesLehmann(sim);
    return statistic(kind, sim.y, sim.mask, sim.n1);
  }

  // Two-sided p-value of the sharp null that the effect is tau0 for every customer.
  function pAt(sim, A, kind, tau0) { return test(sim, A, kind, { tau0 }).p; }

  // Widen a search window around the estimate until the two-sided test rejects on both sides
  // at level alpha, or until the limit. An open side means that the test never rejects there.
  function searchRange(sim, A, kind, opts) {
    opts = opts || {};
    const alpha = opts.alpha || 0.05, limit = opts.limit || 400;
    const c = center(sim, kind);
    let hLo = 4, hHi = 4;
    while (hLo < limit && pAt(sim, A, kind, c - hLo) > alpha) hLo *= 2;
    while (hHi < limit && pAt(sim, A, kind, c + hHi) > alpha) hHi *= 2;
    const openLo = pAt(sim, A, kind, c - hLo) > alpha, openHi = pAt(sim, A, kind, c + hHi) > alpha;
    return { center: c, openLo, openHi, from: openLo ? c - 60 : c - hLo, to: openHi ? c + 60 : c + hHi };
  }

  // 95% confidence interval by inverting the two-sided test: the hypothesized effects tau0
  // that the test does not reject at the 5% level (p-value above 0.05). The p-value curve is
  // computed on a grid over opts.range (default: the search window), plus the estimate itself.
  function invert(sim, A, kind, opts) {
    opts = opts || {};
    const alpha = opts.alpha || 0.05, G = opts.grid || 81;
    const s = opts.search || searchRange(sim, A, kind, opts);
    const from = Math.min(s.from, opts.range ? opts.range[0] : s.from);
    const to = Math.max(s.to, opts.range ? opts.range[1] : s.to);
    const ts = [];
    for (let g = 0; g < G; g++) ts.push(from + (to - from) * g / (G - 1));
    ts.push(s.center);
    ts.sort((a, b) => a - b);
    const grid = ts.map(t => ({ tau0: t, p: pAt(sim, A, kind, t) }));
    let first = -1, last = -1, pMax = -1;
    grid.forEach((pt, g) => {
      if (pt.p > alpha) { if (first < 0) first = g; last = g; }
      pMax = Math.max(pMax, pt.p);
    });
    // Refine each end between the last value not rejected and the first rejected grid point.
    const refine = (inside, outside) => {
      for (let it = 0; it < 40 && Math.abs(inside - outside) > 1e-3; it++) {
        const mid = (inside + outside) / 2;
        if (pAt(sim, A, kind, mid) > alpha) inside = mid; else outside = mid;
      }
      return inside;
    };
    let lo = NaN, hi = NaN;
    if (first >= 0) {
      lo = s.openLo ? -Infinity : (first > 0 ? refine(grid[first].tau0, grid[first - 1].tau0) : grid[0].tau0);
      hi = s.openHi ? Infinity : (last < grid.length - 1 ? refine(grid[last].tau0, grid[last + 1].tau0) : grid[grid.length - 1].tau0);
    }
    // The effects with the highest p-value form a stretch. Refine both ends of it, so that its middle
    // does not depend on where the grid points fall.
    const isTop = t => pAt(sim, A, kind, t) >= pMax - 1e-12;
    let a = 0, b = grid.length - 1;
    while (grid[a].p < pMax - 1e-12) a++;
    while (grid[b].p < pMax - 1e-12) b--;
    const refineTop = (inside, outside) => {
      for (let it = 0; it < 40 && Math.abs(inside - outside) > 1e-3; it++) {
        const mid = (inside + outside) / 2;
        if (isTop(mid)) inside = mid; else outside = mid;
      }
      return inside;
    };
    const topLo = a > 0 ? refineTop(grid[a].tau0, grid[a - 1].tau0) : grid[a].tau0;
    const topHi = b < grid.length - 1 ? refineTop(grid[b].tau0, grid[b + 1].tau0) : grid[b].tau0;
    const est = (topLo + topHi) / 2;
    return { grid, lo, hi, est, pMax, center: s.center, from, to, unbounded: s.openLo || s.openHi };
  }

  // If the sharp null of no effect were true, the outcomes would stay as observed under every
  // assignment. This is the share of assignments in which the test would then reject at level alpha.
  function falseAlarm(vals, twoSided, alpha) {
    const K = vals.length;
    const e = Array.from(vals, v => (twoSided ? Math.abs(v) : v)).sort((a, b) => b - a);
    let rejected = 0;
    for (let j = 0; j < K;) {
      let k = j;
      const tol = 1e-9 * (1 + Math.abs(e[j]));
      while (k + 1 < K && e[k + 1] >= e[j] - tol) k++;
      if ((k + 1) / K <= alpha + 1e-12) rejected = k + 1; else break;
      j = k + 1;
    }
    return rejected / K;
  }

  CP.ri = { DEFAULTS, KINDS, LABELS, choose, simulate, assignments, ranks, values, statistic, pValue, smallestP,
    adjusted, test, hodgesLehmann, center, pAt, searchRange, invert, falseAlarm };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.ri;
})(typeof window !== 'undefined' ? window : globalThis);
