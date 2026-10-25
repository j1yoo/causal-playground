const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('uplift.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);
const run = p => CP.uplift.estimate(CP.uplift.simulate(p));
const KEYS = ['uplift', 'risk', 'random', 'best'];
// A spread of settings, including a small pilot and an offer that raises churn for half of the customers.
const SETTINGS = [{}, { rho: -0.9, d1: 1.5 }, { rho: 0.9, d0: 1.5 }, { d0: 0 }, { d1: 0 }, { nPilot: 500, seed: 7 }];

test('uplift: with no effect of the offer every curve is exactly zero', () => {
  const e = run({ d0: 0, d1: 0, seed: 3 });
  for (const key of KEYS) for (const v of e.curves[key]) assert.equal(v, 0, key);
  assert.equal(e.total, 0);
  assert.equal(e.shareNegative, 0);
});

test('uplift: every curve starts at 0 and ends at the same total at 100% targeted', () => {
  for (const p of SETTINGS) {
    const sim = CP.uplift.simulate(p);
    const e = CP.uplift.estimate(sim);
    const total = 1000 * CP.stats.mean(sim.pop.map(c => c.uplift));
    close(e.total, total, 1e-9, 'total');
    for (const key of KEYS) {
      close(e.curves[key][0], 0, 0, key);
      close(e.curves[key][100], total, 1e-9, key);
    }
  }
});

test('uplift: the random curve is a straight line and the average of random orderings', () => {
  const sim = CP.uplift.simulate({ seed: 4 });
  const e = CP.uplift.estimate(sim);
  e.curves.random.forEach((v, j) => close(v, e.total * e.shares[j], 1e-9, 'share ' + e.shares[j]));
  // Monte Carlo: shuffle the customers many times and target the first 20%.
  const u = sim.pop.map(c => c.uplift), N = u.length, k = 0.2 * N;
  const rng = CP.rng.makeRng(99), idx = u.map((_, i) => i);
  let sum = 0;
  const R = 200;
  for (let r = 0; r < R; r++) {
    const order = rng.shuffle(idx);
    for (let j = 0; j < k; j++) sum += u[order[j]] * 1000 / N;
  }
  close(sum / R, e.curves.random[20], 0.1, 'average of random orderings');
});

test('uplift: the best possible curve is at or above every other curve at every share', () => {
  for (const p of SETTINGS) {
    const e = run(p);
    for (let j = 0; j < e.shares.length; j++) {
      for (const key of ['uplift', 'risk', 'random']) {
        assert.ok(e.curves.best[j] >= e.curves[key][j] - 1e-9, key + ' above best at share ' + e.shares[j]);
      }
      // Sorted from the highest true uplift down, each extra 1% adds no more than the 1% before it.
      if (j >= 2) assert.ok(e.curves.best[j] - e.curves.best[j - 1] <= e.curves.best[j - 1] - e.curves.best[j - 2] + 1e-9);
    }
  }
});

test('uplift: results at the budget match the curves', () => {
  for (const budget of [0.05, 0.2, 0.37, 0.6]) {
    const e = run({ budget, seed: 6 });
    const j = Math.round(budget * 100);
    for (const key of KEYS) close(e.prevented[key], e.curves[key][j], 1e-9, key + ' at ' + budget);
    assert.equal(e.k, Math.round(budget * 20000));
  }
});

test('uplift: with a strong negative link, uplift targeting beats risk targeting by a clear margin', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const e = run({ rho: -0.9, d1: 1.5, budget: 0.2, seed });
    assert.ok(e.prevented.uplift - e.prevented.risk > 40, 'seed ' + seed + ': ' + e.prevented.uplift + ' vs ' + e.prevented.risk);
    assert.ok(e.prevented.uplift > e.prevented.random && e.prevented.random > e.prevented.risk, 'seed ' + seed);
  }
});

test('uplift: risk targeting improves as the link rises from -0.9 to 0 to 0.9', () => {
  const e = [-0.9, 0, 0.9].map(rho => run({ rho, seed: 3 }));
  const risk = e.map(x => x.prevented.risk), overlap = e.map(x => x.overlap);
  assert.ok(risk[0] < risk[1] && risk[1] < risk[2], 'risk targeting ' + risk.join(' '));
  assert.ok(overlap[0] < overlap[1] && overlap[1] < overlap[2], 'overlap ' + overlap.join(' '));
});

