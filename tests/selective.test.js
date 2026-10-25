const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('selective.js');
const S = CP.selective;

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);
const at = (est, r) => est.curves.find(c => Math.abs(c.rate - r) < 1e-9);

test('selective: failure rates divide the number of FTAs by all defendants', () => {
  const sim = S.simulate({ seed: 3 });
  const est = S.estimate(sim);
  const people = sim.people, N = people.length;
  assert.equal(N, 12000);
  // Model rule at 70%: recount from the fitted scores, then divide by all 12,000 defendants.
  const score = people.map(d => CP.stats.logistic(est.beta[0] + est.beta[1] * d.x));
  const order = people.map((_, i) => i).sort((a, b) => score[a] - score[b]);
  const released = order.slice(0, Math.round(0.7 * N));
  let fta = 0, naive = 0;
  for (const i of released) { fta += people[i].y; naive += people[i].released ? people[i].y : score[i]; }
  close(at(est, 0.7).truth, fta / N, 1e-12);
  close(at(est, 0.7).naive, naive / N, 1e-9);
  // Releasing everyone gives the FTA share of all defendants.
  close(at(est, 1).truth, people.reduce((s, d) => s + d.y, 0) / N, 1e-12);
  // Judges: FTA among the released divided by the whole caseload of 2,400.
  sim.judges.forEach((J, j) => {
    assert.equal(J.cases.length, 2400);
    const rel = J.cases.filter(i => people[i].released);
    const count = rel.reduce((s, i) => s + people[i].y, 0);
    close(est.judges[j].failure, count / 2400, 1e-12);
    assert.ok(est.judges[j].failure < count / rel.length, 'judge ' + (j + 1));
  });
  // Contraction: an FTA count divided by the lenient judge's caseload.
  const c = est.atRate.contraction;
  close(c.estimate * c.caseload, Math.round(c.estimate * c.caseload), 1e-9);
  assert.equal(c.caseload, 2400);
});

test('selective: judges release their target shares, evenly spaced from 55%', () => {
  const sim = S.simulate({ lenient: 0.87, seed: 2 });
  const rates = sim.judges.map(J => J.rate);
  [0.55, 0.63, 0.71, 0.79, 0.87].forEach((r, j) => close(rates[j], r, 1e-12));
  sim.judges.forEach(J => assert.equal(J.cases.filter(i => sim.people[i].released).length, J.nReleased));
  // Every defendant belongs to exactly one judge.
  const seen = new Set();
  sim.judges.forEach(J => J.cases.forEach(i => seen.add(i)));
  assert.equal(seen.size, 12000);
});

test('selective: the risk of FTA if released is logistic(-1.6 + x + bZ z), and the outcome is drawn from it', () => {
  for (const bZ of [0, 1, 2]) {
    const sim = S.simulate({ bZ, seed: 2 });
    for (const d of sim.people.slice(0, 100)) close(d.risk, CP.stats.logistic(-1.6 + d.x + bZ * d.z), 1e-12);
    const mean = f => sim.people.reduce((s, d) => s + f(d), 0) / sim.people.length;
    close(mean(d => d.y), mean(d => d.risk), 0.015, 'bZ ' + bZ);
  }
});

test('selective: the model is fit on released defendants only', () => {
  const sim = S.simulate({ seed: 1 });
  const est = S.estimate(sim);
  const rel = sim.people.filter(d => d.released);
  const fit = CP.stats.logitFit(rel.map(d => [1, d.x]), rel.map(d => d.y));
  close(est.beta[0], fit[0], 1e-9);
  close(est.beta[1], fit[1], 1e-9);
  // A fit on all defendants would use outcomes that real data do not have. Its slope differs.
  const all = CP.stats.logitFit(sim.people.map(d => [1, d.x]), sim.people.map(d => d.y));
  assert.ok(Math.abs(all[1] - est.beta[1]) > 0.05, `slope ${est.beta[1]} versus ${all[1]}`);
});

test('selective: with bZ = 0 the naive evaluation matches the truth within 0.01', () => {
  for (const seed of [1, 7, 21]) {
    const est = S.estimate(S.simulate({ bZ: 0, seed }));
    for (const r of [0.6, 0.75, 0.9, 1]) close(at(est, r).naive, at(est, r).truth, 0.01, `seed ${seed} rate ${r}`);
  }
});

