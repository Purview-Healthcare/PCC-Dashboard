'use strict';
/*
 * Extra helpers used only by the production-side number checks (files 10 to 13).
 * Made-up data only. Nothing here changes helpers.js.
 *
 * What is in here
 *  - soft(): collect many small comparisons in one check and report every mismatch at once
 *  - withApp(): open the app, load files, run a check, always close the browser window
 *  - setFilters(): change the top filter bar the way a person would (and redraw)
 *  - small readers for tiles, tables, bar rows and the Overview screen
 *  - dataset builders: the standard set with pieces swapped out, plus extra made-up rows
 */
const assert = require('node:assert/strict');
const h = require('./helpers');

/* ---------- collecting several comparisons ---------- */
function soft() {
  const fails = [];
  return {
    eq(actual, expected, what) {
      try { assert.deepStrictEqual(actual, expected); }
      catch (e) { fails.push(`${what}: expected ${JSON.stringify(expected)} but the screen shows ${JSON.stringify(actual)}`); }
    },
    ok(cond, what) { if (!cond) fails.push(what); },
    done() { if (fails.length) assert.fail('\n  - ' + fails.join('\n  - ')); },
  };
}

/* ---------- opening the app ---------- */
/** files: array of files, or undefined for the standard production set, or null to load nothing. */
async function withApp(opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const app = await h.openApp(opts);
  try {
    if (opts.files !== null) await h.loadProduction(app.page, opts.files);
    if (opts.filters) await setFilters(app.page, opts.filters);
    await fn(app);
  } finally { await app.context.close(); }
}

/** Change the filter bar like a person would. keys: from, to, queue, agent, groupBy, shiftStart, shiftEnd, devices */
async function setFilters(page, f) {
  await page.evaluate(f => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); };
    if ('from' in f) set('fFrom', f.from);
    if ('to' in f) set('fTo', f.to);
    if ('queue' in f) set('fQueue', f.queue);
    if ('agent' in f) set('fAgent', f.agent);
    if ('groupBy' in f) set('fGroup', f.groupBy);
    if ('shiftStart' in f) set('fShiftStart', f.shiftStart);
    if ('shiftEnd' in f) set('fShiftEnd', f.shiftEnd);
    if ('devices' in f) { const c = document.getElementById('fDevices'); c.checked = !!f.devices; c.dispatchEvent(new Event('change', { bubbles: true })); }
  }, f);
  await page.waitForTimeout(80);
}

/* ---------- readers ---------- */
const clean = s => String(s).replace(/\s+/g, ' ').trim();

/** Every KPI tile under a root selector: [{label, value, foot}] */
async function tiles(page, root) {
  return page.evaluate(r => [...document.querySelectorAll(r + ' .kpi')].map(k => {
    const l = k.querySelector('.lab'), v = k.querySelector('.val'), f = k.querySelector('.foot');
    return { label: l ? l.textContent.replace(/\s+/g, ' ').trim() : '', value: v ? v.textContent.replace(/\s+/g, ' ').trim() : '', foot: f ? f.textContent.replace(/\s+/g, ' ').trim() : '' };
  }), root);
}
/** One tile by label. nth picks the 1st, 2nd... tile that has that label. Returns {value, foot} or null. */
function pick(list, label, nth = 0) { return list.filter(t => t.label === label)[nth] || null; }
async function tile(page, root, label, nth = 0) { return pick(await tiles(page, root), label, nth); }

