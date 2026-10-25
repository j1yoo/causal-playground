// Module 6: sharp regression discontinuity with one cutoff.
// The simulation knows the true average outcome at every score, so the true jump is known.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  const CUTOFF = 50;
  const DEFAULTS = {
    n: 1000,              // number of students
    tau: 4,               // true effect of the scholarship (the same for every student)
    curvature: 0.5,       // size of the smooth bend in the outcome line near the cutoff
    h: 15,                // bandwidth: distance from the cutoff on each side
    estimator: 'linear',  // 'constant', 'linear', 'quadratic' (local fits) or 'global4' (order 4 on all data)
    q: 0,                 // share of high-effort students in [45, 50) who raise their score
    noise: 4,             // standard deviation of the grade noise
    effort: 2,            // weight of unobserved effort in the grade (tests can set 0)
    seed: 1,
  };

  // Polynomial order of each estimator. The local constant fit (order 0) is a weighted difference in means.
  const ORDER = { constant: 0, linear: 1, quadratic: 2, global4: 4 };

  // Sharp assignment: a score at or above the cutoff gets the scholarship.
  function isTreated(x) { return x >= CUTOFF ? 1 : 0; }

  // Average grade at score x without the scholarship. The tanh bend is smooth at the cutoff.
  function baseMean(x, p) {
    return 60 + 0.2 * (x - CUTOFF) + p.curvature * 6 * Math.tanh((x - CUTOFF) / 8);
  }

  // True average grade at score x when no student changes a score.
  function trueMean(x, params) {
    const p = Object.assign({}, DEFAULTS, params);
    return baseMean(x, p) + p.tau * isTreated(x);
  }

  function simulate(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const rng = CP.rng.makeRng(p.seed);
    const students = [];
    for (let i = 0; i < p.n; i++) {
      // Every student uses the same random draws whatever the sliders say,
      // so a slider move changes the data only through that slider.
      const x0 = 100 * rng.uniform();   // original score
      const e = rng.normal();           // unobserved effort
      const z = rng.normal();           // grade noise
      const u = rng.uniform(), v = rng.uniform();
      // Manipulation: some high-effort students just below the cutoff move to [50, 52).
      const moved = x0 >= CUTOFF - 5 && x0 < CUTOFF && e > 0 && u < p.q;
      const x = moved ? CUTOFF + 2 * v : x0;   // reported score, used as X everywhere
      const d = isTreated(x);
      const y = baseMean(x, p) + p.effort * e + p.tau * d + p.noise * z;
      students.push({ x0, x, e, d, y, moved });
    }
    return { params: p, students };
  }

  // Least squares of y on 1, u, ..., u^order with u = (x - cutoff) / scale on one side.
  // Scaling keeps the numbers small and does not change the intercept.
  // With too few students for a standard error, the fit is missing (beta null, intercept NaN).
  function fitSide(xs, ys, ws, order, scale) {
    if (xs.length < order + 2) return { beta: null, a: NaN, se: NaN, n: xs.length, scale };
    const X = xs.map(x => {
      const u = (x - CUTOFF) / scale, row = [1];
      for (let k = 1; k <= order; k++) row.push(Math.pow(u, k));
      return row;
    });
    const fit = CP.stats.ols(X, ys, { weights: ws, se: 'hc1' });
    return { beta: fit.beta, a: fit.beta[0], se: fit.se[0], n: xs.length, scale };
  }

  // Points on a fitted curve between x = from and x = to.
  function curve(fit, from, to) {
    if (!fit.beta) return [];
    const pts = [];
    for (let j = 0; j <= 50; j++) {
      const x = from + (to - from) * j / 50, u = (x - CUTOFF) / fit.scale;
      let y = 0;
      for (let k = fit.beta.length - 1; k >= 0; k--) y = y * u + fit.beta[k];
      pts.push({ x, y });
    }
    return pts;
  }

  // Exact two-sided binomial test that k and m come from a 1/2 split.
  // With probability 1/2 both tails are equal, so the p-value is twice the smaller tail.
  function binomialTest(k, m) {
    const N = k + m, lo = Math.min(k, m), lg = CP.stats.logGamma;
    if (N === 0) return 1;
    let tail = 0;
    for (let j = 0; j <= lo; j++) tail += Math.exp(lg(N + 1) - lg(j + 1) - lg(N - j + 1) - N * Math.LN2);
    return Math.min(1, 2 * tail);
  }

  // Simple density check: students in [48, 50) and [50, 52).
  function densityCheck(sim) {
    let below = 0, above = 0;
    for (const s of sim.students) {
      if (s.x >= CUTOFF - 2 && s.x < CUTOFF) below++;
      else if (s.x >= CUTOFF && s.x < CUTOFF + 2) above++;
    }
    return { below, above, p: binomialTest(below, above) };
  }

  // Number of students and average grade in score bins of the given width (default 2).
  function bins(sim, width) {
    width = width || 2;
    const nb = Math.round(100 / width);
    const count = new Array(nb).fill(0), sum = new Array(nb).fill(0);
    for (const s of sim.students) {
      const j = Math.min(nb - 1, Math.floor(s.x / width));
      count[j]++; sum[j] += s.y;
    }
    return count.map((cnt, j) => ({ x0: j * width, x1: (j + 1) * width, mid: (j + 0.5) * width, count: cnt, mean: cnt ? sum[j] / cnt : NaN }));
  }

  // Separate fit on each side of the cutoff with one estimator and one bandwidth h.
  // Local fits keep |x - c| < h with triangular weights 1 - |x - c| / h.
  // The global polynomial uses all students with equal weights and ignores h.
  function fitBoth(students, estimator, h) {
    const local = estimator !== 'global4';
    const order = ORDER[estimator];
    const scale = local ? h : 50;
    const fits = [];
    for (const side of [0, 1]) {
      const xs = [], ys = [], ws = [];
      for (const s of students) {
        if (isTreated(s.x) !== side) continue;
        const w = local ? 1 - Math.abs(s.x - CUTOFF) / h : 1;
        if (w <= 0) continue;
        xs.push(s.x); ys.push(s.y); ws.push(w);
      }
      fits.push(fitSide(xs, ys, local ? ws : null, order, scale));
    }
    const L = fits[0], R = fits[1];
    // The estimate is the right intercept minus the left intercept (NaN if a side is missing).
    const est = R.a - L.a;
    const se = Math.sqrt(L.se * L.se + R.se * R.se);
    return { local, order, left: L, right: R, est, se, ciLow: est - 1.96 * se, ciHigh: est + 1.96 * se };
  }

  function estimate(sim) {
    const p = sim.params;
    const f = fitBoth(sim.students, p.estimator, p.h);
    const L = f.left, R = f.right;
    const lo = f.local ? Math.max(0, CUTOFF - p.h) : 0, hi = f.local ? Math.min(100, CUTOFF + p.h) : 100;
    return Object.assign(f, {
      ok: isFinite(f.est),
      truth: p.tau,
      error: f.est - p.tau,   // estimate minus true effect in this sample: bias plus sampling error
      nUsed: L.n + R.n,
      window: [lo, hi],
      curveLeft: curve(L, lo, CUTOFF), curveRight: curve(R, CUTOFF, hi),
      density: densityCheck(sim),
    });
  }

  // The estimate and its 95% confidence interval at each bandwidth in hs, on the same sample,
  // with the estimator in sim.params. The global polynomial has the same estimate at every bandwidth.
  function bandwidthPath(sim, hs) {
    const p = sim.params;
    const global = p.estimator === 'global4' ? fitBoth(sim.students, 'global4', p.h) : null;
    return hs.map(h => {
      const f = global || fitBoth(sim.students, p.estimator, h);
      const ok = isFinite(f.est);
      return { h, est: f.est, se: f.se, ciLow: f.ciLow, ciHigh: f.ciHigh, ok,
        covers: ok && f.ciLow <= p.tau && p.tau <= f.ciHigh };
    });
  }

  // Runs of neighboring bandwidths in the path whose interval contains the true effect,
  // as [first, last] pairs. A bandwidth whose fit is missing ends a run.
  function coverRuns(path) {
    const runs = [];
    path.forEach((r, i) => {
      if (!r.covers) return;
      if (i > 0 && path[i - 1].covers) runs[runs.length - 1][1] = r.h;
      else runs.push([r.h, r.h]);
    });
    return runs;
  }

  CP.rd = { DEFAULTS, CUTOFF, ORDER, isTreated, trueMean, simulate, fitBoth, estimate, bandwidthPath, coverRuns,
    bins, densityCheck, binomialTest };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.rd;
})(typeof window !== 'undefined' ? window : globalThis);
