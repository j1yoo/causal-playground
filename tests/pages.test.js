// Site-wide checks on the HTML pages and text files. They need no browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Parts in teaching order. Each module page keeps its file name; its number is part.position.
const PARTS = [
  ['Randomized experiments', ['randomization-inference.html', 'neyman.html']],
  ['Observational studies', ['controls.html']],
  ['Noncompliance', ['iv.html', 'principal-strata.html']],
  ['Regression discontinuity', ['rd.html']],
  ['Difference-in-differences', ['did.html', 'staggered.html', 'event-study.html']],
  ['Prediction and decisions', ['selective-labels.html', 'uplift.html']],
];
const MODULES = PARTS.flatMap(p => p[1]);
const NUMBER = {};
const PART_OF = {};
PARTS.forEach(([name, files], i) => files.forEach((f, j) => { NUMBER[f] = (i + 1) + '.' + (j + 1); PART_OF[f] = name; }));
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function walk(dir, exts, out) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'screenshots') continue;
    const rel = path.join(dir, name);
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, exts, out);
    else if (exts.includes(path.extname(name))) out.push(rel);
  }
  return out;
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&apos;|&#39;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

test('all module pages and the home page exist', () => {
  for (const f of ['index.html'].concat(MODULES)) assert.ok(pages.includes(f), f + ' is missing');
});

test('every page has the same navigation in the same order', () => {
  const navOf = html => {
    const m = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/);
    assert.ok(m, 'no site nav');
    return [...m[0].matchAll(/href="([^"]+)"/g)].map(x => x[1]);
  };
  const expected = navOf(read('index.html'));
  assert.deepEqual(expected, MODULES);
  for (const f of MODULES) {
    const html = read(f);
    assert.deepEqual(navOf(html), expected, f);
    const current = html.match(/<a href="([^"]+)" aria-current="page">/);
    assert.ok(current && current[1] === f, f + ' does not mark itself as the current page');
  }
});

