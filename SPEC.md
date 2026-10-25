# Build spec for Causal Playground modules

This file is the contract for anyone who adds or changes a module.
For the code files, the difference-in-differences module (`assets/js/sims/did.js`,
`assets/js/pages/did-page.js`, `tests/did.test.js`) is the reference pattern. For the page layout,
`iv.html` is the reference pattern. Copy their structure.

## 1. Audience and purpose

- Readers are university students in courses on causal inference and on business analytics.
  Some are undergraduates with no matrix algebra. Some are graduate students.
- Each page explains one method in plain English, lets the reader move sliders, and shows
  what happens to an estimate when an assumption holds or fails.
- The data are simulated, so the page always knows the true effect. Use this to show bias.

## 2. Files for one module (example: key `xyz`)

| File | Content |
|---|---|
| `xyz.html` | The page. Same header, nav, footer, and section order as `did.html`. |
| `assets/js/sims/xyz.js` | Pure simulation and estimators. No page elements. Attaches `CP.xyz`. Exports with `module.exports` for Node. |
| `assets/js/pages/xyz-page.js` | Page wiring: reads controls, calls the simulation, draws charts, fills tables. |
| `tests/xyz.test.js` | Unit tests with `node:test`. Load files with `require('./load.js').load('xyz.js')`. |

Do not edit shared files (`assets/js/core/*`, `assets/css/style.css`, other modules, `tools/*`).
If a page needs a style that `style.css` lacks, put a small `<style>` block in the page head
and report it. Do not add libraries. Do not make network requests from site code.
The one exception is `assets/js/core/analytics.js` (section 8).

## 3. Code conventions

- Plain JavaScript in classic scripts (no ES modules, so pages also work from `file://`).
  Wrap each file in `(function (global) { ... })(typeof window !== 'undefined' ? window : globalThis);`
  as the existing files do.
- Use `CP.rng.makeRng(seed)` for all randomness. Same parameters and seed give the same data.
- A "Draw a new sample" button changes the seed (`CP.ui.sampler`). A "Reset" button
  (`type="reset"`) restores the default controls. `CP.ui.bind(form, draw)` redraws on every change.
- Keep one redraw under about 50 ms on a laptop. Prefer closed-form estimators to large regressions.
- Shared helpers: `CP.stats` (mean, variance, quantile, ols with classical, hc1, or cluster
  standard errors, logitFit, normalCdf, chiSquareSf, tTwoSidedP, demeanTwoWay, histogram),
  `CP.plot` (chart, legend, extent, ticks, fmt), `CP.ui` (bind, sampler, setText, byId).
- Number format on the page: `CP.plot.fmt(value, decimals)`. It prints a true minus sign and
  `n/a` for non-finite values. Never print NaN, undefined, or Infinity.

## 4. Page structure (copy `iv.html`)

A page has two layers: a short part to play with at the top, and the full explanation below the simulation.

1. Header with site title and the full module nav. Mark the current page with `aria-current="page"`.
   On the home page only, the header shows the title large, with the line that names the courses and the
   author under it.
2. `<p class="kicker">X.Y Part name</p>` (for example `5.2 Difference-in-differences`), `<h1>`,
   `<p class="lede">` (at most 3 sentences).
3. `In brief` section (`class="prose"`, `<h2 id="brief">`): 100 to 200 words. Two to four sentences on the
   example setting, a list that defines the 3 to 5 quantities that the simulation shows, and the closing line
   "Move the sliders and watch these numbers. The explanation below the simulation gives the reasons."
4. `Try it` section: one to three sentences of introduction, then a
   `<details class="symbols" id="PREFIX-sim-details">` block titled How the simulation makes the data, then one
   or more `<div class="sim">` blocks. Each block has a `<form class="controls">`
   with labeled sliders (`<output for=...>` shows the value), a chart `<figure>` with a legend list
   and an `<svg>`, a caption, and a results table or `<dl class="readout">` with the key numbers.
   The table or readout is the text version of the chart. Every number a reader needs must be there.
