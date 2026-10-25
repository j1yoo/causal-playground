// Module 11: regression adjustment in an observational study, and good and bad controls in causal diagrams.
// The simulation knows both potential outcomes (part 1) and the true causal effect (part 2).
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  // ---- Part 1: customers choose a membership; the segment drives both the choice and spending ----

  const ADJ_DEFAULTS = {
    n: 2000,          // customers, split evenly into four segments
    selection: 1.5,   // how strongly the segment drives joining (0: like a coin flip)
    hetero: 4,        // effect difference between neighboring segments
    curve: 0,         // curvature of spending across segments without the membership
    effect: 10,       // average effect over the four segments
    base: 40,         // average spending without the membership
    step: 10,         // spending rise from one segment to the next (straight part)
    sd: 10,           // standard deviation of spending inside a segment
    seed: 1,
  };
  const SEGMENTS = ['New', 'Occasional', 'Regular', 'Loyal'];

  function segmentTable(p) {
    const J = SEGMENTS.length, mid = (J - 1) / 2;
    return SEGMENTS.map((name, j) => {
      const c = j - mid;
      return {
        j, name,
        // Joining rises with the segment. The +1 makes most customers in the upper segments join, so the
        // shares are not symmetric around one half.
        share: 1 / (1 + Math.exp(-(p.selection * c + 1))),
        mean0: p.base + p.step * c + p.curve * (c * c - 1.25),
        effect: p.effect + p.hetero * c,
      };
    });
  }

  function simulateAdjust(params) {
    const p = Object.assign({}, ADJ_DEFAULTS, params);
    const seg = segmentTable(p), J = seg.length, nj = Math.floor(p.n / J), n = nj * J;
    const rng = CP.rng.makeRng(p.seed);
    const s = new Uint8Array(n), d = new Uint8Array(n), y0 = new Float64Array(n), y1 = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(i / nj);
      s[i] = j;
      const u = rng.uniform();
      y0[i] = seg[j].mean0 + p.sd * rng.normal();
      y1[i] = y0[i] + seg[j].effect;
      d[i] = u < seg[j].share ? 1 : 0;
      y[i] = d[i] ? y1[i] : y0[i];
    }
    return { params: p, seg, n, nj, s, d, y0, y1, y };
  }

  // Robust (HC1) standard errors keep the comparison fair across estimators.
  function olsCoef(X, y, k) {
    const fit = CP.stats.ols(X, y, { se: 'hc1' });
    return { est: fit.beta[k], se: fit.se[k] };
  }

  function estimateAdjust(sim) {
    const S = CP.stats, { n, s, d, y, seg } = sim, J = seg.length;
    const ya = Array.from(y);
    const treated = [], untreated = [];
    for (let i = 0; i < n; i++) (d[i] ? treated : untreated).push(y[i]);
    const naive = S.mean(treated) - S.mean(untreated);
    const naiveSe = Math.sqrt(S.variance(treated) / treated.length + S.variance(untreated) / untreated.length);
    // Cell counts and means by segment and treatment.
    const cell = seg.map(() => ({ n1: 0, n0: 0, s1: 0, s0: 0, q1: 0, q0: 0 }));
    for (let i = 0; i < n; i++) {
      const c = cell[s[i]];
      if (d[i]) { c.n1++; c.s1 += y[i]; c.q1 += y[i] * y[i]; } else { c.n0++; c.s0 += y[i]; c.q0 += y[i] * y[i]; }
    }
    // Stratification (imputation with a separate mean for each segment and group). The estimate needs at
    // least one member and one nonmember in every segment; its standard error needs at least two of each.
    let strat = 0, stratVar = 0, possible = true, withSe = true;
    const within = [];
    cell.forEach((c, j) => {
      if (c.n1 < 1 || c.n0 < 1) { possible = false; within.push(NaN); return; }
      const m1 = c.s1 / c.n1, m0 = c.s0 / c.n0;
      const w = (c.n1 + c.n0) / n;
      within.push(m1 - m0);
      strat += w * (m1 - m0);
      if (c.n1 < 2 || c.n0 < 2) { withSe = false; return; }
      const v1 = (c.q1 - c.n1 * m1 * m1) / (c.n1 - 1), v0 = (c.q0 - c.n0 * m0 * m0) / (c.n0 - 1);
      stratVar += w * w * (v1 / c.n1 + v0 / c.n0);
    });
    // One regression with a separate intercept for each segment and one treatment coefficient.
    let fe = { est: NaN, se: NaN }, line = { est: NaN, se: NaN };
    const anyBoth = cell.some(c => c.n1 > 0 && c.n0 > 0);
    if (anyBoth) {
      const X = [];
      for (let i = 0; i < n; i++) X.push([d[i], s[i] === 0 ? 1 : 0, s[i] === 1 ? 1 : 0, s[i] === 2 ? 1 : 0, s[i] === 3 ? 1 : 0]);
      try { fe = olsCoef(X, ya, 0); } catch (e) { fe = { est: NaN, se: NaN }; }
    }
    // One regression with a straight line in the segment number and one treatment coefficient.
    try {
      const X = [];
      for (let i = 0; i < n; i++) X.push([1, d[i], s[i]]);
      line = olsCoef(X, ya, 1);
    } catch (e) { line = { est: NaN, se: NaN }; }
    // Fixed effects weights: segment size times p(1 - p), with the shares in this sample.
    const om = cell.map(c => { const m = c.n1 + c.n0, q = c.n1 / m; return m * q * (1 - q); });
    const omSum = om.reduce((a, b) => a + b, 0);
    let ate = 0, att = 0, nt = 0;
    for (let i = 0; i < n; i++) {
      const e = sim.y1[i] - sim.y0[i];
      ate += e;
      if (d[i]) { att += e; nt++; }
    }
    return {
      naive: { est: naive, se: naiveSe },
      line, fe,
      strat: possible ? { est: strat, se: withSe ? Math.sqrt(stratVar) : NaN } : { est: NaN, se: NaN },
      possible, withSe, within, cell,
      feWeights: om.map(v => v / omSum), sizeWeights: cell.map(c => (c.n1 + c.n0) / n),
      ate: ate / n, att: nt ? att / nt : NaN,
    };
  }

  // ---- Part 2: good and bad controls in linear causal models ----

  const DAG_DEFAULTS = {
    structure: 'confounder',
    strength: 0.6,    // strength of the arrows that involve Z (and the hidden variables)
    n: 500,           // stores per sample
    reps: 400,        // repeated samples
    effect: 1,        // true effect of advertising on sales
    hidden: 0.6,      // strength of the hidden confounder in the bias-amplification case
    seed: 1,
  };
  const STRUCTURES = ['confounder', 'mediator', 'collider', 'mbias', 'outcomeCause', 'treatmentCause', 'amplify'];

  // One store: draws Z, D, Y (and hidden variables) for the chosen structure and writes them to out.
  // The true effect of D on Y is p.effect in every structure (for the mediator, it is the total effect).
  function drawStore(p, rng, out) {
    const a = p.strength, b = p.effect;
    let z, d, y;
    switch (p.structure) {
      case 'confounder': z = rng.normal(); d = a * z + rng.normal(); y = b * d + a * z + rng.normal(); break;
      case 'mediator': d = rng.normal(); z = a * d + rng.normal(); y = (b - a * a) * d + a * z + rng.normal(); break;
      case 'collider': d = rng.normal(); y = b * d + rng.normal(); z = a * d + a * y + rng.normal(); break;
      case 'mbias': {
        const u1 = rng.normal(), u2 = rng.normal();
        d = a * u1 + rng.normal(); z = a * u1 + a * u2 + rng.normal(); y = b * d + a * u2 + rng.normal();
        break;
      }
      case 'outcomeCause': z = rng.normal(); d = rng.normal(); y = b * d + a * z + rng.normal(); break;
      case 'treatmentCause': z = rng.normal(); d = a * z + rng.normal(); y = b * d + rng.normal(); break;
      case 'amplify': {
        const u = rng.normal();
        z = rng.normal(); d = a * z + p.hidden * u + rng.normal(); y = b * d + p.hidden * u + rng.normal();
        break;
      }
      default: throw new Error('unknown structure ' + p.structure);
    }
    out = out || [0, 0, 0];
    out[0] = z; out[1] = d; out[2] = y;
    return out;
  }

  // OLS of Y on D, and of Y on D and Z, from centered sums. Classical standard errors.
  function fitSample(z, d, y) {
    const n = y.length, S = CP.stats;
    const mz = S.mean(z), md = S.mean(d), my = S.mean(y);
    let dd = 0, zz = 0, dz = 0, dy = 0, zy = 0, yy = 0;
    for (let i = 0; i < n; i++) {
      const a = d[i] - md, c = z[i] - mz, e = y[i] - my;
      dd += a * a; zz += c * c; dz += a * c; dy += a * e; zy += c * e; yy += e * e;
    }
    const b1 = dy / dd;
    const r1 = yy - b1 * dy;
    const se1 = Math.sqrt(r1 / (n - 2) / dd);
    const det = dd * zz - dz * dz;
    const b2 = (zz * dy - dz * zy) / det, g2 = (dd * zy - dz * dy) / det;
    const r2 = yy - b2 * dy - g2 * zy;
    const se2 = Math.sqrt(r2 / (n - 3) * zz / det);
    return { without: { est: b1, se: se1 }, with: { est: b2, se: se2 } };
  }

  function replicateDag(params) {
    const p = Object.assign({}, DAG_DEFAULTS, params);
    const rng = CP.rng.makeRng(p.seed);
    const z = new Float64Array(p.n), d = new Float64Array(p.n), y = new Float64Array(p.n);
    const out = { without: [], with: [] }, cover = { without: 0, with: 0 }, se = { without: [], with: [] };
    let first = null;
    const v = [0, 0, 0];
    for (let r = 0; r < p.reps; r++) {
      for (let i = 0; i < p.n; i++) { drawStore(p, rng, v); z[i] = v[0]; d[i] = v[1]; y[i] = v[2]; }
      const f = fitSample(z, d, y);
      if (!first) first = f;
      for (const k of ['without', 'with']) {
        out[k].push(f[k].est); se[k].push(f[k].se);
        if (Math.abs(f[k].est - p.effect) <= 1.96 * f[k].se) cover[k]++;
      }
    }
    const S = CP.stats, summary = {};
    for (const k of ['without', 'with']) {
      const a = out[k];
      summary[k] = { mean: S.mean(a), sd: S.sd(a), lo: S.quantile(a, 0.025), hi: S.quantile(a, 0.975),
        meanSe: S.mean(se[k]), cover: cover[k] / p.reps, bias: S.mean(a) - p.effect };
    }
    return { params: p, summary, first, truth: p.effect };
  }

  // Bias of each regression in large samples, from the linear model (unit noise variances).
  function limitBias(params) {
    const p = Object.assign({}, DAG_DEFAULTS, params);
    const a = p.strength, b = p.effect, h = p.hidden;
    switch (p.structure) {
      case 'confounder': return { without: a * a / (a * a + 1), with: 0 };
      case 'mediator': return { without: 0, with: -a * a };
      case 'collider': {
        // Population covariances of (D, Z, Y): D ~ N(0,1), Y = bD + e, Z = aD + aY + e.
        const vd = 1, vy = b * b + 1, cdy = b, vz = a * a * vd + a * a * vy + 2 * a * a * cdy + 1;
        const cdz = a * vd + a * cdy, czy = a * cdy + a * vy;
        const est = (vz * cdy - cdz * czy) / (vd * vz - cdz * cdz);
        return { without: 0, with: est - b };
      }
      case 'mbias': {
        const vd = a * a + 1, vz = 2 * a * a + 1, cdz = a * a, cdy = b * vd, czy = b * cdz + a * a;
        const est = (vz * cdy - cdz * czy) / (vd * vz - cdz * cdz);
        return { without: 0, with: est - b };
      }
      case 'outcomeCause': return { without: 0, with: 0 };
      case 'treatmentCause': return { without: 0, with: 0 };
      case 'amplify': return { without: h * h / (a * a + h * h + 1), with: h * h / (h * h + 1) };
      default: throw new Error('unknown structure ' + p.structure);
    }
  }

  CP.controls = { ADJ_DEFAULTS, SEGMENTS, segmentTable, simulateAdjust, estimateAdjust,
    DAG_DEFAULTS, STRUCTURES, drawStore, fitSample, replicateDag, limitBias };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.controls;
})(typeof window !== 'undefined' ? window : globalThis);
