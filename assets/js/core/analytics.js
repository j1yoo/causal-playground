// Visit records with Google Analytics 4. This is the only site code that sends data over the network.
// It runs only on the published host. On any other host the page records nothing.
// With ?cp_debug=1 in the address, the page prints each record with console.debug and sends nothing.
// The records never include names, email addresses, or student numbers.
// Before Google Analytics starts, the address bar keeps only campaign tags (utm_*) and cp_debug, and the
// records get the page address with campaign tags only and a referrer without its query. So text typed
// into an address never reaches Google. Two marks in the address become user properties after a check:
//   ?site_role=owner marks this browser as the site owner's, and ?site_role=clear removes the mark.
//     The key and the values are the same as on the personal site, which shares the browser storage.
//   ?via=<group code> on a link from a course page: one or two letters and one to three digits, for
//     example e1. The browser keeps the newest code, and every later visit sends it as cp_audience.
(function (global) {
  'use strict';
  const CP = global.CP = global.CP || {};

  const MEASUREMENT_ID = 'G-F2Y4X86JTT';
  const LIVE_HOST = 'j1yoo.github.io';
  const EVENT_LIMIT = 300;
  const MAX_VALUE = 100;

  function mode(hostname, search) {
    if (new URLSearchParams(search).get('cp_debug') === '1') return 'debug';
    return hostname === LIVE_HOST ? 'live' : 'off';
  }

  function pageKey(pathname) {
    return String(pathname || '').split('/').pop().replace(/\.html?$/, '') || 'index';
  }

  // A code this short cannot hold a name, a student number, or an email address.
  function groupCode(raw) {
    if (raw === null || raw === undefined) return null;
    const v = String(raw).trim().toLowerCase();
    return /^[a-z]{1,2}[0-9]{1,3}$/.test(v) ? v : null;
  }

  // User properties from the address and the browser storage. A stored value is checked again,
  // because any page on the same host can write to this storage.
  function readMarks(search, storage) {
    const params = new URLSearchParams(search);
    const props = {};
    const requested = params.get('site_role');
    let role = requested === 'owner' ? 'owner' : requested === 'clear' ? 'cleared' : null;
    try {
      if (role === 'owner') storage.setItem('site_role', 'owner');
      if (role === 'cleared') storage.removeItem('site_role');
      if (!role && storage.getItem('site_role') === 'owner') role = 'owner';
    } catch (e) { /* storage blocked: the mark lasts for this page only */ }
    if (role) props.site_role = role;

    let audience = groupCode(params.get('via'));
    try {
      if (audience) storage.setItem('cp_audience', audience);
      else audience = groupCode(storage.getItem('cp_audience'));
    } catch (e) { /* storage blocked */ }
    if (audience) props.cp_audience = audience;
    return props;
  }

  function keepParams(search, keep) {
    const params = new URLSearchParams(search);
    const kept = new URLSearchParams();
    params.forEach((value, key) => { if (keep(key)) kept.append(key, value); });
    const q = kept.toString();
    return q ? '?' + q : '';
  }

  const isCampaignTag = key => /^utm_[a-z_]+$/.test(key);

  // The query that stays in the address bar.
  function addressSearch(search) {
    return keepParams(search, key => isCampaignTag(key) || key === 'cp_debug');
  }

  // The page address that the records get: no marks, no other parameters, no fragment.
  function pageLocation(href) {
    const u = new URL(href);
    return u.origin + u.pathname + keepParams(u.search, isCampaignTag);
  }

  function cleanReferrer(referrer) {
    if (!referrer) return '';
    try {
      const u = new URL(referrer);
      return u.origin + u.pathname;
    } catch (e) {
      return '';
    }
  }

  function clip(value) {
    return value === null || value === undefined ? '' : String(value).slice(0, MAX_VALUE);
  }

  function makeSender(deliver, limit) {
    let count = 0;
    return function send(name, params) {
      if (count >= limit) return false;
      count += 1;
      deliver(name, params);
      return true;
    };
  }

  function linkKind(a) {
    if (a.closest('.site-title')) return 'home';
    if (a.closest('.site-nav')) return 'nav';
    if (a.closest('.skip-link')) return 'skip';
    if (a.closest('.pager')) return 'pager';
    if (a.closest('.refs')) return 'reference';
    if (a.closest('.site-footer')) return 'footer';
    if (a.closest('section[aria-labelledby="terms"]')) return 'key_terms';
    return 'text';
  }

  function start() {
    const m = mode(location.hostname, location.search);
    if (m === 'off') return;
    let storage = null;
    try { storage = global.localStorage; } catch (e) { /* storage blocked */ }
    const props = readMarks(location.search, storage);
    const search = addressSearch(location.search);
    if (search !== location.search) {
      // A copied link must not carry the marks to another browser, and the next page must not
      // get typed text in its referrer.
      history.replaceState(history.state, '', location.pathname + search + location.hash);
    }
    const config = { page_location: pageLocation(location.href), content_group: 'causal-playground', cookie_domain: 'auto', cookie_flags: 'SameSite=None;Secure' };
    const referrer = cleanReferrer(document.referrer);
    if (referrer) config.page_referrer = referrer;
    let deliver;
    if (m === 'live') {
      const dataLayer = global.dataLayer = global.dataLayer || [];
      const gtag = function () { dataLayer.push(arguments); };
      gtag('js', new Date());
      if (Object.keys(props).length) gtag('set', 'user_properties', props);
      gtag('config', MEASUREMENT_ID, config);
      const tag = document.createElement('script');
      tag.async = true;
      tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
      document.head.appendChild(tag);
      deliver = (name, params) => gtag('event', name, params);
    } else {
      console.debug('[analytics]', 'page_view', JSON.stringify(Object.assign({ user_properties: props }, config)));
      deliver = (name, params) => console.debug('[analytics]', name, JSON.stringify(params));
    }
    const send = makeSender(deliver, EVENT_LIMIT);
    const page = pageKey(location.pathname);

    // Sliders send a change only when the reader lets go, not on every step of a drag.
    document.addEventListener('change', e => {
      const el = e.target;
      if (!el || !el.id || !/^(INPUT|SELECT)$/.test(el.tagName)) return;
      send('cp_control_change', { cp_module: page, cp_form: el.form ? el.form.id : '', cp_control: el.id,
        cp_value: clip(el.type === 'checkbox' ? el.checked : el.value) });
    });
    document.addEventListener('click', e => {
      const target = e.target && e.target.closest ? e.target : null;
      if (!target) return;
      const button = target.closest('button');
      if (button) {
        send('cp_button', { cp_module: page, cp_form: button.form ? button.form.id : '', cp_button: button.id || button.type });
        return;
      }
      const a = target.closest('a[href]');
      if (a) send('cp_link_click', { cp_module: page, cp_link_kind: linkKind(a), cp_link_href: clip(a.getAttribute('href')) });
    });
    // The toggle event does not bubble, so it is caught on the way down.
    document.addEventListener('toggle', e => {
      const box = e.target;
      if (box.tagName === 'DETAILS') send('cp_details_toggle', { cp_module: page, cp_box: box.id || box.className || 'details', cp_value: box.open ? 'open' : 'closed' });
    }, true);
    if (typeof IntersectionObserver !== 'undefined') {
      const seen = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        seen.unobserve(entry.target);
        send('cp_section_view', { cp_module: page, cp_section: entry.target.id });
      }));
      document.querySelectorAll('main h2[id]').forEach(h => seen.observe(h));
    }
  }

  CP.analytics = { MEASUREMENT_ID, LIVE_HOST, EVENT_LIMIT, mode, pageKey, groupCode, readMarks, addressSearch, pageLocation, cleanReferrer, clip, makeSender };
  if (typeof module !== 'undefined' && module.exports) module.exports = CP.analytics;
  if (typeof document !== 'undefined' && typeof location !== 'undefined') start();
})(typeof window !== 'undefined' ? window : globalThis);
