'use strict';
// Area 10: speed. Made-up queue rows and call-log rows (20,000 and 60,000 calls) are loaded through the real upload box.
// The numbers measured are printed in the test output ("# ..." lines) so they can be quoted exactly.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

/* small repeatable random numbers so every run builds the same file */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const AGENTS = Array.from({ length: 24 }, (_, i) => `Agent ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + ((i * 7) % 26))} Test${i + 1}`);
const QUEUES = ['Main Line', 'Billing', 'Scheduling', 'Refills'];
const TOPICS = ['scheduling', 'billing', 'insurance', 'order status', 'directions', 'refill', 'results'];
const SUMMARIES = ['Caller booked a routine visit for next week.', 'Caller was unhappy about a long wait on hold.', 'Caller asked about opening hours.', 'Caller needed a refill authorised.'];
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Builds N queue rows and N call-log rows spread over 60 days (weekdays and a few weekend calls). */
function bigFiles(n) {
  const r = rng(12345);
  const q = [h.HEAD.queueDetails.join(',')], c = [h.HEAD.conversations.join(',')];
  for (let i = 0; i < n; i++) {
    const day = Math.floor(r() * 60), d = new Date(Date.UTC(2026, 0, 5 + day));          // from Mon 5 Jan 2026
    const hh = 7 + Math.floor(r() * 12), mm = Math.floor(r() * 60), ss = Math.floor(r() * 60);
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(hh)}:${pad(mm)}:${pad(ss)}-06:00`;
    const roll = r(); const agent = AGENTS[Math.floor(r() * AGENTS.length)]; const queue = QUEUES[Math.floor(r() * QUEUES.length)];
    let outcome, reason, who = '', wait = Math.floor(r() * 60), talk = '', ring = '', sl = r() < 0.8 ? 'YES' : 'NO';
    if (roll < 0.72) { outcome = 'handled'; reason = 'agent answered'; who = agent; talk = 30 + Math.floor(r() * 400); ring = 2 + Math.floor(r() * 8); }
    else if (roll < 0.80) { outcome = 'outflowed system'; reason = 'no agents - joined empty'; sl = ''; wait = ''; }
    else if (roll < 0.90) { outcome = 'abandoned'; reason = 'caller hung up'; sl = 'NO'; }
    else if (roll < 0.94) { outcome = 'outflowed system'; reason = 'queue timeout'; sl = 'NO'; wait = 300; }
    else { outcome = 'outflowed customer'; reason = ''; sl = ''; wait = ''; }
    q.push([date, queue, who, outcome, reason, sl, wait, talk, ring, wait === '' ? '' : wait + (talk || 0), `cid-${i}`].join(','));
    const inbound = r() < 0.9; const missed = !inbound ? false : r() < 0.08;
    const phone = '+1312555' + pad(Math.floor(r() * 10000), 4);
    c.push([date, '', inbound ? 'Inbound' : 'Outbound', missed ? 'Missed Call' : 'Ended successfully', inbound ? phone : agent, inbound ? '' : `"${agent}, ${phone}"`,
      missed ? 15000 : 60000 + Math.floor(r() * 300000), ['Positive', 'Neutral', 'Negative'][Math.floor(r() * 3)], TOPICS[Math.floor(r() * TOPICS.length)],
      r() < 0.3 ? SUMMARIES[Math.floor(r() * SUMMARIES.length)] : '', 'false', 'false'].join(','));
  }
  const small = [h.csvFile('agent-productivity.csv', AGENTS.map(a => ({ 'Agent name': a, '# of queues': 2, 'Logged in': '120:00:00', 'Available': '30:00:00', 'Working': '70:00:00', 'Paused': '20:00:00', 'Utilization': '83.3', 'Occupancy': '58.3' })), h.HEAD.productivity),
    h.csvFile('individual-performance.csv', AGENTS.map((a, i) => ({ 'Agent name': a, 'Handled calls': 500 + i, 'Avg. handle time (hh:mm:ss)': '00:05:00', 'Avg. wrap up time (hh:mm:ss)': '00:00:30', 'Avg. hold time (hh:mm:ss)': '00:01:00', 'Hold count': 20, 'Transfers': 5, 'Missed ring attempts': 10, 'Missed ring percentage': '8', 'Avg. ring time (millis)': 4000, 'Total talk time (hh:mm:ss)': '40:00:00', 'Workload (hh:mm:ss)': '50:00:00' })), h.HEAD.individual)];
  return [
    { name: 'queue-caller-details.csv', mimeType: 'text/csv', buffer: Buffer.from(q.join('\r\n') + '\r\n') },
    { name: 'call-report-conversations.csv', mimeType: 'text/csv', buffer: Buffer.from(c.join('\r\n') + '\r\n') },
  ].concat(small);
}

/** Put timers and counters around the heavy functions, inside the page. */
const INSTRUMENT = () => {
  window.__calls = { qd: 0, conv: 0, qdLegs: 0 };
  window.__ms = { qd: 0, conv: 0, qdLegs: 0 };
  for (const name of ['qd', 'conv', 'qdLegs']) {
    const orig = window[name];
    window[name] = function () { const t = performance.now(); window.__calls[name]++; try { return orig.apply(this, arguments); } finally { window.__ms[name] += performance.now() - t; } };
  }
  window.__view = {};
  VIEWS.forEach(v => { const o = v.fn; v.fn = function () { const t = performance.now(); try { return o.apply(this, arguments); } finally { window.__view[v.id] = (window.__view[v.id] || 0) + performance.now() - t; } }; });
  window.__reset = () => { for (const k of Object.keys(window.__calls)) { window.__calls[k] = 0; window.__ms[k] = 0; } window.__view = {}; };
};
const round = x => Math.round(x);

async function run(n, tc) {
  const files = bigFiles(n);
  const mb = files.reduce((s, f) => s + f.buffer.length, 0) / 1048576;
  const { page, context, errors } = await h.openApp();
  await page.evaluate(() => { window.__t0 = 0; });
  const t0 = Date.now();
  await page.setInputFiles('#fileInput', files);
  await page.waitForFunction(() => !document.querySelector('.shell').classList.contains('pre-load'), null, { timeout: 180000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const loadMs = Date.now() - t0;
  const res = { n, mb: +mb.toFixed(1), loadMs, errors };
  res.nodes = await page.evaluate(() => document.querySelectorAll('*').length);
  await page.evaluate(INSTRUMENT);

  // one full redraw, with per-function counts and per-section times
  await page.evaluate(() => { window.__reset(); });
  res.redrawMs = await page.evaluate(() => { const t = performance.now(); renderAll(); return performance.now() - t; });
  Object.assign(res, await page.evaluate(() => ({ calls: Object.assign({}, window.__calls), fnMs: Object.assign({}, window.__ms), views: Object.assign({}, window.__view) })));

  // filter changes (what a person does): queue, agent, group by, shift, date, as full time until the next painted frame
  const timeChange = async (sel, val) => page.evaluate(([s, v]) => new Promise(done => {
    const el = document.querySelector(s); el.value = v; const t = performance.now();
    el.dispatchEvent(new Event('change', { bubbles: true })); const sync = performance.now() - t;
    requestAnimationFrame(() => requestAnimationFrame(() => done({ sync, toPaint: performance.now() - t })));
  }), [sel, val]);
  res.filter = {};
  res.filter.queue = await timeChange('#fQueue', 'Billing');
  res.filter.agent = await timeChange('#fAgent', AGENTS[3]);
  res.filter.group = await timeChange('#fGroup', 'week');
  res.filter.shift = await timeChange('#fShiftStart', '8');
  res.filter.from = await timeChange('#fFrom', '2026-02-01');
  // switching sections is only a show / hide, it should be instant
  res.switchMs = await page.evaluate(() => { const t = performance.now(); switchView('quality'); switchView('report'); return performance.now() - t; });
  // the heavy table on its own
  res.coverageMs = await page.evaluate(() => { const t = performance.now(); vCoverage(); return performance.now() - t; });
  res.reportMs = await page.evaluate(() => { const t = performance.now(); vReport(); return performance.now() - t; });
  await context.close();

  const top = Object.entries(res.views).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${round(v)} ms`).join(', ');
  tc.diagnostic(`${n} calls (${res.mb} MB of files, ${res.nodes} page elements): upload to dashboard drawn = ${round(loadMs)} ms`);
  tc.diagnostic(`${n} calls: one full redraw = ${round(res.redrawMs)} ms; qd() ran ${res.calls.qd}x (${round(res.fnMs.qd)} ms in total), conv() ran ${res.calls.conv}x (${round(res.fnMs.conv)} ms), qdLegs() ran ${res.calls.qdLegs}x (${round(res.fnMs.qdLegs)} ms)`);
  tc.diagnostic(`${n} calls: biggest sections per redraw: ${top}`);
  tc.diagnostic(`${n} calls: filter change (time to next painted frame): ` + Object.entries(res.filter).map(([k, v]) => `${k} ${round(v.toPaint)} ms`).join(', '));
  tc.diagnostic(`${n} calls: switching sections ${round(res.switchMs)} ms; redrawing Coverage alone ${round(res.coverageMs)} ms; building the Production report alone ${round(res.reportMs)} ms`);
  return res;
}

