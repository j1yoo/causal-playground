// Page wiring for the noncompliance and instrumental variables module.
(function () {
  'use strict';
  const { ui, plot, iv } = CP;
  const fmt = plot.fmt;
  const pct = v => fmt(100 * v, 1) + '%';
  const count = v => Number(v).toLocaleString('en-US');
  const form = ui.byId('iv-controls');
  const svgCells = ui.byId('iv-cells'), svgEst = ui.byId('iv-est'), svgWeak = ui.byId('iv-weak');
  const TYPE_CLS = ['s1', 's2', 's3', 's4'];   // compliers, always-takers, never-takers, defiers

  plot.legend(ui.byId('iv-cells-legend'), iv.TYPES.map((k, j) => ({ label: iv.LABELS[k], cls: TYPE_CLS[j], kind: 'bar' })));
  const EST = [
    { key: 'itt', letter: 'A', short: 'A. ITT', label: 'A. Intention-to-treat effect on spending', cls: 's3' },
    { key: 'asT', letter: 'B', short: 'B. As-treated', label: 'B. As-treated comparison', cls: 's2' },
    { key: 'pp', letter: 'C', short: 'C. Per-protocol', label: 'C. Per-protocol comparison', cls: 's5' },
    { key: 'wald', letter: 'D', short: 'D. Wald', label: 'D. Wald estimate', cls: 's1' },
  ];
  plot.legend(ui.byId('iv-est-legend'), EST.map(r => ({ label: r.label, cls: r.cls, kind: 'whisker' })).concat([
    { label: 'True LATE (simulation only)', cls: 'sg', kind: 'dash' },
    { label: 'True ATE (simulation only)', cls: 'sm', kind: 'dash' },
  ]));
  plot.legend(ui.byId('iv-weak-legend'), [
    { label: 'Wald estimates from repeated experiments', cls: 'sm', kind: 'bar' },
    { label: 'True LATE (simulation only)', cls: 'sg', kind: 'dash' },
    { label: 'Average as-treated comparison', cls: 's2', kind: 'line' },
  ]);

  let redraw = () => {};
  // The first sample uses seed 28. Its Wald estimate at the default settings (10.09) is close to the
  // true LATE of 10, and its as-treated comparison (16.55) is close to the average over 200 seeds.
  const sampler = ui.sampler(ui.byId('iv-new'), ui.byId('iv-sample'), () => redraw(), 28);
  // Keep an axis steady while sliders move on the same sample: it grows, and it shrinks back only when
  // the new range is less than a third of the kept one. A new sample or Reset starts it again.
  const settle = (keep, fresh) => (keep && (fresh[1] - fresh[0]) * 3 >= keep[1] - keep[0]
    ? [Math.min(keep[0], fresh[0]), Math.max(keep[1], fresh[1])] : fresh);
  let yKeep = null, yKey = '';
  form.addEventListener('reset', () => { yKey = ''; });

  const wideChart = svg => (svg.parentNode.getBoundingClientRect().width || 640) >= 560;

  function drawCells(e) {
    const CELLS = [
      { key: '00', short: 'Standard ad, did not complete' },
      { key: '01', short: 'Standard ad, completed' },
      { key: '10', short: 'Swipe ad, did not complete' },
      { key: '11', short: 'Swipe ad, completed' },
    ];
    const totals = CELLS.map(c => e.counts[c.key].reduce((a, b) => a + b, 0));
    const wide = wideChart(svgCells);
    const ch = plot.chart(svgCells, {
      x: { domain: [0.5, 4.5], ticks: [1, 2, 3, 4], format: v => (CELLS[v - 1] ? (wide ? CELLS[v - 1].short : String(v)) : '') },
      y: { domain: plot.niceDomain(0, Math.max(...totals) * 1.08), label: 'Number of customers' },
      title: 'Customers in each observed group, split by compliance type',
      desc: CELLS.map((c, j) => c.short + ': ' + totals[j]).join('. ') + '.',
      aspect: 0.45,
    });
    ch.axes();
    const px = Math.min(70, (ch.sx(2) - ch.sx(1)) * 0.55);
    CELLS.forEach((c, j) => {
      let base = 0;
      e.counts[c.key].forEach((m, k) => {
        if (!m) return;
        const name = iv.LABELS[iv.TYPES[k]].toLowerCase();
        ch.bars([{ x: j + 1, y: base + m, title: c.short + ': ' + m + ' ' + (m === 1 ? name.slice(0, -1) : name) }], TYPE_CLS[k], { width: px, base });
        base += m;
      });
    });
    if (!wide) ui.setText('iv-cells-key', '1: standard ad, did not complete. 2: standard ad, completed. 3: swipe ad, did not complete. 4: swipe ad, completed.');
    else ui.setText('iv-cells-key', '');
  }

  function drawEst(e) {
    const rows = {
      itt: { y: e.ittY, lo: e.ciY[0], hi: e.ciY[1] },
      asT: { y: e.asTreated, lo: e.asTreatedCi[0], hi: e.asTreatedCi[1] },
      pp: { y: e.perProtocol, lo: e.perProtocolCi[0], hi: e.perProtocolCi[1] },
      wald: { y: e.wald, lo: e.ciWald[0], hi: e.ciWald[1] },
    };
    const vals = [e.late, e.ate];
    for (const r of Object.values(rows)) vals.push(r.lo, r.hi);
    const fresh = plot.extent(vals, { pad: 0.08, include: [0] });
    const key = sampler.seed + '|' + form.elements.n.value;
    const yd = settle(key === yKey ? yKeep : null, fresh);
    yKeep = yd; yKey = key;
    const wide = wideChart(svgEst);
    const ch = plot.chart(svgEst, {
      x: { domain: [0.5, 4.5], ticks: [1, 2, 3, 4], format: v => (EST[v - 1] ? (wide ? EST[v - 1].short : EST[v - 1].letter) : '') },
      y: { domain: yd, label: 'Estimate (dollars)' },
      title: 'Four estimates with 95% confidence intervals',
      desc: EST.map(r => r.short + ' ' + fmt(rows[r.key].y)).join('. ') + '. True LATE ' + fmt(e.late) + '. True ATE ' + fmt(e.ate) + '.',
      aspect: 0.45,
    });
    ch.axes();
    ch.segment(0.5, e.ate, 4.5, e.ate, 'sm dash');
    ch.segment(0.5, e.late, 4.5, e.late, 'sg dash');
    EST.forEach((r, j) => {
      const q = rows[r.key];
      ch.whiskers([{ x: j + 1, y: q.y, lo: q.lo, hi: q.hi }], r.cls, {
        title: () => r.label + ': ' + fmt(q.y) + ', 95% interval ' + fmt(q.lo) + ' to ' + fmt(q.hi),
      });
    });
  }

  function drawWeak(r) {
    const ref = isFinite(r.meanAsTreated) ? r.meanAsTreated : r.truth;
    const lo = Math.min(r.truth, ref) - 30, hi = Math.max(r.truth, ref) + 30;
    const xd = plot.niceDomain(lo, hi);
    const bins = 60, width = (xd[1] - xd[0]) / bins;
    const counts = new Array(bins).fill(0);
    let outside = 0;
    for (const v of r.walds) {
      if (!(v >= xd[0] && v < xd[1])) { outside++; continue; }
      counts[Math.floor((v - xd[0]) / width)]++;
    }
    const ch = plot.chart(svgWeak, {
      x: { domain: xd, label: 'Wald estimate (dollars)' },
      y: { domain: plot.niceDomain(0, Math.max(1, ...counts) * 1.08), label: 'Number of experiments' },
      title: 'Wald estimates from ' + count(r.reps) + ' repeated experiments',
      desc: 'Median Wald estimate ' + fmt(r.medianWald) + '. True LATE ' + fmt(r.truth) + '. Average as-treated comparison ' + fmt(r.meanAsTreated) + '.',
      aspect: 0.45,
    });
    ch.axes();
    const px = Math.max(1, ch.sx(xd[0] + width) - ch.sx(xd[0]) - 1);
    ch.bars(counts.map((c, j) => ({ x: xd[0] + (j + 0.5) * width, y: c,
      title: 'Estimates from ' + fmt(xd[0] + j * width) + ' to ' + fmt(xd[0] + (j + 1) * width) + ': ' + c + (c === 1 ? ' experiment' : ' experiments') })), 'sm', { width: px });
    ch.segment(r.truth, ch.yd[0], r.truth, ch.yd[1], 'sg dash');
    if (isFinite(r.meanAsTreated)) ch.segment(r.meanAsTreated, ch.yd[0], r.meanAsTreated, ch.yd[1], 's2');
    return outside;
  }

  function arText(ar) {
    if (ar.kind === 'interval') return fmt(ar.lo) + ' to ' + fmt(ar.hi);
    if (ar.kind === 'rays') {
      if (ar.hi === Infinity) return 'every value from ' + fmt(ar.lo);
      if (ar.lo === -Infinity) return 'every value up to ' + fmt(ar.hi);
      return 'up to ' + fmt(ar.lo) + ', and from ' + fmt(ar.hi);
    }
    if (ar.kind === 'empty') return 'no value';
    return 'every value';
  }

  function draw(p) {
    const params = { n: p.n, compliers: p.compliers, always: p.always, defiers: p.defiers, gap: p.gap, effect: p.effect, direct: p.direct };
    const sim = iv.simulate(Object.assign({ seed: sampler.seed }, params));
    const e = iv.estimate(sim);
    const g = iv.expectedGap(sim.params);
    const r = iv.replicate(Object.assign({ seed: sampler.seed }, params));
    drawCells(e);
    drawEst(e);
    const outside = drawWeak(r);

    const t = sim.table;
    const nType = [0, 0, 0, 0];
    for (let i = 0; i < sim.type.length; i++) nType[sim.type[i]]++;
    iv.TYPES.forEach((k, j) => {
      ui.setText('iv-t-' + k + '-share', pct(nType[j] / sim.type.length));
      ui.setText('iv-t-' + k + '-mean0', fmt(t[k].mean0));
      ui.setText('iv-t-' + k + '-effect', fmt(t[k].effect));
    });
    ui.setText('iv-r-join', fmt(e.joinCalled, 3) + ' and ' + fmt(e.joinNotCalled, 3));
    ui.setText('iv-r-first', fmt(e.ittD, 3));
    ui.setText('iv-r-itt', fmt(e.ittY) + ' (' + fmt(e.ciY[0]) + ' to ' + fmt(e.ciY[1]) + ')');
    ui.setText('iv-r-wald', fmt(e.wald) + ' (' + fmt(e.ciWald[0]) + ' to ' + fmt(e.ciWald[1]) + ')');
    ui.setText('iv-r-ar', arText(e.ar));
    ui.setText('iv-r-f', fmt(e.firstF, 1));
    ui.setText('iv-r-late', fmt(e.late));
    ui.setText('iv-r-ate', fmt(e.ate));
    ui.setText('iv-r-err', fmt(e.wald - e.late));
    ui.setText('iv-r-gap-ex', fmt(g.exclusion));
    ui.setText('iv-r-gap-df', fmt(g.defiers));
    const rows = { itt: [e.ittY, e.ciY], asT: [e.asTreated, e.asTreatedCi], pp: [e.perProtocol, e.perProtocolCi], wald: [e.wald, e.ciWald] };
    for (const k of Object.keys(rows)) {
      ui.setText('iv-e-' + k + '-est', fmt(rows[k][0]));
      ui.setText('iv-e-' + k + '-ci', fmt(rows[k][1][0]) + ' to ' + fmt(rows[k][1][1]));
    }
    ui.setText('iv-w-median', fmt(r.medianWald));
    ui.setText('iv-w-f', fmt(r.medianF, 1));
    ui.setText('iv-w-cover', pct(r.coverWald));
    ui.setText('iv-w-ar', pct(r.coverAr));
    ui.setText('iv-w-unb', pct(r.unbounded));
    ui.setText('iv-w-ast', fmt(r.meanAsTreated));
    ui.setText('iv-w-out', count(outside - r.noRatio) + ' of ' + count(r.reps));
    ui.setText('iv-w-none', count(r.noRatio) + ' of ' + count(r.reps));
    const status = g.first <= 0 ? 'With these shares, the swipe ad does not raise the share who complete, so the Wald estimate does not estimate the LATE.'
      : !isFinite(e.wald) ? 'In this sample, the first stage is exactly 0, so there is no Wald estimate. Draw a new sample or raise the share of compliers.' : '';
    ui.setText('iv-status', status);
  }

  redraw = ui.bind(form, draw);
})();
