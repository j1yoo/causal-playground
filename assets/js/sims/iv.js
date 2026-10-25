// Module 10: noncompliance in a randomized experiment and the instrumental variables (Wald) estimator.
// The simulation knows each customer's compliance type and both potential outcomes.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  const DEFAULTS = {
    n: 2000,          // customers; half of them get the call
    compliers: 0.5,   // share who join only if called
    always: 0,        // share who join whether or not they are called
    defiers: 0,       // share who join only if not called
    gap: 10,          // spending gap without the program: always-takers +gap, never-takers -gap
    effect: 10,       // effect of joining for compliers
    direct: 0,        // text message to called customers who do not join: direct effect on spending
    base: 40,         // compliers' average spending without the program
    sd: 10,           // standard deviation of spending inside a type
    reps: 2000,       // repeated experiments for the weak-instrument chart
    seed: 1,
  };
  const TYPES = ['complier', 'always', 'never', 'defier'];
  const LABELS = { complier: 'Compliers', always: 'Always-takers', never: 'Never-takers', defier: 'Defiers' };

  // Type-level values. The effects differ by type, so the average effect for all customers (ATE)
  // differs from the effect for compliers (LATE).
  function typeTable(p) {
    const never = Math.max(0, 1 - p.compliers - p.always - p.defiers);
    return {
      complier: { share: p.compliers, d0: 0, d1: 1, mean0: p.base, effect: p.effect },
      always: { share: p.always, d0: 1, d1: 1, mean0: p.base + p.gap, effect: p.effect + 5 },
      never: { share: never, d0: 0, d1: 0, mean0: p.base - p.gap, effect: p.effect - 5 },
      defier: { share: p.defiers, d0: 1, d1: 0, mean0: p.base, effect: p.effect - 10 },
    };
  }

  // Wald minus LATE in the population, split into the part from the text message (exclusion
  // restriction) and the part from defiers (monotonicity).
  function expectedGap(p) {
    const t = typeTable(p);
    const first = t.complier.share - t.defier.share;
    return {
      first,
      exclusion: p.direct * (t.never.share + t.defier.share) / first,
      defiers: t.defier.share * (t.complier.effect - t.defier.effect) / first,
    };
  }

  // One sample of customers: type, outcome without the program, call, joining, and outcome.
  // buf lets repeated samples reuse their arrays.
  function drawSample(p, rng, buf) {
    const t = typeTable(p), n = p.n, n1 = Math.floor(n / 2);
    const cut1 = t.complier.share, cut2 = cut1 + t.always.share, cut3 = cut2 + t.defier.share;
    const mean0 = TYPES.map(k => t[k].mean0), eff = TYPES.map(k => t[k].effect);
    const D0 = TYPES.map(k => t[k].d0), D1 = TYPES.map(k => t[k].d1);
    const b = buf && buf.n === n ? buf : { n, type: new Uint8Array(n), y0: new Float64Array(n), z: new Uint8Array(n),
      d: new Uint8Array(n), y: new Float64Array(n), idx: new Int32Array(n) };
    const { type, y0, z, d, y, idx } = b;
    for (let i = 0; i < n; i++) {
      const u = rng.uniform();
      const k = u < cut1 ? 0 : u < cut2 ? 1 : u < cut3 ? 3 : 2;
      type[i] = k;
      y0[i] = mean0[k] + p.sd * rng.normal();
      idx[i] = i;
    }
    // Complete randomization: a random half of the customers get the call.
    z.fill(0);
    for (let j = 0; j < n1; j++) {
      const r = j + rng.int(n - j);
      const tmp = idx[j]; idx[j] = idx[r]; idx[r] = tmp;
      z[idx[j]] = 1;
    }
    for (let i = 0; i < n; i++) {
      const k = type[i];
      d[i] = z[i] ? D1[k] : D0[k];
      y[i] = y0[i] + (d[i] ? eff[k] : 0) + (z[i] && !d[i] ? p.direct : 0);
    }
    return { type, y0, z, d, y, table: t, buf: b };
  }

  function simulate(params) {
    const p = Object.assign({}, DEFAULTS, params);
    return Object.assign({ params: p }, drawSample(p, CP.rng.makeRng(p.seed)));
  }

  // Means, variances, and the covariance of Y and D inside each assignment group.
  function groupMoments(y, d, z, g) {
    let n = 0, sy = 0, sd = 0, syy = 0, sdd = 0, syd = 0;
    for (let i = 0; i < y.length; i++) {
      if (z[i] !== g) continue;
      n++; sy += y[i]; sd += d[i]; syy += y[i] * y[i]; sdd += d[i] * d[i]; syd += y[i] * d[i];
    }
    const my = sy / n, md = sd / n;
    return { n, my, md, vy: (syy - n * my * my) / (n - 1), vd: (sdd - n * md * md) / (n - 1), cyd: (syd - n * my * md) / (n - 1) };
  }

  // Anderson-Rubin 95% set: all b with |ITT_Y - b ITT_D| <= 1.96 se(b), where se(b) is the
  // standard error of the difference in means of Y - bD. It solves a quadratic inequality.
  function andersonRubin(m1, m0, a, b) {
    const c2 = 1.96 * 1.96;
    const A0 = m1.vy / m1.n + m0.vy / m0.n, A1 = m1.cyd / m1.n + m0.cyd / m0.n, A2 = m1.vd / m1.n + m0.vd / m0.n;
    const qa = b * b - c2 * A2, qb = -2 * (a * b - c2 * A1), qc = a * a - c2 * A0;
    const disc = qb * qb - 4 * qa * qc;
    if (Math.abs(qa) < 1e-15) {
      // The inequality is linear in b: qb * b + qc <= 0.
      if (Math.abs(qb) < 1e-15) return qc <= 0 ? { kind: 'line', lo: -Infinity, hi: Infinity } : { kind: 'empty', lo: NaN, hi: NaN };
      const r = -qc / qb;
      return qb > 0 ? { kind: 'rays', lo: r, hi: Infinity } : { kind: 'rays', lo: -Infinity, hi: r };
    }
    if (qa > 0) {
      if (disc < 0) return { kind: 'empty', lo: NaN, hi: NaN };
      const r = Math.sqrt(disc);
      return { kind: 'interval', lo: (-qb - r) / (2 * qa), hi: (-qb + r) / (2 * qa) };
    }
    if (disc <= 0) return { kind: 'line', lo: -Infinity, hi: Infinity };
    const r = Math.sqrt(disc), r1 = (-qb + r) / (2 * qa), r2 = (-qb - r) / (2 * qa);
    // qa < 0: the set is everything outside the two roots.
    return { kind: 'rays', lo: Math.min(r1, r2), hi: Math.max(r1, r2) };
  }
  function arContains(ar, v) {
    if (ar.kind === 'interval') return ar.lo <= v && v <= ar.hi;
    if (ar.kind === 'rays') {
      if (ar.hi === Infinity) return v >= ar.lo;
      if (ar.lo === -Infinity) return v <= ar.hi;
      return v <= ar.lo || v >= ar.hi;
    }
    return ar.kind === 'line' || ar.kind === 'unbounded';
  }

  // ITT, first stage, Wald ratio, and Anderson-Rubin set from the moments of the two assignment groups.
  function fromMoments(m1, m0) {
    const ittY = m1.my - m0.my, ittD = m1.md - m0.md;
    const seY = Math.sqrt(m1.vy / m1.n + m0.vy / m0.n), seD = Math.sqrt(m1.vd / m1.n + m0.vd / m0.n);
    const wald = ittY / ittD;
    // Standard error of the Wald ratio: the difference in means of Y - wald * D, divided by ITT_D.
    const vr = g => g.vy - 2 * wald * g.cyd + wald * wald * g.vd;
    const seWald = Math.sqrt(Math.max(0, vr(m1) / m1.n + vr(m0) / m0.n)) / Math.abs(ittD);
    return { ittY, ittD, seY, seD, wald, seWald, ar: andersonRubin(m1, m0, ittY, ittD), firstF: (ittD / seD) * (ittD / seD) };
  }

  function estimate(sim) {
    const { y, d, z } = sim;
    const m1 = groupMoments(y, d, z, 1), m0 = groupMoments(y, d, z, 0);
    const f = fromMoments(m1, m0);
    const { ittY, ittD, seY, seD, wald, seWald } = f;
    // As-treated: everyone who joined against everyone who did not.
    // Per protocol: called customers who joined against not-called customers who did not join.
    const at1 = [], at0 = [], pp1 = [], pp0 = [];
    for (let i = 0; i < y.length; i++) {
      (d[i] ? at1 : at0).push(y[i]);
      if (z[i] && d[i]) pp1.push(y[i]);
      if (!z[i] && !d[i]) pp0.push(y[i]);
    }
    const S = CP.stats;
    const diff = (a, b) => {
      const est = S.mean(a) - S.mean(b), se = Math.sqrt(S.variance(a) / a.length + S.variance(b) / b.length);
      return { est, se, ci: [est - 1.96 * se, est + 1.96 * se] };
    };
    const asT = diff(at1, at0), pp = diff(pp1, pp0);
    // Truths for the customers in this sample.
    const t = sim.table;
    let late = 0, nc = 0, ate = 0;
    for (let i = 0; i < y.length; i++) {
      const e = t[TYPES[sim.type[i]]].effect;
      ate += e;
      if (sim.type[i] === 0) { late += e; nc++; }
    }
    const counts = {};
    for (const zz of [0, 1]) for (const dd of [0, 1]) counts[zz + '' + dd] = [0, 0, 0, 0];
    for (let i = 0; i < y.length; i++) counts[z[i] + '' + d[i]][sim.type[i]]++;
    return {
      ittY, ittD, seY, seD, ciY: [ittY - 1.96 * seY, ittY + 1.96 * seY],
      joinCalled: m1.md, joinNotCalled: m0.md,
      wald, seWald, ciWald: [wald - 1.96 * seWald, wald + 1.96 * seWald],
      ar: f.ar, firstF: f.firstF,
      asTreated: asT.est, perProtocol: pp.est, asTreatedCi: asT.ci, perProtocolCi: pp.ci,
      late: nc ? late / nc : t.complier.effect, ate: ate / y.length, nCompliers: nc,
      counts,
    };
  }

  // Chi-square draw: a sum of squared normals for small df, the Wilson-Hilferty approximation above 50.
  function chiSquare(df, rng) {
    if (df <= 0) return 0;
    if (df <= 50) { let q = 0; for (let k = 0; k < df; k++) { const v = rng.normal(); q += v * v; } return q; }
    const a = 2 / (9 * df), w = 1 - a + rng.normal() * Math.sqrt(a);
    return df * w * w * w;
  }

  // Binomial draw: inversion of the distribution function when the expected count of the rarer
  // outcome is below 30, otherwise a rounded normal approximation.
  function binomial(N, p, rng) {
    if (N <= 0 || p <= 0) return 0;
    if (p >= 1) return N;
    const q = Math.min(p, 1 - p);
    let k = 0;
    if (N * q < 30) {
      const s = q / (1 - q), a = (N + 1) * s;
      let r = Math.pow(1 - q, N), u = rng.uniform();
      while (u > r && k < N) { u -= r; k++; r *= a / k - s; }
    } else {
      k = Math.max(0, Math.min(N, Math.round(N * q + Math.sqrt(N * q * (1 - q)) * rng.normal())));
    }
    return q === p ? k : N - k;
  }

  // One repeated experiment drawn through its cell totals. The types in each assignment group follow
  // a multinomial draw. Inside a cell (type by assignment), outcomes are normal with a known mean, so
  // the cell sum is normal and the sum of squared deviations is sigma^2 times a chi-square draw.
  function drawMoments(p, t, rng) {
    const n1 = Math.floor(p.n / 2), sizes = [p.n - n1, n1];
    const groups = [], cells = [];
    for (const zz of [0, 1]) {
      // Multinomial counts of the four types, as a chain of binomial draws.
      const c = [0, 0, 0, 0];
      let left = sizes[zz], mass = 1;
      for (const k of [0, 1, 3]) {
        const share = t[TYPES[k]].share;
        c[k] = mass > 1e-12 ? binomial(left, Math.min(1, share / mass), rng) : 0;
        left -= c[k]; mass -= share;
      }
      c[2] = left;
      let sy = 0, syy = 0, sd = 0, syd = 0;
      TYPES.forEach((key, k) => {
        const tt = t[key], cnt = c[k];
        if (!cnt) return;
        const dd = zz ? tt.d1 : tt.d0;
        const shift = (dd ? tt.effect : 0) + (zz && !dd ? p.direct : 0);
        const sum = cnt * (tt.mean0 + shift) + p.sd * Math.sqrt(cnt) * rng.normal();
        const ss = p.sd * p.sd * chiSquare(cnt - 1, rng) + sum * sum / cnt;
        sy += sum; syy += ss; sd += cnt * dd; syd += dd * sum;
        cells.push({ d: dd, n: cnt, sum });
      });
      const n = sizes[zz], my = sy / n, md = sd / n;
      groups.push({ n, my, md, vy: (syy - n * my * my) / (n - 1), vd: (sd - n * md * md) / (n - 1), cyd: (syd - n * my * md) / (n - 1) });
    }
    let s1 = 0, c1 = 0, s0 = 0, c0 = 0;
    for (const cell of cells) { if (cell.d) { s1 += cell.sum; c1 += cell.n; } else { s0 += cell.sum; c0 += cell.n; } }
    return { m0: groups[0], m1: groups[1], asTreated: s1 / c1 - s0 / c0 };
  }

  function summarize(p, rows) {
    const S = CP.stats, truth = p.effect;
    // A sample in which nobody joins, or in which the first stage is exactly zero, has no Wald ratio.
    const walds = rows.map(r => r.wald), finite = walds.filter(v => isFinite(v));
    const asT = rows.map(r => r.asTreated).filter(v => isFinite(v));
    let coverWald = 0, coverAr = 0, unbounded = 0;
    for (const r of rows) {
      if (isFinite(r.wald) && isFinite(r.seWald) && Math.abs(r.wald - truth) <= 1.96 * r.seWald) coverWald++;
      if (arContains(r.ar, truth)) coverAr++;
      if (r.ar.kind !== 'interval') unbounded++;
    }
    const R = rows.length;
    return {
      truth, walds, medianWald: S.quantile(finite, 0.5), medianF: S.quantile(rows.map(r => (isFinite(r.firstF) ? r.firstF : 0)), 0.5),
      meanAsTreated: S.mean(asT), noRatio: walds.length - finite.length,
      coverWald: finite.length ? coverWald / finite.length : NaN, coverAr: coverAr / R, unbounded: unbounded / R, reps: R,
    };
  }

  // Repeat the experiment with new customers each time. Used for the weak-instrument chart.
  function replicate(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const rng = CP.rng.makeRng((Math.imul(p.seed, 2654435761) ^ 0x7f4a7c15) >>> 0);
    const t = typeTable(p), rows = [];
    for (let r = 0; r < p.reps; r++) {
      const m = drawMoments(p, t, rng);
      rows.push(Object.assign(fromMoments(m.m1, m.m0), { asTreated: m.asTreated }));
    }
    return summarize(p, rows);
  }

  // The same repetition, one customer at a time. Slower; the tests use it to check replicate().
  function replicateUnits(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const rng = CP.rng.makeRng((Math.imul(p.seed, 2654435761) ^ 0x1b873593) >>> 0);
    const rows = [];
    let buf = null;
    for (let r = 0; r < p.reps; r++) {
      const s = Object.assign({ params: p }, drawSample(p, rng, buf));
      buf = s.buf;
      rows.push(estimate(s));
    }
    return summarize(p, rows);
  }

  CP.iv = { DEFAULTS, TYPES, LABELS, typeTable, expectedGap, simulate, groupMoments, andersonRubin, arContains, fromMoments, estimate,
    chiSquare, binomial, drawMoments, replicate, replicateUnits };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.iv;
})(typeof window !== 'undefined' ? window : globalThis);
