'use strict';
/*
 * Dates and time zones.
 * The same made-up files are opened by a viewer in India, US Central, UTC, New Zealand and US Pacific.
 * Nothing the viewer sees (numbers, weekday names, week groupings, labels, QA dates) may depend on where the viewer sits.
 *
 * The weekday for any date is worked out here with plain UTC arithmetic (WD below), which cannot be fooled by a viewer's time zone.
 * Known anchors: 2 Mar 2026 is a Monday; 1 Jan 2026 is a Thursday; 29 Feb 2024 (leap day) is a Thursday.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

const ZONES = ['Asia/Kolkata', 'America/Chicago', 'UTC', 'Pacific/Auckland', 'America/Los_Angeles'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const wd = iso => WD[new Date(iso + 'T00:00:00Z').getUTCDay()];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = iso => { const [, m, d] = iso.split('-'); return MON[+m - 1] + ' ' + +d; };

test('the weekday oracle used by these checks agrees with the calendar (sanity)', () => {
  assert.equal(wd('2026-03-02'), 'Mon'); assert.equal(wd('2026-01-01'), 'Thu'); assert.equal(wd('2024-02-29'), 'Thu');
  assert.equal(wd('2025-12-31'), 'Wed'); assert.equal(wd('2026-02-28'), 'Sat'); assert.equal(wd('2026-03-01'), 'Sun');
});

/** run fn(app, zone) once per time zone, each in its own browser context, and return the results by zone */
async function inEveryZone(fn, openOpts = {}) {
  const out = {};
  for (const tz of ZONES) {
    const app = await h.openApp(Object.assign({ timezoneId: tz }, openOpts));
    try { out[tz] = await fn(app, tz); } finally { await app.context.close(); }
  }
  return out;
}
/** compare two long texts; on a difference say where, in a few words, instead of printing both pages */
function sameText(a, b, what) {
  if (a === b) return;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  assert.fail(what + ' differs near: UTC "...' + b.slice(Math.max(0, i - 40), i + 40) + '..." vs this zone "...' + a.slice(Math.max(0, i - 40), i + 40) + '..."');
}

/* ---------------------------------------------------------------- the edge-case phone data */
/*
 * Calls (all stamped -06:00, US Central), one row each unless noted:
 *   Wed 28 Feb 2024 10:00 handled
 *   Thu 29 Feb 2024 (LEAP DAY) 00:00 handled and 23:59 handled
 *   Fri  1 Mar 2024 12:00 handled
 *   Wed 31 Dec 2025 23:59 handled           (YEAR END)
 *   Thu  1 Jan 2026 00:00 handled           (YEAR START)
 *   Fri 27 Feb 2026 17:59 handled
 *   Sat 28 Feb 2026 10:00 handled           (weekend, month end)
 *   Sun  1 Mar 2026 10:00 handled           (weekend, month start)
 *   Mon  2 Mar 2026 no-agent calls at 08:59:59, 09:00:00, 17:59:59, 18:00:00   (SHIFT EDGES)
 *   Tue  3 Mar 2026 no-agent calls at 00:00:00 and 23:59:59                    (MIDNIGHT EDGES)
 * Hand-worked: offered 15, handled 9, no-agent 6, no-agent in shift 2 (09:00:00 and 17:59:59).
 *   By day totals, oldest first: 1,2,1,1,1,1,1,1,4,2
 *   By week (Monday start): Feb 26 2024 = 4, Dec 29 2025 = 2, Feb 23 2026 = 3, Mar 2 2026 = 6
 *   By month: Feb 2024 = 3, Mar 2024 = 1, Dec 2025 = 1, Jan 2026 = 1, Feb 2026 = 2, Mar 2026 = 7
 */