test('uplift: a very large pilot brings uplift targeting within 5% of the best possible', () => {
  const e = run({ nPilot: 200000, budget: 0.2, seed: 2 });
  assert.ok(e.prevented.uplift >= 0.95 * e.prevented.best, e.prevented.uplift + ' vs best ' + e.prevented.best);
});

test('uplift: the two-model fit recovers the true coefficients on a large pilot', () => {
  const e = run({ nPilot: 200000, rho: 0.3, d0: 0.7, d1: 1.1, seed: 5 });
  for (const arm of ['noOffer', 'offer']) {
    e.coef[arm].forEach((b, i) => close(b, e.trueCoef[arm][i], 0.05, arm + ' coefficient ' + i));
  }
  assert.deepEqual(e.trueCoef.offer, [-1.2 - 0.7, 1.2, -1.1]);
});

test('uplift: the pilot size does not change the new customers', () => {
  const a = CP.uplift.simulate({ nPilot: 500, seed: 8 });
  const b = CP.uplift.simulate({ nPilot: 4000, seed: 8 });
  assert.deepEqual(a.pop, b.pop);
  assert.deepEqual(a.pilot, b.pilot.slice(0, 500));
});

test('uplift: the new customers follow the data-generating process', () => {
  const S = CP.stats, logistic = z => 1 / (1 + Math.exp(-z));
  // 100,000 customers: the sample variance of x2 then has a standard deviation of about 0.0045.
  for (const rho of [-0.5, 0.9]) {
    const pop = CP.uplift.simulate({ rho, d0: 0.6, d1: 0.9, nPop: 100000, nPilot: 500, seed: 12 }).pop;
    const x1 = pop.map(c => c.x1), x2 = pop.map(c => c.x2), m1 = S.mean(x1), m2 = S.mean(x2);
    let cov = 0;
    for (let i = 0; i < pop.length; i++) cov += (x1[i] - m1) * (x2[i] - m2);
    close(cov / (pop.length - 1) / Math.sqrt(S.variance(x1) * S.variance(x2)), rho, 0.02, 'correlation of x1 and x2');
    close(S.variance(x2), 1, 0.03, 'variance of x2');
    for (const c of pop.slice(0, 50)) {
      close(c.p0, logistic(-1.2 + 1.2 * c.x1), 1e-12, 'p0');
      close(c.p1, logistic(-1.2 + 1.2 * c.x1 - (0.6 + 0.9 * c.x2)), 1e-12, 'p1');
      assert.equal(c.uplift, c.p0 - c.p1);
    }
  }
});

test('uplift: a coin flip gives about half of the pilot customers the offer', () => {
  // With 4,000 pilot customers the share has a standard deviation of about 0.008.
  for (const seed of [1, 2, 3]) {
    const share = CP.stats.mean(CP.uplift.simulate({ nPilot: 4000, seed }).pilot.map(c => (c.offer ? 1 : 0)));
    close(share, 0.5, 0.03, 'seed ' + seed);
  }
});

// The page's What to notice box was checked at these defaults. The HTML sliders use the same values.
test('uplift: the defaults are the settings that the page text describes', () => {
  const d = CP.uplift.DEFAULTS;
  assert.deepEqual({ rho: d.rho, d0: d.d0, d1: d.d1, budget: d.budget, nPilot: d.nPilot, nPop: d.nPop, nShow: d.nShow },
    { rho: -0.1, d0: 0.5, d1: 0.8, budget: 0.2, nPilot: 4000, nPop: 20000, nShow: 800 });
});

test('uplift: at the defaults, risk targeting beats random targeting but falls far behind uplift targeting', () => {
  // The first 20 samples that the page draws (seed 1, then steps of 7919).
  for (let s = 0; s < 20; s++) {
    const seed = 1 + 7919 * s, P = run({ seed }).prevented;
    assert.ok(P.risk - P.random > 1.5, 'seed ' + seed + ': risk ' + P.risk + ' vs random ' + P.random);
    assert.ok(P.uplift - P.risk > 15, 'seed ' + seed + ': uplift ' + P.uplift + ' vs risk ' + P.risk);
  }
});

