// Seeded random numbers. The same seed always gives the same sample,
// so a page can redraw the same data when a slider moves.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  // mulberry32: a small 32-bit generator. It is fast and good enough
  // for teaching simulations (not for cryptography).
  function makeRng(seed) {
    let a = Number(seed) >>> 0;
    let spare = null;

    function uniform() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Standard normal draw by the Box-Muller method.
    function stdNormal() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0;
      while (u === 0) u = uniform();
      const v = uniform();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    }

    function normal(mean, sd) {
      return (mean || 0) + (sd === undefined ? 1 : sd) * stdNormal();
    }

    function bernoulli(p) { return uniform() < p ? 1 : 0; }

    // Integer in 0, 1, ..., n - 1.
    function int(n) { return Math.floor(uniform() * n); }

    // Fisher-Yates shuffle of a copy.
    function shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    }

    return { uniform, normal, stdNormal, bernoulli, int, shuffle };
  }

  CP.rng = { makeRng };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.rng;
})(typeof window !== 'undefined' ? window : globalThis);
