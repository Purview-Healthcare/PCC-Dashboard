'use strict';
/*
 * The SAME figure must read the same wherever the app shows it, in every filter state.
 * Screens compared: Executive summary, Overview, Coverage & missed, Agent scorecard, Volume trends,
 * Voice of patient, Insights, and the Production report page (which embeds copies of those sections).
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const p = require('./prod-helpers');

after(() => h.closeBrowser());

/* ---------- reading the same figures from every screen ---------- */
const toN = s => (s == null ? null : Number(String(s).replace(/,/g, '')));
const firstInt = s => { const m = String(s || '').match(/-?[\d,]+/); return m ? toN(m[0]) : null; };
const lastRow = rows => (rows && rows.length ? rows[rows.length - 1] : null);

/** Read the headline figures from every section, either the individual section or its copy inside the Production report. */
async function read(page, inReport) {
  const R = id => (inReport ? '#rep-' : '#v-') + id;
  const ex = await p.tiles(page, R('exec')), cv = await p.tiles(page, R('coverage')), ag = await p.tiles(page, R('agents')), vo = await p.tiles(page, R('volume')), vp = await p.tiles(page, R('voice'));
  const ov = await p.overview(page, R('overview'));
  const cov = {
    stack: await p.stackRows(page, R('coverage')),
    miss2h: await p.tableAt(page, R('coverage'), 'Missed calls by day and 2-hour window'),
    missBars: await p.barsAt(page, R('coverage'), 'Missed calls by 2-hour window of shift'),
    missPeriod: await p.tableAt(page, R('coverage'), 'In-shift missed calls by'),
    naPeriod: await p.tableAt(page, R('coverage'), 'No-agent calls by'),
    sentence: await page.evaluate(sel => (document.querySelector(sel).textContent.replace(/\s+/g, ' ').match(/The ([\d,]+) missed calls that landed during staffed hours/) || [])[1], R('coverage')),
  };
  const score = await p.tableAt(page, R('agents'), 'Per-agent scorecard');
  const results = await p.barsAt(page, R('volume'), 'Call results');
  const direction = await p.legendAt(page, R('volume'), 'Direction split');
  const insights = await page.evaluate(sel => [...document.querySelectorAll(sel + ' .insight b')].map(b => b.textContent.trim()), R('insights'));
  const insDir = await p.barsAt(page, R('insights'), 'Direction split');
  const voiceText = await page.evaluate(sel => document.querySelector(sel).textContent.replace(/\s+/g, ' '), R('voice'));
  const insNum = re => { const t = insights.find(x => re.test(x)); return t ? firstInt(t.match(re)[0]) : null; };
  const f = {};
  const chartSum = await page.evaluate(sel => [...document.querySelectorAll(sel + ' svg.line text')].map(t => t.textContent).filter(x => /^\d+$/.test(x)).map(Number).reduce((a, b) => a + b, 0), R('volume'));
  f.offered = { exec: toN(p.pick(ex, 'Offered').value), overview: firstInt(ov.total), coverage: cov.stack.map(r => firstInt(r.tot)).reduce((a, b) => a + b, 0), volumeChart: chartSum };
  f.handled = { exec: firstInt(p.pick(ex, 'Handled').foot), overview: firstInt(ov.handled), overviewLegend: firstInt(ov.legend[0]), scorecardTile: toN(p.pick(ag, 'Calls handled').value), scorecardTotalRow: score && score.find(r => r[0] === 'Total') ? toN(score.find(r => r[0] === 'Total')[1]) : null };
  f.handledPct = { exec: p.pick(ex, 'Handled').value, overview: (ov.handledSub.match(/^([\d.]+%|—)/) || [])[1] };
  f.abandoned = { exec: toN(p.pick(ex, 'Abandoned').value), coverage: toN(p.pick(cv, 'Abandoned in queue').value), overviewLegend: (() => { const l = ov.legend.find(x => /^Abandoned/.test(x)); return l ? firstInt(l.replace('Abandoned', '')) : 0; })(), insightsRate: insights.find(x => /^Abandon rate/.test(x)) ? 'shown' : 'not shown' };
  f.sl = { exec: p.pick(ex, 'Service level').value, overview: ov.mini[0].v, insights: (() => { const t = insights.find(x => /^Service level/.test(x)); return t ? t.replace('Service level ', '') : '—'; })() };
  f.noAgentInShift = { exec: toN(p.pick(ex, 'No-agent (in-shift)').value), coverageTile: toN(p.pick(cv, 'No agent (in-shift)').value), coverageDuring: toN(p.pick(cv, 'During shift', 1) ? p.pick(cv, 'During shift', 1).value : null), coverageTable: cov.naPeriod ? toN(lastRow(cov.naPeriod)[2]) : 0 };
  f.missedInShift = { exec: toN(p.pick(ex, 'Missed (in-shift)').value), overview: toN((ov.other.find(x => x.k === 'Missed calls (in-shift)') || {}).v), coverageTile: toN(p.pick(cv, 'Missed calls (in-shift)').value),
    coverageTwoHourTable: cov.miss2h ? toN(lastRow(cov.miss2h)[cov.miss2h[0].length - 3]) : 0, coveragePeriodTable: cov.missPeriod ? toN(lastRow(cov.missPeriod)[1]) : 0,
    coverageTwoHourBars: cov.missBars.reduce((a, b) => a + firstInt(b.v), 0), coverageSentence: cov.sentence == null ? 0 : toN(cov.sentence) };
  f.voicemails = { overview: toN((ov.other.find(x => x.k === 'Voicemails left') || {}).v), coverage: toN(p.pick(cv, 'Voicemails left').value), volumeResults: toN((results.find(x => x.k === 'Sent to voicemail') || { v: 0 }).v), insights: insights.find(x => /voicemails left$/.test(x)) ? firstInt(insights.find(x => /voicemails left$/.test(x))) : 0 };
  f.inbound = { volumeTile: toN(p.pick(vo, 'Inbound').value), volumeDonut: firstInt(direction[0].split('·')[1]), insights: toN(insDir[0].v), voice: toN((voiceText.match(/(\d[\d,]*) inbound/) || [])[1]) };
  f.outbound = { volumeTile: toN(p.pick(vo, 'Outbound').value), overview: toN((ov.other.find(x => x.k === 'Outbound calls') || {}).v), insights: toN(insDir[1].v) };
  f.analysed = { voice: toN(p.pick(vp, 'Calls analysed').value), volumeResults: results.reduce((a, b) => a + toN(b.v), 0), volumeDirectionSum: toN(p.pick(vo, 'Inbound').value) + toN(p.pick(vo, 'Outbound').value) + toN(p.pick(vo, 'Internal').value) };
  f.insightsNoAgent = insNum(/^[\d,]+ calls \(\d+%\) hit an empty queue/);
  return f;
}
function same(s, name, obj) {
  const pairs = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && !Number.isNaN(v));
  if (pairs.length < 2) return;
  const first = pairs[0][1];
  s.ok(pairs.every(([, v]) => v === first), name + ' is not the same on every screen: ' + pairs.map(([k, v]) => `${k} = ${v}`).join(', '));
}
function checkAgree(s, f, where, opts = {}) {
  same(s, where + 'Offered', f.offered);
  same(s, where + 'Handled count', opts.noScorecard ? { exec: f.handled.exec, overview: f.handled.overview, overviewLegend: f.handled.overviewLegend } : f.handled);
  same(s, where + 'Handled %', f.handledPct);
  same(s, where + 'Abandoned', { exec: f.abandoned.exec, coverage: f.abandoned.coverage, overviewLegend: f.abandoned.overviewLegend });
  same(s, where + 'Service level', f.sl);
  same(s, where + 'No agent (in-shift)', { exec: f.noAgentInShift.exec, coverageTile: f.noAgentInShift.coverageTile, coverageDuring: f.noAgentInShift.coverageDuring, coverageTable: f.noAgentInShift.coverageTable });
  same(s, where + 'Missed (in-shift)', f.missedInShift);
  same(s, where + 'Voicemails', f.voicemails);
  same(s, where + 'Inbound calls', f.inbound);
  same(s, where + 'Outbound calls', f.outbound);
  same(s, where + 'Total calls in the call log', f.analysed);
}
/** The Production report page must hold exactly the same text as each section it embeds. */
async function reportMatchesSections(page) {
  return page.evaluate(() => ['exec', 'overview', 'coverage', 'agents', 'volume', 'voice', 'insights'].filter(id => {
    const a = document.getElementById('v-' + id).textContent.replace(/\s+/g, ' ').trim();
    const b = document.querySelector('#rep-' + id + ' .rep-body').textContent.replace(/\s+/g, ' ').trim();
    return a !== b;
  }));
}

