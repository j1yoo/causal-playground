// Page wiring for the regression adjustment and good and bad controls module.
(function () {
  'use strict';
  const { ui, plot, controls: C } = CP;
  const fmt = plot.fmt;
  const pct = v => fmt(100 * v, 0) + '%';
  const wideChart = svg => (svg.parentNode.getBoundingClientRect().width || 640) >= 560;

  // ---- Part 1: regression adjustment ----
  const formA = ui.byId('adj-controls');
  const svgMeans = ui.byId('adj-means'), svgEst = ui.byId('adj-est');
  plot.legend(ui.byId('adj-means-legend'), [
    { label: 'Members: observed average', cls: 's1', kind: 'dot' },
    { label: 'Nonmembers: observed average', cls: 's2', kind: 'dot' },
    { label: 'True average with the membership (simulation only)', cls: 's1', kind: 'dash' },
    { label: 'True average without the membership (simulation only)', cls: 's2', kind: 'dash' },
    { label: 'What the straight-line regression assumes', cls: 'sg', kind: 'dotted' },
  ]);
  const EST = [
    { key: 'naive', letter: 'A', short: 'A. Simple difference', label: 'A. Simple difference in means', cls: 's3' },
    { key: 'line', letter: 'B', short: 'B. Straight line', label: 'B. Regression with a straight line in the segment number', cls: 's5' },
    { key: 'strat', letter: 'C', short: 'C. Segment-weighted', label: 'C. Segment differences weighted by segment size', cls: 's1' },
    { key: 'fe', letter: 'D', short: 'D. Segment intercepts', label: 'D. Regression with a separate intercept for each segment', cls: 's4' },
  ];
  plot.legend(ui.byId('adj-est-legend'), EST.map(r => ({ label: r.label, cls: r.cls, kind: 'whisker' })).concat([
    { label: 'True ATE (simulation only)', cls: 'sg', kind: 'dash' },
    { label: 'True ATT (simulation only)', cls: 'sm', kind: 'dash' },
  ]));
  let redrawA = () => {};
  // The first sample uses seed 15. Its estimates at the default settings are close to their averages
  // over 200 seeds (segment-weighted 9.99 against 10.04; simple difference 26.02 against 25.75).
  const samplerA = ui.sampler(ui.byId('adj-new'), ui.byId('adj-sample'), () => redrawA(), 15);
  // Keep an axis steady while sliders move on the same sample: it grows, and it shrinks back only when
  // the new range is less than a third of the kept one. A new sample or Reset starts it again.
  const settle = (keep, fresh) => (keep && (fresh[1] - fresh[0]) * 3 >= keep[1] - keep[0]
    ? [Math.min(keep[0], fresh[0]), Math.max(keep[1], fresh[1])] : fresh);
  let yKeep = null, yKey = '';
  formA.addEventListener('reset', () => { yKey = ''; });

  function drawMeans(sim, e) {
    const seg = sim.seg, wide = wideChart(svgMeans);
    const pts1 = [], pts0 = [], true1 = [], true0 = [];
    seg.forEach((g, j) => {
      const c = e.cell[j];
      if (c.n1) pts1.push({ x: j + 1, y: c.s1 / c.n1, n: c.n1, name: g.name });
      if (c.n0) pts0.push({ x: j + 1, y: c.s0 / c.n0, n: c.n0, name: g.name });
      true1.push({ x: j + 1, y: g.mean0 + g.effect });
      true0.push({ x: j + 1, y: g.mean0 });
    });
    // The straight-line regression: spending = a + b * segment number + tau * member.
    const X = [], ya = [];
    for (let i = 0; i < sim.n; i++) { X.push([1, sim.d[i], sim.s[i]]); ya.push(sim.y[i]); }
    let fit = null;
    try { fit = CP.stats.ols(X, ya, { se: 'none' }).beta; } catch (err) { fit = null; }
    const vals = [].concat(pts1, pts0, true1, true0).map(q => q.y);
    if (fit) vals.push(fit[0] + fit[2] * -0.3, fit[0] + fit[2] * 3.3, fit[0] + fit[1] + fit[2] * -0.3, fit[0] + fit[1] + fit[2] * 3.3);
    const yd = plot.extent(vals, { pad: 0.1 });
    const ch = plot.chart(svgMeans, {
      x: { domain: [0.5, 4.5], ticks: [1, 2, 3, 4], format: v => (seg[v - 1] ? (wide ? seg[v - 1].name : seg[v - 1].name[0]) : '') },
      y: { domain: yd, label: 'Spending (dollars)' },
      title: 'Average spending by segment and membership',
      desc: seg.map((g, j) => g.name + ': ' + fmt(100 * e.cell[j].n1 / (e.cell[j].n1 + e.cell[j].n0), 1) + '% members').join('. ') + '.',
      aspect: 0.45,
    });
    ch.axes();
    if (fit) {
      const line = shift => [{ x: 0.7, y: fit[0] + shift + fit[2] * -0.3 }, { x: 4.3, y: fit[0] + shift + fit[2] * 3.3 }];
      ch.line(line(0), 'sg dotted');
      ch.line(line(fit[1]), 'sg dotted');
    }
    ch.line(true0, 's2 dash');
    ch.line(true1, 's1 dash');
    const title = who => q => q.name + ', ' + who + ': average ' + fmt(q.y) + ' dollars, ' + q.n + (q.n === 1 ? ' customer' : ' customers');
    ch.dots(pts0, 's2', { title: title('nonmembers') });
    ch.dots(pts1, 's1', { title: title('members') });
  }

  function drawEst(e) {
    const vals = [e.ate, e.att];
    for (const r of EST) { const q = e[r.key]; if (isFinite(q.est)) vals.push(q.est, q.est - 1.96 * q.se, q.est + 1.96 * q.se); }
    const fresh = plot.extent(vals, { pad: 0.08, include: [0] });
    const key = samplerA.seed + '|' + formA.elements.n.value;
    const yd = settle(key === yKey ? yKeep : null, fresh);
    yKeep = yd; yKey = key;
    const wide = wideChart(svgEst);
    const ch = plot.chart(svgEst, {
      x: { domain: [0.5, 4.5], ticks: [1, 2, 3, 4], format: v => (EST[v - 1] ? (wide ? EST[v - 1].short : EST[v - 1].letter) : '') },
      y: { domain: yd, label: 'Estimate (dollars)' },
      title: 'Four estimates with 95% confidence intervals',
      desc: EST.map(r => r.short + ' ' + (isFinite(e[r.key].est) ? fmt(e[r.key].est) : 'not possible')).join('. ') + '. True ATE ' + fmt(e.ate) + '. True ATT ' + fmt(e.att) + '.',
      aspect: 0.45,
    });
    ch.axes();
    ch.segment(0.5, e.att, 4.5, e.att, 'sm dash');
    ch.segment(0.5, e.ate, 4.5, e.ate, 'sg dash');
    EST.forEach((r, j) => {
      const q = e[r.key];
      if (!isFinite(q.est)) return;
      ch.whiskers([{ x: j + 1, y: q.est, lo: q.est - 1.96 * q.se, hi: q.est + 1.96 * q.se }], r.cls, {
        title: () => r.label + ': ' + fmt(q.est) + (isFinite(q.se) ? ', 95% interval ' + fmt(q.est - 1.96 * q.se) + ' to ' + fmt(q.est + 1.96 * q.se) : ', no interval'),
      });
    });
  }

  function drawA(p) {
    const sim = C.simulateAdjust({ n: p.n, selection: p.selection, hetero: p.hetero, curve: p.curve, seed: samplerA.seed });
    const e = C.estimateAdjust(sim);
    drawMeans(sim, e);
    drawEst(e);
    for (const r of EST) {
      const q = e[r.key];
      const text = !isFinite(q.est) ? 'not possible: a segment has no members or no nonmembers'
        : !isFinite(q.se) ? fmt(q.est) + ' (no interval)'
        : fmt(q.est) + ' (' + fmt(q.est - 1.96 * q.se) + ' to ' + fmt(q.est + 1.96 * q.se) + ')';
      ui.setText('adj-r-' + r.key, text);
    }
    ui.setText('adj-note', e.possible && !e.withSe ? 'C has no interval: a segment has only one member or one nonmember, so its variance cannot be estimated.' : '');
    ui.setText('adj-key', wideChart(svgMeans) ? '' : 'N: new. O: occasional. R: regular. L: loyal.');
    ui.setText('adj-r-ate', fmt(e.ate));
    ui.setText('adj-r-att', fmt(e.att));
    const feTarget = sim.seg.reduce((a, g, j) => a + e.feWeights[j] * g.effect, 0);
    ui.setText('adj-r-fet', fmt(feTarget));
    sim.seg.forEach((g, j) => {
      const c = e.cell[j];
      ui.setText('adj-s' + j + '-share', fmt(100 * c.n1 / (c.n1 + c.n0), 1) + '%');
      ui.setText('adj-s' + j + '-mean0', fmt(g.mean0, 1));
      ui.setText('adj-s' + j + '-effect', fmt(g.effect, 1));
      ui.setText('adj-s' + j + '-wd', pct(e.sizeWeights[j]));
      ui.setText('adj-s' + j + '-wc', pct(e.feWeights[j]));
    });
  }
  redrawA = ui.bind(formA, drawA);

  // ---- Part 2: good and bad controls ----
  const formB = ui.byId('dag-controls');
  const svgDag = ui.byId('dag-est');
  const dagBox = ui.byId('dag-figure');
  plot.legend(ui.byId('dag-est-legend'), [
    { label: 'Regression of sales on advertising', cls: 's2', kind: 'whisker' },
    { label: 'Regression of sales on advertising and Z', cls: 's1', kind: 'whisker' },
    { label: 'True effect (simulation only)', cls: 'sg', kind: 'dash' },
  ]);

  // Node positions in a 360 by 200 box, arrows, and the text for each structure.
  const NODES = { D: [70, 160, 'D'], Y: [290, 160, 'Y'] };
  const LAYOUT = {
    confounder: { nodes: { Z: [180, 50] }, edges: [['Z', 'D'], ['Z', 'Y']] },
    mediator: { nodes: { Z: [180, 50] }, edges: [['D', 'Z'], ['Z', 'Y']] },
    collider: { nodes: { Z: [180, 50] }, edges: [['D', 'Z'], ['Y', 'Z']] },
    mbias: { nodes: { U1: [70, 40], U2: [290, 40], Z: [180, 90] }, edges: [['U1', 'D'], ['U1', 'Z'], ['U2', 'Z'], ['U2', 'Y']], hidden: ['U1', 'U2'] },
    outcomeCause: { nodes: { Z: [290, 50] }, edges: [['Z', 'Y']] },
    treatmentCause: { nodes: { Z: [70, 50] }, edges: [['Z', 'D']] },
    amplify: { nodes: { Z: [70, 50], U: [180, 60] }, edges: [['Z', 'D'], ['U', 'D'], ['U', 'Y']], hidden: ['U'] },
  };
  const TEXT = {
    confounder: { z: 'Z is store size. Larger stores spend more on advertising and also sell more.',
      paths: 'Without Z, the back-door path D ← Z → Y is open. Adjusting for Z blocks it.', verdict: 'Good control: adjust for Z.' },
    mediator: { z: 'Z is store visits. Advertising brings visits, and visits bring sales.',
      paths: 'Part of the effect runs along D → Z → Y. Adjusting for Z blocks this part of the effect.', verdict: 'Bad control for the total effect: do not adjust for Z.' },
    collider: { z: 'Z is an award for top stores. High advertising or high sales make a store more likely to win it.',
      paths: 'The path D → Z ← Y is blocked at the collider Z. Adjusting for Z opens it.', verdict: 'Bad control: adjusting for Z creates collider bias. Do not adjust for Z.' },
    mbias: { z: 'Z is local press coverage. The ambition of the store manager (U1) raises advertising and coverage. The local economy (U2) raises coverage and sales. Neither U1 nor U2 is measured.',
      paths: 'The path D ← U1 → Z ← U2 → Y is blocked at the collider Z. Adjusting for Z opens it, although Z is measured before the advertising.', verdict: 'Bad control, measured before the treatment: do not adjust for Z.' },
    outcomeCause: { z: 'Z is the weather. Sunny days raise sales and have nothing to do with advertising.',
      paths: 'Z is on no path from D to Y. Adjusting for Z removes part of the noise in sales.', verdict: 'Neutral for bias, better precision: adjusting for Z helps.' },
    treatmentCause: { z: 'Z is the quota of an ad agency. It changes advertising and nothing else.',
      paths: 'Z is on no back-door path. Adjusting for Z removes part of the variation in advertising that the estimate uses.', verdict: 'Neutral for bias, worse precision: adjusting for Z hurts.' },
    amplify: { z: 'Z is the quota of an ad agency, and U is the skill of the store manager. Skill raises both advertising and sales and is not measured.',
      paths: 'The back-door path D ← U → Y is open whether or not you adjust for Z. Adjusting for Z leaves less variation in advertising, so U explains a larger part of what remains.', verdict: 'Bad control: in linear models like this one, adjusting for Z always increases the bias.' },
  };

  function drawDag(structure) {
    const NS = 'http://www.w3.org/2000/svg';
    const lay = LAYOUT[structure];
    const pos = Object.assign({}, NODES, lay.nodes);
    while (dagBox.firstChild) dagBox.removeChild(dagBox.firstChild);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 360 200');
    svg.setAttribute('role', 'img');
    svg.setAttribute('class', 'dag');
    const title = document.createElementNS(NS, 'title');
    title.textContent = 'Causal diagram: ' + lay.edges.concat([['D', 'Y']]).map(e => e[0] + ' causes ' + e[1]).join(', ') +
      (lay.hidden ? '. Not measured: ' + lay.hidden.join(' and ') : '') + '.';
    svg.appendChild(title);
    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = '<marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"></path></marker>';
    svg.appendChild(defs);
    const R = 19;
    for (const [a, b] of lay.edges.concat([['D', 'Y']])) {
      const [x1, y1] = pos[a], [x2, y2] = pos[b];
      const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', (x1 + ux * R).toFixed(1)); line.setAttribute('y1', (y1 + uy * R).toFixed(1));
      line.setAttribute('x2', (x2 - ux * (R + 2)).toFixed(1)); line.setAttribute('y2', (y2 - uy * (R + 2)).toFixed(1));
      line.setAttribute('marker-end', 'url(#dag-arrow)');
      if (a === 'D' && b === 'Y') line.setAttribute('class', 'effect');
      svg.appendChild(line);
    }
    for (const key of Object.keys(pos)) {
      const [x, y] = pos[key];
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', R);
      c.setAttribute('class', (lay.hidden || []).includes(key) ? 'hidden' : key === 'Z' ? 'z' : '');
      svg.appendChild(c);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y + 5); t.setAttribute('text-anchor', 'middle');
      t.textContent = key;
      svg.appendChild(t);
    }
    dagBox.appendChild(svg);
  }

  let redrawB = () => {};
  let dKeep = null, dKey = '';
  formB.addEventListener('reset', () => { dKey = ''; });
  const samplerB = ui.sampler(ui.byId('dag-new'), ui.byId('dag-sample'), () => redrawB());

  function drawB(p) {
    // Above 500 stores, 200 repeated samples keep one redraw fast.
    const r = C.replicateDag({ structure: p.structure, strength: p.strength, n: p.n, reps: p.n > 500 ? 200 : 400, seed: samplerB.seed });
    ui.setText('dag-reps', String(r.params.reps));
    const lb = C.limitBias({ structure: p.structure, strength: p.strength });
    const s = r.summary;
    drawDag(p.structure);
    const key2 = samplerB.seed + '|' + p.structure + '|' + p.n;
    const yd = settle(key2 === dKey ? dKeep : null, plot.extent([s.without.lo, s.without.hi, s.with.lo, s.with.hi, r.truth], { pad: 0.15 }));
    dKeep = yd; dKey = key2;
    const ch = plot.chart(svgDag, {
      x: { domain: [0.5, 2.5], ticks: [1, 2], format: v => (v === 1 ? 'Without Z' : v === 2 ? 'With Z' : '') },
      y: { domain: yd, label: 'Estimated effect of advertising' },
      title: 'Estimates from ' + r.params.reps + ' repeated samples, without and with Z',
      desc: 'Without Z: average ' + fmt(s.without.mean) + '. With Z: average ' + fmt(s.with.mean) + '. True effect ' + fmt(r.truth) + '.',
      aspect: 0.6,
    });
    ch.axes();
    ch.hline(r.truth, { cls: 'dash' });
    ch.whiskers([{ x: 1, y: s.without.mean, lo: s.without.lo, hi: s.without.hi }], 's2', {
      title: () => 'Without Z: average ' + fmt(s.without.mean) + ', middle 95% from ' + fmt(s.without.lo) + ' to ' + fmt(s.without.hi) });
    ch.whiskers([{ x: 2, y: s.with.mean, lo: s.with.lo, hi: s.with.hi }], 's1', {
      title: () => 'With Z: average ' + fmt(s.with.mean) + ', middle 95% from ' + fmt(s.with.lo) + ' to ' + fmt(s.with.hi) });

    const t = TEXT[p.structure];
    ui.setText('dag-z', t.z);
    ui.setText('dag-paths', t.paths);
    ui.setText('dag-verdict', t.verdict);
    for (const k of ['without', 'with']) {
      ui.setText('dag-' + k + '-mean', fmt(s[k].mean, 3));
      ui.setText('dag-' + k + '-sd', fmt(s[k].sd, 3));
      ui.setText('dag-' + k + '-cover', fmt(100 * s[k].cover, 1) + '%');
      ui.setText('dag-' + k + '-bias', fmt(lb[k], 3));
    }
  }
  redrawB = ui.bind(formB, drawB);
})();
