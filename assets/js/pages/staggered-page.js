// Page wiring for the staggered adoption module.
(function () {
  'use strict';
  const { ui, plot, staggered } = CP;
  const fmt = plot.fmt;
  const form = ui.byId('st-controls');
  const NAME = { early: 'Early', late: 'Late', never: 'Never' };
  const COLOR = { early: 's1', late: 's2', never: 's3' };

  plot.legend(ui.byId('st-legend-b'), [
    { label: 'Comparison whose control group does not have the policy', cls: 's1', kind: 'dot' },
    { label: 'Comparison whose control group already has the policy', cls: 's2', kind: 'dot' },
    { label: 'TWFE estimate', cls: 'sg', kind: 'line' },
    { label: 'True average effect over all treated store-periods', cls: 'sg', kind: 'dash' },
  ]);
  plot.legend(ui.byId('st-legend-c'), [
    { label: "Callaway and Sant'Anna estimate", cls: 's1', kind: 'dot' },
    { label: 'True value (known only in a simulation)', cls: 'sg', kind: 'dash' },
  ]);

  // Comparison label: the group that adopts comes first, then the control group.
  function compLabel(G, c, long) {
    const a = NAME[G[c.treated].name], b = NAME[G[c.control].name].toLowerCase();
    if (!long || c.type === 'never') return a + ' vs ' + b;
    return a + ' vs ' + b + ' (' + b + ' group ' + (c.type === 'notYet' ? 'does not have the policy yet)' : 'already has the policy)');
  }

  // Keep the y axes steady while the reader moves sliders on the same sample: an axis only grows.
  // Charts B and C start at -1 to 5, so the effects at the default settings and at moderate
  // settings fit without a change of scale. A new sample, a new noise level, or Reset starts again.
  let kept = {}, keptKey = '';
  form.addEventListener('reset', () => { keptKey = ''; });
  function steady(name, fresh, start) {
    const old = kept[name] || start || fresh;
    kept[name] = [Math.min(old[0], fresh[0]), Math.max(old[1], fresh[1])];
    return kept[name];
  }

  // Add a table row. The first cell can start with a color swatch.
  function addRow(tbody, cells, swatch, cls) {
    const tr = document.createElement('tr');
    if (cls) tr.className = cls;
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      if (i === 0 && swatch) {
        const s = document.createElement('span');
        s.className = 'swatch ' + swatch;
        td.appendChild(s);
      }
      td.appendChild(document.createTextNode(text));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    return tr;
  }

  // Put each label above or below its dot, at the first spot that does not touch
  // another label, a dot, or a horizontal reference line (lineYs, in data units).
  function labelDots(ch, items, lineYs) {
    const used = items.map(it => ({ x0: ch.sx(it.x) - 6, x1: ch.sx(it.x) + 6, y0: ch.sy(it.y) - 6, y1: ch.sy(it.y) + 6 }));
    lineYs.forEach(v => used.push({ x0: ch.left(), x1: ch.right(), y0: ch.sy(v) - 2, y1: ch.sy(v) + 2 }));
    const hits = b => used.some(u => u.x0 < b.x1 && b.x0 < u.x1 && u.y0 < b.y1 && b.y0 < u.y1);
    for (const it of items.slice().sort((a, b) => a.x - b.x)) {
      const px = ch.sx(it.x), py = ch.sy(it.y), w = 6.6 * it.text.length;
      const left = px + 8 + w > ch.right();
      const box = dy => ({ x0: left ? px - 8 - w : px + 8, x1: left ? px - 8 : px + 8 + w, y0: py + dy - 11, y1: py + dy + 2 });
      const spots = [-9, 18, -24, 33];
      const free = spots.find(dy => !hits(box(dy)));
      const dy = free === undefined ? spots[0] : free;
      used.push(box(dy));
      ch.text(it.x, it.y, it.text, { dx: left ? -8 : 8, dy, anchor: left ? 'end' : 'start' });
    }
  }

  function drawOutcomes(G, e, T) {
    plot.legend(ui.byId('st-legend-a'), G.map(g => ({
      label: NAME[g.name] + ' group' + (isFinite(g.start) ? ' (adopts in period ' + g.start + ')' : ' (does not adopt)'),
      cls: COLOR[g.name], kind: 'line',
    })));
    const ch = plot.chart(ui.byId('st-chart-a'), {
      x: { domain: [0.5, T + 0.5], ticks: e.periods, decimals: 0, label: 'Period' },
      y: { domain: steady('a', plot.extent([].concat(...e.groupMeans), { pad: 0.08 })), label: 'Average outcome' },
      title: 'Average outcome by group and period',
      desc: 'Average outcome of each group in periods 1 to ' + T + '.',
    });
    ch.axes();
    for (const g of G) {
      if (isFinite(g.start)) ch.vline(g.start - 0.5, { label: NAME[g.name] + (ch.W < 520 ? '' : ' group adopts') });
    }
    G.forEach((g, j) => {
      const pts = e.groupMeans[j].map((v, i) => ({ x: i + 1, y: v }));
      ch.line(pts, COLOR[g.name]);
      ch.dots(pts, COLOR[g.name], { title: d => NAME[g.name] + ' group, period ' + d.x + ': ' + fmt(d.y) });
    });
  }

  function fillReadout(e, never) {
    ui.setText('st-r-twfe', fmt(e.twfe));
    ui.setText('st-r-cs', fmt(e.csAvg));
    ui.setText('st-r-true', fmt(e.trueAll));
    ui.setText('st-r-truecs', fmt(e.csTruth));
    ui.setText('st-r-btwfe', fmt(e.biasTwfe));
    ui.setText('st-r-bcs', fmt(e.biasCs));
    ui.setText('st-cover', never
      ? 'Here the method can estimate all ' + e.treatedCount + ' treated store-periods.'
      : 'Without the never group, the method can estimate only ' + e.csCount + ' of the ' + e.treatedCount + ' treated store-periods.');
  }

  function drawDecomposition(G, e) {
    const comps = e.comparisons;
    const maxW = Math.max.apply(null, comps.map(c => c.weight));
    const ys = comps.map(c => c.estimate).concat([e.twfe, e.trueAll]);
    const ch = plot.chart(ui.byId('st-chart-b'), {
      x: { domain: [0, plot.niceDomain(0, maxW * 1.15)[1]], label: 'Weight in the TWFE estimate' },
      y: { domain: steady('b', plot.extent(ys, { include: [0], pad: 0.15 }), [-1, 5]), label: 'Estimate of the comparison' },
      aspect: 0.45,
      title: 'Goodman-Bacon decomposition of the TWFE estimate',
      desc: 'TWFE estimate ' + fmt(e.twfe) + '. True average effect ' + fmt(e.trueAll) + '. ' +
        comps.map(c => compLabel(G, c) + ': weight ' + fmt(c.weight, 3) + ', estimate ' + fmt(c.estimate)).join('. ') + '.',
    });
    ch.axes();
    ch.hline(e.trueAll, { cls: 'dash' });
    ch.hline(e.twfe);
    for (const c of comps) {
      ch.dots([{ x: c.weight, y: c.estimate }], c.type === 'already' ? 's2' : 's1', {
        top: true,
        title: compLabel(G, c, true) + ': weight ' + fmt(c.weight, 3) + ', estimate ' + fmt(c.estimate),
      });
    }
    // A narrow chart has no room for words, so numbers label the dots and the table repeats them.
    // The table then leaves out the words in parentheses: the row color and the legend give the same fact.
    const narrow = ch.W < 520;
    labelDots(ch, comps.map((c, i) => ({ x: c.weight, y: c.estimate, text: narrow ? String(i + 1) : compLabel(G, c) })),
      [e.twfe, e.trueAll]);

    const tbody = ui.byId('st-decomp');
    tbody.textContent = '';
    comps.forEach((c, i) => {
      addRow(tbody, [(narrow ? (i + 1) + '. ' : '') + compLabel(G, c, !narrow), c.from + ' to ' + c.to,
        fmt(c.weight, 3), fmt(c.estimate), fmt(c.weight * c.estimate, 3)], c.type === 'already' ? 's2' : 's1');
    });
    addRow(tbody, ['Sum', '', fmt(e.weightSum, 3), '', fmt(e.decompSum, 3)], null, 'key');
  }

  function drawEventTime(G, e) {
    const rows = e.eventTime, maxE = rows.length - 1;
    const ch = plot.chart(ui.byId('st-chart-c'), {
      x: { domain: [-0.5, maxE + 0.5], ticks: rows.map(r => r.e), decimals: 0, label: 'Periods since the group adopted' },
      y: { domain: steady('c', plot.extent(rows.map(r => r.estimate).concat(rows.map(r => r.truth)), { include: [0], pad: 0.1 }), [-1, 5]), label: 'Average effect' },
      aspect: 0.45,
      title: 'Average effect by periods since adoption',
      desc: rows.filter(r => r.groups.length).map(r => r.e + ' periods: estimate ' + fmt(r.estimate) + ', true ' + fmt(r.truth)).join('. ') + '.',
    });
    const firstMissing = rows.findIndex(r => !r.groups.length);
    if (firstMissing >= 0) ch.band(firstMissing - 0.5, maxE + 0.5, { label: 'No estimate' });
    ch.axes();
    ch.line(rows.map(r => ({ x: r.e, y: r.truth })), 'sg dash');
    ch.dots(rows.map(r => ({ x: r.e, y: r.estimate, truth: r.truth })), 's1', {
      title: d => d.x + ' periods after adoption: estimate ' + fmt(d.y) + ', true value ' + fmt(d.truth),
    });

    const tbody = ui.byId('st-event');
    tbody.textContent = '';
    for (const r of rows.filter(r => r.groups.length)) {
      const names = r.groups.map((j, i) => i ? NAME[G[j].name].toLowerCase() : NAME[G[j].name]).join(' and ');
      addRow(tbody, [String(r.e), names, fmt(r.estimate), fmt(r.truth)]).children[1].className = 'st-text';
    }
    if (firstMissing >= 0) {
      const tr = addRow(tbody, [firstMissing + ' to ' + maxE, 'None. No control stores are left, so the method gives no estimate.']);
      tr.lastChild.colSpan = 3;
      tr.lastChild.className = 'st-text';
    }
  }

  let redraw = () => {};
  const sampler = ui.sampler(ui.byId('st-new'), ui.byId('st-sample'), () => redraw());

  function draw(p) {
    const sim = staggered.simulate(Object.assign({}, p, { seed: sampler.seed }));
    const e = staggered.estimate(sim);
    const key = sampler.seed + '|' + p.noise;
    if (key !== keptKey) { kept = {}; keptKey = key; }
    drawOutcomes(sim.groups, e, sim.params.periods);
    fillReadout(e, p.neverGroup);
    drawDecomposition(sim.groups, e);
    drawEventTime(sim.groups, e);
  }

  redraw = ui.bind(form, draw);
})();