5. `<aside class="notice">` titled `What to notice`: 3 to 8 bullet points. Each point is one experiment:
   a slider move and the change the reader can see on the page. A point has at most 6 sentences.
6. `The idea` section (`class="prose"`): the method in plain English, below the simulation. Keep the main
   method, the main assumption, and the main failure mode visible. Fold self-contained sub-topics into
   `<details class="symbols" id="PREFIX-TOPIC-details">` blocks. The `In symbols` block with notation for
   graduate students comes last.
7. `References`: 2 to 4 verified references as an ordered list. Use only the references supplied
   with the module brief. Cite them in the text as (Author Year) or (Author Year, ch. N). A page may also
   list one study that it uses as its example, marked `<li class="study">`; it does not count toward the 2 to 4.
8. Pager with links to the previous and next modules, then the footer and the scripts.
   Copy the footer from `iv.html` without changes. The first script is `assets/js/core/analytics.js`.

Parts and modules (the number is part.position; file names never change):
1 Randomized experiments: 1.1 `randomization-inference.html`, 1.2 `neyman.html`.
2 Observational studies: 2.1 `controls.html`.
3 Noncompliance: 3.1 `iv.html`, 3.2 `principal-strata.html`.
4 Regression discontinuity: 4.1 `rd.html`.
5 Difference-in-differences: 5.1 `did.html`, 5.2 `staggered.html`, 5.3 `event-study.html`.
6 Prediction and decisions: 6.1 `selective-labels.html`, 6.2 `uplift.html`.
The nav groups the links by part. To add or move a module, change the nav on every page, the kickers,
the pagers, the home-page lists, the README table, and `PARTS` in `tests/pages.test.js`; the page tests
check that they agree. In the text, refer to a module as Module X.Y.

Formulas. Write them in TeX: `\( ... \)` inside a sentence, and `\[ ... \]` inside `<p class="formula">` for a
formula on its own line. Put each formula right after the sentence that says it in words; keep one or two
lines visible and fold a long derivation into a box at the same place. Break a long display formula at the
equals sign with `aligned`, so that it fits a phone screen. The bundled KaTeX (`assets/vendor/katex`, MIT
License) draws the formulas: a page with formulas loads `assets/vendor/katex/katex.min.css` in the head, and
`katex.min.js`, `auto-render.min.js`, and `assets/js/core/math.js` right after the visit records script.
A page test renders every formula with KaTeX and fails on invalid TeX.

## 5. Chart conventions

- Use `CP.plot.chart(svg, {x: {domain, label}, y: {domain, label}, title, desc})`, then `.axes()`
  and marks (`line`, `dots`, `bars`, `whiskers`, `vline`, `hline`, `band`, `area`, `text`).
- Series colors come from classes `s1` to `s8` (fixed order) and `sg` (gray reference).
  Use `s1` for the treated group or the main estimate, `s2` for the comparison group or the
  competing method, `s3` for a third series, `sg` for assumptions and reference lines.
  Use at most four colored series in one chart.
- Solid lines show what real data would show. Dashed lines (`dash`) show true values that only a
  simulation knows. Dotted gray lines (`sg dotted`) show what a method assumes.
- Every chart with two or more series has a legend (`CP.plot.legend`). Axis labels name the quantity.
  Give dots a hover title. The caption says what shaded areas and lines mean.
- Keep axes stable while a slider moves when the comparison across slider positions matters.

## 6. Writing rules for all site text

- Plain English in the ASD-STE100 spirit: short sentences, one idea per sentence, active voice,
  no contractions, no scare quotes, no quoted phrases used as rule names.
- ASD-STE100 limits for descriptive text: no sentence over 25 words, no paragraph over 6 sentences.
- No em dashes and no en dashes. Use periods, commas, colons, or parentheses.
- No marketing tone, no intensifiers (for example: powerful, remarkable, truly, genuinely),
  no emojis, no exclamation marks.
