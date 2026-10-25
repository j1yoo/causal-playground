// A small SVG chart helper. It draws axes, lines, dots, bars, whiskers,
// reference lines, and shaded bands. Colors come from CSS classes s1 to s8.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};
  const NS = 'http://www.w3.org/2000/svg';

  // Format a number with d decimals. Negative numbers get a true minus sign.
  function fmt(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    d = d === undefined ? 2 : d;
    let s = Math.abs(v).toFixed(d);
    if (Number(s) === 0) return s;
    return (v < 0 ? '−' : '') + s;
  }

  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return step * mag;
  }

  // Round tick values inside [min, max]. The loop stops after 50 ticks, so it always ends.
  function ticks(min, max, count) {
    if (!(max > min)) return [min];
    const step = niceStep(max - min, count || 5);
    const first = Math.ceil(min / step - 1e-9);
    const out = [];
    for (let j = 0; j <= 50; j++) {
      const v = (first + j) * step;
      if (v > max + step * 1e-9) break;
      const r = Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12));
      if (out[out.length - 1] !== r) out.push(r);
    }
    return out.length ? out : [min];
  }

  // Widen [min, max] to round tick boundaries.
  function niceDomain(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    // A span below rounding error counts as one value.
    if (!(max - min > 1e-9 * Math.max(1, Math.abs(min), Math.abs(max)))) { const c = (min + max) / 2; min = c - 1; max = c + 1; }
    const step = niceStep(max - min, count || 5);
    return [Math.floor(min / step + 1e-9) * step, Math.ceil(max / step - 1e-9) * step];
  }

  // Fewest decimals (0 to 10) that show the step exactly: 0.2 gives 1, 0.25 gives 2, 2.5 gives 1.
  function decimalsFor(step) {
    if (!(step > 0)) return 0;
    for (let d = 0; d < 10; d++) {
      const v = step * Math.pow(10, d);
      if (Math.abs(v - Math.round(v)) < 1e-6 * v) return d;
    }
    return 10;
  }

  // Domain that covers all finite values, padded, then rounded.
  function extent(values, opts) {
    opts = opts || {};
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (opts.include) for (const v of opts.include) { if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (!isFinite(lo)) return [0, 1];
    const pad = (hi - lo) * (opts.pad === undefined ? 0.05 : opts.pad);
    return niceDomain(lo - pad, hi + pad, opts.count || 5);
  }

  function el(name, attrs, parent, text) {
    const e = document.createElementNS(NS, name);
    if (attrs) for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function addTitle(node, text) { if (text) el('title', null, node, text); }

  let uid = 0;

  function Chart(svg, opts) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const box = svg.parentNode && svg.parentNode.getBoundingClientRect ? svg.parentNode.getBoundingClientRect().width : 0;
    const W = Math.round(opts.width || Math.max(300, Math.min(900, box || 640)));
    const H = Math.round(opts.height || Math.max(240, Math.min(400, W * (opts.aspect || 0.56))));
    this.m = Object.assign({ top: 16, right: 20, bottom: 48, left: 60 }, opts.margin || {});
    this.W = W; this.H = H; this.svg = svg; this.opts = opts;
    this.xd = opts.x.domain; this.yd = opts.y.domain;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    const id = 'cp-chart-' + (++uid);
    if (opts.title) {
      el('title', { id: id + '-t' }, svg, opts.title);
      svg.setAttribute('aria-labelledby', id + '-t' + (opts.desc ? ' ' + id + '-d' : ''));
    }
    if (opts.desc) el('desc', { id: id + '-d' }, svg, opts.desc);
    this.gBack = el('g', null, svg);
    this.gGrid = el('g', null, svg);
    this.gMarks = el('g', null, svg);
    this.gTop = el('g', null, svg);
  }

  Chart.prototype.sx = function (v) {
    const d = this.xd;
    return this.m.left + (v - d[0]) / (d[1] - d[0]) * (this.W - this.m.left - this.m.right);
  };
  Chart.prototype.sy = function (v) {
    const d = this.yd;
    return this.H - this.m.bottom - (v - d[0]) / (d[1] - d[0]) * (this.H - this.m.top - this.m.bottom);
  };
  Chart.prototype.left = function () { return this.m.left; };
  Chart.prototype.right = function () { return this.W - this.m.right; };
  Chart.prototype.top = function () { return this.m.top; };
  Chart.prototype.bottom = function () { return this.H - this.m.bottom; };

  Chart.prototype.axes = function () {
    const xo = this.opts.x, yo = this.opts.y;
    const yt = yo.ticks || ticks(this.yd[0], this.yd[1], yo.tickCount || 5);
    const ydec = yo.decimals !== undefined ? yo.decimals : decimalsFor(yt.length > 1 ? yt[1] - yt[0] : 1);
    const yf = yo.format || (v => fmt(v, ydec));
    for (const v of yt) {
      const y = this.sy(v);
      el('line', { class: (v === 0 && this.yd[0] < 0) ? 'baseline' : 'grid', x1: this.left(), x2: this.right(), y1: y, y2: y }, this.gGrid);
      el('text', { class: 'tick-label', x: this.left() - 8, y: y + 4, 'text-anchor': 'end' }, this.gGrid, yf(v));
    }
    el('line', { class: 'baseline', x1: this.left(), x2: this.right(), y1: this.bottom(), y2: this.bottom() }, this.gGrid);
    const xt = xo.ticks || ticks(this.xd[0], this.xd[1], xo.tickCount || 6);
    const xdec = xo.decimals !== undefined ? xo.decimals : decimalsFor(xt.length > 1 ? xt[1] - xt[0] : 1);
    const xf = xo.format || (v => fmt(v, xdec));
    for (const v of xt) {
      const x = this.sx(v);
      el('line', { class: 'baseline', x1: x, x2: x, y1: this.bottom(), y2: this.bottom() + 5 }, this.gGrid);
      el('text', { class: 'tick-label', x: x, y: this.bottom() + 19, 'text-anchor': 'middle' }, this.gGrid, xf(v));
    }
    if (xo.label) {
      el('text', { class: 'axis-label', x: (this.left() + this.right()) / 2, y: this.H - 8, 'text-anchor': 'middle' }, this.gGrid, xo.label);
    }
    if (yo.label) {
      const cy = (this.top() + this.bottom()) / 2;
      el('text', { class: 'axis-label', x: 14, y: cy, 'text-anchor': 'middle', transform: 'rotate(-90 14 ' + cy + ')' }, this.gGrid, yo.label);
    }
    return this;
  };

  function pt(p) { return Array.isArray(p) ? { x: p[0], y: p[1] } : p; }

  // Line through points. Points with a missing y break the line.
  Chart.prototype.line = function (points, cls, opts) {
    opts = opts || {};
    let d = '', pen = false;
    for (const raw of points) {
      const p = pt(raw);
      if (p.y === null || p.y === undefined || !isFinite(p.y)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + this.sx(p.x).toFixed(2) + ' ' + this.sy(p.y).toFixed(2);
      pen = true;
    }
    const path = el('path', { class: 'ln ' + (cls || ''), d: d }, opts.top ? this.gTop : this.gMarks);
    addTitle(path, opts.title);
    return this;
  };

  // Shaded area between lower and upper curves that share x values.
  // A point with a missing bound breaks the area, as a missing point breaks a line.
  Chart.prototype.area = function (points, cls) {
    const runs = [[]];
    for (const p of points.map(pt)) {
      if (isFinite(p.x) && isFinite(p.lo) && isFinite(p.hi)) runs[runs.length - 1].push(p);
      else if (runs[runs.length - 1].length) runs.push([]);
    }
    for (const ps of runs) {
      if (!ps.length) continue;
      let d = '';
      ps.forEach((p, i) => { d += (i ? 'L' : 'M') + this.sx(p.x).toFixed(2) + ' ' + this.sy(p.hi).toFixed(2); });
      for (let i = ps.length - 1; i >= 0; i--) d += 'L' + this.sx(ps[i].x).toFixed(2) + ' ' + this.sy(ps[i].lo).toFixed(2);
      el('path', { class: 'area ' + (cls || ''), d: d + 'Z' }, this.gBack);
    }
    return this;
  };

  Chart.prototype.dots = function (points, cls, opts) {
    opts = opts || {};
    const r = opts.r || 4.5;
    const g = opts.top ? this.gTop : this.gMarks;
    for (const raw of points) {
      const p = pt(raw);
      if (!isFinite(p.x) || !isFinite(p.y)) continue;
      const c = el('circle', {
        class: 'dot ' + (cls || '') + (opts.hollow ? ' hollow' : '') + (opts.small ? ' small' : ''),
        cx: this.sx(p.x).toFixed(2), cy: this.sy(p.y).toFixed(2), r: r,
        'fill-opacity': opts.opacity,
      }, g);
      if (opts.title) addTitle(c, typeof opts.title === 'function' ? opts.title(p) : opts.title);
    }
    return this;
  };

  // Columns from a baseline (default 0) with a 4px rounded data end.
  Chart.prototype.bars = function (items, cls, opts) {
    opts = opts || {};
    const base = opts.base || 0;
    const w = Math.min(opts.width || 24, opts.maxWidth || Infinity);
    for (const it of items) {
      if (!isFinite(it.y)) continue;
      const x = this.sx(it.x), y0 = this.sy(base), y1 = this.sy(it.y);
      const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
      const r = Math.min(4, h, w / 2);
      const L = x - w / 2, R = x + w / 2;
      let d;
      if (h < 0.5) {
        d = 'M' + L + ' ' + y0 + 'H' + R;
      } else if (it.y >= base) {
        d = 'M' + L + ' ' + y0 + 'V' + (top + r) + 'Q' + L + ' ' + top + ' ' + (L + r) + ' ' + top +
          'H' + (R - r) + 'Q' + R + ' ' + top + ' ' + R + ' ' + (top + r) + 'V' + y0 + 'Z';
      } else {
        const bot = top + h;
        d = 'M' + L + ' ' + y0 + 'V' + (bot - r) + 'Q' + L + ' ' + bot + ' ' + (L + r) + ' ' + bot +
          'H' + (R - r) + 'Q' + R + ' ' + bot + ' ' + R + ' ' + (bot - r) + 'V' + y0 + 'Z';
      }
      const node = el('path', { class: 'bar ' + (it.cls || cls || ''), d: d }, this.gMarks);
      addTitle(node, typeof opts.title === 'function' ? opts.title(it) : it.title);
    }
    return this;
  };

  // Estimate dots with vertical whiskers from lo to hi.
  Chart.prototype.whiskers = function (items, cls, opts) {
    opts = opts || {};
    for (const it of items) {
      if (!isFinite(it.y)) continue;
      const x = this.sx(it.x);
      if (isFinite(it.lo) && isFinite(it.hi)) {
        el('line', { class: 'whisker ' + (cls || ''), x1: x, x2: x, y1: this.sy(it.lo), y2: this.sy(it.hi) }, this.gMarks);
      }
      const c = el('circle', { class: 'dot ' + (cls || '') + (opts.hollow ? ' hollow' : ''), cx: x, cy: this.sy(it.y), r: opts.r || 4.5 }, this.gTop);
      addTitle(c, typeof opts.title === 'function' ? opts.title(it) : it.title);
    }
    return this;
  };

  Chart.prototype.vline = function (x, opts) {
    opts = opts || {};
    const sx = this.sx(x);
    el('line', { class: 'ref ' + (opts.cls || ''), x1: sx, x2: sx, y1: this.top(), y2: this.bottom() }, this.gTop);
    if (opts.label) {
      const anchor = opts.anchor || 'start';
      const dx = anchor === 'end' ? -6 : anchor === 'middle' ? 0 : 6;
      el('text', { class: 'note halo', x: sx + dx, y: this.top() + 12, 'text-anchor': anchor }, this.gTop, opts.label);
    }
    return this;
  };

  Chart.prototype.hline = function (y, opts) {
    opts = opts || {};
    const sy = this.sy(y);
    el('line', { class: 'ref ' + (opts.cls || ''), x1: this.left(), x2: this.right(), y1: sy, y2: sy }, this.gTop);
    if (opts.label) {
      el('text', { class: 'note halo', x: this.right() - 4, y: sy - 6, 'text-anchor': 'end' }, this.gTop, opts.label);
    }
    return this;
  };

  // Shaded vertical band from x0 to x1 behind the data.
  Chart.prototype.band = function (x0, x1, opts) {
    opts = opts || {};
    const a = this.sx(x0), b = this.sx(x1);
    el('rect', { class: 'band ' + (opts.cls || ''), x: Math.min(a, b), y: this.top(), width: Math.abs(b - a), height: this.bottom() - this.top() }, this.gBack);
    if (opts.label) {
      el('text', { class: 'note halo', x: (a + b) / 2, y: this.top() + 12, 'text-anchor': 'middle' }, this.gBack, opts.label);
    }
    return this;
  };

  Chart.prototype.segment = function (x1, y1, x2, y2, cls) {
    el('line', { class: 'ln ' + (cls || ''), x1: this.sx(x1), y1: this.sy(y1), x2: this.sx(x2), y2: this.sy(y2) }, this.gMarks);
    return this;
  };

  // Text at data coordinates. Options: anchor, dx, dy, cls.
  Chart.prototype.text = function (x, y, str, opts) {
    opts = opts || {};
    el('text', {
      class: opts.cls || 'note', x: this.sx(x) + (opts.dx || 0), y: this.sy(y) + (opts.dy || 0),
      'text-anchor': opts.anchor || 'start',
    }, this.gTop, str);
    return this;
  };

  function chart(svg, opts) { return new Chart(svg, opts); }

  // HTML legend. kind: line, dash, dotted, dot, hollow, bar, band, area, ref, whisker.
  function legend(ul, items) {
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    for (const it of items) {
      const li = document.createElement('li');
      const s = el('svg', { viewBox: '0 0 26 12', 'aria-hidden': 'true' }, li);
      const c = it.cls || '';
      const kind = it.kind || 'line';
      if (kind === 'dot') el('circle', { class: 'dot ' + c, cx: 13, cy: 6, r: 4.5 }, s);
      else if (kind === 'hollow') el('circle', { class: 'dot hollow ' + c, cx: 13, cy: 6, r: 4 }, s);
      else if (kind === 'bar') el('rect', { class: 'bar ' + c, x: 6, y: 1, width: 14, height: 10, rx: 2 }, s);
      else if (kind === 'band') el('rect', { class: 'band ' + c, x: 3, y: 1, width: 20, height: 10, rx: 2 }, s);
      else if (kind === 'area') el('rect', { class: 'area ' + c, x: 3, y: 1, width: 20, height: 10, rx: 2 }, s);
      else if (kind === 'ref') el('line', { class: 'ref ' + c, x1: 13, x2: 13, y1: 0, y2: 12 }, s);
      else if (kind === 'whisker') {
        el('line', { class: 'whisker ' + c, x1: 13, x2: 13, y1: 0, y2: 12 }, s);
        el('circle', { class: 'dot ' + c, cx: 13, cy: 6, r: 4 }, s);
      } else {
        el('line', { class: 'ln ' + c + (kind === 'dash' ? ' dash' : kind === 'dotted' ? ' dotted' : ''), x1: 1, x2: 25, y1: 6, y2: 6 }, s);
      }
      li.appendChild(document.createTextNode(it.label));
      ul.appendChild(li);
    }
  }

  CP.plot = { chart, legend, ticks, niceDomain, extent, decimalsFor, fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.plot;
})(typeof window !== 'undefined' ? window : globalThis);
