const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('neyman.js');
const N = CP.neyman, S = CP.stats;

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);

// Every assignment of k treated units among n, as 0/1 arrays.
function allAssignments(n, k) {
  const out = [];
  const go = (start, cur) => {
    if (cur.length === k) { const d = new Uint8Array(n); for (const i of cur) d[i] = 1; out.push(d); return; }
    for (let i = start; i < n; i++) { cur.push(i); go(i + 1, cur); cur.pop(); }
  };
  go(0, []);
  return out;
}
const popVar = a => { const m = S.mean(a); return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length; };

test('neyman: over all assignments, the difference in means averages to the SATE and has the exact variance', () => {
  for (const [n, n1, spread] of [[6, 3, 20], [8, 3, 5], [8, 4, 0]]) {
    const u = N.simulateUnits({ n, share: n1 / n, spread, seed: 4 });
    assert.equal(u.n1, n1);
    const fin = N.finite(u);
    const ests = [], vars = [];
    for (const d of allAssignments(n, n1)) {
      const e = N.estimateOnce(u.y0, u.y1, d);
      ests.push(e.est); vars.push(e.neyman * e.neyman);
    }
    close(S.mean(ests), fin.sate, 1e-9, 'unbiased n=' + n);
    close(popVar(ests), fin.variance, 1e-9, 'exact variance n=' + n);
    // The Neyman variance estimator averages to S1^2/n1 + S0^2/n0, which leaves out the S_tau^2/n term.
    close(S.mean(vars), fin.neymanExpected, 1e-9, 'Neyman expectation n=' + n);
    close(fin.neymanExpected - fin.variance, fin.St / n, 1e-9);
  }
});

test('neyman: with the same effect for every customer the Neyman variance is exact', () => {
  const fin = N.finite(N.simulateUnits({ spread: 0, seed: 2 }));
  close(fin.St, 0, 1e-9);
  close(fin.variance, fin.neymanExpected, 1e-9);
});

test('neyman: the Neyman standard error equals HC2, and the classical one equals the OLS default', () => {
  const u = N.simulateUnits({ n: 60, share: 0.3, spread: 25, seed: 8 });
  const d = new Uint8Array(60);
  for (let i = 0; i < 60; i++) d[i] = i % 10 < 3 ? 1 : 0;
  const e = N.estimateOnce(u.y0, u.y1, d);
  const y = Array.from(d, (di, i) => (di ? u.y1[i] : u.y0[i]));
  const X = Array.from(d, di => [1, di]);
  const fit = S.ols(X, y, { se: 'classical' });
  close(fit.beta[1], e.est, 1e-9);
  close(fit.se[1], e.classical, 1e-9);
  // HC2: residuals scaled by 1 / (1 - leverage). With a constant and one dummy, the leverage is 1/n1 or 1/n0.
  const n1 = d.reduce((a, b) => a + b, 0), n0 = 60 - n1;
  const XtXinv = S.inverse([[60, n1], [n1, n1]]);
  const meat = [[0, 0], [0, 0]];
  for (let i = 0; i < 60; i++) {
    const h = d[i] ? 1 / n1 : 1 / n0, w = fit.resid[i] ** 2 / (1 - h);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) meat[a][b] += w * X[i][a] * X[i][b];
  }
  const m = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
  const V = m(m(XtXinv, meat), XtXinv);
  close(Math.sqrt(V[1][1]), e.neyman, 1e-9);
});

test('neyman: repeated coin flips on the same customers center on the SATE with the exact spread', () => {
  const r = N.replicate({ reps: 4000, seed: 3 });
  close(r.meanEst, r.finite.sate, 4 * r.trueSd / Math.sqrt(4000), 'mean of the estimates');
  assert.ok(Math.abs(r.sdEst / r.trueSd - 1) < 0.05, 'sd ratio ' + r.sdEst / r.trueSd);
  // Effects vary, so the Neyman standard error is too large and intervals cover more than 95%.
  assert.ok(r.meanNeyman > r.trueSd * 1.1);
  assert.ok(r.coverNeyman > 0.96, 'coverage ' + r.coverNeyman);
});

test('neyman: with new customers each time (PATE), Neyman intervals cover about 95%', () => {
  const r = N.replicate({ target: 'pate', reps: 4000, seed: 5 });
  assert.equal(r.truth, 10);
  assert.ok(r.coverNeyman > 0.935 && r.coverNeyman < 0.965, 'coverage ' + r.coverNeyman);
  assert.ok(Math.abs(r.meanNeyman / r.trueSd - 1) < 0.03);
  close(r.trueSd, Math.sqrt((100 + 400) / 50 + 100 / 50), 1e-12);
});

