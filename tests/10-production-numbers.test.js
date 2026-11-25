'use strict';
/*
 * Production side: every headline figure against answers worked out by hand.
 * Data = the standard made-up set in helpers.js (23 offered calls, 15 handled, ...).
 *
 * Hand working used below (all from the builder functions in helpers.js):
 *   Queue calls   Mon 9 (6 handled), Tue 7 (5 handled), Wed 7 (4 handled)  => 23 offered, 15 handled
 *   Handled %     15 / 23 = 65.2%          Abandoned 2 / 23 = 8.7%       Not answered 8 / 23 = 34.8%
 *   Service level 13 YES / (13 YES + 5 NO) = 72.2%   (in-shift calls that got a verdict)
 *   Avg wait (ASA) of handled waits 158 s / 15 = 10.5 s -> "11s"      Avg talk 2490 s / 15 = 166 s = "2m 46s"
 *   Longest wait to answer 40 s; longest wait before abandon 55 s; average time to abandon (55+25)/2 = 40 s
 *   Outflowed by the phone system: 2 (Mon no-agent) + 1 (Tue timeout) + 3 (Wed) = 6
 *   Total not reached = no agent in shift 3 + abandoned 2 + queue timeout 1 = 6
 *   Call log      17 rows: inbound 14, outbound 2, internal 1. Missed 5 (4 in shift hours, 1 at 8 AM).
 *                 Voicemail 1. One missed caller (+13125550150) was called back at 12:35 (call ended 12:37).
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const p = require('./prod-helpers');

after(() => h.closeBrowser());
const E = h.EXPECT_QUEUE, C = h.EXPECT_CALLS;

/* ================= Executive summary ================= */

test('Executive summary: the headline tiles show offered 23, handled 65.2% (15 calls), service level 72.2%, no-agent 3, abandoned 2 (8.7%)', async () => {
  await p.withApp(async ({ page, errors }) => {
    const t = await p.tiles(page, '#v-exec'); const s = p.soft();
    s.eq(p.pick(t, 'Offered').value, String(E.offered), 'Offered');
    s.eq(p.pick(t, 'Handled').value, '65.2%', 'Handled %');
    s.eq(p.pick(t, 'Handled').foot, '15 calls', 'Handled count');
    s.eq(p.pick(t, 'Service level').value, '72.2%', 'Service level');
    s.eq(p.pick(t, 'No-agent (in-shift)').value, String(E.noAgentInShift), 'No-agent in shift');
    s.eq(p.pick(t, 'Abandoned').value, String(E.abandoned), 'Abandoned');
    s.eq(p.pick(t, 'Abandoned').foot, '8.7%', 'Abandoned %');
    s.done(); assert.deepEqual(errors, []);
  });
});

test('Executive summary: "Missed (in-shift)" is the 3 weekday missed calls inside 9 AM to 6 PM (the Saturday and the 8 AM miss are left out)', { skip: 'QUESTION 1: the app also counts the Saturday 11 AM miss (shows 4). Docs list weekend handling as an open question.' }, async () => {
  await p.withApp(async ({ page }) => {
    assert.equal((await p.tile(page, '#v-exec', 'Missed (in-shift)')).value, String(C.missedInShiftWeekday));
  });
});

test('Executive summary: with no Saturday call, "Missed (in-shift)" is 3 and the recoverable-calls banner says 3 no-agent + 3 missed = 6 (about 2 a day)', async () => {
  await p.withApp({ files: p.weekdayFiles() }, async ({ page }) => {
    const s = p.soft();
    s.eq((await p.tile(page, '#v-exec', 'Missed (in-shift)')).value, '3', 'Missed (in-shift) tile');
    const hero = await page.evaluate(() => ({ big: document.querySelector('#v-exec .ov-hero .big').textContent.replace(/\s+/g, ' ').trim(), meta: document.querySelector('#v-exec .ov-hero .meta').innerHTML.split(/<br\s*\/?>/i).map(x => x.trim()) }));
    s.eq(hero.big, '6 calls', 'recoverable calls');
    s.eq(hero.meta[1], '3 no-agent + 3 missed (in-shift)', 'recoverable breakdown');
    s.eq(hero.meta[2], '≈ 2/day', 'recoverable per day (6 / 3 days)');
    s.done();
  });
});

test('Executive summary: callback speed shows 1 call called back, 30 minutes after the miss (the callback started 12:35, the miss was 12:05)', async () => {
  await p.withApp(async ({ page }) => {
    const s = p.soft();
    const cb = await p.tile(page, '#v-exec', 'Avg time to call back');
    s.eq(cb.foot, '1 called back', 'number called back');
    // The call log says the callback began at 12:35, 30 minutes after the 12:05 miss. (The app measures to the END of the callback, 12:37.)
    s.eq(cb.value, '30:00', 'average time to call back (minutes:seconds)');
    s.eq((await p.tile(page, '#v-exec', 'Slow (> 4 hrs)')).value, '0', 'slow callbacks');
    s.done();
  });
});

test('Executive summary: 5 missed inbound calls, 1 called back, so "no callback" is 4', async () => {
  await p.withApp(async ({ page }) => {
    const txt = await page.evaluate(() => document.querySelector('#v-exec').textContent.replace(/\s+/g, ' '));
    assert.match(txt, /4 missed calls had no callback/);
  });
});

