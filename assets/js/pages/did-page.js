// Page wiring for the difference-in-differences module.
(function () {
  'use strict';
  const { ui, plot, did } = CP;
  const fmt = plot.fmt;
  const form = ui.byId('did-controls');
  const svg = ui.byId('did-chart');

  plot.legend(ui.byId('did-legend'), [
    { label: 'Treated group (observed)', cls: 's1', kind: 'line' },
    { label: 'Comparison group (observed)', cls: 's2', kind: 'line' },
    { label: 'Treated group without the policy (true, not observed in real data)', cls: 's1', kind: 'dash' },
    { label: 'What DiD assumes for the treated group without the policy', cls: 'sg', kind: 'dotted' },
  ]);

  let redraw = () => {};
  const sampler = ui.sampler(ui.byId('did-new'), ui.byId('did-sample'), () => redraw());

  // Keep the y axis steady while the reader moves sliders on the same sample:
  // the axis only grows. A new sample, a new noise level, or Reset starts it again.
  let yKeep = null, yKey = '';
  form.addEventListener('reset', () => { yKey = ''; });

  function draw(p) {
    const sim = did.simulate(Object.assign({}, p, { seed: sampler.seed }));
    const e = did.estimate(sim);
    const T = sim.params.periods, t0 = sim.params.start;
    const fresh = plot.extent([].concat(e.treatedObs, e.controlObs, e.treatedNoPolicy, e.assumed), { pad: 0.06 });
    const key = sampler.seed + '|' + p.noise;
    yKeep = key === yKey && yKeep ? [Math.min(yKeep[0], fresh[0]), Math.max(yKeep[1], fresh[1])] : fresh;
    yKey = key;
    const yd = yKeep;
    const ch = plot.chart(svg, {
      x: { domain: [0.5, T + 0.5], ticks: e.periods, decimals: 0, label: 'Period' },
      y: { domain: yd, label: 'Average outcome' },
      title: 'Average outcome by group and period',
      desc: 'DiD estimate ' + fmt(e.did) + '. True effect ' + fmt(e.att) + '. Estimate minus true effect ' + fmt(e.bias) + '.',
    });
    ch.band(t0 - 0.5, T + 0.5);
    ch.axes();
    ch.vline(t0 - 0.5, { label: 'Policy starts' });
    const all = arr => arr.map((v, i) => ({ x: i + 1, y: v }));
    const fromLastPre = arr => arr.map((v, i) => ({ x: i + 1, y: i + 1 >= t0 - 1 ? v : null }));
    ch.line(fromLastPre(e.assumed), 'sg dotted');
    ch.line(fromLastPre(e.treatedNoPolicy), 's1 dash');
    ch.line(all(e.controlObs), 's2');
    ch.dots(all(e.controlObs), 's2', { title: d => 'Comparison group, period ' + d.x + ': ' + fmt(d.y) });
    ch.line(all(e.treatedObs), 's1');
    ch.dots(all(e.treatedObs), 's1', { title: d => 'Treated group, period ' + d.x + ': ' + fmt(d.y) });

    const tb = e.table;
    ui.setText('did-tb', fmt(tb.treated.before));
    ui.setText('did-ta', fmt(tb.treated.after));
    ui.setText('did-tc', fmt(tb.treated.change));
    ui.setText('did-cb', fmt(tb.control.before));
    ui.setText('did-ca', fmt(tb.control.after));
    ui.setText('did-cc', fmt(tb.control.change));
    ui.setText('did-est', fmt(e.did));
    const avg = (arr, from, to) => { let t = 0; for (let i = from; i < to; i++) t += arr[i]; return t / (to - from); };
    const nb = avg(e.treatedNoPolicy, 0, t0 - 1), na = avg(e.treatedNoPolicy, t0 - 1, T);
    ui.setText('did-nb', fmt(nb));
    ui.setText('did-na', fmt(na));
    ui.setText('did-nc', fmt(na - nb));
    ui.setText('did-r-est', fmt(e.did));
    ui.setText('did-r-ci', fmt(e.ciLow) + ' to ' + fmt(e.ciHigh));
    ui.setText('did-r-att', fmt(e.att));
    ui.setText('did-r-bias', fmt(e.bias));
    ui.setText('did-r-pre', fmt(e.preSlope));
  }

  redraw = ui.bind(form, draw);
})();