/* ================= default view ================= */

test('every shared figure (offered, handled, handled %, abandoned, service level, no-agent, voicemails, directions) is the same on every screen with the standard data', async () => {
  await p.withApp(async ({ page }) => {
    const s = p.soft();
    checkAgree(s, await read(page, false), '');
    s.done();
  });
});

test('"Missed (in-shift)" is the same on Executive summary, Overview and all the Coverage tables with the standard data (the Saturday call is counted by all of them)', async () => {
  await p.withApp(async ({ page }) => {
    const s = p.soft(); const f = await read(page, false);
    same(s, 'Missed (in-shift)', f.missedInShift);
    s.done();
  });
});

test('"Missed (in-shift)" is the same on Executive summary and Overview even when an OUTBOUND call has the result "Missed Call"', async () => {
  // Executive summary counts inbound misses only; Overview and Coverage count a missed call of any direction.
  const outboundMiss = h.cRow({ date: '2026-03-03T10:15:00-06:00', dir: 'Outbound', res: 'Missed Call', from: 'Ben Cole', parts: 'Ben Cole, +13125550198', dur: 15000 });
  await p.withApp({ files: p.weekdayFiles({ calls: p.NO_SAT(h.standardCallLog()).concat([outboundMiss]) }) }, async ({ page }) => {
    const f = await read(page, false); const s = p.soft();
    same(s, 'Missed (in-shift): Executive summary vs Overview vs Coverage', { exec: f.missedInShift.exec, overview: f.missedInShift.overview, coverageTile: f.missedInShift.coverageTile });
    s.done();
  });
});

