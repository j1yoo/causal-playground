// Small statistics helpers shared by all simulations.
// Pure functions only: no page elements, so Node tests can run them.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
  function mean(a) { return a.length ? sum(a) / a.length : NaN; }

  // Sample variance with the n - 1 divisor.
  function variance(a) {
    const n = a.length;
    if (n < 2) return NaN;
    const m = mean(a);
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] - m) * (a[i] - m);
    return s / (n - 1);
  }
  function sd(a) { return Math.sqrt(variance(a)); }

  // Quantile with linear interpolation between order statistics (R type 7).
  function quantile(a, p) {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y);
    const h = (s.length - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return s[lo] + (h - lo) * (s[hi] - s[lo]);
  }

  // Solve A x = b by Gaussian elimination with partial pivoting.
  function solve(A, b) {
    const n = A.length;
    const M = A.map((row, i) => row.slice().concat([b[i]]));
    // Pivot tolerance relative to the largest entry, so the check does not depend on units or sample size.
    let scale = 0;
    for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v));
    const tol = 1e-12 * (scale || 1);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) <= tol) throw new Error('singular matrix');
      const tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        if (f === 0) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  function inverse(A) {
    const n = A.length;
    const cols = [];
    for (let j = 0; j < n; j++) {
      const e = new Array(n).fill(0); e[j] = 1;
      cols.push(solve(A, e));
    }
    return A.map((_, i) => cols.map(col => col[i]));
  }

  // Least squares. X is an array of rows. Options:
  //   weights: array of non-negative weights (weighted least squares)
  //   se: 'classical' (default), 'hc1' (heteroskedasticity-robust), or 'none'
  //   cluster: array of cluster ids (cluster-robust, CR1 small-sample factor)
  function ols(X, y, opts) {
    opts = opts || {};
    const n = X.length, k = X[0].length;
    const w = opts.weights || null;
    const XtX = [], Xty = new Array(k).fill(0);
    for (let a = 0; a < k; a++) XtX.push(new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      const wi = w ? w[i] : 1;
      if (wi === 0) continue;
      const xi = X[i];
      for (let a = 0; a < k; a++) {
        Xty[a] += wi * xi[a] * y[i];
        for (let b = a; b < k; b++) XtX[a][b] += wi * xi[a] * xi[b];
      }
    }
    for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    const beta = solve(XtX, Xty);
    const resid = new Array(n);
    let nUsed = 0;
    for (let i = 0; i < n; i++) {
      let fit = 0;
      for (let a = 0; a < k; a++) fit += X[i][a] * beta[a];
      resid[i] = y[i] - fit;
      if (!w || w[i] > 0) nUsed++;
    }
    const out = { beta, resid, n: nUsed, k };
    const mode = opts.cluster ? 'cluster' : (opts.se || 'classical');
    if (!['classical', 'hc1', 'cluster', 'none'].includes(mode)) throw new Error('ols: unknown se option ' + mode);
    if (mode === 'none') return out;
    const inv = inverse(XtX);
    let cov;
    if (mode === 'classical') {
      let ssr = 0, wsum = 0;
      for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; ssr += wi * resid[i] * resid[i]; wsum += wi > 0 ? 1 : 0; }
      const s2 = wsum > k ? ssr / (wsum - k) : NaN;
      cov = inv.map(row => row.map(v => v * s2));
    } else {
      // Sandwich: inv * meat * inv.
      const meat = [];
      for (let a = 0; a < k; a++) meat.push(new Array(k).fill(0));
      let factor;
      if (mode === 'hc1') {
        for (let i = 0; i < n; i++) {
          const wi = w ? w[i] : 1;
          if (wi === 0) continue;
          const u = wi * resid[i];
          for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) meat[a][b] += u * u * X[i][a] * X[i][b];
        }
        factor = nUsed > k ? nUsed / (nUsed - k) : NaN;
      } else {
        const groups = new Map();
        for (let i = 0; i < n; i++) {
          const wi = w ? w[i] : 1;
          if (wi === 0) continue;
          const g = opts.cluster[i];
          if (!groups.has(g)) groups.set(g, new Array(k).fill(0));
          const s = groups.get(g);
          for (let a = 0; a < k; a++) s[a] += wi * resid[i] * X[i][a];
        }
        groups.forEach(s => {
          for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) meat[a][b] += s[a] * s[b];
        });
        const G = groups.size;
        factor = G > 1 && nUsed > k ? (G / (G - 1)) * ((nUsed - 1) / (nUsed - k)) : NaN;
      }
      const half = inv.map(row => meat[0].map((_, b) => { let s = 0; for (let c = 0; c < k; c++) s += row[c] * meat[c][b]; return s; }));
      cov = half.map(row => inv[0].map((_, b) => { let s = 0; for (let c = 0; c < k; c++) s += row[c] * inv[c][b]; return s * factor; }));
    }
    out.cov = cov;
    out.se = cov.map((row, i) => Math.sqrt(Math.max(0, row[i])));
    return out;
  }

  function logistic(z) { return 1 / (1 + Math.exp(-z)); }
  function logit(p) { return Math.log(p / (1 - p)); }

  // Logistic regression by Newton steps. X rows should include a 1 for the intercept.
  // A tiny ridge term keeps the steps stable when classes separate.
  function logitFit(X, y, opts) {
    opts = opts || {};
    const n = X.length, k = X[0].length;
    const ridge = opts.ridge === undefined ? 1e-6 : opts.ridge;
    let beta = new Array(k).fill(0);
    for (let iter = 0; iter < (opts.maxIter || 50); iter++) {
      const H = [], g = new Array(k).fill(0);
      for (let a = 0; a < k; a++) H.push(new Array(k).fill(0));
      for (let i = 0; i < n; i++) {
        let z = 0;
        for (let a = 0; a < k; a++) z += X[i][a] * beta[a];
        const p = logistic(z), wgt = p * (1 - p);
        for (let a = 0; a < k; a++) {
          g[a] += (y[i] - p) * X[i][a];
          for (let b = a; b < k; b++) H[a][b] += wgt * X[i][a] * X[i][b];
        }
      }
      for (let a = 0; a < k; a++) {
        g[a] -= ridge * beta[a];
        H[a][a] += ridge;
        for (let b = 0; b < a; b++) H[a][b] = H[b][a];
      }
      const step = solve(H, g);
      let change = 0;
      for (let a = 0; a < k; a++) { beta[a] += step[a]; change = Math.max(change, Math.abs(step[a])); }
      if (change < 1e-9) break;
    }
    return beta;
  }

  // Standard normal CDF (Zelen and Severo approximation, error below 1e-7).
  function normalCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp(-z * z / 2);
    const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z >= 0 ? 1 - p : p;
  }

  // Remove unit and period means from a balanced panel stored as m[i][t].
  // For a balanced panel this is exactly what unit and period fixed effects do.
  function demeanTwoWay(m) {
    const N = m.length, T = m[0].length;
    const rowMean = m.map(r => mean(r));
    const colMean = [];
    for (let t = 0; t < T; t++) { let s = 0; for (let i = 0; i < N; i++) s += m[i][t]; colMean.push(s / N); }
    const grand = mean(rowMean);
    return m.map((r, i) => r.map((v, t) => v - rowMean[i] - colMean[t] + grand));
  }

  // Counts of values in bins [edges[j], edges[j + 1]). The last bin also counts values on its
  // right edge, with a small tolerance for rounding in computed edges.
  function histogram(values, edges) {
    const counts = new Array(edges.length - 1).fill(0);
    for (const v of values) {
      for (let j = 0; j < counts.length; j++) {
        const last = j === counts.length - 1;
        if (v >= edges[j] && (v < edges[j + 1] || (last && v - edges[j + 1] <= 1e-9 * Math.max(1, Math.abs(edges[j + 1]))))) { counts[j]++; break; }
      }
    }
    return counts;
  }


  // Log of the gamma function (Lanczos approximation).
  function logGamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  // Regularized lower incomplete gamma function P(a, x).
  function gammaP(a, x) {
    if (x <= 0) return 0;
    if (x < a + 1) {
      let ap = a, sumv = 1 / a, del = sumv;
      for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; sumv += del; if (Math.abs(del) < Math.abs(sumv) * 1e-14) break; }
      return sumv * Math.exp(-x + a * Math.log(x) - logGamma(a));
    }
    // Continued fraction for the upper part, then 1 minus it.
    let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  }

  // P(chi-square with df degrees of freedom > x).
  function chiSquareSf(x, df) { return x === Infinity ? 0 : 1 - gammaP(df / 2, x / 2); }

  // Regularized incomplete beta function I_x(a, b).
  function betaI(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    const cf = (aa, bb, xx) => {
      let c = 1, d = 1 - (aa + bb) * xx / (aa + 1);
      if (Math.abs(d) < 1e-300) d = 1e-300;
      d = 1 / d;
      let h = d;
      for (let m = 1; m < 500; m++) {
        const m2 = 2 * m;
        let num = m * (bb - m) * xx / ((aa + m2 - 1) * (aa + m2));
        d = 1 + num * d; if (Math.abs(d) < 1e-300) d = 1e-300;
        c = 1 + num / c; if (Math.abs(c) < 1e-300) c = 1e-300;
        d = 1 / d; h *= d * c;
        num = -(aa + m) * (aa + bb + m) * xx / ((aa + m2) * (aa + m2 + 1));
        d = 1 + num * d; if (Math.abs(d) < 1e-300) d = 1e-300;
        c = 1 + num / c; if (Math.abs(c) < 1e-300) c = 1e-300;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-14) break;
      }
      return h;
    };
    if (x < (a + 1) / (a + b + 2)) return front * cf(a, b, x) / a;
    return 1 - front * cf(b, a, 1 - x) / b;
  }

  // Two-sided p-value for a t statistic with df degrees of freedom.
  function tTwoSidedP(t, df) {
    if (Number.isNaN(t) || !(df > 0)) return NaN;
    if (!isFinite(t)) return 0;
    return betaI(df / 2, 0.5, df / (df + t * t));
  }

  CP.stats = { sum, mean, variance, sd, quantile, solve, inverse, ols, logistic, logit, logitFit, normalCdf, demeanTwoWay, histogram,
    logGamma, gammaP, chiSquareSf, betaI, tTwoSidedP };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.stats;
})(typeof window !== 'undefined' ? window : globalThis);