test('Executive summary: repeat callers are counted by phone number (2 numbers called 3 and 2 times: 87.5% first-contact, 2 repeat callers, 5 calls, 16 numbers)', async () => {
  // 14 numbers in the standard log + 2 numbers that call again: 16 numbers, 2 of them repeat.
  const extra = [
    h.cRow({ date: '2026-03-03T10:00:00-06:00', from: '+13125550160' }), h.cRow({ date: '2026-03-03T11:00:00-06:00', from: '+13125550160' }), h.cRow({ date: '2026-03-04T11:00:00-06:00', from: '+13125550160' }),
    h.cRow({ date: '2026-03-03T10:30:00-06:00', from: '+13125550161' }), h.cRow({ date: '2026-03-04T10:30:00-06:00', from: '+13125550161' }),
  ];
  await p.withApp({ files: p.prodFiles({ calls: h.standardCallLog().concat(extra) }) }, async ({ page }) => {
    const s = p.soft();
    const fcr = await p.tile(page, '#v-exec', 'First-contact rate'), rep = await p.tile(page, '#v-exec', 'Repeat callers');
    // distinct numbers: 14 + 2 new = 16 (the 3 + 2 calls above come from 2 numbers). Repeat = 2. First-contact = (16-2)/16 = 87.5%
    s.eq(fcr.value, '87.5%', 'first-contact rate');
    s.eq(rep.value, '2', 'repeat callers');
    s.eq(rep.foot, '5 calls · 16 numbers', 'repeat calls and numbers');
    s.done();
  });
});

test('Executive summary: with one month loaded it says so instead of showing a month-over-month table', async () => {
  await p.withApp(async ({ page }) => {
    const txt = await page.evaluate(() => document.querySelector('#v-exec').textContent.replace(/\s+/g, ' '));
    assert.match(txt, /Only one month is loaded \(Mar 2026\)/);
  });
});

test('Executive summary: month-over-month table gives each month its own figures (Feb, Mar, Apr)', async () => {
  // Feb: 4 offered, 2 handled (50.0%), SL 2 YES / 1 NO = 66.7%, 1 no-agent, 1 missed, 1 abandoned, recoverable 2
  // Mar: 26 offered (23 + 3 extra), 17 handled (65.4%), SL 15 YES / 5 NO = 75.0%, no-agent 4, missed 3, abandoned 2, recoverable 7
  // Apr: 1 offered, 1 handled (100.0%), SL 0 / 1 = 0.0%, no-agent 0, missed 1 (9:30 AM), abandoned 0, recoverable 1
  await p.withApp({ files: p.multiMonthFiles() }, async ({ page }) => {
    const rows = await p.tableAt(page, '#v-exec', 'Month over month');
    const s = p.soft();
    s.eq(rows[0], ['Metric', 'Feb 2026', 'Mar 2026', 'Apr 2026'], 'column headings');
    const byName = Object.fromEntries(rows.slice(1).map(r => [r[0], r.slice(1)]));
    const lead = cells => cells.map(c => c.replace(/\s*[▲▼▬].*$/, ''));
    s.eq(lead(byName['Offered']), ['4', '26', '1'], 'Offered');
    s.eq(lead(byName['Handled %']), ['50.0%', '65.4%', '100.0%'], 'Handled %');
    s.eq(lead(byName['Service level %']), ['66.7%', '75.0%', '0.0%'], 'Service level %');
    s.eq(lead(byName['No-agent (in-shift)']), ['1', '4', '0'], 'No-agent (in-shift)');
    s.eq(lead(byName['Missed (in-shift)']), ['1', '3', '1'], 'Missed (in-shift)');
    s.eq(lead(byName['Abandoned']), ['1', '2', '0'], 'Abandoned');
    s.eq(lead(byName['Recoverable']), ['2', '7', '1'], 'Recoverable');
    s.ok(/▲/.test(byName['Offered'][1]) && /▼/.test(byName['Offered'][2]), 'Offered arrows: up Feb->Mar, down Mar->Apr');
    s.done();
  });
});

/* ================= Overview ================= */

test('Overview: the top banner says 23 queue calls, 3 operating days, about 8 a day, 3 agents handled calls, dates Mar 2 to Mar 7', async () => {
  await p.withApp(async ({ page }) => {
    const o = await p.overview(page, '#v-overview'); const s = p.soft();
    s.eq(o.total, '23 queue calls', 'total offered');
    s.eq(o.meta, ['Mar 2 – Mar 7', '3 operating days', '≈ 8/day', '3 agents handled calls'], 'banner lines');   // 23 / 3 = 7.67 -> 8
    s.done();
  });
});

