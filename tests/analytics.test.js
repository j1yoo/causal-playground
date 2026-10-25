// Unit tests for the pure parts of the visit records (assets/js/core/analytics.js).
// The page side (listeners, gtag) is checked in a browser by tools/check-analytics.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const A = require(path.join(__dirname, '..', 'assets', 'js', 'core', 'analytics.js'));

function memoryStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

test('records go to Google only on the published host', () => {
  assert.equal(A.mode('j1yoo.github.io', ''), 'live');
  for (const host of ['localhost', '127.0.0.1', 'preview.example.org', '', 'someone.github.io', 'j1yoo.github.io.example.com']) {
    assert.equal(A.mode(host, ''), 'off', host);
  }
});

test('cp_debug=1 prints the records instead of sending them, on any host', () => {
  assert.equal(A.mode('j1yoo.github.io', '?cp_debug=1'), 'debug');
  assert.equal(A.mode('127.0.0.1', '?via=x&cp_debug=1'), 'debug');
  assert.equal(A.mode('127.0.0.1', '?cp_debug=0'), 'off');
});

test('the page key is the file name without .html, and index for the folder', () => {
  assert.equal(A.pageKey('/causal-playground/did.html'), 'did');
  assert.equal(A.pageKey('/causal-playground/did'), 'did');
  assert.equal(A.pageKey('/causal-playground/'), 'index');
  assert.equal(A.pageKey('/causal-playground/index.html'), 'index');
  assert.equal(A.pageKey('/event-study.html'), 'event-study');
  assert.equal(A.pageKey('/'), 'index');
});

test('a group code is one or two letters and one to three digits, so it cannot hold a name or a number', () => {
  assert.equal(A.groupCode('e1'), 'e1');
  assert.equal(A.groupCode(' P12 '), 'p12');
  assert.equal(A.groupCode('ab123'), 'ab123');
  for (const bad of [null, '', 'alpha', 'wang-xiaoming', 'abc1', 'a1234', '1', 'a-1', 'a 1', 's112065432']) {
    assert.equal(A.groupCode(bad), null, String(bad));
  }
});

test('the owner mark uses the key and values of the personal site', () => {
  const s = memoryStorage();
  assert.deepEqual(A.readMarks('?site_role=owner', s), { site_role: 'owner' });
  assert.equal(s.getItem('site_role'), 'owner');
  assert.deepEqual(A.readMarks('', s), { site_role: 'owner' }, 'the mark stays for later visits');
  assert.deepEqual(A.readMarks('?site_role=clear', s), { site_role: 'cleared' }, 'the clearing visit is recorded once');
  assert.equal(s.getItem('site_role'), null);
  assert.deepEqual(A.readMarks('?site_role=somebody', s), {});
});

test('a stored value is sent only if it passes the same check', () => {
  assert.deepEqual(A.readMarks('', memoryStorage({ site_role: 'Wang Xiaoming' })), {});
  assert.deepEqual(A.readMarks('', memoryStorage({ cp_audience: 'wang-xiaoming' })), {});
  assert.deepEqual(A.readMarks('', memoryStorage({ site_role: 'owner', cp_audience: 'e1' })), { site_role: 'owner', cp_audience: 'e1' });
});

test('the group code from a link is kept for later visits in the same browser', () => {
  const s = memoryStorage();
  assert.deepEqual(A.readMarks('?via=E1', s), { cp_audience: 'e1' });
  assert.deepEqual(A.readMarks('', s), { cp_audience: 'e1' });
  assert.deepEqual(A.readMarks('?via=p2', s), { cp_audience: 'p2' }, 'the newest code replaces the old one');
  assert.deepEqual(A.readMarks('?via=not%20valid', s), { cp_audience: 'p2' }, 'an invalid code changes nothing');
  assert.deepEqual(s.dump(), { cp_audience: 'p2' });
});

test('marks still work when the browser blocks storage', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  for (const storage of [blocked, null]) {
    assert.deepEqual(A.readMarks('?via=e1&site_role=owner', storage), { site_role: 'owner', cp_audience: 'e1' });
  }
});

test('the address bar keeps only campaign tags and cp_debug', () => {
  assert.equal(A.addressSearch('?via=e1'), '');
  assert.equal(A.addressSearch('?cp_debug=1&via=e1&site_role=owner&sid=s112&email=a%40b.c'), '?cp_debug=1');
  assert.equal(A.addressSearch('?utm_source=course&x=1&utm_medium=link'), '?utm_source=course&utm_medium=link');
  assert.equal(A.addressSearch(''), '');
});

test('the recorded address is the page with campaign tags only, and the referrer has no query', () => {
  assert.equal(A.pageLocation('https://j1yoo.github.io/causal-playground/did.html?via=e1&sid=s1&email=a%40b.c&utm_source=course&cp_debug=1#refs'),
    'https://j1yoo.github.io/causal-playground/did.html?utm_source=course');
  assert.equal(A.pageLocation('https://j1yoo.github.io/causal-playground/'), 'https://j1yoo.github.io/causal-playground/');
  assert.equal(A.cleanReferrer('https://j1yoo.github.io/teaching/material/?file=%2Fx.pdf#p2'), 'https://j1yoo.github.io/teaching/material/');
  assert.equal(A.cleanReferrer(''), '');
  assert.equal(A.cleanReferrer('not a url'), '');
});

test('values are cut to the 100 characters that Google Analytics keeps', () => {
  assert.equal(A.clip('x'.repeat(150)).length, 100);
  assert.equal(A.clip(0.25), '0.25');
  assert.equal(A.clip(null), '');
});

test('one page sends at most a fixed number of its own events', () => {
  const got = [];
  const send = A.makeSender((name, params) => got.push([name, params]), 3);
  for (let i = 0; i < 5; i++) send('cp_button', { n: i });
  assert.equal(got.length, 3);
  assert.deepEqual(got[2], ['cp_button', { n: 2 }]);
  assert.equal(A.EVENT_LIMIT, 300);
});
