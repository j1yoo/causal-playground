// Module 4: principal strata. A job training program can change who has a job,
// and a wage exists only for a person with a job. The simulation keeps every person's
// employment and wage with and without training, so it knows each principal stratum.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  const DEFAULTS = {
    n: 2000,       // people in the experiment; a coin flip assigns training
    tau: 1,        // true effect of training on the wage of people employed either way
    helped: 0.3,   // share of people whom training helps get a job
    slope: 3,      // wage points per standard deviation of job readiness
    noise: 3,      // standard deviation of the wage noise
    seed: 1,
  };
  const BASE_RATE = 0.5;        // share employed without training
  const SD_UNIFORM = Math.sqrt(12); // readiness r is uniform on [0, 1]; (r - 0.5) * SD_UNIFORM has SD 1

  // Strata by the pair (employed without training, employed with training).
  const STRATA = ['always', 'helped', 'never'];

  function simulate(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const rng = CP.rng.makeRng(p.seed);
    const people = [];
    for (let i = 0; i < p.n; i++) {
      // The number of draws per person never depends on the sliders,
      // so a slider move changes the data only through that slider.
      const r = rng.uniform(), e = rng.normal(), d = rng.uniform() < 0.5 ? 1 : 0;
      // Training lowers the readiness needed for a job. It never costs anyone a job.
      const s0 = r > BASE_RATE ? 1 : 0;
      const s1 = r > BASE_RATE - p.helped ? 1 : 0;
      const stratum = s0 ? 'always' : s1 ? 'helped' : 'never';
      // Wages exist only with a job. y0 and y1 are the wages without and with training.
      const z = (r - 0.5) * SD_UNIFORM;
      const y0 = 20 + p.slope * z + p.noise * e;
      const y1 = y0 + p.tau;
      const s = d ? s1 : s0;
      people.push({ r, z, d, s0, s1, s, stratum, y0, y1, y: s ? (d ? y1 : y0) : null });
    }
    return { params: p, people };
  }

  const mean = a => CP.stats.mean(a);

  // Lee (2009) bounds for the effect among people employed either way. They need monotonicity:
  // training can only add jobs (or only remove them). Trim the group with the higher employment
  // share by the share of extra workers, from the top for one bound and from the bottom for the other.
  function leeBounds(wT, wC, qT, qC) {
    if (!wT.length || !wC.length) return { lower: NaN, upper: NaN, trim: NaN, trimmed: 'none' };
    const sorted = a => a.slice().sort((x, y) => x - y);
    const trimMean = (a, share, fromTop) => {
      const k = Math.round(share * a.length);
      const s = sorted(a);
      const kept = fromTop ? s.slice(0, s.length - k) : s.slice(k);
      return mean(kept);
    };
    if (qT >= qC) {
      const share = qT > 0 ? (qT - qC) / qT : 0;
      return { lower: trimMean(wT, share, true) - mean(wC), upper: trimMean(wT, share, false) - mean(wC), trim: share, trimmed: 'training' };
    }
    const share = qC > 0 ? (qC - qT) / qC : 0;
    return { lower: mean(wT) - trimMean(wC, share, false), upper: mean(wT) - trimMean(wC, share, true), trim: share, trimmed: 'no training' };
  }

  function estimate(sim) {
    const S = CP.stats, ppl = sim.people;
    const T = ppl.filter(q => q.d === 1), C = ppl.filter(q => q.d === 0);
    const wT = T.filter(q => q.s).map(q => q.y), wC = C.filter(q => q.s).map(q => q.y);
    const qT = wT.length / T.length, qC = wC.length / C.length;

    // The comparison that real data allow: employed trained people against employed untrained people.
    const naive = mean(wT) - mean(wC);
    const se = Math.sqrt(S.variance(wT) / wT.length + S.variance(wC) / wC.length);

    // Simulation only: the effect among people employed either way, and the fair comparison
    // that keeps only the always-employed people in the training group.
    const always = ppl.filter(q => q.stratum === 'always');
    const truth = mean(always.map(q => q.y1 - q.y0));
    // Training never costs a job here, so the employed untrained people are all always-employed.
    const fairT = T.filter(q => q.stratum === 'always').map(q => q.y);
    const fair = mean(fairT) - mean(wC);

    const strata = {};
    for (const k of STRATA) {
      const g = ppl.filter(q => q.stratum === k);
      // Wage with training, which exists for the always-employed and the helped (simulation only).
      strata[k] = { share: g.length / ppl.length, wage1: g.length && k !== 'never' ? mean(g.map(q => q.y1)) : NaN };
    }

    const lee = leeBounds(wT, wC, qT, qC);
    return {
      qT, qC, nT: wT.length, nC: wC.length,
      meanT: mean(wT), meanC: mean(wC), meanTalways: mean(fairT),
      naive, se, ciLow: naive - 1.96 * se, ciHigh: naive + 1.96 * se,
      truth, error: naive - truth, fair, strata, lee,
      employed: ppl.filter(q => q.s).map(q => ({ d: q.d, y: q.y, stratum: q.stratum, r: q.r })),
    };
  }

  CP.strata = { DEFAULTS, BASE_RATE, STRATA, simulate, estimate, leeBounds };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.strata;
})(typeof window !== 'undefined' ? window : globalThis);
