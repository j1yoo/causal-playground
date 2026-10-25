// Page helpers: read controls, show slider values, redraw on change.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  function decimalsOfStep(step) {
    const s = String(step);
    const i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  }

  // Text shown next to a slider. data-format="pct" shows 0.25 as 25%.
  // data-suffix adds a unit. data-decimals overrides the step-based decimals
  // (for pct, the decimals of the percent).
  function formatControl(input) {
    const v = Number(input.value);
    const fmtType = input.dataset.format;
    const suffix = input.dataset.suffix || '';
    const d = input.dataset.decimals !== undefined ? Number(input.dataset.decimals) : decimalsOfStep(input.step || 1);
    if (fmtType === 'pct') return CP.plot.fmt(v * 100, input.dataset.decimals !== undefined ? d : Math.max(0, d - 2)) + '%';
    if (fmtType === 'int') return CP.plot.fmt(Math.round(v), 0) + suffix;
    return CP.plot.fmt(v, d) + suffix;
  }

  function updateOutputs(form) {
    form.querySelectorAll('input[type="range"]').forEach(input => {
      const out = form.querySelector('output[for="' + input.id + '"]');
      if (out) out.textContent = formatControl(input);
    });
  }

  // Values of all named controls: numbers for ranges, booleans for checkboxes,
  // strings for selects and radio groups.
  function readControls(form) {
    const p = {};
    form.querySelectorAll('input[name], select[name]').forEach(input => {
      if (input.type === 'range' || input.type === 'number') p[input.name] = Number(input.value);
      else if (input.type === 'checkbox') p[input.name] = input.checked;
      else if (input.type === 'radio') { if (input.checked) p[input.name] = input.value; }
      else p[input.name] = input.value;
    });
    return p;
  }

  // Call render now, and again after any control change or window resize.
  function bind(form, render) {
    let queued = false;
    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; updateOutputs(form); render(readControls(form)); });
    }
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    form.addEventListener('submit', e => e.preventDefault());
    form.addEventListener('reset', schedule);
    let timer = null;
    window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(schedule, 120); });
    updateOutputs(form);
    render(readControls(form));
    return schedule;
  }

  // A "Draw a new sample" button. It changes the seed and calls redraw.
  // If the button sits inside a form, the form's Reset button also returns to sample 1.
  function sampler(button, label, redraw, firstSeed) {
    const state = { seed: firstSeed || 1, count: 1 };
    function show() { if (label) label.textContent = 'Sample ' + state.count; }
    button.addEventListener('click', () => {
      state.count += 1;
      state.seed = (firstSeed || 1) + 7919 * (state.count - 1);
      show();
      redraw();
    });
    if (button.form) {
      button.form.addEventListener('reset', () => {
        state.count = 1;
        state.seed = firstSeed || 1;
        show();
      });
    }
    show();
    return state;
  }

  function byId(id) { return document.getElementById(id); }
  function setText(id, text) { const e = byId(id); if (e) e.textContent = text; }

  CP.ui = { readControls, updateOutputs, bind, sampler, byId, setText, formatControl, fmt: CP.plot.fmt };
})(typeof window !== 'undefined' ? window : globalThis);