- Definitions follow standard textbooks (Angrist and Pischke; Cunningham, The Mixtape;
  Huntington-Klein, The Effect; Imbens and Rubin) and the verified facts in the module brief.
  Do not add claims that the brief and references do not support.
- In What to notice, describe only what the reader can see on the page after the move.
- Use one term for one thing on the whole page. Define each technical term at first use.
- Expand every abbreviation at first use, for example two-way fixed effects (TWFE).
- Do not name a course or a person who teaches it. Do not name a data platform. Two places are the exception:
  the line under the title of the home page names the two courses and the author, and the footer names the author.

## 7. Tests

- Test the simulation code, not the page. Use fixed seeds.
- Include exact checks in noise-free cases (for example: no noise and no violation gives the true
  effect to 1e-9), identity checks (for example: a decomposition adds up to the regression
  coefficient), and Monte Carlo checks with loose tolerances (for example: 95% intervals cover the
  truth between 91% and 99% of the time over a few hundred seeds).
- Run `node --test tests/xyz.test.js` and `node tools/check-pages.mjs xyz.html`.
  The page check moves every control and fails on console errors, exceptions, failed requests,
  or the text NaN, undefined, or Infinity.
- `node tools/check-pages.mjs --shots xyz.html` also saves a screenshot to `tools/screenshots/`.
  Look at it.
- `node tools/check-analytics.mjs` checks the visit records in headless Chrome. Nothing reaches Google.

## 8. Visit records

- `assets/js/core/analytics.js` sends visit records to Google Analytics 4 (measurement ID G-F2Y4X86JTT,
  the property of the personal site). It runs only when the host is `j1yoo.github.io`. On any other host,
  for example a local preview, it does nothing.
- With `?cp_debug=1` in the address, it sends nothing and prints each record with `console.debug`.
- Google Analytics records page views, engagement time, traffic sources, places, and devices by itself.
  The script adds the events below. Every event carries `cp_module`, the page file name without `.html`
  (`index` for the home page).

| Event | Sent when | Other parameters |
|---|---|---|
| `cp_control_change` | A slider is released, or a select or a checkbox changes | `cp_form`, `cp_control` (the control id), `cp_value` (text) |
| `cp_button` | A button is pressed | `cp_form`, `cp_button` (the button id, or `reset`) |
| `cp_section_view` | An `h2` heading with an id in `main` comes into view, once per page load | `cp_section` (the heading id) |
| `cp_details_toggle` | A `details` block opens or closes | `cp_box` (the block id, or its class), `cp_value` (`open` or `closed`) |
| `cp_link_click` | A link is clicked | `cp_link_kind` (home, nav, skip, pager, reference, footer, key_terms, text), `cp_link_href` |

- One page load sends at most 300 of these events. Values are cut to 100 characters.
- Text typed into an address must never reach Google. Before Google Analytics starts, the address bar keeps
  only campaign tags (`utm_*`), `cp_debug`, and `_gl` (the cross-domain linker value between j1yoo.github.io and
  cadi-lab.github.io, which the config also lists). `page_location` is the origin, the path, and the campaign tags,
  without a fragment. `page_referrer` is the referrer without its query and fragment.
- Two marks in the address become user properties after a check:
  - `?via=<code>`: a group code on a link from a course page. A code is one or two lower-case letters and one
    to three digits (for example `e1`), so it cannot hold a name or a student number. The browser keeps the
    newest code (`localStorage` key `cp_audience`) and sends it with every later visit as `cp_audience`.
  - `?site_role=owner` and `?site_role=clear`: the owner mark of the personal site, with the same
    `localStorage` key `site_role`. It sends the user property `site_role`. A stored value counts only if it
    is `owner`, because any page on the same host can write to this storage.
- For a new module: give every control and every button an id, keep the `h2` ids (`idea`, `try`, `notice`,
  `refs`), and keep the classes `site-nav`, `pager`, `refs`, and `site-footer`. Never put a name, an email
  address, or a student number into an id, a value, or a link.