test('the Coverage "During shift" inbound tile (12) and the "missed by day and 2-hour window" Volume column (13) count the same inbound calls', async () => {
  // Call categories treats Saturday as closed ("weekend"), but the 2-hour table counts the Saturday 11 AM call as in-shift.
  await p.withApp(async ({ page }) => {
    const t = await p.tiles(page, '#v-coverage');
    const during = toN(p.pick(t, 'During shift', 0).value);
    const rows = await p.tableAt(page, '#v-coverage', 'Missed calls by day and 2-hour window');
    const volume = toN(lastRow(rows)[rows[0].length - 2]);
    assert.equal(volume, during, `table says ${volume} inbound calls in shift, the category tile says ${during}`);
  });
});

test('the Coverage "Missed (inbound)" log and the Executive "no callback" figure agree on how many missed calls were called back', async () => {
  await p.withApp(async ({ page }) => {
    const txt = await page.evaluate(() => document.querySelector('#v-exec').textContent.replace(/\s+/g, ' '));
    const execNoCb = toN(txt.match(/([\d,]+) missed calls had no callback/)[1]);
    const covNoCb = toN((await p.tile(page, '#v-coverage', 'No callback')).value);
    assert.equal(covNoCb, execNoCb, `Coverage says ${covNoCb} have no callback, Executive summary says ${execNoCb}`);
  });
});

test('Insights "calls hit an empty queue" equals the in-shift no-agent figure used everywhere else (3), not all hours (4)', async () => {
  await p.withApp(async ({ page }) => {
    const f = await read(page, false);
    assert.equal(f.insightsNoAgent, f.noAgentInShift.exec, `Insights says ${f.insightsNoAgent}, Executive summary says ${f.noAgentInShift.exec}`);
  });
});