function edgeQueue() {
  const H = (date, time) => h.qRow({ start: `${date}T${time}-06:00`, agent: 'Asha Rao', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 100, ring: 3, call: 105 });
  const N = (date, time) => h.qRow({ start: `${date}T${time}-06:00`, outcome: 'outflowed system', reason: 'no agents - joined empty' });
  return [H('2024-02-28', '10:00:00'), H('2024-02-29', '00:00:00'), H('2024-02-29', '23:59:00'), H('2024-03-01', '12:00:00'),
    H('2025-12-31', '23:59:00'), H('2026-01-01', '00:00:00'), H('2026-02-27', '17:59:00'), H('2026-02-28', '10:00:00'), H('2026-03-01', '10:00:00'),
    N('2026-03-02', '08:59:59'), N('2026-03-02', '09:00:00'), N('2026-03-02', '17:59:59'), N('2026-03-02', '18:00:00'),
    N('2026-03-03', '00:00:00'), N('2026-03-03', '23:59:59')];
}
/* Inbound call log for the same period: missed calls on Fri 27 Feb, Mon 2 Mar, Tue 3 Mar (in shift), Sat 28 Feb (weekend);
 * answered calls Mon 2 Mar at 08:59 (before), 09:00 (in), 17:59 (in), 18:00 (after); Sat 28 Feb 11:00 and Sun 1 Mar 11:00 (weekend).
 * Categories: before 1, during 3 missed + 2 answered = 5, after 1, weekend 3 (Sat missed, Sat answered, Sun answered). Inbound total 10. */
function edgeCalls() {
  const I = (date, time, res, from) => h.cRow({ date: `${date}T${time}-06:00`, dir: 'Inbound', res, from, dur: 15000 });
  return [I('2026-02-27', '10:05:00', 'Missed Call', '+13125550161'), I('2026-03-02', '10:05:00', 'Missed Call', '+13125550162'),
    I('2026-03-03', '10:05:00', 'Missed Call', '+13125550163'), I('2026-02-28', '11:00:00', 'Missed Call', '+13125550164'),
    I('2026-03-02', '08:59:00', 'Ended successfully', '+13125550165'), I('2026-03-02', '09:00:00', 'Ended successfully', '+13125550166'),
    I('2026-03-02', '17:59:00', 'Ended successfully', '+13125550167'), I('2026-03-02', '18:00:00', 'Ended successfully', '+13125550168'),
    I('2026-02-28', '11:00:00', 'Ended successfully', '+13125550169'), I('2026-03-01', '11:00:00', 'Ended successfully', '+13125550170')];
}
const edgeFiles = () => [h.csvFile('queue-caller-details.csv', edgeQueue(), h.HEAD.queueDetails), h.csvFile('call-report-conversations.csv', edgeCalls(), h.HEAD.conversations)];

async function loadEdge(app, groupBy) {
  await h.loadProduction(app.page, edgeFiles());
  if (groupBy) await app.page.evaluate(g => setGroupBy(g), groupBy);
  await h.show(app.page, 'coverage');
}
const stackRows = page => page.evaluate(() => [...document.querySelectorAll('#v-coverage .stackrow')].map(r => ({
  label: r.querySelector('.d').innerText.replace(/\s+/g, ' ').trim(), total: +r.querySelector('.tot').innerText.split('·')[0].replace(/[^\d]/g, '') })));

/* ---------------------------------------------------------------- numbers do not depend on the viewer's time zone */
test('standard phone files: every headline number is the same hand-worked answer in all five time zones', async () => {
  const E = h.EXPECT_QUEUE;
  const res = await inEveryZone(async ({ page, errors }) => {
    await h.loadProduction(page);
    const m = await page.evaluate(() => { const m = coreMetrics(); return { total: m.total, handled: m.handled, noagent: m.noagent, noagentDuring: m.noagentDuring, aband: m.aband, timeout: m.timeout, slY: m.slY, slN: m.slN }; });
    assert.deepEqual(errors, []);
    return m;
  });
  for (const tz of ZONES) assert.deepEqual(res[tz], { total: E.offered, handled: E.handled, noagent: E.noAgentAll, noagentDuring: E.noAgentInShift, aband: E.abandoned, timeout: E.queueTimeout, slY: E.slYesInShift, slN: E.slNoInShift }, tz);
});

