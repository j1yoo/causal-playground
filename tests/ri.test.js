const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('./load.js').load('ri.js');
const ri = CP.ri;

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` got ${a}, expected ${b}`);
const bits = m => { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; };
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const median = a => { const s = a.slice().sort((x, y) => x - y), h = s.length / 2; return s.length % 2 ? s[(s.length - 1) / 2] : (s[h - 1] + s[h]) / 2; };

// A hand-made experiment with outcomes y and treated customers listed in treated.
function handSim(y, treated) {
  const n = y.length, d = new Uint8Array(n);
  let mask = 0;
  for (const i of treated) { d[i] = 1; mask |= 1 << i; }
  return { params: Object.assign({}, ri.DEFAULTS, { n }), n, n1: treated.length, n0: n - treated.length,
    y: Float64Array.from(y), y0: Float64Array.from(y), y1: Float64Array.from(y), d, mask: mask >>> 0 };
}

// Every way to pick k of the indices 0..n-1, written without the module's code.
function subsets(n, k) {
  const out = [];
  const go = (start, cur) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < n; i++) { cur.push(i); go(i + 1, cur); cur.pop(); }
  };
  go(0, []);
  return out;
}

test('ri: 10 customers with 5 treated give 252 distinct assignments, the actual one included', () => {
  assert.equal(ri.choose(10, 5), 252);
  assert.equal(ri.choose(6, 3), 20);
  assert.equal(ri.choose(14, 7), 3432);
  const sim = ri.simulate({ seed: 36 });
  const A = ri.assignments(sim);
  assert.equal(A.exact, true);
  assert.equal(A.masks.length, 252);
  assert.equal(new Set(A.masks).size, 252);
  for (const m of A.masks) assert.equal(bits(m), 5);
  assert.ok(A.masks.includes(sim.mask));
  assert.equal(bits(sim.mask), 5);
});

test('ri: exact p-values match a count by hand for all three statistics', () => {
  const y = [5, 9, 3, 2, 4, 1], treated = [0, 1, 2];
  const sim = handSim(y, treated);
  const A = ri.assignments(sim);
  const stat = {
    mean: (t, c) => mean(t) - mean(c),
    median: (t, c) => median(t) - median(c),
    rank: (t, c) => mean(t) - mean(c),
  };
  const rk = y.map(v => y.filter(w => w < v).length + 1);   // no ties in y
  for (const kind of ri.KINDS) {
    const z = kind === 'rank' ? rk : y;
    const split = s => [s.map(i => z[i]), z.filter((_, i) => !s.includes(i))];
    const obs = stat[kind](...split(treated));
    const all = subsets(6, 3).map(s => stat[kind](...split(s)));
    const two = all.filter(v => Math.abs(v) >= Math.abs(obs) - 1e-9).length / all.length;
    const one = all.filter(v => v >= obs - 1e-9).length / all.length;
    const r2 = ri.test(sim, A, kind), r1 = ri.test(sim, A, kind, { alternative: 'greater' });
    close(r2.obs, obs, 1e-12, kind);
    close(r2.p, two, 1e-12, kind + ' two-sided');
    close(r1.p, one, 1e-12, kind + ' one-sided');
  }
  // The difference in means here is 17/3 - 7/3, the third largest of the 20 values.
  close(ri.test(sim, A, 'mean').obs, 10 / 3, 1e-12);
});

test('ri: with equal group sizes the two-sided p-value is twice the one-sided p-value', () => {
  for (const seed of [36, 2, 3, 4, 5]) {
    const sim = ri.simulate({ seed });
    const A = ri.assignments(sim);
    for (const kind of ['mean', 'rank']) {
      const r2 = ri.test(sim, A, kind), r1 = ri.test(sim, A, kind, { alternative: 'greater' });
      if (r2.obs > 0) close(r2.p, 2 * r1.p, 1e-12, kind + ' seed ' + seed);
    }
  }
});