/** Table rows (header, body and footer rows) for the first table that follows a heading containing `title`, inside root. */
async function tableAt(page, root, title) {
  return page.evaluate(([r, t]) => {
    const rootEl = document.querySelector(r); if (!rootEl) return null;
    const heads = [...rootEl.querySelectorAll('h3,h4')].filter(x => x.textContent.includes(t));
    for (const hd of heads) {
      let tbl = null; const card = hd.closest('.card');
      if (card) tbl = card.querySelector('table');
      if (!tbl) { let n = hd.nextElementSibling; while (n && !tbl) { tbl = n.matches('table') ? n : n.querySelector('table'); n = n.nextElementSibling; } }
      if (tbl) return [...tbl.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim()));
    }
    return null;
  }, [root, title]);
}
/** Bar rows (.barrow) of the card that holds / follows a heading: [{k, v}] */
async function barsAt(page, root, title) {
  return page.evaluate(([r, t]) => {
    const rootEl = document.querySelector(r); if (!rootEl) return null;
    const heads = [...rootEl.querySelectorAll('h3,h4')].filter(x => x.textContent.includes(t));
    let found = false;
    for (const hd of heads) {
      let box = hd.closest('.card'); if (!box) { box = hd.nextElementSibling; }
      if (box) found = true;
      if (box && box.querySelector('.barrow')) return [...box.querySelectorAll('.barrow')].map(b => ({ k: b.querySelector('.lbl').textContent.trim(), v: b.querySelector('.num').textContent.replace(/\s+/g, ' ').trim() }));
    }
    return found ? [] : null;
  }, [root, title]);
}
/** The stacked per-period rows on Coverage: [{d, tot}] */
async function stackRows(page, root) {
  return page.evaluate(r => [...document.querySelectorAll(r + ' .stackrow')].map(s => ({ d: s.querySelector('.d').textContent.replace(/\s+/g, ' ').trim(), tot: s.querySelector('.tot').textContent.replace(/\s+/g, ' ').trim() })), root);
}
/** Text of the legend entries of the first donut/legend inside a card whose heading contains title. */
async function legendAt(page, root, title) {
  return page.evaluate(([r, t]) => {
    const rootEl = document.querySelector(r);
    const hd = [...rootEl.querySelectorAll('h3,h4')].find(x => x.textContent.includes(t)); if (!hd) return null;
    const box = hd.closest('.card') || hd.nextElementSibling;
    return [...box.querySelectorAll('.legend span')].map(s => s.textContent.replace(/\s+/g, ' ').trim());
  }, [root, title]);
}
/** Everything on the Overview screen that carries a number. root is '#v-overview' or '#rep-overview'. */
async function overview(page, root) {
  return page.evaluate(r => {
    const q = s => document.querySelector(r + ' ' + s);
    const t = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    const splits = [...document.querySelectorAll(r + ' .ov-split')].map(t);
    const cards = [...document.querySelectorAll(r + ' .accent-card')];
    const handledCard = cards[0], notCard = cards[1];
    const mini = [...handledCard.querySelectorAll('.ov-mini > div')].map(d => ({ k: t(d.querySelector('.k')), v: t(d.querySelector('.v')) }));
    const notSub = t(notCard.querySelector('span[style*="font-weight:600"]'));
    const handledSub = t(handledCard.querySelector('span[style*="font-weight:600"]'));
    const brk = [...document.querySelectorAll(r + ' .ov-brk')].map(b => ({ k: t(b.querySelector('.bl')), v: t(b.querySelector('.bn')) }));
    const legend = [...document.querySelectorAll(r + ' .ov-res-bar')][0].parentElement.querySelectorAll('.legend span');
    const other = [...document.querySelectorAll(r + ' .grid3 .accent-card')].map(c => { const sp = c.querySelectorAll('span'); return { k: t(c.querySelector('.lab')), v: t(sp[0]), foot: t(sp[1]) }; });
    return { total: t(q('.ov-hero .big')), meta: q('.ov-hero .meta').innerHTML.split(/<br\s*\/?>/i).map(x => x.replace(/<[^>]*>/g, '').trim()),
      handled: splits[0], notAnswered: splits[1], handledSub, notSub, mini, brk, legend: [...legend].map(t), other };
  }, root);
}
/** Text of every production section, with problems flagged (NaN, undefined, Infinity, [object ...]). */
async function badText(page) {
  return page.evaluate(() => {
    const out = [];
    ['exec', 'overview', 'coverage', 'agents', 'volume', 'voice', 'insights', 'report'].forEach(id => {
      const el = document.getElementById('v-' + id); if (!el) return;
      const m = el.textContent.match(/.{0,40}(\bNaN\b|undefined|Infinity|\[object).{0,40}/);
      if (m) out.push(id + ': ' + m[0].replace(/\s+/g, ' '));
    });
    return out;
  });
}
const num = s => Number(String(s).replace(/[^0-9.\-]/g, ''));

/* ---------- datasets ---------- */
const NO_SAT = rows => rows.filter(r => !String(r['Date [America/Chicago]']).startsWith('2026-03-07'));

/** Standard files with any piece swapped. Pass an array of rows to replace a piece, or null to leave the file out. */
function prodFiles(o = {}) {
  const pick1 = (key, std) => (key in o ? o[key] : std());
  const set = [
    ['queue-caller-details.csv', pick1('queue', h.standardQueueRows), h.HEAD.queueDetails],
    ['call-report-conversations.csv', pick1('calls', h.standardCallLog), h.HEAD.conversations],
    ['agent-productivity.csv', pick1('productivity', h.standardProductivity), h.HEAD.productivity],
    ['individual-performance.csv', pick1('individual', h.standardIndividual), h.HEAD.individual],
    ['agent-activity.csv', pick1('activity', h.standardActivity), h.HEAD.activity],
    ['pause-usage.csv', pick1('pause', h.standardPause), h.HEAD.pause],
    ['grouped-by-date.csv', pick1('byDate', h.standardByDate), h.HEAD.byDate],
  ];
  return set.filter(([, rows]) => rows).map(([n, rows, head]) => h.csvFile(n, rows, head));
}
/** The standard data without the Saturday missed call, so "in-shift missed" has one clear answer (3). */
function weekdayFiles(o = {}) { return prodFiles(Object.assign({ calls: NO_SAT(h.standardCallLog()) }, o)); }

/** Made-up queue rows for other dates (used to test week / month grouping and month-over-month). */
function extraQueueRows() {
  const at = (date, hh, mm) => `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-06:00`;
  const H = (date, hh, agent, sl, wait, talk) => h.qRow({ start: at(date, hh, 10), agent, outcome: 'handled', reason: 'agent answered', sl, wait, talk, ring: 4, call: wait + talk });
  return [
    // Thu 26 Feb 2026 (February): 2 handled, 1 no-agent in shift, 1 abandoned
    H('2026-02-26', 10, 'Asha Rao', 'YES', 5, 100), H('2026-02-26', 14, 'Ben Cole', 'YES', 6, 120),
    h.qRow({ start: at('2026-02-26', 12, 5), outcome: 'outflowed system', reason: 'no agents - joined empty' }),
    h.qRow({ start: at('2026-02-26', 15, 5), outcome: 'abandoned', reason: 'caller hung up', sl: 'NO', wait: 30 }),
    // Mon 9 Mar 2026 (next week): 1 handled, 1 no-agent in shift
    H('2026-03-09', 11, 'Cara Diaz', 'YES', 4, 90),
    h.qRow({ start: at('2026-03-09', 13, 5), outcome: 'outflowed system', reason: 'no agents - joined empty' }),
    // Tue 31 Mar and Wed 1 Apr 2026 (month end / start)
    H('2026-03-31', 9, 'Asha Rao', 'YES', 5, 110), H('2026-04-01', 9, 'Asha Rao', 'NO', 45, 130),
  ];
}
/** Matching extra call-log rows: one Missed inbound in February, and one in April. */
function extraCallRows() {
  return [
    h.cRow({ date: '2026-02-26T10:05:00-06:00', dir: 'Inbound', res: 'Missed Call', from: '+13125550170', dur: 18000 }),
    h.cRow({ date: '2026-04-01T09:30:00-06:00', dir: 'Inbound', res: 'Missed Call', from: '+13125550171', dur: 22000 }),
  ];
}
function multiMonthFiles(o = {}) {
  return prodFiles(Object.assign({
    queue: h.standardQueueRows().concat(extraQueueRows()),
    calls: NO_SAT(h.standardCallLog()).concat(extraCallRows()),
  }, o));
}

module.exports = {
  soft, withApp, setFilters, clean, tiles, pick, tile, tableAt, barsAt, stackRows, legendAt, overview, badText, num,
  NO_SAT, prodFiles, weekdayFiles, extraQueueRows, extraCallRows, multiMonthFiles,
};
