// Check the visit records (assets/js/core/analytics.js) in headless Chrome. Nothing reaches Google.
// 1. Local address, no cp_debug: the page records nothing and leaves the address as it is.
// 2. Local address with ?cp_debug=1: the page prints each record with console.debug. The check moves a
//    slider, presses the buttons, opens the notation box, clicks links, scrolls, and compares the records.
// 3. Published address: requests to https://j1yoo.github.io/causal-playground/ are answered from this
//    folder, gtag.js is replaced by an empty script, and every other request fails. The check reads
//    window.dataLayer, where the page puts what gtag.js would send.
// Usage: node tools/check-analytics.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIVE = 'https://j1yoo.github.io/causal-playground/';
const GTAG = 'https://www.googletagmanager.com/gtag/js?id=G-F2Y4X86JTT';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fileFor(urlPath) {
  const file = path.join(ROOT, decodeURIComponent(urlPath) || 'index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return null;
  return fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
}

const server = http.createServer((req, res) => {
  const file = fileFor(new URL(req.url, 'http://x').pathname.slice(1));
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/';

const profile = path.join(ROOT, '.tmp-chrome-profile-' + process.pid);
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let port = null;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch (e) { /* not yet */ }
}
if (!port) { console.error('Chrome did not start'); process.exit(2); }

// Open a tab, load a page, and collect the records, problems, and requests.
async function open(url, intercept) {
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const tab = { records: [], problems: [], blocked: [], gtagLoads: 0 };
  const send = (method, params) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  let loaded;
  const loadedOnce = new Promise(r => { loaded = r; });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    const p = msg.params;
    if (msg.method === 'Page.loadEventFired') loaded();
    else if (msg.method === 'Runtime.exceptionThrown') tab.problems.push('exception: ' + (p.exceptionDetails.exception || {}).description);
    else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = p.args.map(a => (a.value !== undefined ? a.value : a.description)).join(' ');
      if (p.type === 'debug') {
        const m = text.match(/^\[analytics\] (\S+) (.*)$/);
        if (m) tab.records.push({ name: m[1], params: JSON.parse(m[2]) });
      } else if (p.type === 'error' || p.type === 'warning' || p.type === 'assert') tab.problems.push('console.' + p.type + ': ' + text);
    } else if (msg.method === 'Fetch.requestPaused') {
      const u = p.request.url;
      const file = u.startsWith(LIVE) ? fileFor(new URL(u).pathname.slice('/causal-playground/'.length)) : null;
      if (file || u === GTAG) {
        if (u === GTAG) tab.gtagLoads++;
        const body = file ? fs.readFileSync(file) : Buffer.from('/* empty stand-in for gtag.js */');
        const type = file ? TYPES[path.extname(file)] || 'application/octet-stream' : 'text/javascript';
        send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: type }], body: body.toString('base64') });
      } else {
        tab.blocked.push(u);
        send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' });
      }
    }
  };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable');
  await send('Page.enable');
  if (intercept) await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await Promise.race([loadedOnce, sleep(10000)]);
  await sleep(400);
  tab.run = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page script failed: ' + (r.exceptionDetails.exception || {}).description);
    await sleep(300);
    return r.result.value;
  };
  tab.close = async () => { ws.close(); await fetch('http://127.0.0.1:' + port + '/json/close/' + target.id).catch(() => {}); };
  return tab;
}

const STATE = `JSON.stringify({ search: location.search, audience: localStorage.getItem('cp_audience'),
  role: localStorage.getItem('site_role'), gtagTags: document.querySelectorAll('script[src*="googletagmanager"]').length,
  dataLayer: (window.dataLayer || null) && window.dataLayer.map(a => Array.from(a)) })`;

// Move a slider, press both buttons, open the notation box, click four kinds of links without leaving
// the page, and scroll down in steps so that each section heading comes into view.
const ACTIONS = `(async () => {
  const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 40)));
  window.addEventListener('click', e => { if (e.target.closest('a')) e.preventDefault(); }, true);
  const slider = document.querySelector('form.controls input[type="range"]');
  slider.value = slider.max;
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('form.controls button[type="button"]').click(); await frame();
  document.querySelector('form.controls button[type="reset"]').click(); await frame();
  document.querySelector('details.symbols').open = true; await frame(); await frame();
  for (const sel of ['.site-nav a', '.pager a', '.refs a', '.site-footer a']) document.querySelector(sel).click();
  for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await frame(); }
  scrollTo(0, document.body.scrollHeight); await frame(); await frame();
  return JSON.stringify({ slider: slider.id, max: slider.max, form: slider.form.id,
    newSample: document.querySelector('form.controls button[type="button"]').id,
    box: document.querySelector('details.symbols').id || 'symbols', nav: document.querySelector('.site-nav a').getAttribute('href'), pager: document.querySelector('.pager a').getAttribute('href'), ref: document.querySelector('.refs a').getAttribute('href'),
    footer: document.querySelector('.site-footer a').getAttribute('href') });
})()`;

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
async function part(name, fn) {
  try { await fn(); } catch (e) { check(name + ': ran to the end', false, e.message); }
}