test('uplift: a strongly negative link pushes risk targeting below random targeting and below zero', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const P = run({ rho: -0.9, seed }).prevented;
    assert.ok(P.risk < 0 && P.risk < P.random, 'seed ' + seed + ': risk ' + P.risk + ' vs random ' + P.random);
  }
});

test('uplift: a larger pilot gives a more precise churn model but leaves risk targeting where a perfect churn model is', () => {
  const S = CP.stats;
  // Mean absolute error of the predicted churn risk over the new customers.
  const riskError = (sim, e) => S.mean(sim.pop.map(c => Math.abs(S.logistic(e.coef.noOffer[0] + e.coef.noOffer[1] * c.x1 + e.coef.noOffer[2] * c.x2) - c.p0)));
  let small = 0, large = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const a = CP.uplift.simulate({ seed }), b = CP.uplift.simulate({ seed, nPilot: 20000 });
    const ea = CP.uplift.estimate(a), eb = CP.uplift.estimate(b);
    small += riskError(a, ea); large += riskError(b, eb);
    if (seed > 5) continue;
    // A perfect churn model ranks the new customers by their true churn risk without the offer.
    const pop = b.pop, N = pop.length, order = pop.map((_, i) => i).sort((i, j) => pop[j].p0 - pop[i].p0);
    let perfect = 0;
    for (let j = 0; j < eb.k; j++) perfect += pop[order[j]].uplift * 1000 / N;
    close(eb.prevented.risk, perfect, 3, 'seed ' + seed + ': risk targeting with a pilot of 20,000 vs a perfect churn model');
    assert.ok(perfect < 0.5 * eb.prevented.uplift, 'seed ' + seed + ': perfect churn model ' + perfect + ' vs uplift ' + eb.prevented.uplift);
    assert.ok(eb.prevented.risk < 0.5 * eb.prevented.uplift, 'seed ' + seed);
  }
  assert.ok(large < 0.8 * small, 'average error ' + large / 10 + ' with 20,000 pilot customers vs ' + small / 10 + ' with 4,000');
});

test('uplift: readouts and scatter flags match a direct recomputation from the fitted models', () => {
  const S = CP.stats, logistic = z => 1 / (1 + Math.exp(-z));
  for (const p of [{ seed: 1 }, { rho: 0.9, budget: 0.37, nPilot: 1000, seed: 5 }]) {
    const sim = CP.uplift.simulate(p);
    const e = CP.uplift.estimate(sim);
    const pop = sim.pop, N = pop.length, k = Math.round(sim.params.budget * N);
    // Predicted risk comes from the model without the offer. Predicted uplift is the difference of the two models.
    const pred = (b, c) => logistic(b[0] + b[1] * c.x1 + b[2] * c.x2);
    const risk = pop.map(c => pred(e.coef.noOffer, c));
    const predUplift = pop.map((c, i) => risk[i] - pred(e.coef.offer, c));
    const top = score => new Set(score.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, k).map(d => d[1]));
    const sets = { risk: top(risk), uplift: top(predUplift), best: top(pop.map(c => c.uplift)) };
    let both = 0;
    for (const i of sets.risk) if (sets.uplift.has(i)) both++;
    close(e.overlap, both / k, 1e-12, 'overlap');
    close(e.shareNegative, pop.filter(c => c.uplift < 0).length / N, 1e-12, 'share with negative uplift');
    close(e.avgRisk.random, S.mean(pop.map(c => c.p0)), 1e-12, 'average true churn risk of everyone');
    for (const key of ['risk', 'uplift', 'best']) {
      close(e.avgRisk[key], S.mean([...sets[key]].map(i => pop[i].p0)), 1e-12, 'average true churn risk, ' + key);
      close(e.prevented[key], [...sets[key]].reduce((s, i) => s + pop[i].uplift, 0) * 1000 / N, 1e-9, 'prevented, ' + key);
    }
    assert.equal(e.shown.length, 800);
    e.shown.forEach((c, i) => {
      assert.equal(c.risk, pop[i].p0);
      assert.equal(c.uplift, pop[i].uplift);
      assert.equal(c.byRisk, sets.risk.has(i), 'risk flag ' + i);
      assert.equal(c.byUplift, sets.uplift.has(i), 'uplift flag ' + i);
    });
  }
});