test('selective: with wZ = 0 the naive evaluation matches the truth within 0.01', () => {
  for (const seed of [1, 7, 21]) {
    const est = S.estimate(S.simulate({ wZ: 0, seed }));
    for (const r of [0.6, 0.75, 0.9, 1]) close(at(est, r).naive, at(est, r).truth, 0.01, `seed ${seed} rate ${r}`);
  }
});

test('selective: with bZ = wZ = 1 the naive evaluation is too low by more than 0.01 at 95%', () => {
  for (const seed of [1, 7, 21, 40]) {
    const e = at(S.estimate(S.simulate({ bZ: 1, wZ: 1, seed })), 0.95);
    assert.ok(e.naive < e.truth - 0.01, `seed ${seed}: naive ${e.naive}, truth ${e.truth}`);
  }
});

test('selective: contraction equals the true failure rate of the contraction rule', () => {
  for (const evalRate of [0.5, 0.62, 0.85, 0.9]) {
    const sim = S.simulate({ evalRate, seed: 5 });
    const est = S.estimate(sim);
    const c = est.atRate.contraction;
    // Rebuild the rule on the lenient judge's caseload and count FTA with every outcome.
    const q = sim.judges[sim.judges.length - 1];
    const score = sim.people.map(d => CP.stats.logistic(est.beta[0] + est.beta[1] * d.x));
    const R = q.cases.filter(i => sim.people[i].released).sort((a, b) => score[b] - score[a]);
    const extra = (2400 - Math.round(evalRate * 2400)) - (2400 - R.length);
    const kept = new Set(R.slice(extra));
    let fta = 0;
    for (const i of q.cases) if (kept.has(i)) fta += sim.people[i].y;
    assert.equal(c.extra, extra);
    assert.equal(c.estimate, fta / 2400);
    assert.equal(c.truth, fta / 2400);
    assert.equal(kept.size, Math.round(evalRate * 2400));
  }
});

test('selective: contraction never releases a defendant the lenient judge detained', () => {
  const sim = S.simulate({ seed: 8 });
  const est = S.estimate(sim);
  const score = sim.people.map(d => CP.stats.logistic(est.beta[0] + est.beta[1] * d.x));
  const contract = S.contraction(sim, score);
  for (const r of [0.5, 0.7, 0.9]) assert.ok(contract(r).kept.every(i => sim.people[i].released));
  // No estimate above the most lenient judge's release rate.
  assert.equal(contract(0.91), null);
  assert.ok(est.curves.filter(c => c.rate > 0.9 + 1e-9).every(c => c.contraction === null));
  assert.equal(S.estimate(S.simulate({ evalRate: 0.95, seed: 8 })).atRate.contraction, null);
});

test('selective: contraction at the lenient judge\'s own rate equals that judge\'s failure rate', () => {
  for (const lenient of [0.7, 0.83, 0.95]) {
    const est = S.estimate(S.simulate({ lenient, seed: 4 }));
    const q = est.judges[est.judges.length - 1];
    close(q.rate, lenient, 1e-12);
    assert.equal(q.contraction, q.failure);
  }
});

test('selective: detained defendants are riskier than the model predicts when bZ and wZ are positive', () => {
  for (const [bZ, wZ] of [[1, 1], [0.5, 1], [1, 0.5], [2, 2]]) {
    for (const seed of [1, 11]) {
      const d = S.estimate(S.simulate({ bZ, wZ, seed })).detained;
      assert.ok(d.truth > d.predicted, `bZ ${bZ} wZ ${wZ} seed ${seed}: ${d.truth} vs ${d.predicted}`);
    }
  }
  // With bZ = 0 the model sees everything that matters, so the two are close.
  const d0 = S.estimate(S.simulate({ bZ: 0, seed: 1 })).detained;
  close(d0.truth, d0.predicted, 0.03);
});

test('selective: the detained readout averages predicted and true risk over detained defendants only', () => {
  const sim = S.simulate({ seed: 1 });
  const est = S.estimate(sim);
  const nReleased = sim.judges.reduce((s, J) => s + J.nReleased, 0);
  assert.equal(est.detained.n, 12000 - nReleased);
  assert.equal(est.detained.n, 3300);
  const det = sim.people.filter(d => !d.released);
  const avg = f => det.reduce((s, d) => s + f(d), 0) / det.length;
  close(est.detained.predicted, avg(d => CP.stats.logistic(est.beta[0] + est.beta[1] * d.x)), 1e-12);
  close(est.detained.truth, avg(d => d.risk), 1e-12);
});

