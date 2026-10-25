// Page wiring for the uplift targeting module.
(function () {
  'use strict';
  const { ui, plot, uplift } = CP;
  const fmt = plot.fmt;
  const pct = v => fmt(100 * v, 0) + '%';
  const form = ui.byId('up-controls');
  const svgA = ui.byId('up-scatter');
  const svgB = ui.byId('up-curve');

  // Scatter groups, drawn from the back (light gray) to the front.
  const GROUPS = [
    { key: 'neither', label: 'Neither rule (no offer)', cls: 'sm' },
    { key: 'risk', label: 'Risk targeting only', cls: 's2' },
    { key: 'uplift', label: 'Uplift targeting only', cls: 's1' },
    { key: 'both', label: 'Both rules', cls: 's3' },
  ];
  // Curves in drawing order, so uplift targeting ends up on top.
  const RULES = [
    { key: 'random', label: 'Random targeting', cls: 'sg dotted' },
    { key: 'best', label: 'Best possible', cls: 's3 dash' },
    { key: 'risk', label: 'Risk targeting', cls: 's2' },
    { key: 'uplift', label: 'Uplift targeting', cls: 's1' },
  ];

  plot.legend(ui.byId('up-scatter-legend'), [2, 1, 3, 0].map(i => ({ label: GROUPS[i].label, cls: GROUPS[i].cls, kind: 'dot' })));
  plot.legend(ui.byId('up-curve-legend'), [
    { label: 'Uplift targeting (by predicted uplift)', cls: 's1', kind: 'line' },
    { label: 'Risk targeting (by predicted churn risk)', cls: 's2', kind: 'line' },
    { label: 'Random targeting (expected value)', cls: 'sg', kind: 'dotted' },
    { label: 'Best possible: by true uplift (known only in a simulation)', cls: 's3', kind: 'dash' },
  ]);

  let redraw = () => {};
  const sampler = ui.sampler(ui.byId('up-new'), ui.byId('up-sample'), () => redraw());

  function draw(p) {
    const sim = uplift.simulate(Object.assign({}, p, { seed: sampler.seed }));
    const e = uplift.estimate(sim);
    const P = e.prevented, R = e.avgRisk;

    // (A) Each shown customer: true churn risk without the offer against true uplift, colored by rule.
    const pts = e.shown.map(c => ({
      x: 100 * c.risk, y: 100 * c.uplift,
      g: c.byUplift ? (c.byRisk ? 'both' : 'uplift') : (c.byRisk ? 'risk' : 'neither'),
    }));
    const a = plot.chart(svgA, {
      x: { domain: [0, 100], label: 'True churn risk without the offer (%)' },
      y: { domain: plot.extent(pts.map(d => d.y), { include: [0], count: 8 }), label: 'True uplift (percentage points)' },
      aspect: 0.5,
      title: 'Which customers each rule targets',
      desc: 'At a budget of ' + pct(p.budget) + ', ' + pct(e.overlap) + ' of the targeted customers are picked by both rules.',
    });
    a.axes();
    for (const g of GROUPS) {
      a.dots(pts.filter(d => d.g === g.key), g.cls, {
        r: g.key === 'neither' ? 2.5 : 3.5, small: true,
        title: d => 'True churn risk ' + fmt(d.x, 0) + '%, true uplift ' + fmt(d.y, 1) + ' points: ' + g.label.toLowerCase(),
      });
    }

    // (B) Uplift curves: churners prevented per 1,000 customers against the share targeted.
    // The axis goes below 0 only when a curve does.
    const xs = e.shares.map(s => 100 * s);
    const all = [].concat(...RULES.map(r => e.curves[r.key]));
    const lo = Math.min(...all), hi = Math.max(...all), pad = 0.06 * (hi - lo);
    const b = plot.chart(svgB, {
      x: { domain: [0, 100], label: 'Customers targeted (%)' },
      y: { domain: plot.niceDomain(lo < 0 ? lo - pad : 0, hi + pad), label: 'Churners prevented per 1,000 customers' },
      aspect: 0.5,
      title: 'Uplift curve: churners prevented as the firm targets more customers',
      desc: 'At the budget, uplift targeting prevents ' + fmt(P.uplift, 1) + ' churners per 1,000 customers, risk targeting ' +
        fmt(P.risk, 1) + ', random targeting ' + fmt(P.random, 1) + ', and the best possible rule ' + fmt(P.best, 1) + '.',
    });
    b.axes();
    for (const r of RULES) {
      b.line(e.curves[r.key].map((v, i) => ({ x: xs[i], y: v })), r.cls, { title: r.label });
    }
    b.vline(100 * p.budget, { label: 'Budget ' + pct(p.budget) });
    for (const r of RULES) {
      b.dots([{ x: 100 * p.budget, y: P[r.key] }], r.cls.split(' ')[0], {
        top: true, title: r.label + ' at ' + pct(p.budget) + ': ' + fmt(P[r.key], 1) + ' churners prevented per 1,000 customers',
      });
    }

    for (const r of RULES) {
      ui.setText('up-p-' + r.key, fmt(P[r.key], 1));
      ui.setText('up-r-' + r.key, pct(R[r.key]));
    }
    ui.setText('up-gap', fmt(P.uplift - P.risk, 1));
    ui.setText('up-overlap', pct(e.overlap));
    ui.setText('up-neg', pct(e.shareNegative));
    ui.setText('up-total', fmt(e.total, 1));
  }

  redraw = ui.bind(form, draw);
})();