const results = {};
test('20,000 calls: loading the files and drawing the dashboard finishes in under 20 seconds, with no errors', { timeout: 300000 }, async (tc) => {
  const r = results[20000] = await run(20000, tc);
  assert.deepEqual(r.errors, []);
  assert.ok(r.loadMs < 20000, `load took ${r.loadMs} ms`);
});

test('20,000 calls: changing a filter redraws everything in under 10 seconds', { timeout: 300000 }, async () => {
  const r = results[20000]; assert.ok(r, 'the 20,000 run did not complete');
  for (const [k, v] of Object.entries(r.filter)) assert.ok(v.toPaint < 10000, `${k} filter took ${round(v.toPaint)} ms`);
});

test('60,000 calls: loading the files and drawing the dashboard finishes in under 60 seconds, with no errors', { timeout: 600000 }, async (tc) => {
  const r = results[60000] = await run(60000, tc);
  assert.deepEqual(r.errors, []);
  assert.ok(r.loadMs < 60000, `load took ${r.loadMs} ms`);
});

test('60,000 calls: changing a filter redraws everything in under 30 seconds', { timeout: 600000 }, async () => {
  const r = results[60000]; assert.ok(r, 'the 60,000 run did not complete');
  for (const [k, v] of Object.entries(r.filter)) assert.ok(v.toPaint < 30000, `${k} filter took ${round(v.toPaint)} ms`);
});

