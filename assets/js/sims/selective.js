// Module 4: selective labels. Judges decide who is released before trial, and the
// data show failure to appear (FTA) only for released defendants. The simulation
// keeps every defendant's outcome if released, so it knows the true failure rates.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  const DEFAULTS = {
    nJudges: 5,          // judges
    casesPerJudge: 2400, // cases heard by each judge
    base: -1.6,          // intercept of the FTA log-odds
    bZ: 1,               // how strongly the judge-only information z predicts FTA
    wZ: 1,               // how much judges use z when they decide
    judgeNoise: 1,       // standard deviation of noise in the judges' view of risk
    strictRate: 0.55,    // release rate of the strictest judge
    lenient: 0.9,        // release rate of the most lenient judge
    evalRate: 0.85,      // release rate for the readouts
    seed: 1,
  };

  function simulate(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const S = CP.stats, rng = CP.rng.makeRng(p.seed);
    const N = p.nJudges * p.casesPerJudge;
    // x is recorded in the data. z is seen only by the judge. y is the outcome if released.
    // s is the risk as the judges see it. The noise eta belongs to the case, not to the judge,
    // so every judge would rank the same defendants in the same order.
    // The number of draws does not depend on the sliders, so a slider move keeps the same people.
    const people = [];
    for (let i = 0; i < N; i++) {
      const x = rng.normal(), z = rng.normal(), eta = rng.normal();
      const risk = S.logistic(p.base + x + p.bZ * z);
      people.push({ x, z, eta, s: x + p.wZ * z + p.judgeNoise * eta, risk, y: rng.bernoulli(risk), judge: -1, released: false });
    }
    // Random assignment: shuffle the cases, then give each judge an equal block.
    const order = rng.shuffle(people.map((_, i) => i));
    const judges = [];
    for (let j = 0; j < p.nJudges; j++) {
      const target = p.strictRate + (p.lenient - p.strictRate) * j / (p.nJudges - 1);
      const cases = order.slice(j * p.casesPerJudge, (j + 1) * p.casesPerJudge);
      // The judge releases the cases with the lowest risk as the judge sees it.
      const ranked = cases.slice().sort((a, b) => people[a].s - people[b].s);
      const nRel = Math.round(target * cases.length);
      ranked.forEach((i, k) => { people[i].judge = j; people[i].released = k < nRel; });
      judges.push({ cases, nReleased: nRel, rate: nRel / cases.length });
    }
    return { params: p, people, judges };
  }

  // Contraction on the caseload of the most lenient judge q (Lakkaraju et al. 2017).
  // Start from q's released cases and detain the highest predicted risks first,
  // until the release rate falls to r. Everyone q detained stays detained.
  // Returns a function of r. It gives null above q's release rate.
  function contraction(sim, score) {
    const people = sim.people;
    const q = sim.judges.reduce((a, b) => (b.rate > a.rate ? b : a));
    const D = q.cases.length;
    const R = q.cases.filter(i => people[i].released).sort((a, b) => score[b] - score[a]);
    // tail[k]: FTA cases among R[k], R[k + 1], ... (all observed, because q released them).
    const tail = new Array(R.length + 1).fill(0);
    for (let k = R.length - 1; k >= 0; k--) tail[k] = tail[k + 1] + people[R[k]].y;
    return function (r) {
      if (r > q.rate + 1e-9) return null;
      const extra = Math.round((1 - r) * D) - (D - R.length);
      return { failure: tail[extra] / D, rate: (R.length - extra) / D, extra, kept: R.slice(extra), caseload: q.cases };
    };
  }

  // Principal strata for the strictest judge and the most lenient judge (simulation only).
  // Each judge would release the same share of all N defendants as of the judge's own cases:
  // those with the lowest s. Both judges rank by the same s, so nobody is released only by
  // the strict judge. group[i] is 0 (released by both), 1 (released only by the lenient
  // judge), or 2 (detained by both). risk is the average true risk of FTA if released.
  function strata(sim) {
    const people = sim.people, N = people.length;
    const rates = sim.judges.map(J => J.rate);
    const strictRate = Math.min.apply(null, rates), lenientRate = Math.max.apply(null, rates);
    const order = people.map((_, i) => i).sort((a, b) => people[a].s - people[b].s);
    const cut = [0, Math.round(strictRate * N), Math.round(lenientRate * N), N];
    const group = new Array(N);
    const groups = [0, 1, 2].map(g => {
      let sum = 0;
      for (let k = cut[g]; k < cut[g + 1]; k++) { group[order[k]] = g; sum += people[order[k]].risk; }
      const n = cut[g + 1] - cut[g];
      return { n, share: n / N, risk: n ? sum / n : null };
    });
    return { strictRate, lenientRate, group, bothReleased: groups[0], lenientOnly: groups[1], bothDetained: groups[2] };
  }

  function estimate(sim) {
    const S = CP.stats, p = sim.params, people = sim.people, N = people.length;

    // Model: logistic regression of FTA on x, fit on released defendants only.
    const rel = people.filter(d => d.released);
    const beta = S.logitFit(rel.map(d => [1, d.x]), rel.map(d => d.y));
    const score = people.map(d => S.logistic(beta[0] + beta[1] * d.x));

    // Model rule: release the share r of all defendants with the lowest score.
    // Running sums along that order give every release rate at once.
    // The truth uses every outcome (simulation only). The naive evaluation uses the
    // observed outcome for people the judges released and the score for people they detained.
    const byScore = people.map((_, i) => i).sort((a, b) => score[a] - score[b]);
    const sumTrue = [0], sumNaive = [0];
    for (const i of byScore) {
      const d = people[i];
      sumTrue.push(sumTrue[sumTrue.length - 1] + d.y);
      sumNaive.push(sumNaive[sumNaive.length - 1] + (d.released ? d.y : score[i]));
    }
    // Failure rate: FTA cases divided by all defendants, released or not.
    const modelRule = r => {
      const k = Math.round(r * N);
      return { truth: sumTrue[k] / N, naive: sumNaive[k] / N };
    };
    const contract = contraction(sim, score);

    const curves = [];
    for (let k = 50; k <= 100; k++) {
      const r = k / 100, m = modelRule(r), c = contract(r);
      curves.push({ rate: r, truth: m.truth, naive: m.naive, contraction: c ? c.failure : null });
    }

    // Judges: FTA among each judge's released cases divided by the judge's whole caseload.
    const judges = sim.judges.map((J, j) => {
      let fta = 0;
      for (const i of J.cases) if (people[i].released) fta += people[i].y;
      const m = modelRule(J.rate), c = contract(J.rate);
      return { judge: j + 1, rate: J.rate, failure: fta / J.cases.length,
        contraction: c ? c.failure : null, naive: m.naive, truth: m.truth };
    });

    // Readouts at the chosen release rate.
    const r = p.evalRate, m = modelRule(r), c = contract(r);
    let contr = null;
    if (c) {
      // True failure rate of the contraction rule: every outcome on q's caseload,
      // counted for the people the rule releases.
      const keep = new Set(c.kept);
      let fta = 0;
      for (const i of c.caseload) if (keep.has(i)) fta += people[i].y;
      contr = { estimate: c.failure, truth: fta / c.caseload.length, extra: c.extra, caseload: c.caseload.length };
    }

    // Defendants the judges detained: the model's predicted risk versus their true risk.
    const pred = [], truth = [];
    people.forEach((d, i) => { if (!d.released) { pred.push(score[i]); truth.push(d.risk); } });
    const detained = { n: pred.length, predicted: S.mean(pred), truth: S.mean(truth) };

    return {
      beta, curves, judges, detained, strata: strata(sim),
      lenientRate: Math.max.apply(null, judges.map(j => j.rate)),
      atRate: { rate: r, naive: m.naive, truth: m.truth, gap: m.naive - m.truth, contraction: contr },
    };
  }

  CP.selective = { DEFAULTS, simulate, estimate, contraction, strata };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.selective;
})(typeof window !== 'undefined' ? window : globalThis);