test('a number that calls twice, once as "+13125550161" and once as "+1 312-555-0161", is a repeat caller on both Executive summary and Insights', async () => {
  const calls = h.standardCallLog().concat([
    h.cRow({ date: '2026-03-03T10:00:00-06:00', from: '+13125550161' }), h.cRow({ date: '2026-03-04T10:30:00-06:00', from: '+1 312-555-0161' }),
  ]);
  await p.withApp({ files: p.prodFiles({ calls }) }, async ({ page }) => {
    const exec = toN((await p.tile(page, '#v-exec', 'Repeat callers')).value);
    const ins = await page.evaluate(() => { const c = [...document.querySelectorAll('#v-insights .insight b')].map(b => b.textContent).find(t => /patients called more than once/.test(t)); return c ? Number(c.match(/^(\d+)/)[1]) : 0; });
    assert.equal(ins, exec, `Insights counts ${ins} repeat patients, Executive summary counts ${exec}`);
  });
});

/* ================= the Production report page ================= */

test('Production report page: every embedded section carries exactly the text of the individual section (default filters)', async () => {
  await p.withApp(async ({ page }) => { assert.deepEqual(await reportMatchesSections(page), []); });
});

test('Production report page: the figures read from the report copy equal the figures read from the individual sections', async () => {
  await p.withApp(async ({ page }) => {
    const a = await read(page, false), b = await read(page, true);
    assert.deepEqual(b, a);
  });
});

test('Production report page: its header shows the active date range, queue and shift', async () => {
  await p.withApp({ filters: { queue: 'Billing', shiftStart: 8, shiftEnd: 17, from: '2026-03-03', to: '2026-03-04' } }, async ({ page }) => {
    const meta = await page.evaluate(() => document.querySelector('#v-report .rep-letter .meta').innerHTML.split(/<br\s*\/?>/i).map(x => x.trim()));
    assert.deepEqual(meta, ['Mar 3 – Mar 4', 'Billing', 'Shift 8 AM – 5 PM CT']);
  });
});

/* ================= filters keep the screens in agreement ================= */

test('date range Mar 2 to Mar 3: Executive, Overview, Coverage, Volume and the report copy all show 16 offered and 11 handled', async () => {
  // Mon 9 + Tue 7 = 16 offered; handled 6 + 5 = 11
  await p.withApp({ filters: { from: '2026-03-02', to: '2026-03-03' } }, async ({ page }) => {
    const f = await read(page, false); const s = p.soft();
    checkAgree(s, f, 'Mar 2-3: ', { noScorecard: true });
    s.eq(f.offered.exec, 16, 'Offered'); s.eq(f.handled.exec, 11, 'Handled');
    s.eq(f.missedInShift.exec, 2, 'Missed in shift (Mon 12:05 and Tue 13:05)');
    s.eq(await reportMatchesSections(page), [], 'report copy matches the sections');
    s.done();
  });
});

test('date range Mar 2 to Mar 3: the Agent scorecard "Calls handled" is 11, the same as Overview', async () => {
  // The individual-performance export is one summary for the whole period, so the scorecard keeps showing 7 + 5 + 3 = 15 whatever dates are picked.
  await p.withApp({ filters: { from: '2026-03-02', to: '2026-03-03' } }, async ({ page }) => {
    const ov = await p.overview(page, '#v-overview');
    const sc = toN((await p.tile(page, '#v-agents', 'Calls handled')).value);
    assert.equal(sc, toN(ov.handled), `Scorecard says ${sc} calls handled, Overview says ${ov.handled}`);
  });
});

test('queue filter "Billing": offered 2 and handled 2 on every screen (call-log figures are not queue-based and stay the same on all screens)', async () => {
  // Billing legs: Mon 17:15 (Ben) and the Tue 16:01 leg of the two-leg call (Cara)
  await p.withApp({ filters: { queue: 'Billing' } }, async ({ page }) => {
    const f = await read(page, false); const s = p.soft();
    checkAgree(s, f, 'Billing: ', { noScorecard: true });
    s.eq(f.offered.exec, 2, 'Offered'); s.eq(f.handled.exec, 2, 'Handled');
    s.eq(await reportMatchesSections(page), [], 'report copy matches the sections');
    s.done();
  });
});