test('time grows roughly in step with the number of calls (3x the calls takes less than 6x the time to redraw)', async (tc) => {
  const a = results[20000], b = results[60000]; assert.ok(a && b);
  tc.diagnostic(`redraw 20k = ${round(a.redrawMs)} ms, 60k = ${round(b.redrawMs)} ms, ratio ${(b.redrawMs / a.redrawMs).toFixed(1)}x`);
  assert.ok(b.redrawMs / a.redrawMs < 6, `ratio ${(b.redrawMs / a.redrawMs).toFixed(1)}`);
});

test('one redraw works the call list out once, not dozens of times (qd and conv run at most 3 times each)', { todo: 'SUGGESTION: qd() and conv() rebuild the whole call list every time they are called, and a single redraw calls them many times. Work them out once per redraw (cache until a filter or the data changes).' }, async () => {
  const r = results[20000]; assert.ok(r);
  assert.ok(r.calls.qd <= 3, `qd() ran ${r.calls.qd} times in one redraw`);
  assert.ok(r.calls.conv <= 3, `conv() ran ${r.calls.conv} times in one redraw`);
});

test('a filter change on 20,000 calls feels instant (under 2 seconds)', { todo: 'SUGGESTION: a redraw this size takes longer than the 1-2 seconds that feels instant; see the numbers printed above' }, async () => {
  const r = results[20000]; assert.ok(r);
  for (const [k, v] of Object.entries(r.filter)) assert.ok(v.toPaint < 2000, `${k} filter took ${round(v.toPaint)} ms`);
});
