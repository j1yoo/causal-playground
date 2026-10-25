const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('strata.js');

const ps = CP.strata;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);
const run = p => ps.estimate(ps.simulate(p));

test('strata: shares follow the settings, and training never costs anyone a job', () => {
  const sim = ps.simulate({ n: 100000, helped: 0.3, seed: 3 });
  const e = ps.estimate(sim);
  close(e.strata.always.share, 0.5, 0.01, 'always employed');
  close(e.strata.helped.share, 0.3, 0.01, 'helped');
  close(e.strata.never.share, 0.2, 0.01, 'never employed');
  assert.equal(sim.people.filter(q => q.s0 === 1 && q.s1 === 0).length, 0, 'nobody is hurt');
  // The employed untrained people are exactly the always-employed untrained people.
  for (const q of sim.people) if (q.d === 0) assert.equal(q.s === 1, q.stratum === 'always');
  close(e.qC, 0.5, 0.01, 'employment without training');
  close(e.qT, 0.8, 0.01, 'employment with training');
});

test('strata: the comparison among employed people matches the selection formula without noise', () => {
  // Readiness z is uniform with SD 1. Always employed: mean sqrt(3)/2. Helped: mean -h * sqrt(12) / 2.
  for (const [h, slope] of [[0.3, 3], [0.1, 4], [0.4, 2]]) {
    const e = run({ n: 400000, helped: h, slope, noise: 0, tau: 1, seed: 5 });
    const mAlways = Math.sqrt(3) / 2, mHelped = -h * Math.sqrt(12) / 2;
    const mTreated = (0.5 * mAlways + h * mHelped) / (0.5 + h);
    close(e.naive, 1 + slope * (mTreated - mAlways), 0.02, `h ${h} slope ${slope}`);
    close(e.truth, 1, 1e-12);
  }
});

test('strata: no helped stratum or no link between readiness and wage removes the bias', () => {
  const e0 = run({ helped: 0, seed: 7 });
  close(e0.naive, e0.fair, 1e-9, 'with nobody helped, the naive comparison is the fair comparison');
  let sum = 0;
  for (let s = 1; s <= 200; s++) sum += run({ slope: 0, seed: 100 + s }).error;
  close(sum / 200, 0, 0.05, 'slope 0: average error');
});

test('strata: at the defaults the naive comparison is negative although the true effect is +1', () => {
  let neg = 0, sumErr = 0;
  for (let s = 1; s <= 50; s++) {
    const e = run({ seed: 1 + 7919 * (s - 1) });
    if (e.naive < 0) neg++;
    sumErr += e.error;
    close(e.truth, 1, 1e-12);
  }
  assert.ok(neg >= 47, 'negative in ' + neg + ' of 50');
  close(sumErr / 50, -1.56, 0.12, 'average error');
});

test('strata: Lee bounds by hand, and they contain the true effect in most samples', () => {
  const b = ps.leeBounds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [4, 5, 6], 0.5, 0.4);
  close(b.trim, 0.2, 1e-12);
  close(b.lower, 4.5 - 5, 1e-12);
  close(b.upper, 6.5 - 5, 1e-12);
  let inside = 0;
  for (let s = 1; s <= 100; s++) {
    const e = run({ seed: 300 + s });
    if (e.lee.lower <= e.truth && e.truth <= e.lee.upper) inside++;
  }
  assert.ok(inside >= 95, 'bounds contain the truth in ' + inside + ' of 100');
});

test('strata: the true effect slider shifts only the trained wages', () => {
  const a = run({ seed: 9 }), b = run({ seed: 9, tau: 2.5 });
  close(b.naive - a.naive, 1.5, 1e-9);
  assert.equal(a.nT, b.nT);
  assert.equal(a.nC, b.nC);
});
