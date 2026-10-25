const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('controls.js');
const C = CP.controls, S = CP.stats;

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);

test('controls: with no noise, the segment-weighted comparison equals the ATE exactly', () => {
  const sim = C.simulateAdjust({ sd: 0, selection: 1, hetero: 6, curve: 4, seed: 3 });
  const e = C.estimateAdjust(sim);
  assert.ok(e.possible);
  close(e.strat.est, e.ate, 1e-9);
  // The naive difference equals the ATT plus selection bias, exactly in the sample.
  const tr = [], un = [], y0t = [];
  for (let i = 0; i < sim.n; i++) { if (sim.d[i]) { tr.push(sim.y[i]); y0t.push(sim.y0[i]); } else un.push(sim.y[i]); }
  close(e.naive.est, e.att + (S.mean(y0t) - S.mean(un)), 1e-9, 'ATT plus selection bias');
});

test('controls: the regression with segment intercepts weights segment differences by size times p(1 - p)', () => {
  const sim = C.simulateAdjust({ hetero: 6, seed: 4 });
  const e = C.estimateAdjust(sim);
  const w = e.cell.map(c => { const m = c.n1 + c.n0, q = c.n1 / m; return m * q * (1 - q); });
  const wsum = w.reduce((a, b) => a + b, 0);
  const manual = e.within.reduce((a, t, j) => a + w[j] * t, 0) / wsum;
  close(e.fe.est, manual, 1e-9);
  e.feWeights.forEach((v, j) => close(v, w[j] / wsum, 1e-12));
  // Without effect differences or selection, the weights do not matter.
  const flat = C.estimateAdjust(C.simulateAdjust({ selection: 0, hetero: 0, sd: 0, seed: 4 }));
  close(flat.fe.est, flat.ate, 1e-9);
});

test('controls: over many samples, the weighted segment comparison centers on the ATE and the fixed effects coefficient on its own weights', () => {
  let strat = 0, fe = 0, naive = 0, R = 200;
  const seg = C.segmentTable(C.ADJ_DEFAULTS);
  const om = seg.map(s => s.share * (1 - s.share)), osum = om.reduce((a, b) => a + b, 0);
  const feTarget = seg.reduce((a, s, j) => a + om[j] / osum * s.effect, 0);
  for (let s = 1; s <= R; s++) {
    const e = C.estimateAdjust(C.simulateAdjust({ seed: 500 + s }));
    strat += e.strat.est / R; fe += e.fe.est / R; naive += e.naive.est / R;
  }
  close(strat, 10, 0.15, 'weighted comparison');
  close(fe, feTarget, 0.2, 'fixed effects');
  assert.ok(feTarget < 9, 'the default design makes the fixed effects target differ from the ATE: ' + feTarget);
  assert.ok(naive > 20, 'naive ' + naive);
});

test('controls: a straight line in the segment number misses a curved pattern, and more data do not fix it', () => {
  const small = [], big = [];
  for (let s = 1; s <= 60; s++) {
    small.push(C.estimateAdjust(C.simulateAdjust({ curve: 6, hetero: 0, n: 1000, seed: 900 + s })).line.est);
    big.push(C.estimateAdjust(C.simulateAdjust({ curve: 6, hetero: 0, n: 8000, seed: 900 + s })).line.est);
  }
  assert.ok(Math.abs(S.mean(small) - 10) > 1.5, 'bias with 1,000 customers: ' + (S.mean(small) - 10));
  assert.ok(Math.abs(S.mean(big) - S.mean(small)) < 1, 'the bias stays');
  assert.ok(S.sd(big) < 0.5 * S.sd(small), 'the spread shrinks');
  // With a straight pattern and no effect differences, the straight line is fine.
  const ok = [];
  for (let s = 1; s <= 60; s++) ok.push(C.estimateAdjust(C.simulateAdjust({ curve: 0, hetero: 0, seed: 900 + s })).line.est);
  close(S.mean(ok), 10, 0.25);
});

test('controls: without overlap, the segment comparison is not possible', () => {
  const e = C.estimateAdjust(C.simulateAdjust({ selection: 3, seed: 1 }));
  assert.equal(e.possible, false);
  assert.ok(Number.isNaN(e.strat.est));
  assert.ok(isFinite(e.fe.est) && isFinite(e.line.est));
});