test('selective: Monte Carlo, the naive gap is near 0 on average with bZ = 0 and negative with defaults', () => {
  const R = 30;
  let sum0 = 0, negatives = 0;
  for (let s = 1; s <= R; s++) {
    sum0 += S.estimate(S.simulate({ bZ: 0, seed: 500 + s })).atRate.gap;
    if (S.estimate(S.simulate({ seed: 500 + s })).atRate.gap < -0.01) negatives++;
  }
  close(sum0 / R, 0, 0.003, 'average gap with bZ = 0');
  assert.equal(negatives, R);
});

test('selective: all judges rank defendants by the same perceived risk s', () => {
  const sim = S.simulate({ bZ: 1.5, wZ: 0.7, judgeNoise: 1.3, seed: 2 });
  for (const d of sim.people.slice(0, 100)) close(d.s, d.x + 0.7 * d.z + 1.3 * d.eta, 1e-12);
  // Within each judge, every released defendant has a lower s than every detained defendant.
  for (const J of sim.judges) {
    const rel = J.cases.filter(i => sim.people[i].released).map(i => sim.people[i].s);
    const det = J.cases.filter(i => !sim.people[i].released).map(i => sim.people[i].s);
    assert.ok(Math.max(...rel) < Math.min(...det));
  }
});

test('selective: principal strata of the strictest and the most lenient judge', () => {
  for (const [bZ, wZ, judgeNoise, lenient] of [[1, 1, 1, 0.9], [0.5, 2, 0, 0.7], [2, 0.3, 2, 0.95], [0.2, 1, 1, 0.8]]) {
    for (const seed of [1, 6]) {
      const sim = S.simulate({ bZ, wZ, judgeNoise, lenient, seed });
      const st = S.estimate(sim).strata;
      const lab = `bZ ${bZ} wZ ${wZ} noise ${judgeNoise} lenient ${lenient} seed ${seed}`;
      close(st.strictRate, 0.55, 1e-12, lab);
      close(st.lenientRate, lenient, 1e-12, lab);
      // The shares match the two release rates.
      close(st.bothReleased.share, 0.55, 0.01, lab);
      close(st.lenientOnly.share, lenient - 0.55, 0.01, lab);
      close(st.bothDetained.share, 1 - lenient, 0.01, lab);
      assert.equal(st.bothReleased.n + st.lenientOnly.n + st.bothDetained.n, 12000);
      // Each risk is the average true risk of the defendants in the group.
      const people = sim.people;
      [st.bothReleased, st.lenientOnly, st.bothDetained].forEach((g, k) => {
        const m = people.filter((_, i) => st.group[i] === k);
        assert.equal(m.length, g.n);
        close(g.risk, m.reduce((s, d) => s + d.risk, 0) / m.length, 1e-12, lab);
      });
      // The groups follow s: a lower group has a lower s.
      const maxS = k => Math.max(...people.filter((_, i) => st.group[i] === k).map(d => d.s));
      const minS = k => Math.min(...people.filter((_, i) => st.group[i] === k).map(d => d.s));
      assert.ok(maxS(0) < minS(1) && maxS(1) < minS(2), lab);
      // With wZ > 0 and bZ > 0, the true risk rises from the first group to the third.
      assert.ok(st.bothReleased.risk < st.lenientOnly.risk && st.lenientOnly.risk < st.bothDetained.risk, lab);
      // On their own cases, judges 1 and 5 decide as their group says, apart from a few cases near the cut.
      const agree = (J, rel) => J.cases.filter(i => people[i].released === rel(st.group[i])).length / J.cases.length;
      assert.ok(agree(sim.judges[0], g => g === 0) > 0.95, lab + ' judge 1');
      assert.ok(agree(sim.judges[4], g => g <= 1) > 0.95, lab + ' judge 5');
    }
  }
});

test('selective: same seed gives the same data', () => {
  const a = S.estimate(S.simulate({ seed: 9 })), b = S.estimate(S.simulate({ seed: 9 }));
  assert.deepEqual(a.curves, b.curves);
  assert.deepEqual(a.judges, b.judges);
  assert.deepEqual(a.strata, b.strata);
});
