// Formulas: TeX between \( \) inside a sentence and between \[ \] for a formula on its own line.
// The bundled KaTeX (assets/vendor/katex, MIT License) draws them when the page loads.
(function (global) {
  'use strict';
  if (typeof document === 'undefined' || typeof global.renderMathInElement !== 'function') return;
  const root = document.querySelector('main') || document.body;
  global.renderMathInElement(root, {
    delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
    throwOnError: false,
  });
  // Keep a comma, period, colon, semicolon, or closing parenthesis on the same line as the formula before it.
  root.querySelectorAll('.katex').forEach(k => {
    if (k.closest('.katex-display')) return;
    // Auto-render puts each formula in a span of its own; the punctuation follows that span.
    const host = k.parentElement && k.parentElement.children.length === 1 && !k.parentElement.matches('p, li, dd, td, th, figcaption, label') ? k.parentElement : k;
    const next = host.nextSibling;
    const m = next && next.nodeType === 3 ? next.nodeValue.match(/^[.,;:)]+/) : null;
    if (!m) return;
    const keep = document.createElement('span');
    keep.className = 'math-nowrap';
    host.parentNode.insertBefore(keep, host);
    keep.appendChild(host);
    keep.appendChild(document.createTextNode(m[0]));
    next.nodeValue = next.nodeValue.slice(m[0].length);
  });
})(typeof window !== 'undefined' ? window : globalThis);