test('queue filter "Billing": the Agent scorecard "Calls handled" is 2, the same as Overview', async () => {
  await p.withApp({ filters: { queue: 'Billing' } }, async ({ page }) => {
    const ov = await p.overview(page, '#v-overview');
    const sc = toN((await p.tile(page, '#v-agents', 'Calls handled')).value);
    assert.equal(sc, toN(ov.handled), `Scorecard says ${sc} calls handled, Overview says ${ov.handled}`);
  });
});

test('shift 1 PM to 6 PM: service level 60.0%, no-agent (in-shift) 0, missed (in-shift) 1 on every screen, and the windows relabel to 1-3, 3-5, 5-6', async () => {
  // In-shift (hour >= 13) verdicts: Mon Ben x3 YES + 14:20 abandoned NO; Tue Ben NO, timeout NO, abandoned NO, Cara YES; Wed Cara x2 YES => 6 YES, 4 NO = 60.0%
  // No-agent calls all happen at 12 or 7 => 0 in shift (4 out of hours). Weekday-only missed calls: only Tue 13:05 is at/after 13:00.
  await p.withApp({ files: p.weekdayFiles(), filters: { shiftStart: 13 } }, async ({ page }) => {
    const f = await read(page, false); const s = p.soft();
    checkAgree(s, f, 'Shift 1-6 PM: ');
    s.eq(f.sl.exec, '60.0%', 'Service level'); s.eq(f.noAgentInShift.exec, 0, 'No-agent in shift'); s.eq(f.missedInShift.exec, 1, 'Missed in shift');
    const rows = await p.barsAt(page, '#v-coverage', 'Call demand vs handled');
    s.eq(rows.map(r => r.k), ['1–3p', '3–5p', '5–6p'], 'window labels');
    s.eq(rows.map(r => r.v), ['3 / 5', '3 / 5', '1 / 1'], 'handled / offered per window');
    s.eq((await p.tile(page, '#v-coverage', 'No agent (in-shift)')).foot, '4 out-of-hours excluded', 'no-agent out of hours');
    s.eq((await p.tile(page, '#v-coverage', 'Total not reached')).value, '3', 'total not reached = 0 + 2 abandoned + 1 timeout');
    s.eq(await reportMatchesSections(page), [], 'report copy matches the sections');
    s.done();
  });
});

test('shift start 6 PM and end 9 AM (start after end): in-shift figures are all 0 on every screen and nothing shows NaN', async () => {
  await p.withApp({ filters: { shiftStart: 18, shiftEnd: 9 } }, async ({ page }) => {
    const f = await read(page, false); const s = p.soft();
    checkAgree(s, f, 'Shift 6 PM-9 AM: ');
    s.eq(f.noAgentInShift.exec, 0, 'no-agent in shift'); s.eq(f.missedInShift.exec, 0, 'missed in shift'); s.eq(f.sl.exec, '—', 'service level has no calls to judge');
    s.eq(await p.badText(page), [], 'NaN / undefined text');
    s.done();
  });
});

test('agent filter "Asha Rao": scorecard and per-agent insights show only her; her scorecard row equals the unfiltered row', async () => {
  await p.withApp(async ({ page }) => {
    const before = (await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).find(r => r[0] === 'Asha Rao');
    await p.setFilters(page, { agent: 'Asha Rao' });
    const rows = await p.tableAt(page, '#v-agents', 'Per-agent scorecard'); const s = p.soft();
    s.eq(rows.slice(2, -2).map(r => r[0]), ['Asha Rao'], 'scorecard rows');
    s.eq(rows.slice(2, -2)[0], before, 'her row is unchanged');
    s.eq(rows.find(r => r[0] === 'Total')[1], '7', 'total handled is her 7');
    s.eq(await page.evaluate(() => [...document.querySelectorAll('#v-insights .ai-card .ai-head b')].map(b => b.textContent)), ['Asha Rao'], 'insight cards');
    s.eq(await reportMatchesSections(page), [], 'report copy matches the sections');
    s.done();
  });
});

