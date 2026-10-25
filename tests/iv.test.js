const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('iv.js');
const iv = CP.iv, S = CP.stats;

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);

test('iv: the Wald estimate equals ITT_Y / ITT_D, and the sample LATE is the complier effect', () => {
  const sim = iv.simulate({ sd: 0, n: 4000, compliers: 0.4, always: 0.15, gap: 12, effect: 7, seed: 3 });
  const e = iv.estimate(sim);
  close(e.wald, e.ittY / e.ittD, 1e-12, 'Wald identity');
  // Without noise, the remaining error comes only from the type mix differing between the two groups.
  const z1 = [0, 0, 0, 0], z0 = [0, 0, 0, 0];
  for (let i = 0; i < sim.y.length; i++) (sim.z[i] ? z1 : z0)[sim.type[i]]++;
  const n1 = z1.reduce((a, b) => a + b, 0), n0 = z0.reduce((a, b) => a + b, 0);
  assert.ok(n1 > 0 && n0 > 0);
  close(e.late, 7, 1e-12, 'sample LATE');
});

test('iv: Wald equals 2SLS with one binary instrument and no covariates', () => {
  const sim = iv.simulate({ always: 0.1, defiers: 0.05, direct: 3, seed: 5 });
  const e = iv.estimate(sim);
  // 2SLS by hand: first stage D on Z, then Y on the fitted D.
  const X1 = Array.from(sim.z, zz => [1, zz]);
  const fs = S.ols(X1, Array.from(sim.d), { se: 'none' });
  const dhat = Array.from(sim.z, zz => fs.beta[0] + fs.beta[1] * zz);
  const ss = S.ols(dhat.map(v => [1, v]), Array.from(sim.y), { se: 'none' });
  close(ss.beta[1], e.wald, 1e-9);
});

test('iv: ITT_Y equals the complier share times the LATE when the assumptions hold', () => {
  // Large sample, one-sided noncompliance: ITT_Y is about pi_c * LATE, and |ITT_Y| <= |LATE|.
  for (const effect of [10, -8]) {
    const e = iv.estimate(iv.simulate({ n: 200000, compliers: 0.3, effect, seed: 2 }));
    close(e.ittY, e.ittD * e.late, 0.15, 'effect ' + effect);
    assert.ok(Math.abs(e.ittY) <= Math.abs(e.late));
    assert.equal(Math.sign(e.ittY), Math.sign(effect));
  }
});

test('iv: the text message shifts the Wald ratio by the direct effect times the never-taker share over the complier share', () => {
  const p = { n: 200000, compliers: 0.2, direct: 5, seed: 7 };
  const g = iv.expectedGap(Object.assign({}, iv.DEFAULTS, p));
  close(g.exclusion, 5 * 0.8 / 0.2, 1e-12);
  close(g.defiers, 0, 1e-12);
  const e = iv.estimate(iv.simulate(p));
  close(e.wald - e.late, g.exclusion, 4 * e.seWald, 'large-sample Wald error');
});

test('iv: defiers push the Wald ratio beyond the complier effect, as the formula says', () => {
  const p = { n: 400000, compliers: 0.4, defiers: 0.1, seed: 9 };
  const full = Object.assign({}, iv.DEFAULTS, p);
  const g = iv.expectedGap(full);
  const t = iv.typeTable(full);
  close(g.defiers, 0.1 * (t.complier.effect - t.defier.effect) / 0.3, 1e-12);
  const e = iv.estimate(iv.simulate(p));
  close(e.wald, e.late + g.defiers, 4 * e.seWald);
  // The ratio lies outside the range between the defier effect and the complier effect.
  assert.ok(e.wald > Math.max(t.complier.effect, t.defier.effect));
});

test('iv: as-treated and per-protocol comparisons are biased when the types differ in spending', () => {
  let asT = 0, pp = 0, wald = 0;
  for (let s = 1; s <= 50; s++) {
    const e = iv.estimate(iv.simulate({ seed: 100 + s }));
    asT += e.asTreated / 50; pp += e.perProtocol / 50; wald += e.wald / 50;
  }
  assert.ok(asT > 15 && pp > 13, 'as-treated ' + asT + ', per protocol ' + pp);
  close(wald, 10, 0.5, 'Wald');
  // With no spending gap between types, the as-treated comparison has no selection part in the
  // one-sided design, but compliers and never-takers still have different effects.
  const e0 = iv.estimate(iv.simulate({ gap: 0, n: 200000, seed: 1 }));
  close(e0.perProtocol, e0.late, 0.3, 'per protocol without a gap');
});