test('controls: each causal structure gives the bias that the linear model predicts', () => {
  for (const structure of C.STRUCTURES) {
    for (const strength of [0.4, 1.1]) {
      const r = C.replicateDag({ structure, strength, n: 2000, reps: 150, seed: 7 });
      const lb = C.limitBias({ structure, strength });
      for (const k of ['without', 'with']) {
        close(r.summary[k].bias, lb[k], 4 * r.summary[k].sd / Math.sqrt(150) + 0.01, structure + ' ' + strength + ' ' + k);
      }
    }
  }
});

test('controls: good, bad, and neutral controls behave as Cinelli, Forney, and Pearl describe', () => {
  const lb = s => C.limitBias({ structure: s, strength: 0.8 });
  assert.ok(lb('confounder').without > 0 && lb('confounder').with === 0);
  assert.ok(lb('mediator').without === 0 && lb('mediator').with < 0);
  assert.ok(lb('collider').without === 0 && Math.abs(lb('collider').with) > 0.3);
  assert.ok(lb('mbias').without === 0 && Math.abs(lb('mbias').with) > 0);
  // M-bias is small with weak arrows and grows with all four of them.
  assert.ok(Math.abs(C.limitBias({ structure: 'mbias', strength: 0.3 }).with) < 0.01);
  assert.ok(Math.abs(C.limitBias({ structure: 'mbias', strength: 1.2 }).with) > 0.2);
  // Bias amplification: adjusting for a cause of the treatment only increases a hidden-confounder bias.
  for (const strength of [0.3, 0.8, 1.5]) {
    const b = C.limitBias({ structure: 'amplify', strength });
    assert.ok(b.with > b.without && b.without > 0, 'strength ' + strength);
  }
  // Precision: a cause of the outcome only helps, a cause of the treatment only hurts.
  const yOnly = C.replicateDag({ structure: 'outcomeCause', strength: 1, reps: 300, seed: 2 }).summary;
  assert.ok(yOnly.with.sd < 0.8 * yOnly.without.sd);
  const dOnly = C.replicateDag({ structure: 'treatmentCause', strength: 1, reps: 300, seed: 2 }).summary;
  assert.ok(dOnly.with.sd > 1.2 * dOnly.without.sd);
});

test('controls: the regression formulas from centered sums match OLS', () => {
  const rng = CP.rng.makeRng(5);
  const n = 300, z = [], d = [], y = [];
  for (let i = 0; i < n; i++) { const v = C.drawStore(Object.assign({}, C.DAG_DEFAULTS, { structure: 'confounder' }), rng); z.push(v[0]); d.push(v[1]); y.push(v[2]); }
  const f = C.fitSample(z, d, y);
  const a = S.ols(d.map(v => [1, v]), y, { se: 'classical' });
  const b = S.ols(d.map((v, i) => [1, v, z[i]]), y, { se: 'classical' });
  close(f.without.est, a.beta[1], 1e-9); close(f.without.se, a.se[1], 1e-9);
  close(f.with.est, b.beta[1], 1e-9); close(f.with.se, b.se[1], 1e-9);
});

test('controls: one customer in a group gives an estimate without an interval; none gives no estimate', () => {
  // Seed 15 with the joining slider at 3: the loyal segment has 499 members and 1 nonmember.
  const e = C.estimateAdjust(C.simulateAdjust({ selection: 3, seed: 15 }));
  assert.equal(e.cell[3].n0, 1);
  assert.ok(e.possible && !e.withSe);
  assert.ok(isFinite(e.strat.est) && Number.isNaN(e.strat.se));
  close(e.strat.est, e.within.reduce((a, t, j) => a + e.sizeWeights[j] * t, 0), 1e-9);
});

test('iv: the Anderson-Rubin set handles a first stage with no variation', () => {
  const g = (n, my, md, vy, vd, cyd) => ({ n, my, md, vy, vd, cyd });
  // Nobody joins in either group: the set is every value if ITT_Y is not significant, and empty if it is.
  const CPi = require('./load.js').load('iv.js');
  const iv = CPi.iv;
  const small = iv.andersonRubin(g(100, 40.5, 0, 100, 0, 0), g(100, 40, 0, 100, 0, 0), 0.5, 0);
  assert.equal(small.kind, 'line');
  const big = iv.andersonRubin(g(100, 50, 0, 100, 0, 0), g(100, 40, 0, 100, 0, 0), 10, 0);
  assert.equal(big.kind, 'empty');
  assert.equal(iv.arContains(big, 10), false);
});