// 1. Local address without cp_debug.
await part('local', async () => {
  const tab = await open(base + 'did.html?via=q9', false);
  const s = JSON.parse(await tab.run(STATE));
  await tab.run(ACTIONS);
  check('local: no records', tab.records.length === 0, tab.records.length + ' records');
  check('local: no gtag.js and no dataLayer', s.gtagTags === 0 && s.dataLayer === null, JSON.stringify(s));
  check('local: address and storage unchanged', s.search === '?via=q9' && s.audience === null, JSON.stringify(s));
  check('local: no console problems', tab.problems.length === 0, tab.problems.join('; '));
  await tab.close();
});

// 2. Local address with cp_debug=1.
await part('debug', async () => {
  const url = base + 'did.html?cp_debug=1&via=Q9&site_role=owner';
  const tab = await open(url, false);
  const s = JSON.parse(await tab.run(STATE));
  const a = JSON.parse(await tab.run(ACTIONS));
  const recs = tab.records;
  const named = n => recs.filter(r => r.name === n).map(r => r.params);
  const pv = named('page_view');
  check('debug: one page view with the cleaned address and both marks', pv.length === 1 && pv[0].page_location === base + 'did.html'
    && same(pv[0].user_properties, { site_role: 'owner', cp_audience: 'q9' }) && pv[0].content_group === 'causal-playground', JSON.stringify(pv));
  check('debug: marks leave the address and stay in storage', s.search === '?cp_debug=1' && s.audience === 'q9' && s.role === 'owner', JSON.stringify(s));
  check('debug: no gtag.js and no dataLayer', s.gtagTags === 0 && s.dataLayer === null, JSON.stringify(s));
  check('debug: slider release', same(named('cp_control_change'), [{ cp_module: 'did', cp_form: a.form, cp_control: a.slider, cp_value: a.max }]), JSON.stringify(named('cp_control_change')));
  check('debug: buttons', same(named('cp_button'), [{ cp_module: 'did', cp_form: a.form, cp_button: a.newSample }, { cp_module: 'did', cp_form: a.form, cp_button: 'reset' }]), JSON.stringify(named('cp_button')));
  check('debug: notation box', same(named('cp_details_toggle'), [{ cp_module: 'did', cp_box: a.box, cp_value: 'open' }]), JSON.stringify(named('cp_details_toggle')));
  check('debug: link kinds', same(named('cp_link_click'), [
    { cp_module: 'did', cp_link_kind: 'nav', cp_link_href: a.nav },
    { cp_module: 'did', cp_link_kind: 'pager', cp_link_href: a.pager },
    { cp_module: 'did', cp_link_kind: 'reference', cp_link_href: a.ref },
    { cp_module: 'did', cp_link_kind: 'footer', cp_link_href: a.footer }]), JSON.stringify(named('cp_link_click')));
  const sections = named('cp_section_view').map(p => p.cp_section);
  check('debug: each section once', same(sections.slice().sort(), ['brief', 'idea', 'notice', 'refs', 'try']), JSON.stringify(sections));
  check('debug: no console problems', tab.problems.length === 0, tab.problems.join('; '));
  await tab.close();
});

