// Page wiring for the Neyman variance and blocking module.
(function () {
  'use strict';
  const { ui, plot, neyman } = CP;
  const fmt = plot.fmt;
  const pct = v => fmt(100 * v, 1) + '%';
  const count = v => Number(v).toLocaleString('en-US');

  // ---- Part A: the same customers, new coin flips ----
  const formA = ui.byId('ny-controls');
  const svgA = ui.byId('ny-chart');
  plot.legend(ui.byId('ny-legend'), [
    { label: 'Estimates from the repeated experiments', cls: 'sm', kind: 'bar' },
    { label: 'Normal curve with the true standard deviation (simulation only)', cls: 's1', kind: 'dash' },
    { label: 'Normal curve with the average Neyman standard error', cls: 's2', kind: 'line' },
    { label: 'Normal curve with the average classical standard error', cls: 's3', kind: 'line' },
  ]);
  let redrawA = () => {};
  const samplerA = ui.sampler(ui.byId('ny-new'), ui.byId('ny-sample'), () => redrawA());
  // Keep an axis steady while sliders move on the same sample: it grows, and it shrinks back only when
  // the new range is less than a third of the kept one. A new sample or Reset starts it again.
  const settle = (keep, fresh) => (keep && (fresh[1] - fresh[0]) * 3 >= keep[1] - keep[0]
    ? [Math.min(keep[0], fresh[0]), Math.max(keep[1], fresh[1])] : fresh);
  let xKeep = null, xKey = '';
  formA.addEventListener('reset', () => { xKey = ''; });

  function normalCurve(center, sd, scale, xd) {
    const pts = [];
    for (let k = 0; k <= 120; k++) {
      const x = xd[0] + (xd[1] - xd[0]) * k / 120;
      const z = (x - center) / sd;
      pts.push({ x, y: scale * Math.exp(-z * z / 2) / (sd * Math.sqrt(2 * Math.PI)) });
    }
    return pts;
  }

  function drawA(p) {
    const r = neyman.replicate({ n: p.n, share: p.share, spread: p.spread, target: p.target, seed: samplerA.seed });
    const reps = r.params.reps;
    // Horizontal axis: the target plus or minus 4.5 of the largest standard deviation shown.
    const half = 4.5 * Math.max(r.trueSd, r.meanNeyman, r.meanClassical);
    const fresh = plot.niceDomain(r.truth - half, r.truth + half);
    const key = samplerA.seed + '|' + p.n + '|' + p.target;
    const xd = settle(key === xKey ? xKeep : null, fresh);
    xKeep = xd; xKey = key;
    const bins = 40, width = (xd[1] - xd[0]) / bins;
    const counts = new Array(bins).fill(0);
    for (const v of r.est) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - xd[0]) / width)))]++;
    const scale = reps * width;
    const curves = [
      { sd: r.trueSd, cls: 's1 dash' },
      { sd: r.meanNeyman, cls: 's2' },
      { sd: r.meanClassical, cls: 's3' },
    ].map(c => Object.assign(c, { pts: normalCurve(r.truth, c.sd, scale, xd) }));
    let top = Math.max(...counts);
    for (const c of curves) for (const q of c.pts) top = Math.max(top, q.y);
    const targetName = p.target === 'pate' ? 'PATE' : 'SATE';
    const ch = plot.chart(svgA, {
      x: { domain: xd, label: 'Difference in means (dollars)' },
      y: { domain: plot.niceDomain(0, top * 1.08), label: 'Number of experiments' },
      title: 'Estimates from ' + count(reps) + ' repeated experiments',
      desc: 'True ' + targetName + ' ' + fmt(r.truth) + '. True standard deviation ' + fmt(r.trueSd) +
        '. Average Neyman standard error ' + fmt(r.meanNeyman) + '. Average classical standard error ' + fmt(r.meanClassical) + '.',
      aspect: 0.5,
    });
    ch.axes();
    const px = Math.max(1, ch.sx(xd[0] + width) - ch.sx(xd[0]) - 1);
    ch.bars(counts.map((c, j) => ({ x: xd[0] + (j + 0.5) * width, y: c,
      title: 'Estimates from ' + fmt(xd[0] + j * width) + ' to ' + fmt(xd[0] + (j + 1) * width) + ': ' + c + (c === 1 ? ' experiment' : ' experiments') })), 'sm', { width: px });
    for (const c of curves.slice().reverse()) ch.line(c.pts, c.cls);
    ch.segment(r.truth, ch.yd[0], r.truth, ch.yd[1], 'sg dash');
    ch.text(r.truth, ch.yd[1], 'true ' + targetName, { dx: 6, dy: 12, cls: 'note halo' });

    const f = r.finite;
    ui.setText('ny-r-target-name', 'True ' + targetName + (p.target === 'pate' ? ' (population)' : ' (these customers)'));
    ui.setText('ny-r-target', fmt(r.truth));
    ui.setText('ny-r-mean', fmt(r.meanEst));
    ui.setText('ny-r-sd', fmt(r.trueSd));
    ui.setText('ny-r-neyman', fmt(r.meanNeyman));
    ui.setText('ny-r-classical', fmt(r.meanClassical));
    ui.setText('ny-r-covn', pct(r.coverNeyman));
    ui.setText('ny-r-covc', pct(r.coverClassical));
    ui.setText('ny-r-groups', r.n1 + ' and ' + r.n0);
    const pate = p.target === 'pate';
    ui.setText('ny-v-1', fmt(pate ? r.popTerm1 : f.term1));
    ui.setText('ny-v-0', fmt(pate ? r.popTerm0 : f.term0));
    ui.setText('ny-v-tau', pate ? 'not part of the variance' : f.termTau < 0.005 ? fmt(0) : '−' + fmt(f.termTau));
    ui.setText('ny-v-total', fmt(r.trueSd * r.trueSd));
    ui.setText('ny-v-neyman', fmt(pate ? r.popTerm1 + r.popTerm0 : f.neymanExpected));
    ui.setText('ny-v-label-1', pate ? 'Variance of Y(1) in the population divided by the number with the offer' : 'S1² / n1: variance of Y(1) among these customers divided by the number with the offer');
    ui.setText('ny-v-label-0', pate ? 'Variance of Y(0) in the population divided by the number without the offer' : 'S0² / n0: variance of Y(0) among these customers divided by the number without the offer');
  }
  redrawA = ui.bind(formA, drawA);

  // ---- Part B: blocking ----
  const formB = ui.byId('bk-controls');
  const svgB = ui.byId('bk-chart');
  const ROWS = [
    { key: 'complete', letter: 'A', label: 'A. Complete randomization: difference in means', short: 'A. Complete', cls: 's3' },
    { key: 'pooled', letter: 'B', label: 'B. Block randomization: difference in means that ignores the segments', short: 'B. Ignore segments', cls: 's2' },
    { key: 'block', letter: 'C', label: 'C. Block randomization: segment estimates weighted by segment size', short: 'C. Weighted', cls: 's1' },
    { key: 'fe', letter: 'D', label: 'D. Block randomization: regression with segment fixed effects', short: 'D. Fixed effects', cls: 's4' },
  ];
  plot.legend(ui.byId('bk-legend'), ROWS.map(r => ({ label: r.label, cls: r.cls, kind: 'whisker' }))
    .concat([{ label: 'True SATE (simulation only)', cls: 'sg', kind: 'dash' }]));
  let redrawB = () => {};
  const samplerB = ui.sampler(ui.byId('bk-new'), ui.byId('bk-sample'), () => redrawB());
  let yKeep = null, yKey = '';
  formB.addEventListener('reset', () => { yKey = ''; });

  function drawB(p) {
    const r = neyman.replicateBlocks({ n: p.n, gap: p.gap, shareStep: p.shareStep, effectStep: p.effectStep, seed: samplerB.seed });
    const s = r.summary, sate = r.sim.sate;
    const fresh = plot.extent([sate].concat(...ROWS.map(row => [s[row.key].lo, s[row.key].hi])), { pad: 0.08 });
    const key = samplerB.seed + '|' + p.n;
    const yd = settle(key === yKey ? yKeep : null, fresh);
    yKeep = yd; yKey = key;
    // Short words fit under the dots on a wide chart; a narrow chart shows only the letters.
    const wide = (svgB.parentNode.getBoundingClientRect().width || 640) >= 560;
    const ch = plot.chart(svgB, {
      x: { domain: [0.5, 4.5], ticks: [1, 2, 3, 4], format: v => (ROWS[v - 1] ? (wide ? ROWS[v - 1].short : ROWS[v - 1].letter) : '') },
      y: { domain: yd, label: 'Estimate (dollars)' },
      title: 'Estimates from ' + count(r.sim.params.reps) + ' repeated experiments, by design and estimator',
      desc: ROWS.map(row => row.short + ': average ' + fmt(s[row.key].mean) + ', standard deviation ' + fmt(s[row.key].sd)).join('. ') + '. True SATE ' + fmt(sate) + '.',
      aspect: 0.5,
    });
    ch.axes();
    ch.hline(sate, { cls: 'dash' });
    ROWS.forEach((row, k) => {
      const q = s[row.key];
      ch.whiskers([{ x: k + 1, y: q.mean, lo: q.lo, hi: q.hi }], row.cls, {
        title: () => row.label + ': average ' + fmt(q.mean) + ', middle 95% from ' + fmt(q.lo) + ' to ' + fmt(q.hi),
      });
    });

    for (const row of ROWS) {
      ui.setText('bk-' + row.key + '-mean', fmt(s[row.key].mean));
      ui.setText('bk-' + row.key + '-bias', fmt(s[row.key].bias));
      ui.setText('bk-' + row.key + '-sd', fmt(s[row.key].sd));
    }
    r.sim.design.seg.forEach((g, j) => {
      ui.setText('bk-s' + j + '-treated', g.n1 + '\u00a0of\u00a0' + g.size);
      ui.setText('bk-s' + j + '-mean0', fmt(g.mean0));
      ui.setText('bk-s' + j + '-effect', fmt(g.effect));
      ui.setText('bk-s' + j + '-wb', fmt(100 * g.wBlock, 0) + '%');
      ui.setText('bk-s' + j + '-wfe', fmt(100 * g.wFe, 0) + '%');
    });
    ui.setText('bk-r-sate', fmt(sate));
    ui.setText('bk-r-fe', fmt(r.feTarget));
  }
  redrawB = ui.bind(formB, drawB);
})();