test('ri: for the difference in means the smallest possible p-value is 1/K one-sided and 2/K two-sided; ties make it larger for medians', () => {
  const sim = ri.simulate({ seed: 36 });
  const A = ri.assignments(sim);
  close(ri.test(sim, A, 'mean').pMin, 2 / 252, 1e-12);
  close(ri.test(sim, A, 'mean', { alternative: 'greater' }).pMin, 1 / 252, 1e-12);
  const six = ri.simulate({ seed: 36, n: 6 });
  const A6 = ri.assignments(six);
  close(ri.test(six, A6, 'mean').pMin, 0.1, 1e-12);
  close(ri.test(six, A6, 'mean', { alternative: 'greater' }).pMin, 0.05, 1e-12);
  // The difference in medians has many ties at its largest value.
  close(ri.test(sim, A, 'median').pMin, 12 / 252, 1e-12);
  close(ri.test(six, A6, 'median').pMin, 0.2, 1e-12);
});

test('ri: if the sharp null holds, each test rejects at the 5% level in at most 5% of the assignments', () => {
  for (const [n, outlier] of [[10, 0], [10, 200], [8, 50]]) {
    const base = ri.simulate({ seed: 7, n, effect: 0, outlier });
    const A = ri.assignments(base);
    for (const kind of ri.KINDS) for (const alternative of ['two', 'greater']) {
      // Make each assignment the actual one in turn. With no effect, the outcomes do not change.
      let rejected = 0;
      for (const m of A.masks) {
        const d = new Uint8Array(n);
        for (let i = 0; i < n; i++) d[i] = (m >>> i) & 1;
        const sim = Object.assign({}, base, { d, mask: m });
        if (ri.test(sim, A, kind, { alternative }).p <= 0.05) rejected++;
      }
      const share = rejected / A.masks.length;
      assert.ok(share <= 0.05, kind + ' ' + alternative + ' share ' + share);
      const vals = ri.test(base, A, kind).vals;
      close(ri.falseAlarm(vals, alternative !== 'greater', 0.05), share, 1e-12, kind + ' ' + alternative);
    }
  }
});

test('ri: at the true effect the adjusted outcomes are the outcomes without the new page', () => {
  const sim = ri.simulate({ seed: 4, effect: 12.5, outlier: 80 });
  const y = ri.adjusted(sim, 12.5);
  for (let i = 0; i < sim.n; i++) close(y[i], sim.y0[i], 1e-12, 'customer ' + i);
});

test('ri: with no noise, inverting the test gives the true effect as a single point', () => {
  // The median is left out: with only two distinct outcome values, half of all assignments tie
  // with the most extreme median difference, so that test cannot reject.
  for (const kind of ['mean', 'rank']) {
    const sim = ri.simulate({ seed: 9, sd: 0, effect: 7 });
    const inv = ri.invert(sim, ri.assignments(sim), kind);
    close(inv.lo, 7, 2e-3, kind + ' lower end');
    close(inv.hi, 7, 2e-3, kind + ' upper end');
    close(inv.est, 7, 2e-3, kind + ' estimate');
  }
});

test('ri: every value inside the interval has a p-value above 0.05, and values just outside are rejected', () => {
  const sim = ri.simulate({ seed: 36 });
  const A = ri.assignments(sim);
  for (const kind of ri.KINDS) {
    const inv = ri.invert(sim, A, kind);
    assert.ok(ri.pAt(sim, A, kind, inv.lo) > 0.05 && ri.pAt(sim, A, kind, inv.hi) > 0.05, kind);
    assert.ok(ri.pAt(sim, A, kind, inv.lo - 0.01) <= 0.05 && ri.pAt(sim, A, kind, inv.hi + 0.01) <= 0.05, kind);
    for (const pt of inv.grid) if (pt.tau0 > inv.lo + 1e-6 && pt.tau0 < inv.hi - 1e-6) assert.ok(pt.p > 0.05, kind + ' at ' + pt.tau0);
    assert.ok(inv.lo < inv.est && inv.est < inv.hi, kind);
  }
});

test('ri: the interval from inverting the test contains the true effect in at least 92% of 200 samples', () => {
  for (const kind of ['mean', 'rank']) {
    let cover = 0;
    for (let s = 1; s <= 200; s++) {
      const sim = ri.simulate({ seed: 3000 + s });
      const inv = ri.invert(sim, ri.assignments(sim), kind, { grid: 41 });
      if (inv.lo <= 15 && 15 <= inv.hi) cover++;
    }
    assert.ok(cover / 200 >= 0.92, kind + ' coverage ' + cover / 200);
  }
});