test('edge-case phone data: offered, handled, no-agent and in-shift no-agent are the same in all five zones (midnight, 9:00 and 18:00 edges)', async () => {
  const res = await inEveryZone(async (app) => {
    await h.loadProduction(app.page, edgeFiles());
    return app.page.evaluate(() => { const m = coreMetrics(); return { total: m.total, handled: m.handled, noagent: m.noagent, noagentDuring: m.noagentDuring, from: FILTER.from, to: FILTER.to }; });
  });
  for (const tz of ZONES) assert.deepEqual(res[tz], { total: 15, handled: 9, noagent: 6, noagentDuring: 2, from: '2024-02-28', to: '2026-03-03' }, tz);
});

test('shift edges: a call at exactly 9:00:00 is in shift, 8:59:59 is before, 17:59:59 is in shift, exactly 18:00:00 is after', async () => {
  const res = await inEveryZone(async ({ page }) => {
    await h.loadProduction(page, edgeFiles());
    return page.evaluate(() => {
      const rows = qd().filter(r => r._date === '2026-03-02' && r._outcome.startsWith('outflowed'));
      return rows.map(r => [r._hour, shiftBucket(r._hour)]).sort((a, b) => a[0] - b[0]);
    });
  });
  for (const tz of ZONES) assert.deepEqual(res[tz], [[8, 'before'], [9, 'during'], [17, 'during'], [18, 'after']], tz);
});

test('changing the shift window moves the edge calls the same way in every zone (shift 10 to 17: nothing in shift on 2 Mar except none; shift 8 to 19: all four)', async () => {
  const res = await inEveryZone(async ({ page }) => {
    await h.loadProduction(page, edgeFiles());
    const out = {};
    for (const [s, e] of [[10, 17], [8, 19], [9, 18]]) {
      await page.selectOption('#fShiftStart', String(s)); await page.selectOption('#fShiftEnd', String(e));
      out[s + '-' + e] = await page.evaluate(() => coreMetrics().noagentDuring);
    }
    return out;
  });
  // 08:59:59 / 09:00:00 / 17:59:59 / 18:00:00 on 2 Mar plus 00:00:00 and 23:59:59 on 3 Mar
  for (const tz of ZONES) assert.deepEqual(res[tz], { '10-17': 0, '8-19': 4, '9-18': 2 }, tz);
});