test('agent filter "Asha Rao": Executive summary, Overview, Coverage and Volume change to her calls only (7 handled)', { skip: 'QUESTION: the Agent filter only changes the scorecard, per-agent insights and pause tables. Offered / Handled on Executive, Overview, Coverage and Volume ignore it (coreMetrics never looks at FILTER.agent). Is that intended?' }, async () => {
  await p.withApp({ filters: { agent: 'Asha Rao' } }, async ({ page }) => {
    assert.equal((await p.tile(page, '#v-exec', 'Handled')).foot, '7 calls');
  });
});

test('"Include device lines" does not change any call total, only agent tables: Offered, handled and abandoned stay the same on every screen', async () => {
  // Front Desk answers 2 extra calls
  const rows = h.standardQueueRows().concat([
    h.qRow({ start: '2026-03-03T10:20:00-06:00', agent: 'Front Desk', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 100, ring: 3, call: 105 }),
    h.qRow({ start: '2026-03-03T10:50:00-06:00', agent: 'Front Desk', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 6, talk: 80, ring: 3, call: 86 }),
  ]);
  await p.withApp({ files: p.prodFiles({ queue: rows }) }, async ({ page }) => {
    const off = await read(page, false);
    await p.setFilters(page, { devices: true });
    const on = await read(page, false); const s = p.soft();
    checkAgree(s, off, 'devices off: ', { noScorecard: true }); checkAgree(s, on, 'devices on: ');
    s.eq(on.offered.exec, off.offered.exec, 'offered unchanged'); s.eq(on.handled.exec, 17, 'handled counts the device-line calls both times'); s.eq(off.handled.exec, 17, 'handled (toggle off)');
    s.done();
  });
});

test('"Include device lines" on: the Agent scorecard total handled (17) equals Overview handled (17), and the device line is marked', async () => {
  const rows = h.standardQueueRows().concat([
    h.qRow({ start: '2026-03-03T10:20:00-06:00', agent: 'Front Desk', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 100, ring: 3, call: 105 }),
    h.qRow({ start: '2026-03-03T10:50:00-06:00', agent: 'Front Desk', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 6, talk: 80, ring: 3, call: 86 }),
  ]);
  await p.withApp({ files: p.prodFiles({ queue: rows }), filters: { devices: true } }, async ({ page }) => {
    const sc = await p.tableAt(page, '#v-agents', 'Per-agent scorecard'); const s = p.soft();
    s.eq(sc.find(r => r[0] === 'Total')[1], '17', 'scorecard total handled');
    s.ok(sc.some(r => /^Front Desk\s*device$/.test(r[0])), 'Front Desk row tagged device: ' + sc.map(r => r[0]).join(' | '));
    s.done();
  });
});

/* ================= grouping and totals rows ================= */

test('Day / Week / Month grouping only changes the rows: offered 31, no-agent 6 (5 in shift), missed 5 never change (three months of data)', async () => {
  await p.withApp({ files: p.multiMonthFiles() }, async ({ page }) => {
    const s = p.soft();
    for (const gb of ['day', 'week', 'month']) {
      await p.setFilters(page, { groupBy: gb });
      const f = await read(page, false);
      s.eq(f.offered.coverage, 31, gb + ': Coverage offered total');
      s.eq(f.offered.volumeChart, 31, gb + ': Volume line chart total');
      s.eq(f.noAgentInShift.coverageTable, 5, gb + ': no-agent (during) period table total');
      s.eq(f.missedInShift.coveragePeriodTable, 5, gb + ': missed (in-shift) period table total');
      s.eq(f.missedInShift.exec, 5, gb + ': Executive missed (in-shift)');
      s.eq(f.offered.exec, 31, gb + ': Executive offered');
      s.eq(await reportMatchesSections(page), [], gb + ': report copy matches the sections');
    }
    s.done();
  });
});

