// Module 9: Neyman's repeated-sampling view of an experiment, and block randomization.
// The simulation keeps both potential outcomes of every customer, so it knows the true effects.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  const DEFAULTS = {
    n: 100,          // customers in the experiment
    share: 0.5,      // share of customers who get the offer
    spread: 20,      // standard deviation of the individual effects
    effect: 10,      // average effect in the population
    base: 40,        // average spending without the offer
    sd: 10,          // standard deviation of spending without the offer
    target: 'sate',  // 'sate': same customers, new coin flips; 'pate': new customers each time
    reps: 1000,      // coin flips (or new samples) per redraw
    seed: 1,
  };

  const BLOCK_DEFAULTS = {
    n: 200,          // customers, split evenly into four segments
    gap: 15,         // difference in average spending between neighboring segments
    shareStep: 0,    // extra treated share from one segment to the next (segment 1 has 0.5)
    effectStep: 0,   // difference in the effect between neighboring segments
    effect: 10,      // average effect over the four segments
    base: 40,        // average spending without the offer, over the four segments
    sd: 10,          // standard deviation of spending inside a segment
    reps: 2000,
    seed: 1,
  };
  const SEGMENTS = ['New', 'Occasional', 'Regular', 'Loyal'];

  function groupSizes(n, share) {
    const n1 = Math.min(n - 2, Math.max(2, Math.round(share * n)));
    return { n1, n0: n - n1 };
  }

  // Customers with both potential outcomes. Effects vary around the average, independently of Y(0).
  function drawUnits(p, rng) {
    const y0 = new Float64Array(p.n), y1 = new Float64Array(p.n);
    for (let i = 0; i < p.n; i++) {
      y0[i] = p.base + p.sd * rng.normal();
      y1[i] = y0[i] + p.effect + p.spread * rng.normal();
    }
    return { y0, y1 };
  }

  function simulateUnits(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const u = drawUnits(p, CP.rng.makeRng(p.seed));
    return Object.assign({ params: p }, groupSizes(p.n, p.share), u);
  }

  // Exact finite-sample quantities for the customers in the sample (n - 1 divisors).
  function finite(units) {
    const S = CP.stats, n = units.y0.length;
    const tau = Array.from(units.y1, (v, i) => v - units.y0[i]);
    const S1 = S.variance(Array.from(units.y1)), S0 = S.variance(Array.from(units.y0)), St = S.variance(tau);
    const { n1, n0 } = units;
    return {
      sate: S.mean(tau), S1, S0, St,
      term1: S1 / n1, term0: S0 / n0, termTau: St / n,
      variance: S1 / n1 + S0 / n0 - St / n,
      neymanExpected: S1 / n1 + S0 / n0,
    };
  }

  // Difference in means, its Neyman standard error, and the classical OLS standard error,
  // for one assignment given as an array of 0/1.
  function estimateOnce(y0, y1, d) {
    let n1 = 0, s1 = 0, q1 = 0, n0 = 0, s0 = 0, q0 = 0;
    for (let i = 0; i < d.length; i++) {
      if (d[i]) { const v = y1[i]; n1++; s1 += v; q1 += v * v; }
      else { const v = y0[i]; n0++; s0 += v; q0 += v * v; }
    }
    const m1 = s1 / n1, m0 = s0 / n0;
    const ss1 = Math.max(0, q1 - n1 * m1 * m1), ss0 = Math.max(0, q0 - n0 * m0 * m0);
    const est = m1 - m0;
    const neyman = Math.sqrt(ss1 / (n1 - 1) / n1 + ss0 / (n0 - 1) / n0);
    const classical = Math.sqrt((ss1 + ss0) / (n1 + n0 - 2) * (1 / n1 + 1 / n0));
    return { est, neyman, classical, m1, m0 };
  }

  function shuffleAssign(d, n1, rng, idx) {
    const n = d.length;
    for (let j = 0; j < n1; j++) {
      const t = j + rng.int(n - j);
      const tmp = idx[j]; idx[j] = idx[t]; idx[t] = tmp;
    }
    d.fill(0);
    for (let j = 0; j < n1; j++) d[idx[j]] = 1;
  }

  // Repeat the experiment. SATE: the same customers, a new random assignment each time.
  // PATE: new customers from the population and a new random assignment each time.
  function replicate(params) {
    const units = simulateUnits(params);
    const p = units.params, n = p.n, { n1, n0 } = units;
    const rng = CP.rng.makeRng((Math.imul(p.seed, 2654435761) ^ 0x2545f491) >>> 0);
    const d = new Uint8Array(n), idx = Array.from({ length: n }, (_, i) => i);
    const est = new Float64Array(p.reps), neyman = new Float64Array(p.reps), classical = new Float64Array(p.reps);
    const fin = finite(units);
    const pate = p.target === 'pate';
    const truth = pate ? p.effect : fin.sate;
    let coverN = 0, coverC = 0;
    for (let r = 0; r < p.reps; r++) {
      let y0 = units.y0, y1 = units.y1;
      if (pate) { const u = drawUnits(p, rng); y0 = u.y0; y1 = u.y1; }
      shuffleAssign(d, n1, rng, idx);
      const e = estimateOnce(y0, y1, d);
      est[r] = e.est; neyman[r] = e.neyman; classical[r] = e.classical;
      if (Math.abs(e.est - truth) <= 1.96 * e.neyman) coverN++;
      if (Math.abs(e.est - truth) <= 1.96 * e.classical) coverC++;
    }
    const S = CP.stats, a = Array.from(est);
    const popVar1 = p.sd * p.sd + p.spread * p.spread, popVar0 = p.sd * p.sd;
    return {
      params: p, units, n1, n0, finite: fin, truth,
      est, neyman, classical,
      meanEst: S.mean(a), sdEst: S.sd(a),
      meanNeyman: S.mean(Array.from(neyman)), meanClassical: S.mean(Array.from(classical)),
      coverNeyman: coverN / p.reps, coverClassical: coverC / p.reps,
      // The true standard deviation of the estimate under the chosen view of repeated sampling.
      trueSd: Math.sqrt(pate ? popVar1 / n1 + popVar0 / n0 : fin.variance),
      popTerm1: popVar1 / n1, popTerm0: popVar0 / n0,
    };
  }

  // ---- Block randomization ----

  function blockDesign(p) {
    const J = SEGMENTS.length, nj = Math.floor(p.n / J);
    const seg = [];
    for (let j = 0; j < J; j++) {
      const share = Math.min(0.95, 0.5 + p.shareStep * j / (J - 1));
      const n1 = Math.min(nj - 2, Math.max(2, Math.round(share * nj)));
      seg.push({ j, name: SEGMENTS[j], size: nj, n1, n0: nj - n1, share: n1 / nj,
        mean0: p.base + p.gap * (j - (J - 1) / 2), effect: p.effect + p.effectStep * (j - (J - 1) / 2) });
    }
    const n = nj * J;
    const fe = seg.map(s => s.size * s.share * (1 - s.share));
    const feSum = fe.reduce((a, b) => a + b, 0);
    seg.forEach((s, j) => { s.wBlock = s.size / n; s.wFe = fe[j] / feSum; });
    return { seg, n, nj };
  }

  function simulateBlocks(params) {
    const p = Object.assign({}, BLOCK_DEFAULTS, params);
    const design = blockDesign(p);
    const rng = CP.rng.makeRng(p.seed);
    const y0 = new Float64Array(design.n), y1 = new Float64Array(design.n), block = new Uint8Array(design.n);
    let k = 0;
    for (const s of design.seg) {
      for (let i = 0; i < s.size; i++, k++) {
        block[k] = s.j;
        y0[k] = s.mean0 + p.sd * rng.normal();
        y1[k] = y0[k] + s.effect;
      }
    }
    let sate = 0;
    for (let i = 0; i < design.n; i++) sate += y1[i] - y0[i];
    return { params: p, design, y0, y1, block, sate: sate / design.n };
  }

  // Estimators for one block-randomized assignment d.
  function blockEstimates(sim, d) {
    const seg = sim.design.seg, J = seg.length;
    const s1 = new Float64Array(J), s0 = new Float64Array(J), c1 = new Float64Array(J), c0 = new Float64Array(J);
    let t1 = 0, t0 = 0, m1 = 0, m0 = 0;
    for (let i = 0; i < d.length; i++) {
      const j = sim.block[i];
      if (d[i]) { s1[j] += sim.y1[i]; c1[j]++; t1 += sim.y1[i]; m1++; }
      else { s0[j] += sim.y0[i]; c0[j]++; t0 += sim.y0[i]; m0++; }
    }
    let block = 0, feNum = 0, feDen = 0;
    const within = [];
    for (let j = 0; j < J; j++) {
      const tj = s1[j] / c1[j] - s0[j] / c0[j];
      within.push(tj);
      block += seg[j].wBlock * tj;
      const w = (c1[j] + c0[j]) * (c1[j] / (c1[j] + c0[j])) * (c0[j] / (c1[j] + c0[j]));
      feNum += w * tj; feDen += w;
    }
    return { pooled: t1 / m1 - t0 / m0, block, fe: feNum / feDen, within };
  }

  // Repeat the experiment on the same customers under two designs:
  // complete randomization of the same total number of treated customers, and block randomization.
  function replicateBlocks(params) {
    const sim = simulateBlocks(params);
    const p = sim.params, n = sim.design.n, seg = sim.design.seg;
    const rng = CP.rng.makeRng((Math.imul(p.seed, 2654435761) ^ 0x68e31da4) >>> 0);
    const n1Total = seg.reduce((a, s) => a + s.n1, 0);
    const d = new Uint8Array(n), idx = Array.from({ length: n }, (_, i) => i);
    const out = { complete: [], pooled: [], block: [], fe: [] };
    // Index ranges of the segments (customers are stored segment by segment).
    const starts = [];
    let k = 0;
    for (const s of seg) { starts.push(k); k += s.size; }
    const segIdx = seg.map((s, j) => Array.from({ length: s.size }, (_, i) => starts[j] + i));
    for (let r = 0; r < p.reps; r++) {
      shuffleAssign(d, n1Total, rng, idx);
      out.complete.push(estimateOnce(sim.y0, sim.y1, d).est);
      d.fill(0);
      seg.forEach((s, j) => {
        const ids = segIdx[j];
        for (let a = 0; a < s.n1; a++) {
          const t = a + rng.int(s.size - a);
          const tmp = ids[a]; ids[a] = ids[t]; ids[t] = tmp;
        }
        for (let a = 0; a < s.n1; a++) d[ids[a]] = 1;
      });
      const e = blockEstimates(sim, d);
      out.pooled.push(e.pooled); out.block.push(e.block); out.fe.push(e.fe);
    }
    const S = CP.stats, summary = {};
    for (const key of Object.keys(out)) {
      const a = out[key];
      summary[key] = { mean: S.mean(a), sd: S.sd(a), lo: S.quantile(a, 0.025), hi: S.quantile(a, 0.975) };
      summary[key].bias = summary[key].mean - sim.sate;
    }
    // What the fixed effects regression targets: the effects weighted by the fixed effects weights.
    const feTarget = seg.reduce((a, s) => a + s.wFe * s.effect, 0);
    return { sim, summary, draws: out, feTarget };
  }

  CP.neyman = { DEFAULTS, BLOCK_DEFAULTS, SEGMENTS, groupSizes, simulateUnits, finite, estimateOnce, replicate,
    blockDesign, simulateBlocks, blockEstimates, replicateBlocks };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.neyman;
})(typeof window !== 'undefined' ? window : globalThis);