test('local links, scripts, and styles point to existing files', () => {
  for (const f of pages) {
    const html = read(f);
    for (const m of html.matchAll(/(?:href|src)="([^"#]+)(#[^"]*)?"/g)) {
      const url = m[1];
      if (/^(https?:|mailto:|data:)/.test(url)) continue;
      assert.ok(fs.existsSync(path.join(ROOT, url)), f + ' links to missing ' + url);
    }
  }
});

test('no external scripts, stylesheets, or fonts', () => {
  for (const f of pages) {
    const html = read(f);
    for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:[^"]+)"/g)) {
      assert.fail(f + ' loads an external resource: ' + m[1]);
    }
  }
  for (const f of walk('assets', ['.css'], [])) {
    assert.ok(!/@import|url\(\s*["']?https?:/.test(read(f)), f + ' loads an external resource');
  }
});

test('no em dashes or en dashes in pages, scripts, or documents', () => {
  const files = pages.concat(walk('assets', ['.js', '.css'], []), walk('.', ['.md'], []));
  for (const f of files) {
    const text = read(f);
    for (const bad of ['\u2014', '\u2013', '&mdash;', '&ndash;']) {
      const i = text.indexOf(bad);
      assert.equal(i, -1, f + ' contains a dash at: ' + text.slice(Math.max(0, i - 40), i + 40));
    }
  }
});

test('no contractions in page text or page scripts', () => {
  const words = ["don't", "doesn't", "isn't", "aren't", "can't", "won't", "it's", "that's", "there's", "we're",
    "you're", "they're", "let's", "didn't", "wasn't", "weren't", "haven't", "hasn't", "shouldn't", "wouldn't",
    "couldn't", "i'm", "we'll", "you'll", "it'll", "what's", "here's", "who's", "we've", "you've", "they've"];
  const re = new RegExp("\\b(" + words.map(w => w.replace("'", "['’]")).join('|') + ")\\b", 'i');
  for (const f of pages) {
    const m = visibleText(read(f)).match(re);
    assert.equal(m, null, f + ' contains the contraction ' + (m && m[0]));
  }
  for (const f of walk(path.join('assets', 'js', 'pages'), ['.js'], [])) {
    const strings = (read(f).match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || []).join(' ');
    const m = strings.match(re);
    assert.equal(m, null, f + ' contains the contraction ' + (m && m[0]));
  }
});

test('module pages have the required sections and 2 to 4 references', () => {
  for (const f of MODULES) {
    const html = read(f);
    for (const heading of ['The idea', 'Try it', 'What to notice', 'References']) {
      assert.ok(new RegExp('<h2[^>]*>' + heading + '</h2>').test(html), f + ' lacks the section ' + heading);
    }
    assert.ok(/class="notice"/.test(html), f + ' lacks the notice box');
    const refs = html.match(/<section class="refs[\s\S]*?<\/section>/);
    assert.ok(refs, f + ' lacks a references section');
    const n = (refs[0].match(/<li>/g) || []).length;
    assert.ok(n >= 2 && n <= 4, f + ' has ' + n + ' method references');
    const studies = (refs[0].match(/<li class="study">/g) || []).length;
    assert.ok(studies <= 1, f + ' has ' + studies + ' example studies');
    const kicker = html.match(/<p class="kicker">([^<]+)<\/p>/);
    assert.ok(kicker, f + ' lacks the module kicker');
    assert.equal(kicker[1], NUMBER[f] + ' ' + PART_OF[f], f + ' has the wrong part or number');
  }
});

test('every slider has a label and a value display', () => {
  for (const f of MODULES) {
    const html = read(f);
    for (const m of html.matchAll(/<input type="range" id="([^"]+)"/g)) {
      const id = m[1];
      assert.ok(html.includes('<label for="' + id + '"'), f + ': no label for ' + id);
      assert.ok(html.includes('<output for="' + id + '"'), f + ': no output for ' + id);
    }
  }
});

test('every page loads the visit records script once, before the other scripts', () => {
  for (const f of pages) {
    const srcs = [...read(f).matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    assert.equal(srcs.filter(s => s === 'assets/js/core/analytics.js').length, 1, f);
    assert.equal(srcs[0], 'assets/js/core/analytics.js', f);
  }
});

test('every page has the same footer with the author and the licenses', () => {
  const footerOf = html => (html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/) || [''])[0];
  const expected = footerOf(read('index.html'));
  for (const f of pages) assert.equal(footerOf(read(f)), expected, f);
  const text = visibleText(expected);
  for (const part of ['Jaewon Yoo', 'National Tsing Hua University', 'PolyForm Noncommercial 1.0.0', 'CC BY-NC-ND 4.0']) {
    assert.ok(text.includes(part), 'the footer lacks ' + part);
  }
  for (const f of pages) assert.ok(!/send(s)? nothing to a server/.test(read(f)), f + ' still says that it sends nothing');
  assert.ok(expected.includes('href="https://creativecommons.org/licenses/by-nc-nd/4.0/"'), 'the footer does not link the text license');
  assert.ok(expected.includes('href="https://polyformproject.org/licenses/noncommercial/1.0.0"'), 'the footer does not link the code license');
  assert.ok(read('LICENSE').startsWith('Required Notice: Copyright (c) 2026 Jaewon Yoo'), 'LICENSE lacks the required notice');
});

test('the pager links each module page to the previous and the next page in order', () => {
  MODULES.forEach((f, i) => {
    const m = read(f).match(/<nav class="pager"[\s\S]*?<\/nav>/);
    assert.ok(m, f + ' lacks a pager');
    const hrefs = [...m[0].matchAll(/href="([^"]+)"/g)].map(x => x[1]);
    assert.deepEqual(hrefs, [i === 0 ? 'index.html' : MODULES[i - 1], i === MODULES.length - 1 ? 'index.html' : MODULES[i + 1]], f);
  });
});

test('the home page lists the modules by part, in order, with their numbers', () => {
  const html = read('index.html');
  const lists = [...html.matchAll(/<ol class="module-list">[\s\S]*?<\/ol>/g)].map(m => m[0]).join('');
  const links = [...lists.matchAll(/<a href="([^"]+)">([\d.]+) /g)].map(x => [x[1], x[2]]);
  assert.deepEqual(links, MODULES.map(f => [f, NUMBER[f]]));
  PARTS.forEach(([name], i) => assert.ok(html.includes('>' + (i + 1) + '. ' + name + '</h3>'), 'the home page lacks the part ' + name));
});

test('module numbers in the text use the part.position form', () => {
  for (const f of pages) {
    const m = read(f).match(/Module \d+(?!\.\d|\d)/);
    assert.equal(m, null, f + ' still uses an old module number: ' + (m && m[0]));
  }
});

test('the IV page cites the swipe-ad study as its example, with a link', () => {
  const refs = read('iv.html').match(/<section class="refs[\s\S]*?<\/section>/)[0];
  const study = refs.match(/<li class="study">([\s\S]*?)<\/li>/);
  assert.ok(study, 'iv.html lacks the example study');
  for (const part of ['Yoon, S., Yoo, J., Kim, M., Kim, W., &amp; Lee, M. S.', 'Interactive blind lead-in ads and purchase conversion',
    'Journal of Interactive Marketing', 'href="https://j1yoo.github.io/research/"']) {
    assert.ok(study[1].includes(part), 'the study reference lacks ' + part);
  }
  assert.ok(/\(Yoon et al\. in press\)/.test(read('iv.html')), 'iv.html does not cite the study in the text');
});

test('module pages follow the two-layer order: In brief, Try it, What to notice, The idea, References', () => {
  for (const f of MODULES) {
    const ids = [...read(f).matchAll(/<h2 id="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(ids, ['brief', 'try', 'notice', 'idea', 'refs'], f);
  }
});

test('page text keeps the ASD-STE100 limits: at most 25 words a sentence and 6 sentences a paragraph', () => {
  const decode = t => t.replace(/&minus;/g, '−').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, 'x');
  const sentences = t => t.replace(/ch\. /g, 'ch§').replace(/et al\. /g, 'et al§').replace(/sec\. /g, 'sec§')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(−])/).filter(x => x.trim());
  for (const f of pages) {
    const html = read(f);
    const main = html.slice(html.indexOf('<main'), html.indexOf('<section class="refs'))
      .replace(/<table[\s\S]*?<\/table>|<dl class="readout">[\s\S]*?<\/dl>|<p class="formula">[\s\S]*?<\/p>|<span class="src">[\s\S]*?<\/span>/g, ' ');
    for (const tag of ['p', 'li', 'dd', 'figcaption']) {
      for (const m of main.matchAll(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'g'))) {
        if (tag === 'li' && m[1].includes('<p')) continue;
        // An inline formula counts as one word and can start a sentence.
        const ss = sentences(decode(visibleText(m[1])).replace(/\\\([\s\S]*?\\\)/g, 'M').trim());
        assert.ok(ss.length <= 6, f + ': a paragraph has ' + ss.length + ' sentences: ' + ss[0]);
        for (const x of ss) {
          const n = x.split(/\s+/).filter(Boolean).length;
          assert.ok(n <= 25, f + ': a sentence has ' + n + ' words: ' + x);
        }
      }
    }
  }
});

// Formulas are TeX between \( \) or \[ \], rendered by the bundled KaTeX.
const katex = require(path.join(ROOT, 'assets', 'vendor', 'katex', 'katex.min.js'));
const texOf = html => [...html.matchAll(/\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g)].map(m => (m[1] !== undefined ? m[1] : m[2]));
const decodeTex = t => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

test('every formula is valid TeX for the bundled KaTeX', () => {
  for (const f of pages) {
    for (const tex of texOf(read(f))) {
      assert.doesNotThrow(() => katex.renderToString(decodeTex(tex), { throwOnError: true }), f + ': ' + tex);
    }
  }
});

test('pages with formulas load KaTeX and the math script after the visit records script', () => {
  for (const f of pages) {
    const html = read(f);
    if (!texOf(html).length) continue;
    assert.ok(html.includes('<link rel="stylesheet" href="assets/vendor/katex/katex.min.css">'), f + ' lacks the KaTeX styles');
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(srcs.slice(0, 4), ['assets/js/core/analytics.js', 'assets/vendor/katex/katex.min.js',
      'assets/vendor/katex/auto-render.min.js', 'assets/js/core/math.js'], f);
  }
});

test('module pages put each formula next to its sentence, with no In symbols box at the end', () => {
  for (const f of MODULES) {
    const html = read(f);
    assert.ok(!html.includes('<summary>In symbols</summary>'), f + ' still has the In symbols box');
    assert.ok((html.match(/<p class="formula">\\\[/g) || []).length >= 1, f + ' has no display formula');
  }
});
