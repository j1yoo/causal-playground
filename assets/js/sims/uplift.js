// Module 5: whom should a retention offer target? Ranking customers by predicted
// churn risk versus by predicted uplift. The outcome is churn (1 = the customer leaves).
// The CATE of the offer on churn is tau(x) = p1(x) - p0(x). The page reports the uplift
// u(x) = p0(x) - p1(x) = -tau(x): churn probability without the offer minus churn probability
// with the offer, so a positive uplift means that the offer keeps customers.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  // Default link -0.1: in each of 40 page samples, risk targeting then prevents more churners
  // than random targeting and far fewer than uplift targeting (tests check 20 of them).
  const DEFAULTS = {
    rho: -0.1,     // correlation between x1 (drives churn risk) and x2 (drives response to the offer)
    d0: 0.5,       // average strength of the offer: drop in the log odds of churn
    d1: 0.8,       // how much the strength changes with x2
    budget: 0.2,   // share of new customers the firm can target
    nPilot: 4000,  // customers in the randomized pilot
    nPop: 20000,   // new customers the firm ranks and targets
    nShow: 800,    // new customers shown in the scatter
    seed: 1,
  };
  const A = -1.2, B = 1.2;  // log odds of churn without the offer: A + B * x1

  // One customer: two characteristics and the churn probabilities without and with the offer.
  function customer(rng, p) {
    const x1 = rng.normal(0, 1);
    const x2 = p.rho * x1 + Math.sqrt(1 - p.rho * p.rho) * rng.normal(0, 1);
    const z = A + B * x1;
    const p0 = CP.stats.logistic(z);
    const p1 = CP.stats.logistic(z - (p.d0 + p.d1 * x2));
    return { x1, x2, p0, p1, uplift: p0 - p1 };
  }

  function simulate(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const rng = CP.rng.makeRng(p.seed);
    // New customers come first, so a change in the pilot size does not change them.
    const pop = [];
    for (let i = 0; i < p.nPop; i++) pop.push(customer(rng, p));
    // Pilot: a coin flip decides who gets the offer. We see churn only under that choice.
    const pilot = [];
    for (let i = 0; i < p.nPilot; i++) {
      const c = customer(rng, p);
      const offer = rng.uniform() < 0.5;
      pilot.push({ x1: c.x1, x2: c.x2, offer, churn: rng.uniform() < (offer ? c.p1 : c.p0) ? 1 : 0 });
    }
    return { params: p, pop, pilot };
  }

  // Logistic regression of churn on (1, x1, x2) in one arm of the pilot.
  function fitArm(pilot, offer) {
    const rows = pilot.filter(c => c.offer === offer);
    return CP.stats.logitFit(rows.map(c => [1, c.x1, c.x2]), rows.map(c => c.churn));
  }

  // Customer indices sorted from the highest to the lowest score.
  function rank(score) {
    return score.map((_, i) => i).sort((a, b) => score[b] - score[a]);
  }

  function estimate(sim) {
    const S = CP.stats, p = sim.params, pop = sim.pop, N = pop.length;
    // Two-model approach: one churn model per pilot arm. Predicted risk comes from the no-offer model.
    const bNo = fitArm(sim.pilot, false), bYes = fitArm(sim.pilot, true);
    const prob = (b, c) => S.logistic(b[0] + b[1] * c.x1 + b[2] * c.x2);
    const risk = pop.map(c => prob(bNo, c));
    const predUplift = pop.map((c, i) => risk[i] - prob(bYes, c));
    const trueUplift = pop.map(c => c.uplift);
    const order = { uplift: rank(predUplift), risk: rank(risk), best: rank(trueUplift) };

    // Churners prevented per 1,000 new customers: running sum of true uplift down each ranking.
    const run = {};
    for (const key in order) {
      const r = [0];
      for (let j = 0; j < N; j++) r.push(r[j] + trueUplift[order[key][j]] * 1000 / N);
      run[key] = r;
    }
    const total = run.best[N];  // the result of targeting everyone, the same for every ranking

    // Curves at every 1% of customers targeted. Random targeting is a straight line in expectation.
    const shares = [], curves = { uplift: [], risk: [], random: [], best: [] };
    for (let s = 0; s <= 100; s++) {
      const j = Math.round(s / 100 * N);
      shares.push(s / 100);
      curves.uplift.push(run.uplift[j]);
      curves.risk.push(run.risk[j]);
      curves.random.push(total * j / N);
      curves.best.push(run.best[j]);
    }

    // Results at the budget: the top k customers of each ranking get the offer.
    const k = Math.round(p.budget * N);
    const avgRiskTop = key => S.mean(order[key].slice(0, k).map(i => pop[i].p0));
    const picked = key => { const f = new Uint8Array(N); for (let j = 0; j < k; j++) f[order[key][j]] = 1; return f; };
    const byUplift = picked('uplift'), byRisk = picked('risk');
    let both = 0;
    for (let i = 0; i < N; i++) both += byUplift[i] & byRisk[i];
    const shown = pop.slice(0, p.nShow).map((c, i) => ({
      risk: c.p0, uplift: c.uplift, byUplift: byUplift[i] === 1, byRisk: byRisk[i] === 1,
    }));

    return {
      coef: { noOffer: bNo, offer: bYes },
      trueCoef: { noOffer: [A, B, 0], offer: [A - p.d0, B, -p.d1] },
      shares, curves, total, k,
      prevented: { uplift: run.uplift[k], risk: run.risk[k], random: total * k / N, best: run.best[k] },
      avgRisk: { uplift: avgRiskTop('uplift'), risk: avgRiskTop('risk'), random: S.mean(pop.map(c => c.p0)), best: avgRiskTop('best') },
      overlap: both / k,                         // share of the targeted customers that both rules pick
      shareNegative: S.mean(trueUplift.map(u => (u < 0 ? 1 : 0))),  // the offer raises churn for these
      shown,
    };
  }

  CP.uplift = { DEFAULTS, simulate, estimate };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.uplift;
})(typeof window !== 'undefined' ? window : globalThis);