test('ri: with 6 customers the two-sided test never rejects, so the interval has no ends', () => {
  const sim = ri.simulate({ seed: 36, n: 6 });
  const inv = ri.invert(sim, ri.assignments(sim), 'mean');
  assert.equal(inv.lo, -Infinity);
  assert.equal(inv.hi, Infinity);
  assert.ok(inv.unbounded);
});

test('ri: moving a slider keeps the same customers and the same assignment', () => {
  const a = ri.simulate({ seed: 36 });
  const b = ri.simulate({ seed: 36, effect: -5, outlier: 250 });
  assert.equal(a.mask, b.mask);
  for (let i = 0; i < a.n; i++) close(b.y0[i] - a.y0[i], i === 0 ? 250 : 0, 1e-9, 'customer ' + i);
  for (let i = 0; i < a.n; i++) close(b.y1[i] - b.y0[i], -5, 1e-9);
  // Sample 1 puts the large customer (customer 1) in the comparison group.
  assert.equal(a.d[0], 0);
});

test('ri: the randomization distribution of the rank statistic does not depend on the outcome values', () => {
  const A = ri.assignments(ri.simulate({ seed: 36 }));
  const v0 = ri.test(ri.simulate({ seed: 36, outlier: 0 }), A, 'rank').vals;
  const v1 = ri.test(ri.simulate({ seed: 36, outlier: 300, effect: 25 }), A, 'rank').vals;
  const s0 = Array.from(v0).sort((x, y) => x - y), s1 = Array.from(v1).sort((x, y) => x - y);
  for (let k = 0; k < s0.length; k++) close(s1[k], s0[k], 1e-9);
});

test('ri: above 3,432 assignments the page uses the actual assignment plus 1,999 random ones', () => {
  const sim = ri.simulate({ seed: 5, n: 16 });
  const A = ri.assignments(sim);
  assert.equal(A.exact, false);
  assert.equal(A.K, 12870);
  assert.equal(A.masks.length, 2000);
  assert.equal(A.masks[0], sim.mask);
  for (const m of A.masks) assert.equal(bits(m), 8);
  // The same seed gives the same draws.
  assert.deepEqual(Array.from(ri.assignments(sim).masks.slice(0, 20)), Array.from(A.masks.slice(0, 20)));
});

test('ri: random assignments give p-values close to the exact ones', () => {
  for (const seed of [1, 2, 3]) {
    const sim = ri.simulate({ seed, n: 14 });
    const exact = ri.assignments(sim);
    const approx = ri.assignments(Object.assign({}, sim, { params: Object.assign({}, sim.params, { maxExact: 100 }) }));
    assert.equal(exact.masks.length, 3432);
    assert.equal(approx.masks.length, 2000);
    for (const kind of ri.KINDS) {
      const pe = ri.test(sim, exact, kind).p, pa = ri.test(sim, approx, kind).p;
      assert.ok(Math.abs(pe - pa) < 0.035, kind + ' seed ' + seed + ': ' + pe + ' vs ' + pa);
    }
  }
});

test('ri: the median statistic handles groups of even size, and the Hodges-Lehmann estimate is a median of pairwise differences', () => {
  const y = [10, 30, 20, 50, 40, 60, 0, 70], treated = [1, 3, 5, 7];
  const sim = handSim(y, treated);
  close(ri.statistic('median', sim.y, sim.mask, 4), median([30, 50, 60, 70]) - median([10, 20, 40, 0]), 1e-12);
  const diffs = [];
  for (const i of treated) for (let j = 0; j < 8; j++) if (!treated.includes(j)) diffs.push(y[i] - y[j]);
  close(ri.hodgesLehmann(sim), median(diffs), 1e-12);
});

test('ri: Sample 1 shows the outlier lesson', () => {
  const A = ri.assignments(ri.simulate({ seed: 36 }));
  const clean = ri.simulate({ seed: 36 }), big = ri.simulate({ seed: 36, outlier: 200 });
  assert.ok(ri.test(clean, A, 'mean').p < 0.05);
  assert.ok(ri.test(big, A, 'mean').p > 0.9);
  assert.ok(ri.test(big, A, 'rank').p < 0.3);
  assert.ok(ri.test(big, A, 'median').p < 0.3);
});