test('iv: the Anderson-Rubin set matches a direct check of the test at many values', () => {
  for (const p of [{ seed: 3 }, { compliers: 0.03, always: 0.2, gap: 30, seed: 4 }, { compliers: 0.02, always: 0.2, gap: 30, seed: 11 }]) {
    const sim = iv.simulate(p);
    const m1 = iv.groupMoments(sim.y, sim.d, sim.z, 1), m0 = iv.groupMoments(sim.y, sim.d, sim.z, 0);
    const e = iv.fromMoments(m1, m0);
    for (let b = -300; b <= 300; b += 0.7) {
      const num = (m1.my - m0.my) - b * (m1.md - m0.md);
      const v = (m1.vy - 2 * b * m1.cyd + b * b * m1.vd) / m1.n + (m0.vy - 2 * b * m0.cyd + b * b * m0.vd) / m0.n;
      const accept = num * num <= 1.96 * 1.96 * v;
      assert.equal(iv.arContains(e.ar, b), accept, JSON.stringify(p) + ' at ' + b + ' kind ' + e.ar.kind);
    }
    // The set has two ends exactly when the first stage is significant at the 5% level.
    assert.equal(e.ar.kind === 'interval', e.firstF > 1.96 * 1.96);
  }
});

test('iv: with a strong instrument both intervals cover the LATE about 95% of the time', () => {
  const r = iv.replicate({ reps: 4000, seed: 2 });
  assert.ok(r.coverWald > 0.935 && r.coverWald < 0.965, 'Wald coverage ' + r.coverWald);
  assert.ok(r.coverAr > 0.935 && r.coverAr < 0.965, 'AR coverage ' + r.coverAr);
  close(r.medianWald, 10, 0.2);
});

test('iv: with a weak instrument the usual interval undercovers, Anderson-Rubin does not, and the center moves toward the as-treated value', () => {
  const r = iv.replicate({ compliers: 0.02, always: 0.2, gap: 30, reps: 4000, seed: 3 });
  assert.ok(r.medianF < 3, 'median F ' + r.medianF);
  assert.ok(r.coverWald < 0.9, 'Wald coverage ' + r.coverWald);
  assert.ok(r.coverAr > 0.93, 'AR coverage ' + r.coverAr);
  assert.ok(r.medianWald > 15 && r.medianWald < r.meanAsTreated, 'median ' + r.medianWald);
  assert.ok(r.unbounded > 0.6);
});

test('iv: the cell-total shortcut gives the same results as drawing every customer', () => {
  for (const p of [{ compliers: 0.03, always: 0.2, gap: 30 }, { compliers: 0.3, defiers: 0.05, direct: 4 }]) {
    const a = iv.replicate(Object.assign({ reps: 3000, seed: 5 }, p));
    const b = iv.replicateUnits(Object.assign({ reps: 1500, seed: 5 }, p));
    assert.ok(Math.abs(a.coverWald - b.coverWald) < 0.04, 'coverage ' + a.coverWald + ' vs ' + b.coverWald);
    assert.ok(Math.abs(a.coverAr - b.coverAr) < 0.04, 'AR coverage ' + a.coverAr + ' vs ' + b.coverAr);
    assert.ok(Math.abs(a.meanAsTreated - b.meanAsTreated) < 0.5, 'as-treated ' + a.meanAsTreated + ' vs ' + b.meanAsTreated);
    assert.ok(Math.abs(Math.log(a.medianF / b.medianF)) < 0.25, 'median F ' + a.medianF + ' vs ' + b.medianF);
  }
});

test('iv: the binomial and chi-square draws have the right mean and variance', () => {
  const rng = CP.rng.makeRng(4);
  for (const [N, p] of [[1000, 0.02], [1000, 0.5], [50, 0.9], [3000, 0.97]]) {
    const xs = [];
    for (let k = 0; k < 20000; k++) xs.push(iv.binomial(N, p, rng));
    close(S.mean(xs), N * p, 4 * Math.sqrt(N * p * (1 - p) / 20000), 'binomial mean ' + N + ' ' + p);
    assert.ok(Math.abs(S.variance(xs) / (N * p * (1 - p)) - 1) < 0.05, 'binomial variance ' + N + ' ' + p);
  }
  for (const df of [3, 40, 400]) {
    const xs = [];
    for (let k = 0; k < 20000; k++) xs.push(iv.chiSquare(df, rng));
    close(S.mean(xs), df, 4 * Math.sqrt(2 * df / 20000), 'chi-square mean ' + df);
    assert.ok(Math.abs(S.variance(xs) / (2 * df) - 1) < 0.06, 'chi-square variance ' + df);
  }
});

test('iv: moving a slider keeps the same draws, and the composition counts add up', () => {
  const a = iv.simulate({ seed: 28 }), b = iv.simulate({ seed: 28, effect: -4, direct: 6 });
  assert.deepEqual(Array.from(a.z), Array.from(b.z));
  assert.deepEqual(Array.from(a.type), Array.from(b.type));
  const e = iv.estimate(a);
  let total = 0;
  for (const key of Object.keys(e.counts)) total += e.counts[key].reduce((x, y) => x + y, 0);
  assert.equal(total, 2000);
  // One-sided noncompliance: nobody who was not called joins.
  assert.equal(e.counts['01'].reduce((x, y) => x + y, 0), 0);
  // Sample 1 (seed 28) has a Wald estimate close to the true LATE of 10.
  close(e.wald, 10, 0.2);
});