test('grouped by day, week and month the period tables list the right periods (7 days, 4 weeks starting Monday, 3 months)', async () => {
  // dates: Thu 26 Feb, Mon 2, Tue 3, Wed 4, Mon 9, Tue 31 Mar, Wed 1 Apr. Weeks (Mon start): Feb 23, Mar 2, Mar 9, Mar 30.
  await p.withApp({ files: p.multiMonthFiles() }, async ({ page }) => {
    const s = p.soft();
    await p.setFilters(page, { groupBy: 'day' });
    s.eq((await p.stackRows(page, '#v-coverage')).map(r => r.d), ['Feb 26Thu', 'Mar 2Mon', 'Mar 3Tue', 'Mar 4Wed', 'Mar 9Mon', 'Mar 31Tue', 'Apr 1Wed'], 'coverage days');
    s.eq(await p.tableAt(page, '#v-coverage', 'No-agent calls by'), [['Day', 'Before', 'During (gap)', 'After', 'Total'], ['Feb 26 Thu', '0', '1', '0', '1'], ['Mar 2 Mon', '0', '2', '0', '2'], ['Mar 4 Wed', '1', '1', '0', '2'], ['Mar 9 Mon', '0', '1', '0', '1'], ['Total', '1', '5', '0', '6']], 'no-agent by day');
    s.eq(await p.tableAt(page, '#v-coverage', 'In-shift missed calls by'), [['Day', 'Missed (in-shift)'], ['Feb 26 Thu', '1'], ['Mar 2 Mon', '1'], ['Mar 3 Tue', '1'], ['Mar 4 Wed', '1'], ['Apr 1 Wed', '1'], ['Total', '5']], 'missed by day');
    await p.setFilters(page, { groupBy: 'week' });
    s.eq((await p.stackRows(page, '#v-coverage')).map(r => r.d), ['Wk of Feb 23', 'Wk of Mar 2', 'Wk of Mar 9', 'Wk of Mar 30'], 'coverage weeks');
    s.eq((await p.stackRows(page, '#v-coverage')).map(r => firstInt(r.tot)), [4, 23, 2, 2], 'calls per week');
    s.eq(await p.tableAt(page, '#v-coverage', 'No-agent calls by'), [['Week', 'Before', 'During (gap)', 'After', 'Total'], ['Wk of Feb 23', '0', '1', '0', '1'], ['Wk of Mar 2', '1', '3', '0', '4'], ['Wk of Mar 9', '0', '1', '0', '1'], ['Total', '1', '5', '0', '6']], 'no-agent by week');
    s.eq(await p.tableAt(page, '#v-coverage', 'In-shift missed calls by'), [['Week', 'Missed (in-shift)'], ['Wk of Feb 23', '1'], ['Wk of Mar 2', '3'], ['Wk of Mar 30', '1'], ['Total', '5']], 'missed by week');
    await p.setFilters(page, { groupBy: 'month' });
    s.eq((await p.stackRows(page, '#v-coverage')).map(r => r.d), ['Feb 2026', 'Mar 2026', 'Apr 2026'], 'coverage months');
    s.eq(await p.tableAt(page, '#v-coverage', 'No-agent calls by'), [['Month', 'Before', 'During (gap)', 'After', 'Total'], ['Feb 2026', '0', '1', '0', '1'], ['Mar 2026', '1', '4', '0', '5'], ['Total', '1', '5', '0', '6']], 'no-agent by month');
    s.eq(await p.tableAt(page, '#v-coverage', 'In-shift missed calls by'), [['Month', 'Missed (in-shift)'], ['Feb 2026', '1'], ['Mar 2026', '3'], ['Apr 2026', '1'], ['Total', '5']], 'missed by month');
    s.done();
  });
});