// 2b. The cap on records from one page.
await part('cap', async () => {
  const tab = await open(base + 'neyman.html?cp_debug=1', false);
  await tab.run(`(async () => { const s = document.querySelector('form.controls input[type="range"]');
    for (let i = 0; i < 400; i++) s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const own = tab.records.filter(r => r.name.startsWith('cp_')).length;
  check('debug: at most 300 records from one page', own === 300, own + ' records');
  await tab.close();
});

// 3. Published address, answered from this folder.
await part('live', async () => {
  const url = LIVE + 'did.html?via=Q9';
  const tab = await open(url, true);
  const before = JSON.parse(await tab.run(STATE));
  await tab.run(`(async () => { const s = document.querySelector('form.controls input[type="range"]');
    s.value = s.min; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const after = JSON.parse(await tab.run(STATE));
  const dl = after.dataLayer || [];
  check('live: gtag.js requested once', tab.gtagLoads === 1 && before.gtagTags === 1, tab.gtagLoads + ' loads, ' + before.gtagTags + ' tags');
  check('live: no request outside the site and gtag.js', tab.blocked.length === 0, tab.blocked.join(' '));
  check('live: js, user properties, then config with the cleaned address', dl.length >= 3 && dl[0][0] === 'js'
    && same(dl[1], ['set', 'user_properties', { cp_audience: 'q9' }])
    && same(dl[2], ['config', 'G-F2Y4X86JTT', { page_location: LIVE + 'did.html', content_group: 'causal-playground', cookie_domain: 'auto', cookie_flags: 'SameSite=None;Secure', linker: { domains: ['j1yoo.github.io', 'cadi-lab.github.io'] } }]),
  JSON.stringify(dl.slice(0, 3)));
  const change = dl.filter(e => e[0] === 'event' && e[1] === 'cp_control_change');
  check('live: a slider release becomes a gtag event', change.length === 1 && change[0][2].cp_module === 'did', JSON.stringify(change));
  check('live: the group code leaves the address and stays in storage', after.search === '' && after.audience === 'q9', JSON.stringify({ search: after.search, audience: after.audience }));
  check('live: no console problems', tab.problems.length === 0, tab.problems.join('; '));
  await tab.close();
});
await part('live student number', async () => {
  // A student who types a number into the address must not send it: the code is refused and the address is cleaned.
  const tab = await open(LIVE + 'iv.html?via=s112065432', true);
  const s = JSON.parse(await tab.run(STATE));
  const sent = JSON.stringify(s.dataLayer);
  check('live: a number in the address never reaches the records', s.dataLayer && !sent.includes('112065432') && s.search === '' && s.audience === 'q9', sent.slice(0, 300));
  await tab.close();
});
await part('live free text', async () => {
  // Anything else typed into the address stays out of the records, on this page and in the next page's referrer.
  const tab = await open(LIVE + 'did.html?via=q9&sid=s1120654321&email=a%40b.c&utm_source=course#refs', true);
  const a = JSON.parse(await tab.run(STATE));
  const configA = (a.dataLayer || []).find(e => e[0] === 'config');
  const leaks = t => ['s1120654321', 'a%40b.c', 'a@b.c'].filter(x => t.includes(x));
  check('live: the recorded address keeps only campaign tags', configA && configA[2].page_location === LIVE + 'did.html?utm_source=course'
    && a.search === '?utm_source=course' && leaks(JSON.stringify(a.dataLayer)).length === 0, JSON.stringify(configA) + ' ' + a.search);
  await tab.run("location.assign('neyman.html'); true");
  await sleep(2000);
  const b = JSON.parse(await tab.run(STATE));
  const configB = (b.dataLayer || []).find(e => e[0] === 'config');
  check('live: the next page records the referrer without its query', configB && configB[2].page_referrer === LIVE + 'did.html'
    && configB[2].page_location === LIVE + 'neyman.html' && leaks(JSON.stringify(b.dataLayer)).length === 0, JSON.stringify(configB));
  check('live free text: no request outside the site and gtag.js', tab.blocked.length === 0, tab.blocked.join(' '));
  await tab.close();
});
await part('live home', async () => {
  const tab = await open(LIVE, true);
  const s = JSON.parse(await tab.run(STATE));
  const config = (s.dataLayer || []).find(e => e[0] === 'config');
  check('live: the folder address is the home page', config && config[2].page_location === LIVE && s.audience === 'q9'
    && same((s.dataLayer || []).find(e => e[0] === 'set'), ['set', 'user_properties', { cp_audience: 'q9' }]), JSON.stringify(s.dataLayer));
  check('live home: no request outside the site and gtag.js', tab.blocked.length === 0, tab.blocked.join(' '));
  await tab.close();
});

chrome.kill();
server.close();
await sleep(300);
fs.rmSync(profile, { recursive: true, force: true });
let failures = 0;
for (const r of results) {
  if (!r.ok) failures++;
  console.log((r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.detail));
}
process.exit(failures ? 1 : 0);
