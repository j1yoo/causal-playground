// Page wiring for the event-study and placebo-date module.
(function () {
  'use strict';
  const { ui, plot, eventstudy: es } = CP;
  const fmt = plot.fmt;
  const fmtP = v => (v < 0.001 ? '< 0.001' : fmt(v, 3));

  // ---- Part A: event study with leads and lags ----

  const formA = ui.byId('es-controls');
  const svgA = ui.byId('es-chart');

  plot.legend(ui.byId('es-legend'), [
    { label: 'Estimate with 95% confidence interval', cls: 's1', kind: 'whisker' },
    { label: 'Reference period (0 by construction)', cls: 's1', kind: 'hollow' },
    { label: 'True effect (known only in the simulation)', cls: 's2', kind: 'dash' },
  ]);

  let redrawA = () => {};
  const samplerA = ui.sampler(ui.byId('es-new'), ui.byId('es-sample'), () => redrawA());

  function drawA(p) {
    const sim = es.simulatePanel(Object.assign({}, p, { seed: samplerA.seed }));
    const e = es.estimatePanel(sim);
    const est = e.rows.filter(r => !r.reference);
    const ref = e.rows.find(r => r.reference);
    const first = e.rows[0].e, last = e.rows[e.rows.length - 1].e;
    const yd = plot.extent([].concat(est.map(r => r.lo), est.map(r => r.hi), e.rows.map(r => r.truth)), { include: [0], pad: 0.06 });
    const ch = plot.chart(svgA, {
      x: { domain: [first - 0.5, last + 0.5], ticks: e.rows.map(r => r.e), decimals: 0, label: 'Event time (periods from the policy start)' },
      y: { domain: yd, label: 'Estimate (against event time −1)' },
      title: 'Event-study estimates for each period relative to the policy start',
      desc: 'Average estimate for event times 0 to 5: ' + fmt(e.avgEst) + '. True average effect: ' + fmt(e.avgTrue) +
        '. Pre-trend test p-value: ' + fmtP(e.preP) + '.',
    });
    ch.axes();
    ch.hline(0, { cls: 'light' });
    ch.vline(-0.5);
    // True effect path, broken at the start so it does not suggest a gradual rise.
    const truth = [];
    for (const r of e.rows) {
      if (r.e === 0) truth.push({ x: -0.5, y: null });
      truth.push({ x: r.e, y: r.truth });
    }
    ch.line(truth, 's2 dash');
    ch.whiskers(est.map(r => ({ x: r.e, y: r.est, lo: r.lo, hi: r.hi })), 's1', {
      title: it => 'Event time ' + fmt(it.x, 0) + ': estimate ' + fmt(it.y) + ', 95% interval ' + fmt(it.lo) + ' to ' + fmt(it.hi),
    });
    ch.dots([{ x: ref.e, y: 0 }], 's1', { hollow: true, top: true, title: 'Event time −1: reference period, 0 by construction' });
    // Notes with a halo (shared style) stay readable where they cross whiskers.
    ch.text(ref.e, 0, 'reference', { anchor: 'middle', dy: 18, cls: 'note halo' });
    ch.text(-0.5, yd[1], 'Policy starts', { dx: 6, dy: 12, cls: 'note halo' });

    const tbody = ui.byId('es-rows');
    tbody.textContent = '';
    for (const r of e.rows) {
      const cells = r.reference
        ? [fmt(r.e, 0), '0 (reference)', 'none', fmt(r.truth)]
        : [fmt(r.e, 0), fmt(r.est), fmt(r.lo) + ' to ' + fmt(r.hi), fmt(r.truth)];
      const tr = document.createElement('tr');
      for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
      tbody.appendChild(tr);
    }
    ui.setText('es-r-avg', fmt(e.avgEst));
    ui.setText('es-r-true', fmt(e.avgTrue));
    ui.setText('es-r-bias', fmt(e.bias));
    ui.setText('es-r-p', fmtP(e.preP));
  }

  redrawA = ui.bind(formA, drawA);

  // ---- Part B: placebo dates in daily data ----

  const formB = ui.byId('pl-controls');
  const svgSeries = ui.byId('pl-series');
  const svgRank = ui.byId('pl-rank');

  plot.legend(ui.byId('pl-legend'), [
    { label: 'Placebo date', cls: 'sg', kind: 'dot' },
    { label: 'Policy date', cls: 's1', kind: 'dot' },
  ]);

  let redrawB = () => {};
  const samplerB = ui.sampler(ui.byId('pl-new'), ui.byId('pl-sample'), () => redrawB());

  function drawB(p) {
    const sim = es.simulateDaily(Object.assign({}, p, { seed: samplerB.seed }));
    const e = es.estimateDaily(sim);
    const D0 = sim.params.start, w = sim.params.w;

    // Chart 1: the last 16 weeks before the policy and the first 8 weeks with it.
    const from = D0 - 112, to = D0 + 56;
    const pts = [];
    for (let d = from; d < to; d++) pts.push({ x: d - D0, y: sim.y[d] });
    const yd1 = plot.extent(pts.map(q => q.y), { pad: 0.08 });
    const ch1 = plot.chart(svgSeries, {
      aspect: 0.45,
      x: { domain: [from - D0 - 0.5, to - D0 - 0.5], ticks: [-112, -84, -56, -28, 0, 28], decimals: 0, label: 'Days relative to the policy date' },
      y: { domain: yd1, label: 'Daily orders' },
      title: 'Daily orders around the policy date',
      desc: 'Daily orders for the last 16 weeks before the policy and the first 8 weeks with it. Window length ' + w + ' days.',
    });
    ch1.band(-w - 0.5, -0.5);
    ch1.band(-0.5, w - 0.5);
    ch1.axes();
    const tick = (yd1[1] - yd1[0]) * 0.06;
    for (const q of e.placebos) {
      if (q.day >= from) ch1.segment(q.day - D0 - 0.5, yd1[0], q.day - D0 - 0.5, yd1[0] + tick, 'sg');
    }
    ch1.line(pts, 's1 thin');
    ch1.vline(-0.5);
    ch1.text(-0.5, yd1[1], 'Policy starts', { dx: 6, dy: 12, cls: 'note halo' });

    // Chart 2: all candidate dates sorted by their estimate.
    const cands = e.placebos.map(q => ({ y: q.est, actual: false })).concat([{ y: e.actual, actual: true }]);
    cands.sort((a, b) => a.y - b.y);
    cands.forEach((c, i) => { c.x = i + 1; });
    const act = cands.find(c => c.actual);
    const size = Math.abs(e.actual);
    // The y range uses every pre-policy date, so it stays fixed when the weekday option changes.
    const yd2 = plot.extent(e.dates.map(q => q.est).concat([size, -size]), { pad: 0.06 });
    const ch2 = plot.chart(svgRank, {
      aspect: 0.5,
      x: { domain: [0.5, e.K + 0.5], decimals: 0, label: 'Candidate dates, sorted by estimate' },
      y: { domain: yd2, label: 'Estimate (after minus before)' },
      title: 'Estimates at all candidate dates',
      desc: 'Actual estimate ' + fmt(e.actual) + '. Rank ' + e.rank + ' of ' + e.K + '. Placebo p-value ' + fmt(e.pPlacebo, 3) + '.',
    });
    ch2.area([{ x: 0.5, lo: -size, hi: size }, { x: e.K + 0.5, lo: -size, hi: size }], 'sm');
    ch2.axes();
    ch2.hline(-e.actual, { cls: 'light' });
    ch2.hline(e.actual);
    // Label the actual-estimate line where no dots cross it. The dots are sorted, so dots left of
    // the policy date lie on or below the line, and dots right of it lie on or above the line.
    if (act.x > e.K / 2) ch2.text(0.5, e.actual, 'actual estimate', { dx: 6, dy: -6, cls: 'note halo' });
    else ch2.text(e.K + 0.5, e.actual, 'actual estimate', { anchor: 'end', dx: -6, dy: 16, cls: 'note halo' });
    ch2.dots(cands.filter(c => !c.actual), 'sg', { r: e.K > 100 ? 2.2 : 3.5, small: true, title: d => 'Placebo date: estimate ' + fmt(d.y) });
    ch2.dots([act], 's1', { r: 6, top: true, title: 'Policy date: estimate ' + fmt(act.y) + ', rank ' + e.rank + ' of ' + e.K });

    ui.setText('pl-r-est', fmt(e.actual));
    ui.setText('pl-r-rank', e.rank + ' of ' + e.K);
    ui.setText('pl-r-p', fmt(e.pPlacebo, 3));
    ui.setText('pl-r-pmin', fmt(e.pMin, 3));
    ui.setText('pl-r-naive', fmtP(e.pNaive));
    ui.setText('pl-r-sd', fmt(e.placeboSd));
  }

  redrawB = ui.bind(formB, drawB);
})();
