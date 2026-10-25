// Page wiring for the randomization inference module.
(function () {
  'use strict';
  const { ui, plot, ri } = CP;
  const fmt = plot.fmt;
  const form = ui.byId('ri-controls');
  const svgData = ui.byId('ri-data'), svgHist = ui.byId('ri-hist'), svgCurve = ui.byId('ri-curve');
  const count = v => Number(v).toLocaleString('en-US');
  const fmtP = v => fmt(v, v < 0.001 ? 4 : 3);
  const pct = v => fmt(100 * v, 1) + '%';
  const plural = (k, word) => count(k) + ' ' + word + (k === 1 ? '' : 's');

  plot.legend(ui.byId('ri-data-legend'), [
    { label: 'Customer who sees the new page (treated group)', cls: 's1', kind: 'dot' },
    { label: 'Customer who sees the old page (comparison group)', cls: 's2', kind: 'dot' },
    { label: 'Mean spending of the group', cls: 'sg', kind: 'line' },
  ]);
  plot.legend(ui.byId('ri-hist-legend'), [
    { label: 'Assignments less extreme than the actual one', cls: 'sm', kind: 'bar' },
    { label: 'Assignments at least as extreme (counted in the p-value)', cls: 's1', kind: 'bar' },
  ]);
  plot.legend(ui.byId('ri-curve-legend'), [
    { label: 'Two-sided p-value of the chosen statistic', cls: 's1', kind: 'line' },
    { label: 'Values not rejected at the 5% level (95% confidence interval)', kind: 'band' },
    { label: 'True effect (simulation only)', cls: 'sg', kind: 'dash' },
  ]);

  let redraw = () => {};
  // The first sample uses seed 36. In it the large customer sees the old page, and the difference
  // in means at the default settings (15.21) is close to the true effect of 15.
  const sampler = ui.sampler(ui.byId('ri-new'), ui.byId('ri-sample'), () => redraw(), 36);

  // The assignments depend only on the number of customers and, above 14 customers, on the sample.
  let aKey = '', aKeep = null;
  function assignmentsFor(sim) {
    const key = sim.n + '|' + (ri.choose(sim.n, sim.n1) <= sim.params.maxExact ? 'all' : sim.params.seed);
    if (key !== aKey) { aKeep = ri.assignments(sim); aKey = key; }
    return aKeep;
  }

  // Keep the horizontal axes steady while sliders move on the same sample: they only grow.
  // A new sample, a new number of customers, or Reset starts them again.
  let hKeep = null, hKey = '', cKeep = null, cKey = '', dKeep = null, dKey = '';
  form.addEventListener('reset', () => { hKey = ''; cKey = ''; dKey = ''; });
  // Keep an axis steady while sliders move on the same sample: it grows, and it shrinks back only when
  // the new range is less than a third of the kept one. A new sample or Reset starts it again.
  const settle = (keep, fresh) => (keep && (fresh[1] - fresh[0]) * 3 >= keep[1] - keep[0]
    ? [Math.min(keep[0], fresh[0]), Math.max(keep[1], fresh[1])] : fresh);

  function drawData(sim) {
    const ys = Array.from(sim.y);
    const key = sim.params.seed + '|' + sim.n;
    const xd = settle(key === dKey ? dKeep : null, plot.extent(ys, { pad: 0.08 }));
    dKeep = xd; dKey = key;
    const groupMean = g => { let s = 0, c = 0; for (let i = 0; i < sim.n; i++) if (sim.d[i] === g) { s += sim.y[i]; c++; } return s / c; };
    const m1 = groupMean(1), m0 = groupMean(0);
    const ch = plot.chart(svgData, {
      x: { domain: xd, label: 'Spending in the next month (dollars)' },
      y: { domain: [0.4, 2.6], ticks: [1, 2], format: v => (v === 2 ? 'New page' : 'Old page') },
      title: 'Spending of each customer by page',
      desc: 'Mean spending ' + fmt(m1) + ' dollars with the new page and ' + fmt(m0) + ' dollars with the old page.',
      height: 200, margin: { left: 78 },
    });
    ch.axes();
    ch.segment(m1, 1.62, m1, 2.38, 'sg');
    ch.segment(m0, 0.62, m0, 1.38, 'sg');
    const pts = [];
    for (let i = 0; i < sim.n; i++) {
      const jitter = (((i * 37) % 7) - 3) * 0.06;
      pts.push({ x: sim.y[i], y: (sim.d[i] ? 2 : 1) + jitter, i, treated: sim.d[i] === 1 });
    }
    const name = d => 'Customer ' + (d.i + 1) + (d.i === 0 && sim.params.outlier > 0 ? ' (large customer)' : '') +
      (d.treated ? ', new page: ' : ', old page: ') + fmt(d.x, 1) + ' dollars';
    ch.dots(pts.filter(d => !d.treated), 's2', { title: name });
    ch.dots(pts.filter(d => d.treated), 's1', { title: name });
    if (sim.params.outlier > 0) {
      const big = pts[0];
      const right = ch.sx(big.x) > (ch.left() + ch.right()) / 2;
      ch.text(big.x, big.y, 'large customer', { anchor: right ? 'end' : 'start', dx: right ? -9 : 9, dy: -8, cls: 'note halo' });
    }
  }

  function drawHist(sim, t, p) {
    const two = p.alternative !== 'greater';
    let M = Math.abs(t.obs);
    for (let k = 0; k < t.vals.length; k++) M = Math.max(M, Math.abs(t.vals[k]));
    const fresh = plot.niceDomain(-1.05 * M, 1.05 * M);
    const key = sampler.seed + '|' + p.n + '|' + p.statistic;
    const xd = settle(key === hKey ? hKeep : null, fresh);
    hKeep = xd; hKey = key;
    // Bins. Mean ranks take values on a grid with step 1/n1 + 1/n0, so each bin holds one value.
    let width, start;
    if (p.statistic === 'rank') {
      width = 1 / sim.n1 + 1 / sim.n0;
      start = t.vals[0] - width / 2 - Math.ceil((t.vals[0] - width / 2 - xd[0]) / width) * width;
    } else {
      width = (xd[1] - xd[0]) / 40;
      start = xd[0];
    }
    const nb = Math.max(1, Math.ceil((xd[1] - start) / width));
    const rest = new Array(nb).fill(0), ext = new Array(nb).fill(0);
    const tol = 1e-9 * (1 + Math.abs(t.obs));
    for (let k = 0; k < t.vals.length; k++) {
      const v = t.vals[k];
      const j = Math.min(nb - 1, Math.max(0, Math.floor((v - start) / width)));
      const extreme = two ? Math.abs(v) >= Math.abs(t.obs) - tol : v >= t.obs - tol;
      if (extreme) ext[j]++; else rest[j]++;
    }
    let top = 1;
    for (let j = 0; j < nb; j++) top = Math.max(top, rest[j] + ext[j]);
    const statLabel = ri.LABELS[p.statistic] + (p.statistic === 'rank' ? '' : ' (dollars)');
    const ch = plot.chart(svgHist, {
      x: { domain: xd, label: statLabel },
      y: { domain: plot.niceDomain(0, top * 1.08), label: 'Number of assignments' },
      title: 'Randomization distribution of the ' + ri.LABELS[p.statistic].toLowerCase(),
      desc: 'Value for the actual assignment ' + fmt(t.obs) + '. ' + count(t.count) + ' of ' + count(t.used) +
        ' assignments are at least as extreme. p-value ' + fmtP(t.p) + '.',
      aspect: 0.45,
    });
    ch.axes();
    const px = Math.max(1, ch.sx(xd[0] + width) - ch.sx(xd[0]) - (p.statistic === 'rank' ? 3 : 1));
    for (let j = 0; j < nb; j++) {
      if (!rest[j] && !ext[j]) continue;
      const a = start + j * width, b = a + width, mid = (a + b) / 2;
      const title = 'Values from ' + fmt(a) + ' to ' + fmt(b) + ': ' + plural(rest[j] + ext[j], 'assignment') + ', ' +
        count(ext[j]) + ' of them counted in the p-value';
      if (rest[j]) ch.bars([{ x: mid, y: rest[j], title }], 'sm', { width: px });
      if (ext[j]) ch.bars([{ x: mid, y: rest[j] + ext[j], title }], 's1', { width: px, base: rest[j] });
    }
    const right = ch.sx(t.obs) > (ch.left() + ch.right()) / 2;
    if (two && Math.abs(t.obs) > 1e-9) ch.vline(-t.obs, { cls: 'light' });
    ch.vline(t.obs, { label: 'Actual assignment', anchor: right ? 'end' : 'start' });
  }

  function drawCurve(sim, A, p) {
    const s = ri.searchRange(sim, A, p.statistic);
    const fresh = plot.niceDomain(Math.min(s.from, p.effect - 5), Math.max(s.to, p.effect + 5));
    const key = sampler.seed + '|' + p.n;
    const xd = settle(key === cKey ? cKeep : null, fresh);
    cKeep = xd; cKey = key;
    const inv = ri.invert(sim, A, p.statistic, { search: s, range: xd });
    const ch = plot.chart(svgCurve, {
      x: { domain: xd, label: 'Hypothesized effect τ0 (dollars)' },
      y: { domain: [0, 1], label: 'Two-sided p-value' },
      title: 'p-value of the sharp null of a constant effect, for each hypothesized effect',
      desc: '95% confidence interval ' + ciText(inv) + '. True effect ' + fmt(p.effect) + ' dollars.',
      aspect: 0.45,
    });
    if (isFinite(inv.lo) || isFinite(inv.hi) || inv.unbounded) {
      const a = isFinite(inv.lo) ? inv.lo : xd[0], b = isFinite(inv.hi) ? inv.hi : xd[1];
      if (b >= a) ch.band(Math.max(a, xd[0]), Math.min(b, xd[1]));
    }
    ch.axes();
    ch.hline(0.05, { cls: 'light' });
    ch.segment(p.effect, 0, p.effect, 1, 'sg dash');
    ch.line(inv.grid.map(pt => ({ x: pt.tau0, y: pt.p })), 's1');
    ch.dots([{ x: inv.est, y: inv.pMax }], 's1', { title: 'Middle of the effects with the highest p-value: ' + fmt(inv.est) + ' dollars, p-value ' + fmtP(inv.pMax) });
    return inv;
  }

  function ciText(inv) {
    if (!isFinite(inv.lo) && !isFinite(inv.hi)) return inv.unbounded ? 'every value' : 'no value';
    if (!isFinite(inv.lo)) return 'every value up to ' + fmt(inv.hi);
    if (!isFinite(inv.hi)) return 'every value from ' + fmt(inv.lo);
    return fmt(inv.lo) + ' to ' + fmt(inv.hi);
  }

  function draw(p) {
    const sim = ri.simulate({ n: p.n, effect: p.effect, outlier: p.outlier, seed: sampler.seed });
    const A = assignmentsFor(sim);
    const two = p.alternative !== 'greater';
    const res = {};
    for (const k of ri.KINDS) {
      res[k] = ri.test(sim, A, k, { alternative: p.alternative });
      res[k].size = ri.falseAlarm(res[k].vals, two, 0.05);
    }
    const t = res[p.statistic];
    drawData(sim);
    drawHist(sim, t, p);
    const inv = drawCurve(sim, A, p);

    for (const k of ri.KINDS) {
      ui.setText('ri-' + k + '-obs', fmt(res[k].obs));
      ui.setText('ri-' + k + '-p', fmtP(res[k].p));
      ui.setText('ri-' + k + '-size', pct(res[k].size));
      ui.byId('ri-row-' + k).classList.toggle('key', k === p.statistic);
    }
    ui.setText('ri-r-K', count(A.K));
    ui.setText('ri-r-used', A.exact ? 'all ' + count(A.K) : count(A.masks.length) + ' of ' + count(A.K));
    ui.setText('ri-r-count', count(t.count) + ' of ' + count(t.used));
    ui.setText('ri-r-p', fmtP(t.p));
    ui.setText('ri-r-pmin', fmtP(t.pMin));
    ui.setText('ri-r-ci', ciText(inv));
    ui.setText('ri-r-est', fmt(inv.est));
    ui.setText('ri-r-true', fmt(p.effect));
  }

  redraw = ui.bind(form, draw);
})();