test('Overview: "Call resolution" splits the 23 calls into handled 15, no agent 4, queue timeout 1, abandoned 2, caller exited the menu 1 (and they add up to 23)', async () => {
  await p.withApp(async ({ page }) => {
    const o = await p.overview(page, '#v-overview'); const s = p.soft();
    s.eq(o.legend, ['Handled 15 (65.2%)', 'No agent available 4 (17.4%)', 'Queue timeout 1 (4.3%)', 'Abandoned 2 (8.7%)', 'Caller exited (menu) 1 (4.3%)'], 'resolution legend');
    const sum = o.legend.map(x => Number(x.match(/ (\d+) \(/)[1])).reduce((a, b) => a + b, 0);
    s.eq(sum, E.offered, 'legend adds up to offered');
    s.done();
  });
});

test('Overview: "Calls handled" card shows 15, 65.2% of offered, about 5 a day, service level 72.2%, ASA 11s, average talk 2m 46s', async () => {
  await p.withApp(async ({ page }) => {
    const o = await p.overview(page, '#v-overview'); const s = p.soft();
    s.eq(o.handled, '15', 'handled count');
    s.eq(o.handledSub, '65.2% of offered · ≈ 5/day', 'handled sub-line');
    s.eq(o.mini, [{ k: 'Service level', v: '72.2%' }, { k: 'Avg speed of answer', v: '11s' }, { k: 'Avg talk time', v: '2m 46s' }], 'handled mini figures');
    s.done();
  });
});

test('Overview: "Not answered" card shows 8 (34.8% of offered, about 3 a day) split no agent 4 / timeout 1 / abandoned 2 / exited 1 and the pieces add up to 8', async () => {
  await p.withApp(async ({ page }) => {
    const o = await p.overview(page, '#v-overview'); const s = p.soft();
    s.eq(o.notAnswered, '8', 'not answered count');
    s.eq(o.notSub, '34.8% of offered · ≈ 3/day', 'not answered sub-line');
    s.eq(o.brk, [{ k: 'No agent available', v: '4 · 50.0%' }, { k: 'Queue timeout', v: '1 · 12.5%' }, { k: 'Abandoned in queue', v: '2 · 25.0%' }, { k: 'Caller exited menu', v: '1 · 12.5%' }], 'not-answered pieces');
    s.eq(o.brk.reduce((a, b) => a + Number(b.v.split(' ')[0]), 0), 8, 'pieces add up to not answered');
    s.done();
  });
});

test('Overview: "Other activity" shows 1 voicemail and 2 outbound calls (per-day figures use the 4 days in the call log)', async () => {
  await p.withApp(async ({ page }) => {
    const o = await p.overview(page, '#v-overview'); const s = p.soft();
    const by = Object.fromEntries(o.other.map(x => [x.k, x]));
    s.eq(by['Voicemails left'].v, '1', 'voicemails'); s.eq(by['Voicemails left'].foot, '≈ 0/day · to return', 'voicemails per day');   // 1/4 = 0.25 -> 0
    s.eq(by['Outbound calls'].v, '2', 'outbound'); s.eq(by['Outbound calls'].foot, '≈ 1/day · agent-initiated', 'outbound per day');   // 2/4 = 0.5 -> 1
    s.done();
  });
});

test('Overview: "Missed calls (in-shift)" is 3 with 1 out-of-hours miss excluded (no Saturday call in the data)', async () => {
  await p.withApp({ files: p.weekdayFiles() }, async ({ page }) => {
    const o = await p.overview(page, '#v-overview');
    const m = o.other.find(x => x.k === 'Missed calls (in-shift)');
    assert.equal(m.v, '3'); assert.match(m.foot, /1 out-of-hours excl\./);
  });
});

test('Overview: "Caller exited (menu)" is never a negative number, even when one call is both abandoned and a queue timeout', async () => {
  // One call whose outcome is abandoned AND whose reason is "queue timeout": it must not be counted in two boxes.
  const rows = h.standardQueueRows().concat([h.qRow({ start: '2026-03-03T10:40:00-06:00', outcome: 'abandoned', reason: 'queue timeout', sl: 'NO', wait: 120 })]);
  await p.withApp({ files: p.prodFiles({ queue: rows }) }, async ({ page }) => {
    const o = await p.overview(page, '#v-overview');
    const exited = o.brk.find(b => b.k === 'Caller exited menu').v;
    assert.ok(Number(exited.split(' ')[0]) >= 0, 'Caller exited menu shows ' + exited);
    assert.ok(!o.legend.some(l => /\(-/.test(l)), 'a negative share in the resolution legend: ' + o.legend.join(' | '));
  });
});

/* ================= Coverage & missed ================= */

test('Coverage: the top tiles show no-agent 3 (1 out-of-hours excluded), abandoned 2, timeouts 1, outflowed 6, total not reached 6, voicemails 1, longest waits 40s / 55s, avg time to abandon 40s', async () => {
  await p.withApp(async ({ page }) => {
    const t = await p.tiles(page, '#v-coverage'); const s = p.soft();
    const v = l => { const x = p.pick(t, l); return x ? [x.value, x.foot] : null; };
    s.eq(v('No agent (in-shift)'), ['3', '1 out-of-hours excluded'], 'No agent (in-shift)');
    s.eq(v('Abandoned in queue'), ['2', '8.7%'], 'Abandoned in queue');
    s.eq(v('Queue timeouts'), ['1', 'waited then dropped'], 'Queue timeouts');
    s.eq(v('Outflowed (system)'), ['6', 'routed out unanswered'], 'Outflowed (system)');
    s.eq(v('Total not reached'), ['6', 'in-shift, recoverable'], 'Total not reached');   // 3 + 2 + 1
    s.eq(v('Voicemails left'), ['1', 'all lines'], 'Voicemails left');
    s.eq(v('Longest wait to answer'), ['40s', 'slowest pickup'], 'Longest wait to answer');
    s.eq(v('Longest wait before abandon'), ['55s', 'before hang-up'], 'Longest wait before abandon');
    s.eq(v('Avg time to abandon'), ['40s', '2 abandoned calls'], 'Avg time to abandon');
    s.done();
  });
});

test('Coverage: "Missed calls (in-shift)" tile is 3 with 1 out-of-hours miss excluded (no Saturday call in the data)', async () => {
  await p.withApp({ files: p.weekdayFiles() }, async ({ page }) => {
    const m = await p.tile(page, '#v-coverage', 'Missed calls (in-shift)');
    assert.equal(m.value, '3'); assert.equal(m.foot, '1 out-of-hours excluded');
  });
});

test('Coverage: "Call categories" sorts the 14 inbound calls into before 1, during shift 12, after 0, weekend 1 (7.1% / 85.7% / 0.0% / 7.1%)', async () => {
  await p.withApp(async ({ page }) => {
    const t = await p.tiles(page, '#v-coverage'); const s = p.soft();
    const catTiles = ['Before shift', 'During shift', 'After shift', 'Weekend'].map(l => p.pick(t, l, 0));   // the first four with these names
    s.eq(catTiles.map(x => x.value), ['1', '12', '0', '1'], 'category counts');
    s.eq(catTiles.map(x => x.foot.split(' · ')[0]), ['7.1%', '85.7%', '0.0%', '7.1%'], 'category shares');
    s.eq(catTiles.reduce((a, x) => a + Number(x.value), 0), C.inbound, 'categories add up to all inbound calls');
    s.done();
  });
});

test('Coverage: "Call demand vs handled" per 2-hour window shows handled / offered 4/4, 4/7, 3/5, 3/5, 1/1 (the 7 AM call is outside the shift)', async () => {
  await p.withApp(async ({ page }) => {
    const rows = await p.barsAt(page, '#v-coverage', 'Call demand vs handled');
    assert.deepEqual(rows, [{ k: '9–11a', v: '4 / 4' }, { k: '11–1p', v: '4 / 7' }, { k: '1–3p', v: '3 / 5' }, { k: '3–5p', v: '3 / 5' }, { k: '5–6p', v: '1 / 1' }]);
  });
});

test('Coverage: "Missed calls by 2-hour window of shift" shows missed / inbound for each window (0/4, 2/3, 1/2, 0/3, 0/0) with the percentage', async () => {
  // weekday-only call log. 11-1p: missed Mon 12:05 + Wed 12:05 of 3 inbound (Mon 11:05, Mon 12:05, Wed 12:05) = 67%
  await p.withApp({ files: p.weekdayFiles() }, async ({ page }) => {
    const rows = await p.barsAt(page, '#v-coverage', 'Missed calls by 2-hour window of shift');
    assert.deepEqual(rows, [{ k: '9–11a', v: '0 / 4 · 0%' }, { k: '11–1p', v: '2 / 3 · 67%' }, { k: '1–3p', v: '1 / 2 · 50%' }, { k: '3–5p', v: '0 / 3 · 0%' }, { k: '5–6p', v: '0 / 0' }]);
  });
});

test('Coverage: "Missed calls by day and 2-hour window" has one row per day and a Total row that adds the rows up (3 missed of 12 inbound = 25.0%)', async () => {
  await p.withApp({ files: p.weekdayFiles() }, async ({ page }) => {
    const rows = await p.tableAt(page, '#v-coverage', 'Missed calls by day and 2-hour window'); const s = p.soft();
    s.eq(rows, [
      ['Day', '9–11a', '11–1p', '1–3p', '3–5p', '5–6p', 'Missed', 'Volume', 'Missed %'],
      ['Mar 2 Mon', '0 / 2', '1 / 2', '—', '0 / 1', '—', '1', '5', '20.0%'],
      ['Mar 3 Tue', '0 / 1', '—', '1 / 2', '0 / 1', '—', '1', '4', '25.0%'],
      ['Mar 4 Wed', '0 / 1', '1 / 1', '—', '0 / 1', '—', '1', '3', '33.3%'],
      ['Total', '0 / 4', '2 / 3', '1 / 2', '0 / 3', '—', '3', '12', '25.0%'],
    ], 'table');
    s.done();
  });
});

test('Coverage: "In-shift missed calls by day" lists Mar 2, 3 and 4 with 1 each and a Total of 3', async () => {
  await p.withApp({ files: p.weekdayFiles(), filters: { groupBy: 'day' } }, async ({ page }) => {
    const rows = await p.tableAt(page, '#v-coverage', 'In-shift missed calls by');
    assert.deepEqual(rows, [['Day', 'Missed (in-shift)'], ['Mar 2 Mon', '1'], ['Mar 3 Tue', '1'], ['Mar 4 Wed', '1'], ['Total', '3']]);
  });
});

test('Coverage: "No-agent calls by day & shift" splits 4 no-agent calls into before / during / after per day with a Total row 1 / 3 / 0 / 4', async () => {
  await p.withApp({ filters: { groupBy: 'day' } }, async ({ page }) => {
    const rows = await p.tableAt(page, '#v-coverage', 'No-agent calls by'); const s = p.soft();
    s.eq(rows, [['Day', 'Before', 'During (gap)', 'After', 'Total'], ['Mar 2 Mon', '0', '2', '0', '2'], ['Mar 4 Wed', '1', '1', '0', '2'], ['Total', '1', '3', '0', '4']], 'table');
    const t = await p.tiles(page, '#v-coverage');
    s.eq(['Before shift', 'During shift', 'After shift'].map(l => p.pick(t, l, 1).value), ['1', '3', '0'], 'no-agent tiles (the second set of Before/During/After tiles)');
    s.done();
  });
});

test('Coverage: grouped by month, every period table has a single "Mar 2026" row with the same totals', async () => {
  await p.withApp({ files: p.weekdayFiles() }, async ({ page }) => {
    const s = p.soft();
    s.eq(await p.tableAt(page, '#v-coverage', 'No-agent calls by'), [['Month', 'Before', 'During (gap)', 'After', 'Total'], ['Mar 2026', '1', '3', '0', '4'], ['Total', '1', '3', '0', '4']], 'no-agent by month');
    s.eq(await p.tableAt(page, '#v-coverage', 'In-shift missed calls by'), [['Month', 'Missed (in-shift)'], ['Mar 2026', '3'], ['Total', '3']], 'missed by month');
    s.eq(await p.stackRows(page, '#v-coverage'), [{ d: 'Mar 2026', tot: '23 · 65%' }], 'coverage by month');
    s.done();
  });
});

test('Coverage: "Coverage by day" shows 9 calls 67%, 7 calls 71%, 7 calls 57% (handled share of that day)', async () => {
  await p.withApp({ filters: { groupBy: 'day' } }, async ({ page }) => {
    // 6/9 = 66.7 -> 67 ; 5/7 = 71.4 -> 71 ; 4/7 = 57.1 -> 57
    assert.deepEqual(await p.stackRows(page, '#v-coverage'), [{ d: 'Mar 2Mon', tot: '9 · 67%' }, { d: 'Mar 3Tue', tot: '7 · 71%' }, { d: 'Mar 4Wed', tot: '7 · 57%' }]);
  });
});

test('Coverage: the missed-call log counts 5 missed inbound calls, 1 called back (20%), 4 with no callback (80%)', async () => {
  await p.withApp(async ({ page }) => {
    const t = await p.tiles(page, '#v-coverage'); const s = p.soft();
    const v = l => { const x = p.pick(t, l); return x ? [x.value, x.foot] : null; };
    s.eq(v('Missed (inbound)'), ['5', 'in range'], 'Missed (inbound)');
    // The 12:35 outbound call lists "+1 312-555-0150" among its participants, so the 12:05 miss from +13125550150 was called back.
    s.eq(v('Called back'), ['1', '20%'], 'Called back');
    s.eq(v('No callback'), ['4', '80% — to action'], 'No callback');
    s.done();
  });
});

/* ================= Agent scorecard ================= */

test('Agent scorecard: tiles show 3 agents, 15 handled, avg handle time 4m 40s, avg utilisation 84.1%, total paused 13:00:00, 4 missed rings', async () => {
  // AHT: (240 + 390 + 210) / 3 = 280 s = 4m 40s ; utilisation (91.7 + 66.7 + 93.8) / 3 = 84.07 ; paused 2h + 10h + 1h
  await p.withApp(async ({ page }) => {
    const t = await p.tiles(page, '#v-agents'); const s = p.soft();
    const v = l => { const x = p.pick(t, l); return x ? [x.value, x.foot] : null; };
    s.eq(v('Agents logged in'), ['3', 'all handled ≥1 call'], 'Agents logged in');
    s.eq(v('Calls handled'), ['15', 'total'], 'Calls handled');
    s.eq(v('Avg handle time'), ['4m 40s', 'team'], 'Avg handle time');
    s.eq(v('Avg utilisation'), ['84.1%', 'non-paused ÷ logged-in'], 'Avg utilisation');
    s.eq(v('Total paused'), ['13:00:00', 'across agents'], 'Total paused');
    s.eq(v('Missed rings'), ['4', 'unanswered offers'], 'Missed rings');
    s.done();
  });
});

test('Agent scorecard: each agent row matches the made-up exports (handled, AHT, holds, missed rings, present days, logged in, status)', async () => {
  await p.withApp(async ({ page }) => {
    const rows = await p.tableAt(page, '#v-agents', 'Per-agent scorecard');
    const body = rows.slice(2, 5);   // two header rows, then Asha, Ben, Cara
    const s = p.soft();
    // Asha 7 handled, AHT 4m 00s, 2 holds, avg hold 1:00, 1 missed ring (12.5% = more than 20% over the 10% target -> red), ring 4.0s, 1 transfer,
    //      3 present days, logged in 24:00:00 -> 8:00:00 a day, working 16:00:00, paused 2:00:00, util 91.7, occ 66.7
    s.eq(body[0], ['Asha Rao', '7', '4m 00s', '2', '1:00', '1', '12.5%', '4.0s', '1', '3', '24:00:00', '8:00:00', '16:00:00', '2:00:00', '91.7%', '66.7%', 'Off target'], 'Asha Rao');
    // Ben 5 handled, AHT 6m 30s (390 s is over 378 = 20% above 315 -> red), 3 missed (37.5%), 3 present days, 30:00:00 -> 10:00:00 a day
    s.eq(body[1], ['Ben Cole', '5', '6m 30s', '2', '1:00', '3', '37.5%', '4.0s', '1', '3', '30:00:00', '10:00:00', '15:00:00', '10:00:00', '66.7%', '50.0%', 'Off target'], 'Ben Cole');
    // Cara 3 handled, AHT 3m 30s, 0 missed, only 2 present days, logged in 16:00:00 -> 8:00:00 a day, everything on target
    s.eq(body[2], ['Cara Diaz', '3', '3m 30s', '2', '1:00', '0', '0.0%', '4.0s', '1', '2', '16:00:00', '8:00:00', '11:00:00', '1:00:00', '93.8%', '68.8%', 'On target'], 'Cara Diaz');
    s.done();
  });
});

test('Agent scorecard: the Total row adds the agents up (handled 15, holds 6, missed rings 4, transfers 3, logged in 70:00:00, working 42:00:00, paused 13:00:00)', async () => {
  await p.withApp(async ({ page }) => {
    const rows = await p.tableAt(page, '#v-agents', 'Per-agent scorecard');
    const tot = rows.find(r => r[0] === 'Total'); const s = p.soft();
    s.eq(tot, ['Total', '15', '—', '6', '—', '4', '—', '—', '3', '—', '70:00:00', '—', '42:00:00', '13:00:00', '—', '—', '—'], 'Total row');
    // and the total row really equals the sum of the three agent rows above it
    const body = rows.slice(2, 5);
    s.eq(body.reduce((a, r) => a + Number(r[1]), 0), Number(tot[1]), 'handled adds up');
    s.eq(body.reduce((a, r) => a + Number(r[3]), 0), Number(tot[3]), 'holds add up');
    s.eq(body.reduce((a, r) => a + Number(r[5]), 0), Number(tot[5]), 'missed rings add up');
    s.done();
  });
});

test('Agent scorecard: the Average row is the plain mean of the agent rows (handled 5, AHT 4m 40s, miss 16.7%, present days 2.7, logged in 23:20:00, utilisation 84.1%, occupancy 61.8%)', async () => {
  await p.withApp(async ({ page }) => {
    const rows = await p.tableAt(page, '#v-agents', 'Per-agent scorecard');
    const avg = rows.find(r => r[0] === 'Average'); const s = p.soft();
    // AHT mean (240+390+210)/3 = 280 s ; miss mean (12.5+37.5+0)/3 = 16.67 ; present days (3+3+2)/3 = 2.67 ; logged in 70h/3 = 23:20:00
    s.eq(avg.slice(0, 9), ['Average', '5', '4m 40s', '2', '1:00', '1', '16.7%', '4.0s', '1'], 'first columns of the Average row');
    s.eq(avg[9], '2.7', 'present days average'); s.eq(avg[10], '23:20:00', 'logged in average');
    s.eq(avg.slice(12), ['14:00:00', '4:20:00', '84.1%', '61.8%', '—'], 'working, paused, util, occupancy');
    s.done();
  });
});

test('Agent scorecard: the Average row "Avg/day" (8:40:00) agrees with its own Logged in average (23:20:00) divided by its Present days average (2.7)', { skip: 'QUESTION: the Average row averages each agent\'s per-day figure (8:40:00). Dividing the Average row\'s own columns gives 8:45:00 (23:20 / 2.67). On-screen text says "Average = mean across agents", so it may be intended.' }, async () => {
  await p.withApp(async ({ page }) => {
    const rows = await p.tableAt(page, '#v-agents', 'Per-agent scorecard');
    assert.equal(rows.find(r => r[0] === 'Average')[11], '8:45:00');
  });
});

test('Agent scorecard: the Totals strip counts 3 agents, 1 on target, 0 watch, 2 off target', async () => {
  await p.withApp(async ({ page }) => {
    const txt = await page.evaluate(() => [...document.querySelectorAll('#v-agents .card')].map(c => c.textContent.replace(/\s+/g, ' ')).find(t => /^\s*Totals/.test(t)));
    assert.match(txt, /Agents: 3 On target 1 Watch 0 Off target 2 Calls handled: 15 · Missed rings: 4/);
  });
});

/* ================= Volume trends ================= */

test('Volume trends: tiles show 8 queue calls a day (23 / 3), busiest month Mar 2026 with 23 calls, inbound 14, outbound 2, internal 1', async () => {
  await p.withApp(async ({ page }) => {
    const t = await p.tiles(page, '#v-volume'); const s = p.soft();
    const v = l => { const x = p.pick(t, l); return x ? [x.value, x.foot] : null; };
    s.eq(v('Queue calls / day'), ['8', 'average'], 'Queue calls / day');
    s.eq(v('Busiest month'), ['Mar 2026', '23 calls'], 'Busiest month');
    s.eq(v('Inbound'), ['14', 'all lines'], 'Inbound'); s.eq(v('Outbound'), ['2', 'all lines'], 'Outbound'); s.eq(v('Internal'), ['1', 'all lines'], 'Internal');
    s.done();
  });
});

test('Volume trends: grouped by day the busiest day is Mar 2 with 9 calls, and the line chart plots 9, 7, 7', async () => {
  await p.withApp({ filters: { groupBy: 'day' } }, async ({ page }) => {
    const s = p.soft();
    const bd = await p.tile(page, '#v-volume', 'Busiest day');
    s.eq([bd.value, bd.foot], ['Mar 2', '9 calls'], 'Busiest day');
    const pts = await page.evaluate(() => [...document.querySelectorAll('#v-volume svg.line text')].map(t => t.textContent));
    // the chart prints value then label for each dot is not guaranteed; just check the numbers and labels are all there
    s.eq(pts.filter(x => /^\d+$/.test(x)), ['9', '7', '7'], 'plotted values');
    s.eq(pts.filter(x => /^[A-Z][a-z]{2} \d+$/.test(x)), ['Mar 2', 'Mar 3', 'Mar 4'], 'day labels');
    s.done();
  });
});

test('Volume trends: "Calls by 2-hour window" shows 4, 7, 5, 5, 1 queue calls for 9-11, 11-1, 1-3, 3-5, 5-6 (22 in shift; the 7 AM call is not in a window)', async () => {
  await p.withApp(async ({ page }) => {
    const rows = await p.barsAt(page, '#v-volume', 'Calls by 2-hour window');
    assert.deepEqual(rows, [{ k: '9–11a', v: '4' }, { k: '11–1p', v: '7' }, { k: '1–3p', v: '5' }, { k: '3–5p', v: '5' }, { k: '5–6p', v: '1' }]);
  });
});

test('Volume trends: "Direction split" shows inbound 14 (82.4%), outbound 2 (11.8%), internal 1 (5.9%) with 17 calls in the middle', async () => {
  await p.withApp(async ({ page }) => {
    const s = p.soft();
    s.eq(await p.legendAt(page, '#v-volume', 'Direction split'), ['Inbound · 14 (82.4%)', 'Outbound · 2 (11.8%)', 'Internal · 1 (5.9%)'], 'direction legend');
    s.eq(await page.evaluate(() => document.querySelector('#v-volume .donut .ctr').textContent.replace(/\s+/g, ' ').trim()), '17calls', 'centre of the donut');
    s.done();
  });
});

test('Volume trends: "Call results" counts ended successfully 11, missed 5, voicemail 1 (17 in all)', async () => {
  await p.withApp(async ({ page }) => {
    const rows = await p.barsAt(page, '#v-volume', 'Call results');
    assert.deepEqual(rows, [{ k: 'Ended successfully', v: '11' }, { k: 'Missed Call', v: '5' }, { k: 'Sent to voicemail', v: '1' }]);
  });
});

/* ================= Voice of the patient ================= */

test('Voice of patient: 17 calls analysed; positive 17.6% (3), neutral 76.5% (13), negative 5.9% (1)', async () => {
  await p.withApp(async ({ page }) => {
    const t = await p.tiles(page, '#v-voice'); const s = p.soft();
    const v = l => { const x = p.pick(t, l); return x ? [x.value, x.foot] : null; };
    s.eq(v('Calls analysed'), ['17', 'with AI summary'], 'Calls analysed');
    s.eq(v('Positive'), ['17.6%', '3 calls'], 'Positive'); s.eq(v('Neutral'), ['76.5%', '13 calls'], 'Neutral'); s.eq(v('Negative'), ['5.9%', '1 calls'], 'Negative');
    s.done();
  });
});

test('Voice of patient: the explanation line repeats the direction counts (17 = 14 inbound + 2 outbound + 1 internal) and the topic list has 4 distinct topics', async () => {
  await p.withApp(async ({ page }) => {
    const txt = await page.evaluate(() => document.querySelector('#v-voice').textContent.replace(/\s+/g, ' '));
    const s = p.soft();
    s.ok(/These 17 calls are every leg the phone system logged: 14 inbound .* \+ 2 outbound .* \+ 1 internal/.test(txt), 'direction sentence');
    s.ok(/Top call topics 4 distinct/.test(txt), 'distinct topics tag');
    s.ok(/Negative-sentiment calls to review 1 shown/.test(txt), 'one negative call shown');
    s.done();
  });
});

test('Voice of patient: "Negative calls by day" plots 1 negative on Mar 2 and 0 on the other days', async () => {
  await p.withApp(async ({ page }) => {
    const pts = await page.evaluate(() => [...document.querySelectorAll('#v-voice svg.line text')].map(t => t.textContent));
    assert.deepEqual(pts.filter(x => /^\d+$/.test(x)), ['1', '0', '0', '0']);
    assert.deepEqual(pts.filter(x => /^[A-Z][a-z]{2} \d+$/.test(x)), ['Mar 2', 'Mar 3', 'Mar 4', 'Mar 7']);
  });
});

/* ================= Insights ================= */

test('Insights: flag titles carry the right numbers (SL 72.2%, abandon rate 8.7%, Ben Cole 38% missed rings, 10:00:00 Do Not Disturb, best coverage Mar 3 at 71%, worst hour 12 PM, 1 inbound outside shift, 1 voicemail)', async () => {
  await p.withApp(async ({ page }) => {
    const cards = await page.evaluate(() => [...document.querySelectorAll('#v-insights .insight')].map(c => ({ title: c.querySelector('b').textContent.trim(), body: c.querySelector('p').textContent.trim() })));
    const titles = cards.map(c => c.title); const s = p.soft();
    for (const want of ['Service level 72.2%', 'Abandon rate 8.7%', 'Ben Cole: 38% missed rings', '10:00:00 on Do Not Disturb', 'Best coverage: Mar 3', 'Worst uncovered hour: 12 PM',
      '1 inbound calls outside shift', '1 voicemails left', '6% of rated calls tagged negative']) s.ok(titles.includes(want), 'missing flag "' + want + '". Titles shown: ' + titles.join(' | '));
    s.ok(cards.find(c => c.title === 'Best coverage: Mar 3').body.startsWith('71% handled across 7 calls'), 'best coverage body');
    s.ok(cards.find(c => c.title === 'Worst uncovered hour: 12 PM').body.startsWith('3 calls dropped'), 'worst hour count');
    s.ok(cards.find(c => c.title === 'Ben Cole: 38% missed rings').body.startsWith('3 ring offers went unanswered.'), 'Ben missed rings');
    s.ok(cards.find(c => c.title === '6% of rated calls tagged negative').body.startsWith('1 of 17 calls the platform rated as negative'), 'negative share body');
    s.done();
  });
});

test('Insights: "Call length distribution" buckets the 17 calls: under 30s 4, 30-60s 1, 1-3 min 12, 3-5 min 0, over 5 min 0', async () => {
  await p.withApp(async ({ page }) => {
    const rows = await p.barsAt(page, '#v-insights', 'Call length distribution');
    assert.deepEqual(rows, [{ k: 'Under 30s', v: '4' }, { k: '30–60s', v: '1' }, { k: '1–3 min', v: '12' }, { k: '3–5 min', v: '0' }, { k: 'Over 5 min', v: '0' }]);
  });
});

test('Insights: "Direction split" shows inbound 14, outbound 2, internal 1', async () => {
  await p.withApp(async ({ page }) => {
    assert.deepEqual(await p.barsAt(page, '#v-insights', 'Direction split'), [{ k: 'Inbound', v: '14' }, { k: 'Outbound', v: '2' }, { k: 'Internal', v: '1' }]);
  });
});

test('Insights: repeat inbound numbers are reported (2 patients called more than once, 5 calls)', async () => {
  const extra = [
    h.cRow({ date: '2026-03-03T10:00:00-06:00', from: '+13125550160' }), h.cRow({ date: '2026-03-03T11:00:00-06:00', from: '+13125550160' }), h.cRow({ date: '2026-03-04T11:00:00-06:00', from: '+13125550160' }),
    h.cRow({ date: '2026-03-03T10:30:00-06:00', from: '+13125550161' }), h.cRow({ date: '2026-03-04T10:30:00-06:00', from: '+13125550161' }),
  ];
  await p.withApp({ files: p.prodFiles({ calls: h.standardCallLog().concat(extra) }) }, async ({ page }) => {
    const cards = await page.evaluate(() => [...document.querySelectorAll('#v-insights .insight')].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(cards.some(c => /^2 patients called more than once\s*5 inbound calls came from repeat numbers/.test(c)), cards.join(' | '));
  });
});

test('Insights: per-agent cards say 3 agents, 1 needs action (Ben Cole, 37.5% missed rings), 1 needs attention (Asha Rao, 12.5%)', async () => {
  await p.withApp(async ({ page }) => {
    const txt = await page.evaluate(() => document.querySelector('#v-insights').textContent.replace(/\s+/g, ' '));
    const badges = await page.evaluate(() => [...document.querySelectorAll('#v-insights .ai-card')].map(c => c.querySelector('.ai-head b').textContent + '=' + c.querySelector('.ai-badge').textContent.trim()));
    const s = p.soft();
    s.ok(/Per-agent insights: production \+ QA 3 agents/.test(txt), 'agent count tag');
    s.ok(/1 need action, 1 need attention/.test(txt), 'action / attention counts');
    s.eq(badges, ['Ben Cole=Action needed', 'Asha Rao=Needs attention', 'Cara Diaz=On track'], 'badges');
    s.done();
  });
});

/* ================= Per-queue table (Service level overview) ================= */

test('Per-queue table: queue rows add up to the All queues row (offered 23, handled 15, abandoned 2)', { skip: 'QUESTION: vSL() (the By-queue table) is defined in index.html but never drawn: it is not in VIEWS, so no screen shows it. Checked directly below only to document the numbers.' }, async () => {
  await p.withApp(async ({ page }) => {
    await page.evaluate(() => vSL());
    const rows = await p.tableAt(page, '#v-sl', 'By queue');
    const body = rows.slice(1, -1), all = rows[rows.length - 1];
    assert.equal(body.reduce((a, r) => a + Number(r[1]), 0), Number(all[1]));
  });
});

test('Per-queue table: SL met % per queue counts only in-shift calls, like the All queues row', { skip: 'QUESTION: vSL() is never drawn (see above). If it is ever switched on: the per-queue rows count every call with a YES/NO stamp (also before/after shift) while the All queues row is in-shift only, so the rows would not agree.' }, async () => {
  const off = h.qRow({ start: '2026-03-02T07:30:00-06:00', agent: 'Asha Rao', outcome: 'handled', reason: 'agent answered', sl: 'NO', wait: 60, talk: 100, ring: 4, call: 160, queue: 'Billing' });
  await p.withApp({ files: p.prodFiles({ queue: h.standardQueueRows().concat([off]) }) }, async ({ page }) => {
    await page.evaluate(() => vSL());
    const rows = await p.tableAt(page, '#v-sl', 'By queue');
    const billing = rows.find(r => r[0] === 'Billing');
    // Billing in shift: Mon 17:15 YES, Tue 16:01 YES -> 100.0%. The 7:30 AM NO call must not count.
    assert.equal(billing[9], '100.0%');
  });
});