test('every Total row equals the sum of the rows above it: missed by day and window, no-agent by period, in-shift missed by period, scorecard', async () => {
  await p.withApp({ files: p.multiMonthFiles(), filters: { groupBy: 'day' } }, async ({ page }) => {
    const s = p.soft();
    const sums = (rows, from, to, label) => {
      const body = rows.slice(1, -1), tot = lastRow(rows);
      for (let c = from; c < to; c++) s.eq(body.reduce((a, r) => a + firstInt(r[c]), 0), firstInt(tot[c]), `${label}: column ${rows[0][c]}`);
    };
    const m = await p.tableAt(page, '#v-coverage', 'Missed calls by day and 2-hour window');
    // window columns hold "missed / volume" so check them by splitting
    const body = m.slice(1, -1), tot = lastRow(m), nWin = m[0].length - 4;
    for (let c = 1; c <= nWin; c++) {
      const part = (r, i) => (r[c].includes('/') ? Number(r[c].split('/')[i]) : 0);
      s.eq(body.reduce((a, r) => a + part(r, 0), 0), part(tot, 0), `missed in window ${m[0][c]}`);
      s.eq(body.reduce((a, r) => a + part(r, 1), 0), part(tot, 1), `volume in window ${m[0][c]}`);
    }
    sums(m, nWin + 1, nWin + 3, 'missed-by-window table');
    sums(await p.tableAt(page, '#v-coverage', 'No-agent calls by'), 1, 5, 'no-agent table');
    sums(await p.tableAt(page, '#v-coverage', 'In-shift missed calls by'), 1, 2, 'missed-by-period table');
    // each row's own Total is the sum of its before / during / after
    const na = await p.tableAt(page, '#v-coverage', 'No-agent calls by');
    na.slice(1).forEach(r => s.eq(firstInt(r[1]) + firstInt(r[2]) + firstInt(r[3]), firstInt(r[4]), 'no-agent row ' + r[0]));
    s.done();
  });
});

test('Reset puts the filters back to what they were on first load (same date range, same figures), including the call-log dates', async () => {
  // The call log runs to Sat 7 Mar but the queue file ends Wed 4 Mar. First load uses both; Reset uses the queue file only.
  await p.withApp(async ({ page }) => {
    const before = await read(page, false);
    const metaBefore = (await p.overview(page, '#v-overview')).meta[0];
    await p.setFilters(page, { from: '2026-03-03', to: '2026-03-03' });
    await page.click('#fReset'); await page.waitForTimeout(150);
    const after = await read(page, false);
    const metaAfter = (await p.overview(page, '#v-overview')).meta[0];
    const s = p.soft();
    s.eq(metaAfter, metaBefore, 'date range after Reset');
    s.eq(after, before, 'figures after Reset');
    s.done();
  });
});

test('Reset puts group-by, shift hours and the device toggle back to their defaults on every screen', async () => {
  await p.withApp(async ({ page }) => {
    await p.setFilters(page, { groupBy: 'day', shiftStart: 10, shiftEnd: 16, devices: true, queue: 'Billing' });
    await page.click('#fReset'); await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({ g: FILTER.groupBy, a: FILTER.shiftStart, b: FILTER.shiftEnd, d: FILTER.devices, q: FILTER.queue, sel: [fGroup.value, fShiftStart.value, fShiftEnd.value, fQueue.value, fDevices.checked] }));
    assert.deepEqual(state, { g: 'month', a: 9, b: 18, d: false, q: '', sel: ['month', '9', '18', '', false] });
    assert.deepEqual(await reportMatchesSections(page), []);
  });
});

test('Executive summary headline equals the sum of its own parts: recoverable calls = no-agent (in-shift) + missed (in-shift)', async () => {
  await p.withApp(async ({ page }) => {
    const big = firstInt(await page.evaluate(() => document.querySelector('#v-exec .ov-hero .big').textContent));
    const na = toN((await p.tile(page, '#v-exec', 'No-agent (in-shift)')).value), ms = toN((await p.tile(page, '#v-exec', 'Missed (in-shift)')).value);
    assert.equal(big, na + ms);
  });
});

test('Overview: the call-resolution pieces always add up to Offered, even for odd data (two calls with unknown outcome words)', async () => {
  const rows = h.standardQueueRows().concat([
    h.qRow({ start: '2026-03-03T10:20:00-06:00', outcome: 'transferred', reason: 'moved' }), h.qRow({ start: '2026-03-03T10:30:00-06:00', outcome: 'voicemail', reason: '' }),
  ]);
  await p.withApp({ files: p.prodFiles({ queue: rows }) }, async ({ page }) => {
    const ov = await p.overview(page, '#v-overview');
    const sum = ov.legend.map(x => firstInt(x.replace(/\([^)]*\)/, '').match(/ -?\d+/)[0])).reduce((a, b) => a + b, 0);
    assert.equal(sum, firstInt(ov.total), 'legend ' + ov.legend.join(' | '));
  });
});