test('neyman: with few treated customers and unequal variances the classical standard error is too small', () => {
  const r = N.replicate({ share: 0.2, reps: 4000, seed: 6 });
  assert.ok(r.meanClassical < 0.8 * r.trueSd, 'classical ' + r.meanClassical + ' true ' + r.trueSd);
  assert.ok(r.coverClassical < 0.9, 'classical coverage ' + r.coverClassical);
  assert.ok(r.coverNeyman > 0.94, 'Neyman coverage ' + r.coverNeyman);
  const even = N.replicate({ share: 0.5, reps: 500, seed: 6 });
  close(even.meanClassical, even.meanNeyman, 1e-9, 'equal group sizes give the same standard error');
});

test('neyman: moving a slider keeps the same customers', () => {
  const a = N.simulateUnits({ seed: 9, spread: 10 }), b = N.simulateUnits({ seed: 9, spread: 30, share: 0.3 });
  for (let i = 0; i < 100; i++) {
    close(b.y0[i], a.y0[i], 1e-12);
    close(b.y1[i] - b.y0[i] - 10, 3 * (a.y1[i] - a.y0[i] - 10), 1e-9);
  }
  const c = N.simulateUnits({ seed: 9, spread: 10, n: 40 });
  for (let i = 0; i < 40; i++) close(c.y1[i], a.y1[i], 1e-12, 'the first 40 customers stay the same');
});

test('neyman blocks: weights, and equal shares make the three block-design estimators identical', () => {
  const des = N.blockDesign(Object.assign({}, N.BLOCK_DEFAULTS, { shareStep: 0.4 }));
  close(des.seg.reduce((a, s) => a + s.wFe, 0), 1, 1e-12);
  for (const s of des.seg) close(s.wBlock, 0.25, 1e-12);
  assert.deepEqual(des.seg.map(s => s.n1), [25, 32, 38, 45]);
  const sim = N.simulateBlocks({ seed: 2 });
  const d = new Uint8Array(sim.design.n);
  for (let i = 0; i < d.length; i++) d[i] = i % 2;
  const e = N.blockEstimates(sim, d);
  close(e.pooled, e.block, 1e-9);
  close(e.fe, e.block, 1e-9);
});

test('neyman blocks: the fixed effects formula equals OLS with segment indicators', () => {
  const sim = N.simulateBlocks({ seed: 3, shareStep: 0.4, effectStep: 6 });
  const d = new Uint8Array(sim.design.n);
  let k = 0;
  for (const s of sim.design.seg) { for (let i = 0; i < s.size; i++, k++) d[k] = i < s.n1 ? 1 : 0; }
  const y = Array.from(d, (di, i) => (di ? sim.y1[i] : sim.y0[i]));
  const X = Array.from(d, (di, i) => [di, sim.block[i] === 0 ? 1 : 0, sim.block[i] === 1 ? 1 : 0, sim.block[i] === 2 ? 1 : 0, sim.block[i] === 3 ? 1 : 0]);
  const fit = S.ols(X, y, { se: 'none' });
  close(N.blockEstimates(sim, d).fe, fit.beta[0], 1e-9);
});

test('neyman blocks: the block estimator is unbiased, the pooled one is not, and fixed effects target their own weights', () => {
  const r = N.replicateBlocks({ shareStep: 0.4, effectStep: 10, reps: 3000, seed: 4 });
  const s = r.summary, sim = r.sim;
  close(s.block.mean, sim.sate, 4 * s.block.sd / Math.sqrt(3000), 'block estimator');
  close(s.complete.mean, sim.sate, 4 * s.complete.sd / Math.sqrt(3000), 'complete randomization');
  close(s.fe.mean, r.feTarget, 4 * s.fe.sd / Math.sqrt(3000), 'fixed effects');
  assert.ok(Math.abs(r.feTarget - sim.sate) > 2);
  // Exact expectation of the pooled difference: segment means weighted by the treated and untreated counts.
  const seg = sim.design.seg, n1 = seg.reduce((a, x) => a + x.n1, 0), n0 = seg.reduce((a, x) => a + x.n0, 0);
  let e = 0, k = 0;
  for (const x of seg) {
    let m1 = 0, m0 = 0;
    for (let i = 0; i < x.size; i++, k++) { m1 += sim.y1[k]; m0 += sim.y0[k]; }
    e += (x.n1 / n1) * (m1 / x.size) - (x.n0 / n0) * (m0 / x.size);
  }
  close(s.pooled.mean, e, 4 * s.pooled.sd / Math.sqrt(3000), 'pooled difference');
  assert.ok(e - sim.sate > 5);
});

test('neyman blocks: blocking helps when segments differ and hardly matters when they do not', () => {
  const big = N.replicateBlocks({ gap: 20, reps: 3000, seed: 7 }).summary;
  assert.ok(big.block.sd < 0.6 * big.complete.sd);
  const none = N.replicateBlocks({ gap: 0, reps: 3000, seed: 7 }).summary;
  assert.ok(Math.abs(none.block.sd / none.complete.sd - 1) < 0.08, 'ratio ' + none.block.sd / none.complete.sd);
});
