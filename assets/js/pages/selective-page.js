// Page wiring for the selective labels module.
(function () {
  'use strict';
  const { ui, plot, selective } = CP;
  const fmt = plot.fmt;
  const form = ui.byId('sel-controls');
  const svg = ui.byId('sel-chart');
  const pct = v => (v === null ? 'none' : fmt(100 * v, 1) + '%');
  const wholePct = v => Math.round(100 * v) + '%';
  // Judges' release rates are multiples of 0.25%, so two decimals show them exactly.
  const ratePct = v => fmt(100 * v, 2) + '%';
  const count = n => n.toLocaleString('en-US');

  plot.legend(ui.byId('sel-legend'), [
    { label: 'Model rule, true failure rate (known only in the simulation)', cls: 's1', kind: 'dash' },
    { label: 'Model rule, naive evaluation', cls: 's2', kind: 'line' },
    { label: 'Contraction estimate', cls: 's3', kind: 'line' },
    { label: 'Judges 1 to 5', cls: 'sg', kind: 'hollow' },
  ]);

  let redraw = () => {};
  const sampler = ui.sampler(ui.byId('sel-new'), ui.byId('sel-sample'), () => redraw());

  function draw(p) {
    const sim = selective.simulate(Object.assign({}, p, { seed: sampler.seed }));
    const e = selective.estimate(sim);
    const a = e.atRate, c = a.contraction;

    // The y axis stays at 0 to 30% unless a value is higher, so slider moves are easy to compare.
    let top = 0.3;
    for (const v of e.curves) top = Math.max(top, v.truth, v.naive, v.contraction || 0);
    for (const j of e.judges) top = Math.max(top, j.failure);
    const ch = plot.chart(svg, {
      x: { domain: [0.5, 1], label: 'Release rate (share released)', format: wholePct },
      y: { domain: [0, Math.ceil(top / 0.05 - 1e-9) * 0.05], label: 'Failure rate', format: wholePct },
      title: 'Failure rate by release rate',
      desc: 'At a release rate of ' + wholePct(a.rate) + ', the naive evaluation of the model rule is ' + pct(a.naive) +
        ' and its true failure rate is ' + pct(a.truth) + '. ' +
        (c ? 'The contraction estimate is ' + pct(c.estimate) + '.' : 'Contraction gives no estimate at this rate.'),
    });
    ch.axes();
    const series = key => e.curves.map(v => ({ x: v.rate, y: v[key] }));
    // The dashed true line goes on top of the naive line, so it stays visible where the two meet.
    ch.line(series('naive'), 's2');
    ch.line(series('truth'), 's1 dash');
    ch.line(series('contraction'), 's3');
    ch.vline(a.rate, { label: 'Readouts', anchor: a.rate > 0.9 ? 'end' : 'start' });
    ch.dots(e.judges.map(j => ({ x: j.rate, y: j.failure, judge: j.judge })), 'sg', {
      hollow: true, r: 7,
      title: d => 'Judge ' + d.judge + ': release rate ' + ratePct(d.x) + ', failure rate ' + pct(d.y),
    });
    ch.dots(e.judges.map(j => ({ x: j.rate, y: j.contraction })), 's3', {
      r: 4, top: true,
      title: d => 'Contraction at a release rate of ' + ratePct(d.x) + ': failure rate ' + pct(d.y),
    });
    // Judge numbers go to the right of the circles, or below them when the circles are close together.
    const crowded = ch.sx(e.judges[1].rate) - ch.sx(e.judges[0].rate) < 26;
    const place = crowded ? { anchor: 'middle', dy: 22 } : { dx: 10, dy: 4 };
    for (const j of e.judges) ch.text(j.rate, j.failure, String(j.judge), Object.assign({ cls: 'note judge-label' }, place));

    // Table: each judge next to the rules at the same release rate.
    const body = ui.byId('sel-judges');
    while (body.firstChild) body.removeChild(body.firstChild);
    for (const j of e.judges) {
      const tr = document.createElement('tr');
      for (const text of ['Judge ' + j.judge, ratePct(j.rate), pct(j.failure), pct(j.contraction), pct(j.naive), pct(j.truth)]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }

    // Readouts at the chosen release rate.
    ui.setText('sel-rate-1', wholePct(a.rate));
    ui.setText('sel-r-naive', pct(a.naive));
    ui.setText('sel-r-true', pct(a.truth));
    ui.setText('sel-r-gap', fmt(100 * a.gap, 1));
    const lenient = wholePct(e.lenientRate);
    if (c) {
      ui.setText('sel-c-note', 'Contraction covers release rates up to ' + lenient + ', the release rate of the most lenient judge.');
      ui.setText('sel-r-c', pct(c.estimate));
      ui.setText('sel-r-ctrue', pct(c.truth));
      ui.setText('sel-r-extra', count(c.extra));
    } else {
      ui.setText('sel-c-note', 'The readout rate is above ' + lenient + ', the release rate of the most lenient judge. Contraction gives no estimate there.');
      ['sel-r-c', 'sel-r-ctrue', 'sel-r-extra'].forEach(id => ui.setText(id, 'none'));
    }
    ui.setText('sel-r-ndet', count(e.detained.n));
    ui.setText('sel-r-dpred', pct(e.detained.predicted));
    ui.setText('sel-r-dtrue', pct(e.detained.truth));

    const st = e.strata;
    ui.setText('sel-st-strict', wholePct(st.strictRate));
    ui.setText('sel-st-lenient', wholePct(st.lenientRate));
    [['a', st.bothReleased], ['b', st.lenientOnly], ['c', st.bothDetained]].forEach(([k, g]) => {
      ui.setText('sel-st-' + k + '-share', wholePct(g.share));
      ui.setText('sel-st-' + k + '-risk', g.risk === null ? 'no defendants' : pct(g.risk));
    });
  }

  redraw = ui.bind(form, draw);
})();
