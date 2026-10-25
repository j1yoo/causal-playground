// Load every page in headless Chrome, move every control, and report
// console errors, page exceptions, failed requests, and bad numbers (NaN, undefined, Infinity).
// Usage: node tools/check-pages.mjs [--shots] [--mobile] [page.html ...]
// No packages needed: it uses the Chrome DevTools Protocol over WebSocket (Node 22 or newer).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const SHOTS = args.includes('--shots');
const MOBILE = args.includes('--mobile');
let pages = args.filter(a => a.endsWith('.html'));
if (!pages.length) pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const missing = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    missing.push(url); res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/';

const profile = path.join(ROOT, '.tmp-chrome-profile-' + process.pid);
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = null;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch (e) { /* not yet */ }
}
if (!port) { console.error('Chrome did not start'); process.exit(2); }

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
    else listeners.forEach(fn => fn(msg));
  };
  const ready = new Promise(r => { ws.onopen = r; });
  return {
    ready,
    send: (method, params) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }),
    on: fn => listeners.push(fn),
    close: () => ws.close(),
  };
}

// Runs inside the page: moves every control through its range and checks the text.
const EXERCISE = `(async () => {
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const bad = [], warn = [];
  const main = document.querySelector('main');
  const check = (what) => {
    // Every text node, joined with spaces: this also covers hover titles, chart descriptions, and closed details blocks.
    const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT), parts = [];
    while (walk.nextNode()) parts.push(walk.currentNode.nodeValue);
    const all = parts.join(' ');
    const m = all.match(/\\bNaN\\b|\\bundefined\\b|\\bInfinity\\b|\\[object/);
    if (m) bad.push(what + ': found "' + m[0] + '"');
    if (/\\bn\\/a\\b/.test(all)) warn.push(what);
    for (const s of main.querySelectorAll('svg[id]')) {
      const marks = [...s.querySelectorAll('.dot, .bar, .area, .whisker, .ln')]
        .filter(e => !(e.tagName === 'path' && e.classList.contains('ln')) || /L/.test(e.getAttribute('d') || ''));
      if (!marks.length) bad.push(what + ': chart ' + s.id + ' has no data marks');
    }
  };
  await frame(); await frame();
  check('initial');
  const ranges = [...document.querySelectorAll('input[type=range]')];
  for (const r of ranges) {
    const orig = r.value;
    const min = Number(r.min), max = Number(r.max), step = Number(r.step) || 1;
    const mid = min + Math.round((max - min) / 2 / step) * step;
    for (const v of [min, max, mid, orig]) {
      r.value = v; r.dispatchEvent(new Event('input', { bubbles: true }));
      await frame(); check(r.id + '=' + v);
    }
  }
  // Move all sliders together: all at the minimum, all at the maximum, then 20 seeded random settings.
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const settings = [r => r.min, r => r.max];
  for (let i = 0; i < 20; i++) settings.push(r => Number(r.min) + rnd() * (Number(r.max) - Number(r.min)));
  for (const [i, f] of settings.entries()) {
    for (const r of ranges) r.value = f(r);
    for (const r of ranges) r.dispatchEvent(new Event('input', { bubbles: true }));
    await frame(); check('setting ' + i + ' (' + ranges.map(r => r.id + '=' + r.value).join(', ') + ')');
  }
  for (const r of ranges) { r.value = r.defaultValue; r.dispatchEvent(new Event('input', { bubbles: true })); }
  await frame();
  for (const c of document.querySelectorAll('input[type=checkbox]')) {
    c.click(); await frame(); check(c.id + ' toggled'); c.click(); await frame(); check(c.id + ' back');
  }
  for (const s of document.querySelectorAll('select')) {
    const orig = s.value;
    for (const o of s.options) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); await frame(); check(s.id + '=' + o.value); }
    s.value = orig; s.dispatchEvent(new Event('change', { bubbles: true })); await frame();
  }
  for (const r of document.querySelectorAll('input[type=radio]')) {
    r.click(); await frame(); check(r.id + ' chosen');
  }
  for (const b of document.querySelectorAll('main button[type=button]')) {
    b.click(); await frame(); check('button ' + (b.id || b.textContent)); b.click(); await frame(); check('button ' + (b.id || b.textContent) + ' again');
  }
  for (const b of document.querySelectorAll('main button[type=reset]')) {
    b.click(); await frame(); await frame(); check('reset');
    if (!b.form) { bad.push('a Reset button sits outside any form'); continue; }
    for (const r of b.form.querySelectorAll('input[type=range]')) if (r.value !== r.defaultValue) bad.push('reset left ' + r.id + ' at ' + r.value);
  }
  for (const l of document.querySelectorAll('main .sample-label')) if (l.textContent !== 'Sample 1') bad.push('after reset, ' + (l.id || 'a sample label') + ' shows ' + l.textContent);
  const svgs = main.querySelectorAll('svg[id]').length;
  const na = (main.innerText.match(/n\\/a/g) || []).length;
  return { bad, warn, controls: ranges.length, svgs, emptyCharts: [], naCount: na, title: document.title };
})()`;