/* ---------------------------------------------------------------- weekday names next to dates */
test('day view: every date in Coverage shows the right weekday, in every zone (Mon 2 Mar 2026, Thu 29 Feb 2024 ...)', async () => {
  const expectLabels = ['2024-02-28', '2024-02-29', '2024-03-01', '2025-12-31', '2026-01-01', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03'].map(d => nice(d) + ' ' + wd(d));
  assert.deepEqual(expectLabels, ['Feb 28 Wed', 'Feb 29 Thu', 'Mar 1 Fri', 'Dec 31 Wed', 'Jan 1 Thu', 'Feb 27 Fri', 'Feb 28 Sat', 'Mar 1 Sun', 'Mar 2 Mon', 'Mar 3 Tue']);
  const res = await inEveryZone(async (app) => { await loadEdge(app, 'day'); return stackRows(app.page); });
  for (const tz of ZONES) {
    assert.deepEqual(res[tz].map(r => r.label), expectLabels, tz + ' weekday labels');
    assert.deepEqual(res[tz].map(r => r.total), [1, 2, 1, 1, 1, 1, 1, 1, 4, 2], tz + ' calls per day');
  }
});

test('every weekday written next to a date anywhere in the Coverage section is the right one, in every zone', async () => {
  const allowed = new Set(['2024-02-28', '2024-02-29', '2024-03-01', '2025-12-31', '2026-01-01', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03'].map(d => nice(d) + ' ' + wd(d)));
  const res = await inEveryZone(async (app) => {
    await loadEdge(app, 'day');
    return app.page.evaluate(() => {
      const found = [];
      document.querySelectorAll('#v-coverage td, #v-coverage .stackrow .d').forEach(c => {
        const m = c.innerText.replace(/\s+/g, ' ').trim().match(/^([A-Z][a-z]{2} \d{1,2}) (Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
        if (m) found.push(m[1] + ' ' + m[2]);
      });
      return found;
    });
  });
  for (const tz of ZONES) {
    assert.ok(res[tz].length >= 20, tz + ': expected dates with weekdays in several tables, found ' + res[tz].length);
    const wrong = res[tz].filter(x => !allowed.has(x));
    assert.deepEqual(wrong, [], tz + ': wrong weekday next to a date');
  }
});

test('week and month views group the same calls in every zone: weeks start on Monday and cross month and year ends correctly', async () => {
  const res = await inEveryZone(async (app) => {
    await loadEdge(app, 'week'); const week = await stackRows(app.page);
    await app.page.evaluate(() => setGroupBy('month')); const month = await stackRows(app.page);
    return { week, month };
  });
  for (const tz of ZONES) {
    assert.deepEqual(res[tz].week, [{ label: 'Wk of Feb 26', total: 4 }, { label: 'Wk of Dec 29', total: 2 }, { label: 'Wk of Feb 23', total: 3 }, { label: 'Wk of Mar 2', total: 6 }], tz + ' weeks');
    assert.deepEqual(res[tz].month, [{ label: 'Feb 2024', total: 3 }, { label: 'Mar 2024', total: 1 }, { label: 'Dec 2025', total: 1 }, { label: 'Jan 2026', total: 1 }, { label: 'Feb 2026', total: 2 }, { label: 'Mar 2026', total: 7 }], tz + ' months');
  }
});

test('the standard phone files read exactly the same on every screen in every zone (all sections, by day, by week and by month)', async () => {
  const res = await inEveryZone(async ({ page }) => {
    await h.loadProduction(page);
    await h.loadQuality(page, h.qaCsvFile());
    const out = {};
    for (const gb of ['day', 'week', 'month']) {
      await page.evaluate(g => setGroupBy(g), gb);
      out[gb] = await page.evaluate(() => ['exec', 'overview', 'coverage', 'agents', 'volume', 'voice', 'insights', 'quality', 'report'].map(id => id + ': ' + document.getElementById('v-' + id).textContent.replace(/\s+/g, ' ')));
    }
    return out;
  });
  for (const gb of ['day', 'week', 'month']) {
    const base = res['UTC'][gb];
    for (const tz of ZONES) base.forEach((t, i) => sameText(res[tz][gb][i], t, gb + ' view, ' + tz + ', section ' + t.split(':')[0]));
  }
});

test('the edge-case phone data reads exactly the same on every screen in every zone', async () => {
  const res = await inEveryZone(async ({ page }) => {
    await h.loadProduction(page, edgeFiles());
    const out = {};
    for (const gb of ['day', 'week', 'month']) {
      await page.evaluate(g => setGroupBy(g), gb);
      out[gb] = await page.evaluate(() => ['exec', 'overview', 'coverage', 'agents', 'volume', 'voice', 'insights', 'report'].map(id => id + ': ' + document.getElementById('v-' + id).textContent.replace(/\s+/g, ' ')));
    }
    return out;
  });
  for (const gb of ['day', 'week', 'month']) {
    const base = res['UTC'][gb];
    for (const tz of ZONES) base.forEach((t, i) => sameText(res[tz][gb][i], t, gb + ' view, ' + tz + ', section ' + t.split(':')[0]));
  }
});

test('call categories (before shift / during / after / weekend) are the same in every zone: 1, 5, 1 and 3 of 10 inbound calls', async () => {
  const res = await inEveryZone(async (app) => {
    await loadEdge(app);
    return app.page.evaluate(() => {
      const t = document.getElementById('v-coverage').innerText.replace(/\s+/g, ' ');
      const g = l => { const m = t.match(new RegExp(l + ' (\\d+) [\\d.]+% ·')); return m ? +m[1] : null; };
      return { before: g('Before shift'), during: g('During shift'), after: g('After shift'), weekend: g('Weekend'), share: (t.match(/Share of (\d+) inbound calls/) || [])[1] };
    });
  });
  for (const tz of ZONES) assert.deepEqual(res[tz], { before: 1, during: 5, after: 1, weekend: 3, share: '10' }, tz);
});

/* ---------------------------------------------------------------- week helpers directly */
const WEEK_CASES = [
  // date, Monday of that week, label
  ['2024-02-28', '2024-02-26', 'Feb 26 – Mar 3'], ['2024-02-29', '2024-02-26', 'Feb 26 – Mar 3'], ['2024-03-01', '2024-02-26', 'Feb 26 – Mar 3'], ['2024-03-03', '2024-02-26', 'Feb 26 – Mar 3'],
  ['2025-12-31', '2025-12-29', 'Dec 29 – Jan 4'], ['2026-01-01', '2025-12-29', 'Dec 29 – Jan 4'], ['2026-01-04', '2025-12-29', 'Dec 29 – Jan 4'],
  ['2026-02-28', '2026-02-23', 'Feb 23 – Mar 1'], ['2026-03-01', '2026-02-23', 'Feb 23 – Mar 1'],
  ['2026-03-02', '2026-03-02', 'Mar 2–8'], ['2026-03-08', '2026-03-02', 'Mar 2–8'], ['2026-03-09', '2026-03-09', 'Mar 9–15'],
  ['2026-04-05', '2026-03-30', 'Mar 30 – Apr 5'], ['2026-04-06', '2026-04-06', 'Apr 6–12'], ['2026-10-31', '2026-10-26', 'Oct 26 – Nov 1'], ['2026-11-02', '2026-11-02', 'Nov 2–8'],
];
test('weeks start on Monday and are labelled the same in every zone (month ends, year end, leap day, clock-change weeks)', async () => {
  const res = await inEveryZone(async ({ page }) => page.evaluate(cases => cases.map(([d]) => [d, weekOf(d).label, periodKey(d, 'week'), periodLabel(periodKey(d, 'week'), 'week')]), WEEK_CASES));
  for (const tz of ZONES) res[tz].forEach(([d, label, pk, pl], i) => {
    assert.equal(label, WEEK_CASES[i][2], tz + ' weekOf label for ' + d);
    assert.equal(pk, WEEK_CASES[i][1], tz + ' production week key for ' + d);
    assert.equal(pl, 'Wk of ' + nice(WEEK_CASES[i][1]), tz + ' production week label for ' + d);
  });
});

test('the sortable week key used by the QA report is the date of that week\'s Monday in every zone', async () => {
  const res = await inEveryZone(async ({ page }) => page.evaluate(cases => cases.map(([d]) => weekOf(d).key), WEEK_CASES));
  for (const tz of ZONES) assert.deepEqual(res[tz], WEEK_CASES.map(c => c[1]), tz + ' week keys');
});

/* ---------------------------------------------------------------- QA audit dates */
/* QA sheet with audit dates around every awkward boundary. Hand-worked weeks (Monday start, by audit date):
 *   Thu 29 Feb 2024      -> week Feb 26 - Mar 3   (leap day)         1 audit
 *   Wed 31 Dec 2025 and Thu 1 Jan 2026 -> week Dec 29 - Jan 4       2 audits
 *   Sun 1 Mar 2026       -> week Feb 23 - Mar 1   (Sunday, month start)   1 audit
 *   Mon 2 Mar 2026 and Sun 8 Mar 2026 -> week Mar 2-8              2 audits
 */
const QA_DATES = ['2024-02-29', '2025-12-31', '2026-01-01', '2026-03-01', '2026-03-02', '2026-03-08'];
const qaDateRows = (fmt) => QA_DATES.map((d, i) => h.qaRow({ agent: 'Agent ' + (i + 1), doa: fmt(d), doc: fmt(d) }));
const readDates = page => page.evaluate(() => qualRows().map(r => [r._doa, r._doc]));
// NB: weeks are numbered in date order of the weeks present, so the leap-day week is Week 1.

async function qaWeeklyTable(page) {
  await h.show(page, 'quality');
  return page.evaluate(() => { const ts = document.querySelectorAll('#q-overview table'); const t = ts[ts.length - 1];
    return [...t.querySelectorAll('tbody tr')].map(tr => [tr.children[0].textContent.replace(/\s+/g, ' ').replace('▶', '').trim(), tr.children[1].textContent.trim()]); });
}
test('QA audit dates written as plain ISO text (2026-03-02) read as that same date and give the same week labels in every zone', async () => {
  const res = await inEveryZone(async ({ page, errors }) => {
    await h.loadQuality(page, h.qaCsvFile(qaDateRows(d => d)));
    const out = { dates: await readDates(page), weeks: await qaWeeklyTable(page) };
    assert.deepEqual(errors, []); return out;
  });
  for (const tz of ZONES) {
    assert.deepEqual(res[tz].dates, QA_DATES.map(d => [d, d]), tz);
    assert.deepEqual(res[tz].weeks, [['Week 1 · Feb 26 – Mar 3', '1'], ['Week 2 · Dec 29 – Jan 4', '2'], ['Week 3 · Feb 23 – Mar 1', '1'], ['Week 4 · Mar 2–8', '2']].map(r => r), tz);
  }
});

test('QA audit dates with a time or a zone letter after them (2026-03-02 00:00:00, 2026-03-02T00:00:00Z) keep their calendar date in every zone', async () => {
  for (const fmt of [d => d + ' 00:00:00', d => d + 'T00:00:00', d => d + 'T00:00:00Z', d => d + 'T23:30:00+05:30']) {
    const res = await inEveryZone(async ({ page }) => { await h.loadQuality(page, h.qaCsvFile(qaDateRows(fmt))); return readDates(page); });
    for (const tz of ZONES) assert.deepEqual(res[tz], QA_DATES.map(d => [d, d]), tz + ' ' + fmt('2026-03-02'));
  }
});

test('QA audit dates written as month/day/year text (3/25/2026) read as that date in every zone', async () => {
  const dates = ['2024-02-29', '2025-12-31', '2026-01-01', '2026-03-13', '2026-03-25'];
  const us = d => { const [y, m, dd] = d.split('-'); return `${+m}/${+dd}/${y}`; };
  const rows = dates.map((d, i) => h.qaRow({ agent: 'Agent ' + i, doa: us(d), doc: us(d) }));
  const res = await inEveryZone(async ({ page }) => { await h.loadQuality(page, h.qaCsvFile(rows)); return readDates(page); });
  for (const tz of ZONES) assert.deepEqual(res[tz], dates.map(d => [d, d]), tz);
});

test('QA audit dates written with a month name (4 Mar 2026, Mar 4, 2026, 04-Mar-2026) read as that date in every zone', async () => {
  const dates = ['2024-02-29', '2025-12-31', '2026-01-01', '2026-03-04'];
  const forms = [d => { const [y, m, dd] = d.split('-'); return `${+dd} ${MON[+m - 1]} ${y}`; }, d => { const [y, m, dd] = d.split('-'); return `${MON[+m - 1]} ${+dd}, ${y}`; }, d => { const [y, m, dd] = d.split('-'); return `${dd}-${MON[+m - 1]}-${y}`; }];
  for (const f of forms) {
    const rows = dates.map((d, i) => h.qaRow({ agent: 'Agent ' + i, doa: f(d), doc: f(d) }));
    const res = await inEveryZone(async ({ page }) => { await h.loadQuality(page, h.qaCsvFile(rows)); return readDates(page); });
    for (const tz of ZONES) assert.deepEqual(res[tz], dates.map(d => [d, d]), tz + ' as "' + f('2026-03-04') + '"');
  }
});

test('QA audit dates stored as real Excel date cells read as the same calendar date and the same weeks in every zone', async () => {
  const res = await inEveryZone(async ({ page, errors }) => {
    await h.loadQuality(page, h.qaXlsxFile(qaDateRows(d => d), { dateCells: true }));
    const out = { dates: await readDates(page), weeks: await qaWeeklyTable(page) };
    assert.deepEqual(errors, []); return out;
  });
  for (const tz of ZONES) {
    assert.deepEqual(res[tz].dates, QA_DATES.map(d => [d, d]), tz);
    assert.deepEqual(res[tz].weeks.map(r => r[0]), ['Week 1 · Feb 26 – Mar 3', 'Week 2 · Dec 29 – Jan 4', 'Week 3 · Feb 23 – Mar 1', 'Week 4 · Mar 2–8'], tz);
  }
});

test('the standard QA sheet as Excel date cells gives the same report as the same sheet with ISO text dates (same weeks, same scores) in every zone', async () => {
  const res = await inEveryZone(async ({ page }) => {
    await h.loadQuality(page, h.qaXlsxFile(h.standardQARows(), { dateCells: true }));
    await h.show(page, 'quality');
    return { dates: await readDates(page), weeks: await qaWeeklyTable(page), avg: (await h.kpi(page, 'quality', 'Avg QA score')).value };
  });
  const iso = h.standardQARows().map(r => [r['DOA (Audit Date)'], r['DOC (Date of Call)']]);
  for (const tz of ZONES) {
    assert.deepEqual(res[tz].dates, iso, tz);
    assert.deepEqual(res[tz].weeks, [['Week 1 · Mar 2–8', '5'], ['Week 2 · Mar 9–15', '3']], tz);
    assert.equal(res[tz].avg, '72.5%');
  }
});

test('QA audit date filter and the "error repeated after feedback" count use the same dates in every zone (Excel date cells)', async () => {
  const rows = [
    h.qaRow({ agent: 'Hal Moss', doc: '2026-03-02', doa: '2026-03-03', missed: ['Call ownership'], fb: 'Yes', fbDate: '2026-03-04' }),
    h.qaRow({ agent: 'Hal Moss', doc: '2026-03-05', doa: '2026-03-06', missed: ['Call ownership'] }),
    h.qaRow({ agent: 'Hal Moss', doc: '2026-03-04', doa: '2026-03-05', missed: ['Call ownership'] }),
  ];
  const res = await inEveryZone(async ({ page }) => {
    await h.loadQuality(page, h.qaXlsxFile(rows, { dateCells: true }));
    await h.show(page, 'quality');
    await page.evaluate(() => setQF('from', '2026-03-05'));
    const shown = (await h.kpi(page, 'quality', 'Audits')).value;
    await page.evaluate(() => setQF('from', ''));
    // call made on 5 Mar is after the 4 Mar feedback (repeat); call made on 4 Mar is the same day as the feedback (not after)
    const rep = await page.evaluate(() => recurrence(qualRows()).map(x => [x.errors, x.feedbacks, x.after, x.lastFb]));
    return { shown, rep };
  });
  for (const tz of ZONES) { assert.equal(res[tz].shown, '2', tz); assert.deepEqual(res[tz].rep, [[3, 1, 1, '2026-03-04']], tz); }
});

test('QA dates typed day-first (25/03/2026, Indian style)', { todo: 'QUESTION: day/month/year text cannot be read (shows as no date, so the audit drops out of weeks and date filters). 3/4/2026 is read as 4 March, never 3 April. Which order do the QA sheets use?' }, async () => {});
test('QA dates typed 3/4/2026: 4 March or 3 April?', { todo: 'QUESTION: read as 4 March (month first) in every zone. Same as the open question in docs/APP-OVERVIEW.md item 6.' }, async () => {});

/* ---------------------------------------------------------------- the date stamped on a root-cause note */
test('marking a root-cause note "Implemented" stamps the viewer\'s own calendar date (not the UTC date)', async () => {
  // instants chosen so that, for at least one of the zones, the local date is one day off the UTC date
  const INSTANTS = ['2026-03-10T23:30:00Z', '2026-03-11T02:00:00Z', '2026-03-11T12:00:00Z'];
  const localDate = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  assert.equal(localDate('2026-03-10T23:30:00Z', 'Asia/Kolkata'), '2026-03-11');      // oracle sanity: India is already on the 11th
  assert.equal(localDate('2026-03-11T02:00:00Z', 'America/Chicago'), '2026-03-10');   // and Chicago still on the 10th
  for (const iso of INSTANTS) {
    const res = await inEveryZone(async ({ page, context }) => {
      await h.loadQuality(page, h.qaCsvFile());
      await h.show(page, 'quality');
      await page.clock.setFixedTime(new Date(iso));
      await page.locator('.rca-item select[data-f=status]').first().selectOption('Implemented');
      return page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('pcc_rca_')); return k ? JSON.parse(localStorage.getItem(k)) : null; });
    });
    for (const tz of ZONES) {
      assert.ok(res[tz] && res[tz].status === 'Implemented', tz + ' note saved');
      assert.equal(res[tz].implementedAt, localDate(iso, tz), tz + ' at ' + iso + ' should be stamped with the local date');
    }
  }
});

/* ---------------------------------------------------------------- callback time in the missed-call log */
test('missed-call log: the callback time is shown in US Central like the call itself (12:35 PM, not the UTC 6:35 PM), same in every zone', async () => {
  const calls = [
    h.cRow({ date: '2026-03-02T12:05:00-06:00', dir: 'Inbound', res: 'Missed Call', from: '+13125550150', dur: 20000 }),
    h.cRow({ date: '2026-03-02T12:35:00-06:00', end: '2026-03-02T12:37:00-06:00', dir: 'Outbound', res: 'Ended successfully', from: 'Asha Rao', parts: 'Asha Rao, +13125550150' }),
    h.cRow({ date: '2026-03-02T10:00:00-06:00', dir: 'Inbound', res: 'Ended successfully', from: '+13125550177' }),
  ];
  const res = await inEveryZone(async ({ page }) => {
    await h.loadProduction(page, [h.csvFile('call-report-conversations.csv', calls, h.HEAD.conversations)]);
    await h.show(page, 'coverage');
    return page.evaluate(() => { const row = [...document.querySelectorAll('#v-coverage tr')].find(r => /\+13125550150/.test(r.textContent) && /Mar 2/.test(r.textContent)); return row ? row.textContent.replace(/\s+/g, ' ') : null; });
  });
  for (const tz of ZONES) {
    assert.ok(res[tz], tz + ': missed call row found');
    assert.match(res[tz], /Mar 2, 12:05 PM/);
    assert.match(res[tz], /Called back/);
    assert.match(res[tz], /Mar 2, 12:3\d PM/, tz + ': callback time should be on the same Central clock as the call: ' + res[tz]);
  }
});

test('missed-call log on screen and the missed-calls CSV agree on which calls were called back (phone number written "+1 312-555-0150")', async () => {
  const calls = [
    h.cRow({ date: '2026-03-02T12:05:00-06:00', dir: 'Inbound', res: 'Missed Call', from: '+13125550150', dur: 20000 }),
    h.cRow({ date: '2026-03-02T12:35:00-06:00', end: '2026-03-02T12:37:00-06:00', dir: 'Outbound', res: 'Ended successfully', from: 'Asha Rao', parts: 'Asha Rao, +1 312-555-0150' }),
  ];
  const { page, context } = await h.openApp();
  await h.loadProduction(page, [h.csvFile('call-report-conversations.csv', calls, h.HEAD.conversations)]);
  await h.show(page, 'coverage');
  const csv = await h.download(page, () => page.evaluate(() => dlMissedCSV()));
  const rows = h.parseCSVText(csv.text);
  const csvYes = rows.slice(1).filter(r => r[5] === 'Yes').length;
  const screen = await h.kpi(page, 'coverage', 'Called back');
  assert.equal(csvYes, 1, 'the CSV found the callback');
  assert.equal(screen.value, '1', 'the on-screen "Called back" count disagrees with the CSV');
  await context.close();
});

test('missed-call log: the callback time on screen and in the CSV are the same moment', { todo: 'QUESTION: screen uses the callback call\'s END time (12:37), the CSV uses its START time (12:35). Which one should "callback time" be?' }, async () => {});
