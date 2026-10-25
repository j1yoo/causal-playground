// Page wiring for the principal strata module.
(function () {
  'use strict';
  const { ui, plot, strata } = CP;
  const fmt = plot.fmt;
  const form = ui.byId('ps-controls');
  const svg = ui.byId('ps-chart');
  const pct = v => Math.round(100 * v) + '%';

  plot.legend(ui.byId('ps-legend'), [
    { label: 'Always employed (works with or without training)', cls: 's1', kind: 'dot' },
    { label: 'Helped by the training (works only with training)', cls: 's2', kind: 'dot' },
    { label: 'Average wage of all workers in the column', cls: 'sg', kind: 'line' },
    { label: 'Average wage of the always employed among trained workers (simulation only)', cls: 's1', kind: 'dash' },
  ]);

  let redraw = () => {};
  const sampler = ui.sampler(ui.byId('ps-new'), ui.byId('ps-sample'), () => redraw());

  // Keep the y axis steady while the reader moves sliders on the same sample.
  let yKeep = null, yKey = '';
  form.addEventListener('reset', () => { yKey = ''; });

  function draw(p) {
    const sim = strata.simulate(Object.assign({}, p, { seed: sampler.seed }));
    const e = strata.estimate(sim);

    const fresh = plot.extent(e.employed.map(q => q.y), { pad: 0.04 });
    const key = sampler.seed + '|' + p.noise + '|' + p.slope;
    yKeep = key === yKey && yKeep ? [Math.min(yKeep[0], fresh[0]), Math.max(yKeep[1], fresh[1])] : fresh;
    yKey = key;
    const ch = plot.chart(svg, {
      x: { domain: [0.4, 2.6], ticks: [1, 2], format: v => (v === 1 ? 'No training' : 'Training'), label: 'Group (assigned by a coin flip)' },
      y: { domain: yKeep, label: 'Wage of a person with a job' },
      title: 'Wages of people with a job, by training group',
      desc: 'Naive comparison ' + fmt(e.naive) + '. True effect for the always employed ' + fmt(e.truth) + '. Fair comparison ' + fmt(e.fair) + '.',
    });
    ch.axes();
    // Spread the dots sideways by readiness across the full width of each column.
    // Workers with the lowest readiness sit on the left, so the helped workers form the left part
    // of the training column.
    const x = q => {
      const lo = q.d ? strata.BASE_RATE - p.helped : strata.BASE_RATE;
      return (q.d ? 2 : 1) - 0.35 + 0.7 * (q.r - lo) / (1 - lo);
    };
    const title = q => (q.stratum === 'always' ? 'Always employed' : 'Helped by the training') + ': wage ' + fmt(q.y);
    const pts = g => e.employed.filter(q => q.stratum === g).map(q => ({ x: x(q), y: q.y, q }));
    ch.dots(pts('always'), 's1', { r: 2.6, small: true, opacity: 0.55, title: d => title(d.q) });
    ch.dots(pts('helped'), 's2', { r: 2.6, small: true, opacity: 0.75, title: d => title(d.q) });
    // Averages as short horizontal lines over each column.
    const seg = (cx, y, cls) => ch.line([{ x: cx - 0.42, y }, { x: cx + 0.42, y }], cls, { top: true });
    seg(1, e.meanC, 'sg thick');
    seg(2, e.meanT, 'sg thick');
    seg(2, e.meanTalways, 's1 dash thick');
    ch.text(2.45, e.meanT, fmt(e.meanT), { cls: 'note halo', dy: 4 });
    ch.text(1.45, e.meanC, fmt(e.meanC), { cls: 'note halo', dy: 4 });

    const st = e.strata;
    ui.setText('ps-s-always', pct(st.always.share));
    ui.setText('ps-s-helped', pct(st.helped.share));
    ui.setText('ps-s-never', pct(st.never.share));
    ui.setText('ps-w-always', fmt(st.always.wage1));
    ui.setText('ps-w-helped', st.helped.share > 0 ? fmt(st.helped.wage1) : 'nobody in this group');

    ui.setText('ps-r-qc', pct(e.qC));
    ui.setText('ps-r-qt', pct(e.qT));
    ui.setText('ps-r-naive', fmt(e.naive));
    ui.setText('ps-r-ci', fmt(e.ciLow) + ' to ' + fmt(e.ciHigh));
    ui.setText('ps-r-true', fmt(e.truth));
    ui.setText('ps-r-err', fmt(e.error));
    ui.setText('ps-r-fair', fmt(e.fair));
    ui.setText('ps-r-lee', fmt(e.lee.lower) + ' to ' + fmt(e.lee.upper));
    ui.setText('ps-r-trim', pct(e.lee.trim));
  }

  redraw = ui.bind(form, draw);
})();
