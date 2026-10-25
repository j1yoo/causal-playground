# Causal Playground

Interactive teaching pages for causal inference. Each page explains one method in plain English
and runs a simulation in the browser. Students move sliders and watch what happens to an estimate.
The data are simulated, so each module page knows the true value of what it estimates and can show how far an estimate misses it.

Author: Jaewon Yoo, National Tsing Hua University (https://j1yoo.github.io/).

## Pages

| File | Content |
|---|---|
| `index.html` | Home page: module list and key terms, each with a textbook or paper source |
| `randomization-inference.html` | 1.1 (Randomized experiments). Randomization inference: an exact test in a small experiment, the choice of test statistic, and a confidence interval from inverting the test |
| `neyman.html` | 1.2 (Randomized experiments). Neyman variance and blocking: the spread of an estimate over repeated coin flips, the Neyman and classical standard errors, and block randomization |
| `controls.html` | 2.1 (Observational studies). Regression adjustment and good and bad controls: adjusting for a confounder, the weights of one regression coefficient, extrapolation, and seven cases in causal diagrams |
| `iv.html` | 3.1 (Noncompliance). Noncompliance and instrumental variables, told with a field experiment on a swipe ad (one-sided noncompliance): compliance types, the intention-to-treat effect, the Wald estimator and the LATE, a direct effect of assignment, defiers, and weak instruments |
| `principal-strata.html` | 3.2 (Noncompliance). Principal strata: a job training program changes who works, and wages exist only for workers |
| `rd.html` | 4.1 (Regression discontinuity). Sharp regression discontinuity |
| `did.html` | 5.1 (Difference-in-differences). Difference-in-differences: what breaks when parallel trends fail |
| `staggered.html` | 5.2 (Difference-in-differences). Staggered adoption: two-way fixed effects, the Goodman-Bacon decomposition, Callaway and Sant'Anna group-time effects |
| `event-study.html` | 5.3 (Difference-in-differences). Event study with leads and lags, and placebo dates ranked against the actual date |
| `selective-labels.html` | 6.1 (Prediction and decisions). Selective labels in prediction (Kleinberg et al. 2018) |
| `uplift.html` | 6.2 (Prediction and decisions). Prediction versus uplift targeting (Ascarza 2018) |

The modules come in six parts: randomized experiments, observational studies, noncompliance, regression
discontinuity, difference-in-differences, and prediction and decisions. A module number such as 5.2 gives
the part and the place in the part. Each module page has the same parts: an explanation, an interactive simulation, a results table or
readout, a "What to notice" box, and 2 to 4 references.

## Preview locally

The pages are plain files. Two ways to open them:

1. Double-click `index.html`. The pages use classic scripts, so they also work from disk.
2. Or serve the folder:

   ```
   cd causal-playground
   python3 -m http.server 8000
   ```

   Then open http://localhost:8000/ in a browser.

## Tests

Node 22 or newer and Google Chrome are needed. No npm packages are needed.

```
node --test "tests/*.test.js"      # unit tests for the simulation code and site-wide page checks
node tools/check-pages.mjs         # loads every page in headless Chrome and moves every control
node tools/check-pages.mjs --shots # also saves screenshots to tools/screenshots/
node tools/check-analytics.mjs     # checks the visit records in headless Chrome; nothing reaches Google
```

`npm test` runs the unit tests. `npm run check` runs both browser checks.

The page check uses Google Chrome at its standard macOS path. Set `CHROME_PATH` to use another
Chrome or Chromium. It moves every control on its own and all controls together, and presses every
button. It fails on console errors and warnings, page exceptions, failed requests, charts without
data marks, a Reset that does not restore the controls, and the text NaN, undefined, Infinity, or
[object anywhere in the page, including hover titles. It prints a note where the page shows n/a.

## Visit records

On the published site, `assets/js/core/analytics.js` records visits with Google Analytics 4: page views,
the sections that come into view, link clicks, button presses, and control settings. The records include
no names, email addresses, or student numbers. A local preview records nothing. Add `?cp_debug=1` to an
address to print the records in the browser console instead of sending them. `SPEC.md` lists the events.

## Folder layout

| Path | Content |
|---|---|
| `assets/css/style.css` | Shared styles |
| `assets/js/core/` | Seeded random numbers (`rng.js`), statistics (`stats.js`), SVG charts (`plot.js`), page helpers (`ui.js`), visit records (`analytics.js`) |
| `assets/js/sims/` | One simulation file per module. Pure functions, no page elements |
| `assets/js/pages/` | One page-wiring file per module |
| `tests/` | Unit tests (`node:test`) |
| `tools/check-pages.mjs` | Headless browser check of every page and control |
| `tools/check-analytics.mjs` | Headless browser check of the visit records |
| `SPEC.md` | Conventions for adding or changing a module |
| `LICENSE` | PolyForm Noncommercial License 1.0.0 for the code |
| `assets/vendor/katex/` | KaTeX 0.19.1 for the formulas (MIT License, its own `LICENSE` file) |

## Publishing

GitHub Pages serves the site from the main branch and the root folder, at
https://j1yoo.github.io/causal-playground/.

## License

The code is under the PolyForm Noncommercial License 1.0.0 (`LICENSE`): anyone may use and change it for
noncommercial purposes, which include use by educational institutions; commercial use needs the author's
permission. KaTeX in `assets/vendor/katex/` keeps its own MIT License. The text of the pages is under the Creative Commons
Attribution-NonCommercial-NoDerivatives 4.0 International License (CC BY-NC-ND 4.0),
https://creativecommons.org/licenses/by-nc-nd/4.0/.