const report = [];
let failures = 0;
if (SHOTS) fs.mkdirSync(path.join(ROOT, 'tools', 'screenshots'), { recursive: true });
for (const page of pages) {
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
  const c = connect(target.webSocketDebuggerUrl);
  await c.ready;
  const problems = [];
  c.on(msg => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push('exception: ' + (d.exception && d.exception.description || d.text) + ' at ' + (d.url || '') + ':' + d.lineNumber);
    } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning' || msg.params.type === 'assert')) {
      problems.push('console.' + msg.params.type + ': ' + msg.params.args.map(a => a.value || a.description).join(' '));
    } else if (msg.method === 'Log.entryAdded' && (msg.params.entry.level === 'error' || msg.params.entry.level === 'warning')) {
      problems.push('log ' + msg.params.entry.level + ': ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  });
  await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
  const width = MOBILE ? 390 : 1280;
  await c.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: MOBILE });
  const loaded = new Promise(r => c.on(msg => { if (msg.method === 'Page.loadEventFired') r(); }));
  await c.send('Page.navigate', { url: base + page });
  await Promise.race([loaded, sleep(10000)]);
  await sleep(300);
  let result = null;
  try {
    const r = await Promise.race([
      c.send('Runtime.evaluate', { expression: EXERCISE, awaitPromise: true, returnByValue: true, timeout: 120000 }),
      sleep(60000).then(() => { throw new Error('no result after 60 s (the page may loop forever)'); }),
    ]);
    if (r.exceptionDetails) problems.push('exercise failed: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    else result = r.result.value;
  } catch (e) { problems.push('evaluate error: ' + e.message); }
  if (result) {
    for (const b of result.bad) problems.push('bad text after ' + b);
    for (const id of result.emptyCharts) problems.push('chart looks empty: ' + id);
  }
  if (SHOTS) {
    await c.send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' });
    const m = await c.send('Page.getLayoutMetrics');
    const h = Math.ceil(m.cssContentSize ? m.cssContentSize.height : m.contentSize.height);
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(h, 12000), deviceScaleFactor: 1, mobile: MOBILE });
    await sleep(400);
    const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(ROOT, 'tools', 'screenshots', page.replace('.html', '') + (MOBILE ? '-mobile' : '') + '.png'), Buffer.from(shot.data, 'base64'));
  }
  c.close();
  await fetch('http://127.0.0.1:' + port + '/json/close/' + target.id).catch(() => {});
  if (problems.length) failures++;
  report.push({ page, ok: problems.length === 0, problems, controls: result && result.controls, charts: result && result.svgs, naCount: result && result.naCount, warn: result ? result.warn : [] });
}
if (missing.length) { failures++; report.push({ page: '(server)', ok: false, problems: missing.map(u => '404 ' + u) }); }

chrome.kill();
server.close();
await sleep(300);
fs.rmSync(profile, { recursive: true, force: true });
for (const r of report) {
  console.log((r.ok ? 'OK   ' : 'FAIL ') + r.page + (r.controls !== undefined ? '  controls=' + r.controls + ' charts=' + r.charts + ' n/a=' + r.naCount : ''));
  for (const p of r.problems) console.log('     - ' + p);
  if (r.warn && r.warn.length) console.log('     note: n/a shown in ' + r.warn.length + ' states, for example: ' + r.warn.slice(0, 3).join('; '));
}
process.exit(failures ? 1 : 0);
