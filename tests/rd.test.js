const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('rd.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);
const run = p => CP.rd.estimate(CP.rd.simulate(p));

test('rd: a score of exactly 50 gets the scholarship', () => {
  assert.equal(CP.rd.isTreated(50), 1);
  assert.equal(CP.rd.isTreated(49.999999), 0);
  assert.equal(CP.rd.isTreated(50.000001), 1);
  // Hand-made data with a student at exactly 50: y = 0.3 x + 2.5 D.
  // The fit is exact only if that student is on the right side of the cutoff.
  const students = [];
  for (let x = 38; x <= 62; x++) students.push({ x, y: 0.3 * x + 2.5 * (x >= 50 ? 1 : 0) });
  const sim = { params: Object.assign({}, CP.rd.DEFAULTS, { h: 15 }), students };
  const est = CP.rd.estimate(sim);
  close(est.est, 2.5, 1e-9);
  assert.equal(est.right.n, 13); // 50, 51, ..., 62
  assert.equal(est.left.n, 12);  // 38, 39, ..., 49
});

test('rd: no curvature, no noise, and no effort give the true jump exactly', () => {
  for (const h of [2, 5, 15, 30, 50]) {
    const est = run({ curvature: 0, noise: 0, effort: 0, tau: 3.5, h, seed: 7 });
    close(est.est, 3.5, 1e-9, `local linear h ${h}`);
    close(est.error, 0, 1e-9, `estimate minus true effect, h ${h}`);
  }
  const quad = run({ curvature: 0, noise: 0, effort: 0, tau: -2, estimator: 'quadratic', seed: 7 });
  close(quad.est, -2, 1e-9, 'local quadratic');
  const glob = run({ curvature: 0, noise: 0, effort: 0, tau: 6, estimator: 'global4', seed: 7 });
  close(glob.est, 6, 1e-9, 'global polynomial');
});

// Hand-made, noise-free data: scores from a simulated sample, grades from a polynomial in
// v = (x - 50) / 50 on each side. The coefficients are listed from the constant term up.
function polyData(left, right, seed) {
  const val = (c, v) => c.reduce((s, ck, k) => s + ck * Math.pow(v, k), 0);
  const students = CP.rd.simulate({ n: 1000, seed }).students.map(s => {
    const v = (s.x - 50) / 50;
    return { x: s.x, y: s.x >= 50 ? val(right, v) : val(left, v) };
  });
  return params => CP.rd.estimate({ params: Object.assign({}, CP.rd.DEFAULTS, params), students });
}

test('rd: each estimator is exact when the truth is a polynomial of its order', () => {
  // Quadratic on each side, jump 5: local quadratic and the order-4 fit are exact, local linear is not.
  const quad = polyData([58, 3, -12], [63, 2, 12], 7);
  for (const h of [5, 15, 50]) close(quad({ estimator: 'quadratic', h }).est, 5, 1e-8, 'local quadratic h ' + h);
  close(quad({ estimator: 'global4' }).est, 5, 1e-8, 'order 4, quadratic truth');
  assert.ok(Math.abs(quad({ estimator: 'linear', h: 15 }).est - 5) > 0.1, 'local linear misses the bend');
  // Quartic on each side, jump 5: only the order-4 fit is exact.
  const quart = polyData([58, 3, 2, 4, 6], [63, -2, 5, -3, 4], 7);
  close(quart({ estimator: 'global4' }).est, 5, 1e-8, 'order 4, quartic truth');
  assert.ok(Math.abs(quart({ estimator: 'quadratic', h: 50 }).est - 5) > 0.01, 'local quadratic misses the quartic terms');
});

test('rd: local linear uses triangular weights and robust standard errors on each side', () => {
  const sim = CP.rd.simulate({ seed: 13 });
  for (const h of [5, 15, 40]) {
    const est = CP.rd.estimate({ params: Object.assign({}, sim.params, { h }), students: sim.students });
    for (const [side, fit] of [[0, est.left], [1, est.right]]) {
      // Weighted least squares of y on 1 and u = x - 50 with weights 1 - |u| / h, by hand.
      const obs = sim.students.filter(s => (s.x >= 50 ? 1 : 0) === side && Math.abs(s.x - 50) < h)
        .map(s => ({ u: s.x - 50, y: s.y, w: 1 - Math.abs(s.x - 50) / h }));
      let S0 = 0, S1 = 0, S2 = 0, T0 = 0, T1 = 0;
      for (const o of obs) { S0 += o.w; S1 += o.w * o.u; S2 += o.w * o.u * o.u; T0 += o.w * o.y; T1 += o.w * o.u * o.y; }
      const det = S0 * S2 - S1 * S1;
      const a = (S2 * T0 - S1 * T1) / det, b = (S0 * T1 - S1 * T0) / det;
      // HC1 variance of the intercept: the sum of (w e (S2 - S1 u) / det)^2, times n / (n - 2).
      let v = 0;
      for (const o of obs) v += (o.w * (o.y - a - b * o.u) * (S2 - S1 * o.u) / det) ** 2;
      const n = obs.length;
      assert.equal(fit.n, n);
      close(fit.a, a, 1e-9, `intercept, h ${h}, side ${side}`);
      close(fit.se, Math.sqrt(v * n / (n - 2)), 1e-9, `standard error, h ${h}, side ${side}`);
    }
  }
});

test('rd: the true average grade follows the formula, and bins count and average the students', () => {
  for (const x of [0, 20, 44.5, 49.9, 50, 57, 100]) {
    const want = 60 + 0.2 * (x - 50) + 0.7 * 6 * Math.tanh((x - 50) / 8) + (x >= 50 ? 3 : 0);
    close(CP.rd.trueMean(x, { curvature: 0.7, tau: 3 }), want, 1e-12, 'score ' + x);
  }
  const pts = [[0, 1], [1.99, 3], [2, 5], [49.99, 7], [50, 9], [51.5, 11], [99.99, 13]];
  const b = CP.rd.bins({ students: pts.map(([x, y]) => ({ x, y })) });
  assert.equal(b.length, 50);
  assert.deepEqual([b[0].count, b[1].count, b[24].count, b[25].count, b[49].count], [2, 1, 1, 2, 1]);
  assert.equal(b.reduce((s, bin) => s + bin.count, 0), pts.length);
  close(b[0].mean, 2, 1e-12);
  close(b[25].mean, 10, 1e-12);
  assert.deepEqual([b[25].x0, b[25].x1, b[25].mid], [50, 52, 51]);
  assert.ok(b[10].count === 0 && Number.isNaN(b[10].mean));
});

test('rd: each grade is the true average at the reported score plus the effort term', () => {
  // Without noise, the grade of every student, movers included, is fixed by the reported score and the effort.
  const sim = CP.rd.simulate({ noise: 0, q: 0.8, curvature: 0.9, tau: 2.5, seed: 3 });
  assert.ok(sim.students.some(s => s.moved));
  for (const s of sim.students) close(s.y, CP.rd.trueMean(s.x, sim.params) + sim.params.effort * s.e, 1e-9);
});

test('rd: with curvature and no noise, the bias of local linear falls as the bandwidth falls', () => {
  for (const seed of [1, 2, 3]) {
    const bias = [40, 20, 10, 5].map(h => Math.abs(run({ curvature: 1, noise: 0, effort: 0, h, seed }).error));
    for (let i = 1; i < bias.length; i++) assert.ok(bias[i] < bias[i - 1], `seed ${seed}: ${bias.join(', ')}`);
    assert.ok(bias[0] > 1, 'a wide bandwidth gives a large bias: ' + bias[0]);
  }
});

test('rd: the estimate is the right intercept minus the left intercept', () => {
  const est = run({ seed: 11 });
  close(est.est, est.right.a - est.left.a, 1e-12);
  close(est.se, Math.sqrt(est.left.se ** 2 + est.right.se ** 2), 1e-12);
  close(est.ciHigh - est.est, 1.96 * est.se, 1e-12);
  // Each fitted curve ends at its intercept at the cutoff.
  close(est.curveLeft[est.curveLeft.length - 1].y, est.left.a, 1e-9);
  close(est.curveRight[0].y, est.right.a, 1e-9);
});

test('rd: local fits use only students inside the bandwidth, the global fit uses all', () => {
  const sim = CP.rd.simulate({ h: 12, seed: 4 });
  const inside = sim.students.filter(s => Math.abs(s.x - 50) < 12).length;
  assert.equal(CP.rd.estimate(sim).nUsed, inside);
  const g = run({ estimator: 'global4', n: 800, seed: 4 });
  assert.equal(g.nUsed, 800);
});

test('rd: the true effect slider changes only the treated grades', () => {
  const a = CP.rd.simulate({ tau: 0, seed: 5 }), b = CP.rd.simulate({ tau: 7, seed: 5 });
  for (let i = 0; i < a.students.length; i++) {
    assert.equal(a.students[i].x, b.students[i].x);
    close(b.students[i].y - a.students[i].y, 7 * a.students[i].d, 1e-9);
  }
  close(CP.rd.trueMean(50, { tau: 7, curvature: 1 }) - CP.rd.trueMean(49.9999999, { tau: 7, curvature: 1 }), 7, 1e-5);
});

test('rd: confidence interval covers the true effect about 95% of the time', () => {
  let cover = 0;
  const R = 300;
  for (let s = 1; s <= R; s++) {
    const est = run({ curvature: 0, q: 0, seed: s });
    if (est.ciLow <= est.truth && est.truth <= est.ciHigh) cover++;
  }
  const rate = cover / R;
  assert.ok(rate > 0.91 && rate < 0.99, 'coverage ' + rate);
});

test('rd: manipulation moves high-effort students from [45, 50) to [50, 52)', () => {
  const sim = CP.rd.simulate({ q: 0.8, seed: 3 });
  const moved = sim.students.filter(s => s.moved);
  assert.ok(moved.length > 0);
  for (const s of moved) {
    assert.ok(s.x0 >= 45 && s.x0 < 50 && s.e > 0, 'mover came from [45, 50) with effort > 0');
    assert.ok(s.x >= 50 && s.x < 52 && s.d === 1, 'mover reports a score in [50, 52)');
  }
  for (const s of sim.students) if (!s.moved) assert.equal(s.x, s.x0);
  assert.equal(CP.rd.simulate({ q: 0, seed: 3 }).students.filter(s => s.moved).length, 0);
});

test('rd: manipulation biases the estimate upward and the density check sees it', () => {
  const R = 200;
  let bias0 = 0, bias8 = 0, p0 = 0, p8 = 0;
  for (let s = 1; s <= R; s++) {
    const a = run({ curvature: 0, q: 0, seed: s }), b = run({ curvature: 0, q: 0.8, seed: s });
    bias0 += a.error / R; bias8 += b.error / R;
    p0 += a.density.p / R; p8 += b.density.p / R;
  }
  assert.ok(Math.abs(bias0) < 0.3, 'no manipulation, average bias ' + bias0);
  // In a very large sample without noise this bias is about 1.8. Movers without their effort give less.
  assert.ok(bias8 > 1.4 && bias8 < 2.4, 'manipulation, average bias ' + bias8);
  assert.ok(p8 < 0.05, 'manipulation, average p-value ' + p8);
  assert.ok(p0 > 0.3, 'no manipulation, average p-value ' + p0);
});

test('rd: exact binomial test matches the textbook example', () => {
  close(CP.rd.binomialTest(47, 53), 0.6173, 1e-4);
  close(CP.rd.binomialTest(53, 47), 0.6173, 1e-4);
  close(CP.rd.binomialTest(0, 10), 2 / 1024, 1e-12);
  assert.equal(CP.rd.binomialTest(20, 20), 1);
  const sim = { students: [48.5, 49.9, 50, 51.99, 52, 47.9].map(x => ({ x })) };
  const d = CP.rd.densityCheck(sim);
  assert.equal(d.below, 2);
  assert.equal(d.above, 2);
});

test('rd: too few students on one side gives n/a instead of an error', () => {
  const sim = { params: Object.assign({}, CP.rd.DEFAULTS, { h: 5 }), students: [{ x: 49, y: 1 }, { x: 51, y: 2 }, { x: 52, y: 3 }, { x: 53, y: 3 }] };
  const est = CP.rd.estimate(sim);
  assert.equal(est.left.beta, null);
  assert.equal(est.left.n, 1);
  assert.equal(est.right.n, 3);
  assert.equal(est.ok, false);
  assert.ok(Number.isNaN(est.est) && Number.isNaN(est.ciLow));
  assert.deepEqual(est.curveLeft, []);
});

test('rd: the bandwidth path matches single fits, and the global fit is flat', () => {
  const sim = CP.rd.simulate({ seed: 11, curvature: 1.5 });
  const path = CP.rd.bandwidthPath(sim, [5, 15, 30]);
  for (const r of path) {
    const one = CP.rd.estimate(CP.rd.simulate({ seed: 11, curvature: 1.5, h: r.h }));
    assert.ok(Math.abs(r.est - one.est) < 1e-9 && Math.abs(r.se - one.se) < 1e-9, 'h ' + r.h);
  }
  const g = CP.rd.bandwidthPath(CP.rd.simulate({ seed: 11, estimator: 'global4' }), [5, 30]);
  assert.ok(Math.abs(g[0].est - g[1].est) < 1e-12);
});

test('rd: the local constant fit is the weighted mean difference and is biased upward here', () => {
  let sum = 0;
  for (let s = 1; s <= 100; s++) sum += CP.rd.estimate(CP.rd.simulate({ seed: s, estimator: 'constant' })).est;
  assert.ok(sum / 100 - 4 > 3.5, 'local constant mean ' + sum / 100);
});
