'use strict';
/*
 * Production side: odd data values and odd situations.
 * Blank cells, text where a number belongs, no calls in range, a single call, each file on its own,
 * duplicate rows, one call split over several queue legs, unknown outcome words, missing columns,
 * very long names, shift hours the wrong way round, agents that are only in some files, and device lines.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const p = require('./prod-helpers');

after(() => h.closeBrowser());

const none = { calls: null, productivity: null, individual: null, activity: null, pause: null, byDate: null };   // queue file only
const noQueue = { queue: null };
/** A queue row built from the standard builder, then overridden cell by cell (so blanks stay blank). */
function qOver(over, o = {}) { return Object.assign(h.qRow(o), over); }
const handledRow = (hh, agent, extra = {}) => h.qRow(Object.assign({ start: `2026-03-02T${String(hh).padStart(2, '0')}:15:00-06:00`, agent, outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 100, ring: 4, call: 105 }, extra));
const execTile = (page, l) => p.tile(page, '#v-exec', l);

/* ================= blank cells and text where a number belongs ================= */

test('blank cells: rows with a blank outcome, queue, agent, wait, reason or verdict are still counted as calls and nothing shows NaN or undefined', async () => {
  const rows = h.standardQueueRows().concat([
    qOver({ 'Outcome': '', 'Left Queue Reason': '', 'Queue': '' }, { start: '2026-03-03T10:00:00-06:00' }),
    qOver({ 'Wait time (s)': '', 'Talk duration (s)': '', 'Agent Name': '', 'Met SL': '' }, { start: '2026-03-03T10:30:00-06:00', outcome: 'handled', reason: 'agent answered' }),
  ]);
  const calls = h.standardCallLog().concat([
    Object.assign(h.cRow({ date: '2026-03-03T10:40:00-06:00' }), { 'Direction': '', 'Call Result': '', 'From': '', 'Duration [Milliseconds]': '', 'Sentiment': '', 'Topics': '' }),
  ]);
  await p.withApp({ files: p.prodFiles({ queue: rows, calls }) }, async ({ page, errors, dialogs }) => {
    const s = p.soft();
    s.eq((await execTile(page, 'Offered')).value, '25', 'Offered = 23 + 2 blank-cell calls');
    s.eq((await execTile(page, 'Handled')).foot, '16 calls', 'Handled = 15 + the handled call with blank numbers');
    s.eq(await p.badText(page), [], 'text showing NaN / undefined');
    s.eq(errors, [], 'page errors'); s.eq(dialogs, [], 'pop-ups');
    s.done();
  });
});

test('text where a number belongs: "abc" or "n/a" in wait, talk, handled, miss % or logged-in cells is ignored, never turned into NaN or zero', async () => {
  // A handled call whose wait is "abc" and talk is "n/a" must be skipped by the averages: ASA stays 158 s / 15 = 11s, talk stays 2m 46s.
  const rows = h.standardQueueRows().concat([handledRow(10, 'Asha Rao', { wait: 'abc', talk: 'n/a', call: 'x', sl: '' })]);
  const ind = h.standardIndividual(); ind[0]['Handled calls'] = 'many'; ind[1]['Missed ring percentage'] = 'N/A'; ind[2]['Avg. handle time (hh:mm:ss)'] = 'abc';
  const prod = h.standardProductivity(); prod[0]['Logged in'] = 'abc';
  await p.withApp({ files: p.prodFiles({ queue: rows, individual: ind, productivity: prod }) }, async ({ page, errors }) => {
    const o = await p.overview(page, '#v-overview'); const s = p.soft();
    s.eq(o.mini.map(m => m.v), ['72.2%', '11s', '2m 46s'], 'service level / ASA / talk ignore the bad cells');
    s.eq(await p.badText(page), [], 'text showing NaN / undefined');
    s.eq(errors, [], 'page errors');
    s.done();
  });
});

test('text where a number belongs: a handled call with a bad wait still counts as handled, and the other averages ignore it', async () => {
  const rows = h.standardQueueRows().concat([handledRow(10, 'Asha Rao', { wait: 'abc', talk: 'n/a', sl: '' })]);
  await p.withApp({ files: p.prodFiles({ queue: rows, ...none }) }, async ({ page }) => {
    const o = await p.overview(page, '#v-overview'); const s = p.soft();
    s.eq(o.handled, '16', 'handled count');
    s.eq(o.mini.map(m => m.v), ['72.2%', '11s', '2m 46s'], 'SL / ASA / talk are unchanged by the bad row');
    s.done();
  });
});

test('a cell holding only spaces is treated as blank, not as zero seconds (ASA stays 11s)', async () => {
  const rows = h.standardQueueRows().concat([handledRow(10, 'Asha Rao', { wait: '  ', talk: ' ', sl: '' })]);
  await p.withApp({ files: p.prodFiles({ queue: rows, ...none }) }, async ({ page }) => {
    const o = await p.overview(page, '#v-overview');
    // 158 s over 15 timed calls = 10.5 -> 11s. Counting the spaces as 0 s gives 158 / 16 = 9.9 -> 10s.
    assert.deepEqual(o.mini.map(m => m.v).slice(1), ['11s', '2m 46s']);
  });
});

test('numbers written with thousands commas or a percent sign are read correctly (1,200 handled; 12.5%)', async () => {
  const ind = h.standardIndividual(); ind[0]['Handled calls'] = '1,200'; ind[0]['Missed ring percentage'] = '12.5%';
  await p.withApp({ files: p.prodFiles({ individual: ind }) }, async ({ page }) => {
    const row = (await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).find(r => r[0] === 'Asha Rao');
    assert.equal(row[1], '1,200'); assert.equal(row[6], '12.5%');
  });
});

test('a queue row with no time stamp is counted in Offered', { skip: 'QUESTION: the app silently leaves such a row out of every figure (no date means it cannot be placed in the range). Should the Data health card warn about rows with no time stamp?' }, async () => {
  const rows = h.standardQueueRows().concat([qOver({ 'Start time [US/Central]': '' })]);
  await p.withApp({ files: p.prodFiles({ queue: rows }) }, async ({ page }) => {
    assert.equal((await execTile(page, 'Offered')).value, '24');
  });
});

/* ================= no calls, one call ================= */

for (const [name, f] of [['a date range with no calls in it (Mar 10 to Mar 20)', { from: '2026-03-10', to: '2026-03-20' }], ['from-date after to-date', { from: '2026-03-05', to: '2026-03-01' }]]) {
  test(`zero calls (${name}): every screen shows zeros or dashes, no NaN, no errors`, async () => {
    await p.withApp({ filters: f }, async ({ page, errors, dialogs }) => {
      const s = p.soft();
      s.eq(await p.badText(page), [], 'text showing NaN / undefined / Infinity');
      s.eq(errors, [], 'page errors'); s.eq(dialogs, [], 'pop-ups');
      const t = await p.tiles(page, '#v-exec');
      s.eq([p.pick(t, 'Offered').value, p.pick(t, 'Handled').value, p.pick(t, 'Service level').value, p.pick(t, 'Missed (in-shift)').value, p.pick(t, 'Abandoned').value], ['0', '—', '—', '0', '0'], 'Executive tiles');
      s.done();
    });
  });
  test(`zero calls (${name}): Overview says 0 offered, 0 handled, 0 not answered, and nobody "exited the menu"`, async () => {
    await p.withApp({ filters: f }, async ({ page }) => {
      const o = await p.overview(page, '#v-overview'); const s = p.soft();
      s.eq(o.total, '0 queue calls', 'offered'); s.eq(o.handled, '0', 'handled'); s.eq(o.notAnswered, '0', 'not answered');
      s.eq(o.brk.map(b => b.v.split(' ')[0]), ['0', '0', '0', '0'], 'not-answered pieces');
      s.done();
    });
  });
  test(`zero calls (${name}): the Agent scorecard shows no handled calls, and the downloads say there is nothing to export`, async () => {
    await p.withApp({ filters: f }, async ({ page, dialogs }) => {
      const s = p.soft();
      const t = await p.tile(page, '#v-agents', 'Calls handled');
      s.eq(t ? t.value : '0', '0', 'Calls handled on the scorecard');
      await page.evaluate(() => { dlMissedCSV(); dlNoCallbackCSV(); });
      s.ok(dialogs.includes('No missed calls in the current filter range.'), 'missed calls message: ' + JSON.stringify(dialogs));
      s.done();
    });
  });
}

test('a single handled call: offered 1, handled 100.0%, service level 100.0%, one operating day, no NaN', async () => {
  const q = [handledRow(10, 'Asha Rao')];
  await p.withApp({ files: p.prodFiles({ queue: q, ...none }) }, async ({ page, errors }) => {
    const s = p.soft(); const o = await p.overview(page, '#v-overview');
    s.eq([(await execTile(page, 'Offered')).value, (await execTile(page, 'Handled')).value, (await execTile(page, 'Service level')).value], ['1', '100.0%', '100.0%'], 'Executive tiles');
    s.eq(o.total, '1 queue calls', 'overview total'); s.eq(o.meta.slice(1, 3), ['1 operating days', '≈ 1/day'], 'overview meta');
    s.eq(o.mini.map(m => m.v), ['100.0%', '5s', '1m 40s'], 'SL / ASA / talk');
    s.eq((await p.tile(page, '#v-volume', 'Busiest month')).foot, '1 calls', 'busiest month');
    s.eq(await p.badText(page), [], 'NaN text'); s.eq(errors, [], 'errors');
    s.done();
  });
});

test('a single abandoned call: handled 0.0%, abandoned 100.0%, average speed of answer and talk time show dashes', async () => {
  const q = [h.qRow({ start: '2026-03-02T10:00:00-06:00', outcome: 'abandoned', reason: 'caller hung up', sl: 'NO', wait: 30 })];
  await p.withApp({ files: p.prodFiles({ queue: q, ...none }) }, async ({ page, errors }) => {
    const s = p.soft(); const o = await p.overview(page, '#v-overview');
    s.eq([(await execTile(page, 'Handled')).value, (await execTile(page, 'Abandoned')).foot, (await execTile(page, 'Service level')).value], ['0.0%', '100.0%', '0.0%'], 'Executive tiles');
    s.eq(o.mini.map(m => m.v), ['0.0%', '—', '—'], 'SL / ASA / talk');
    s.eq(await p.badText(page), [], 'NaN text'); s.eq(errors, [], 'errors');
    s.done();
  });
});

/* ================= each file on its own ================= */

const SINGLE = [
  ['queue caller details', { ...noneExcept('queue') }, async (page, s) => { s.eq((await execTile(page, 'Offered')).value, '23', 'Offered'); s.eq((await execTile(page, 'Missed (in-shift)')).value, '0', 'no call log means 0 missed'); s.eq((await p.tile(page, '#v-voice', 'Calls analysed')), null, 'Voice shows its "not loaded" message'); }],
  ['call log (conversations)', { ...noneExcept('calls') }, async (page, s) => { s.eq((await execTile(page, 'Offered')).value, '0', 'Offered'); s.eq((await execTile(page, 'Missed (in-shift)')).value, '4', 'Missed (in-shift)'); s.eq((await p.tile(page, '#v-voice', 'Calls analysed')).value, '17', 'calls analysed'); }],
  ['agent productivity', { ...noneExcept('productivity') }, async (page, s) => { s.eq((await p.tile(page, '#v-agents', 'Agents logged in')).value, '3', 'agents on the scorecard (Billing Admin is a device line)'); }],
  ['individual performance', { ...noneExcept('individual') }, async (page, s) => { s.eq((await p.tile(page, '#v-agents', 'Calls handled')).value, '15', 'calls handled'); }],
  ['agent activity', { ...noneExcept('activity') }, async (page, s) => { s.eq(await page.evaluate(() => document.querySelector('#v-agents').textContent.includes('No agent data')), true, 'scorecard says there is no agent data'); }],
  ['pause usage', { ...noneExcept('pause') }, async (page, s) => { s.eq(await page.evaluate(() => document.querySelector('#v-agents').textContent.includes('No agent data')), true, 'scorecard says there is no agent data'); }],
  ['grouped by date', { ...noneExcept('byDate') }, async (page, s) => { s.eq((await execTile(page, 'Offered')).value, '0', 'Offered'); }],
];
function noneExcept(keep) { const o = { queue: null, calls: null, productivity: null, individual: null, activity: null, pause: null, byDate: null }; delete o[keep]; return o; }
for (const [label, set, extra] of SINGLE) {
  test(`only the ${label} file loaded: the report still opens, shows no NaN, and the figures it can make are right`, async () => {
    await p.withApp({ files: p.prodFiles(set) }, async ({ page, errors, dialogs }) => {
      const s = p.soft();
      s.eq(await p.badText(page), [], 'text showing NaN / undefined / Infinity');
      s.eq(errors, [], 'page errors'); s.eq(dialogs, [], 'pop-ups');
      s.ok(await page.isVisible('#v-report'), 'the Production report is showing');
      await extra(page, s);
      s.done();
    });
  });
}

/* ================= duplicates and split calls ================= */

test('duplicate rows: every queue row listed twice (same call id) counts each call once', async () => {
  const rows = h.standardQueueRows();
  await p.withApp({ files: p.prodFiles({ queue: rows.concat(rows) }) }, async ({ page }) => {
    const s = p.soft();
    s.eq((await execTile(page, 'Offered')).value, '23', 'Offered'); s.eq((await execTile(page, 'Handled')).foot, '15 calls', 'Handled');
    s.done();
  });
});

test('duplicate upload: loading the same files twice gives the same numbers, not doubled ones', async () => {
  await p.withApp(async ({ page }) => {
    await h.loadProduction(page, p.prodFiles());
    const s = p.soft();
    s.eq((await execTile(page, 'Offered')).value, '23', 'Offered'); s.eq((await p.tile(page, '#v-voice', 'Calls analysed')).value, '17', 'calls analysed');
    s.eq(await page.evaluate(() => document.querySelectorAll('#fileList .fl').length), 7, 'files listed');
    s.done();
  });
});

test('one call over several queue legs: the best result wins (handled beats abandoned beats outflowed) and each call counts once', async () => {
  const at = m => `2026-03-02T10:${String(m).padStart(2, '0')}:00-06:00`;
  const leg = (m, cid, o) => h.qRow(Object.assign({ start: at(m), cid }, o));
  const rows = [
    // A: abandoned first, then handled by Asha  -> handled
    leg(0, 'A', { outcome: 'abandoned', reason: 'caller hung up', sl: 'NO', wait: 20 }), leg(1, 'A', { agent: 'Asha Rao', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 8, talk: 90, ring: 3, call: 98 }),
    // B: outflowed first, then abandoned -> abandoned
    leg(5, 'B', { outcome: 'outflowed system', reason: 'queue overflow' }), leg(6, 'B', { outcome: 'abandoned', reason: 'caller hung up', sl: 'NO', wait: 30 }),
    // C: handled by Asha, then handled again by Ben (transfer) -> handled once, credited to the first
    leg(10, 'C', { agent: 'Asha Rao', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 60, ring: 3, call: 65 }), leg(12, 'C', { agent: 'Ben Cole', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 1, talk: 30, ring: 3, call: 31 }),
    // D: two no-agent legs in different queues -> one no-agent call
    leg(15, 'D', { outcome: 'outflowed system', reason: 'no agents - joined empty', queue: 'Main Line' }), leg(16, 'D', { outcome: 'outflowed system', reason: 'no agents - joined empty', queue: 'Billing' }),
  ];
  await p.withApp({ files: p.prodFiles({ queue: rows, ...none }) }, async ({ page }) => {
    const s = p.soft(); const o = await p.overview(page, '#v-overview');
    s.eq(o.total, '4 queue calls', 'offered = 4 calls (8 legs)');
    s.eq(o.legend, ['Handled 2 (50.0%)', 'No agent available 1 (25.0%)', 'Queue timeout 0 (0.0%)', 'Abandoned 1 (25.0%)', 'Caller exited (menu) 0 (0.0%)'], 'resolution');
    const sc = (await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).slice(2, -2);
    s.eq(sc.map(r => [r[0], r[1]]), [['Asha Rao', '2']], 'only Asha is credited (call C goes to the first leg)');
    s.done();
  });
});

test('a call that is handled in one queue leg is handled once even when the queue filter keeps only the other leg', async () => {
  const rows = [
    h.qRow({ start: '2026-03-02T10:00:00-06:00', cid: 'X', outcome: 'outflowed system', reason: 'queue overflow', queue: 'Main Line' }),
    h.qRow({ start: '2026-03-02T10:01:00-06:00', cid: 'X', agent: 'Cara Diaz', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 60, ring: 3, call: 65, queue: 'Billing' }),
  ];
  await p.withApp({ files: p.prodFiles({ queue: rows, ...none }), filters: { queue: 'Main Line' } }, async ({ page }) => {
    // With only the Main Line leg kept, the call was bounced out of Main Line: 1 offered, 0 handled. Billing: 1 offered, 1 handled.
    const s = p.soft();
    s.eq([(await execTile(page, 'Offered')).value, (await execTile(page, 'Handled')).foot], ['1', '0 calls'], 'Main Line');
    await p.setFilters(page, { queue: 'Billing' });
    s.eq([(await execTile(page, 'Offered')).value, (await execTile(page, 'Handled')).foot], ['1', '1 calls'], 'Billing');
    s.done();
  });
});

test('duplicate call-log rows (the same missed call listed twice) are counted once', { skip: 'QUESTION: the call log has no unique call id, so exact duplicate rows are all counted. Is de-duplication wanted?' }, async () => {
  const calls = h.standardCallLog(); calls.push(calls.find(r => r['Call Result'] === 'Missed Call'));
  await p.withApp({ files: p.prodFiles({ calls }) }, async ({ page }) => {
    assert.equal((await p.tile(page, '#v-coverage', 'Missed (inbound)')).value, '5');
  });
});

/* ================= unknown words, missing columns ================= */

test('unknown outcome words: "transferred" and a blank outcome are offered calls but not handled; "HANDLED " and " Abandoned" in other letter case / spacing still count', async () => {
  const rows = [
    qOver({ 'Outcome': 'HANDLED ', 'Left Queue Reason': 'agent answered', 'Met SL': 'YES', 'Wait time (s)': 5 }, { start: '2026-03-02T10:00:00-06:00' }),
    qOver({ 'Outcome': ' Abandoned', 'Left Queue Reason': 'caller hung up', 'Wait time (s)': 20 }, { start: '2026-03-02T10:10:00-06:00' }),
    qOver({ 'Outcome': 'transferred', 'Left Queue Reason': 'moved' }, { start: '2026-03-02T10:20:00-06:00' }),
    qOver({ 'Outcome': '', 'Left Queue Reason': '' }, { start: '2026-03-02T10:30:00-06:00' }),
  ];
  await p.withApp({ files: p.prodFiles({ queue: rows, ...none }) }, async ({ page, errors }) => {
    const s = p.soft();
    s.eq([(await execTile(page, 'Offered')).value, (await execTile(page, 'Handled')).foot, (await execTile(page, 'Abandoned')).value], ['4', '1 calls', '1'], 'offered / handled / abandoned');
    s.eq(errors, [], 'page errors');
    s.done();
  });
});

test('unknown outcome words are shown as their own group on Overview, not as "Caller exited (menu)"', { skip: 'QUESTION: Overview gets "Caller exited (menu)" by subtraction (offered - handled - no agent - timeout - abandoned), so any unknown outcome word ("transferred", blank...) is labelled as a caller who exited the menu.' }, async () => {
  const rows = [qOver({ 'Outcome': 'transferred', 'Left Queue Reason': 'moved' }, { start: '2026-03-02T10:20:00-06:00' })];
  await p.withApp({ files: p.prodFiles({ queue: rows, ...none }) }, async ({ page }) => {
    const o = await p.overview(page, '#v-overview');
    assert.ok(o.legend.some(l => /^Caller exited \(menu\) 0/.test(l)));
  });
});

test('reason and Met-SL words in other letter case ("No Agents - Joined Empty", "yes") count like the exact words', { skip: 'QUESTION: Outcome is matched ignoring letter case, but "Left Queue Reason" and "Met SL" must match exactly. Is the phone system always consistent?' }, async () => {
  const rows = [
    qOver({ 'Outcome': 'outflowed system', 'Left Queue Reason': 'No Agents - Joined Empty' }, { start: '2026-03-02T10:00:00-06:00' }),
    qOver({ 'Outcome': 'handled', 'Left Queue Reason': 'agent answered', 'Met SL': 'yes', 'Wait time (s)': 4 }, { start: '2026-03-02T11:00:00-06:00', agent: 'Asha Rao' }),
  ];
  await p.withApp({ files: p.prodFiles({ queue: rows, ...none }) }, async ({ page }) => {
    assert.equal((await execTile(page, 'No-agent (in-shift)')).value, '1');
    assert.equal((await execTile(page, 'Service level')).value, '100.0%');
  });
});

test('missing optional columns: a queue file with only time, queue, outcome, reason and wait still gives offered, handled, abandoned and ASA; service level and talk show dashes', async () => {
  const head = ['Start time [US/Central]', 'Queue', 'Outcome', 'Left Queue Reason', 'Wait time (s)'];
  const rows = [
    { 'Start time [US/Central]': '2026-03-02T10:00:00-06:00', Queue: 'Main Line', Outcome: 'handled', 'Left Queue Reason': 'agent answered', 'Wait time (s)': 10 },
    { 'Start time [US/Central]': '2026-03-02T10:10:00-06:00', Queue: 'Main Line', Outcome: 'handled', 'Left Queue Reason': 'agent answered', 'Wait time (s)': 20 },
    { 'Start time [US/Central]': '2026-03-02T10:20:00-06:00', Queue: 'Main Line', Outcome: 'abandoned', 'Left Queue Reason': 'caller hung up', 'Wait time (s)': 40 },
  ];
  await p.withApp({ files: [h.csvFile('queue-caller-details.csv', rows, head)] }, async ({ page, errors, dialogs }) => {
    const s = p.soft(); const o = await p.overview(page, '#v-overview');
    s.eq([(await execTile(page, 'Offered')).value, (await execTile(page, 'Handled')).value, (await execTile(page, 'Abandoned')).value], ['3', '66.7%', '1'], 'Executive tiles');
    s.eq(o.mini.map(m => m.v), ['—', '15s', '—'], 'SL / ASA / talk');
    s.eq(await p.badText(page), [], 'NaN text'); s.eq(errors, [], 'errors'); s.eq(dialogs, [], 'pop-ups');
    s.done();
  });
});

test('missing optional columns: a call log with only date, direction, result and AI summary still draws every screen', async () => {
  const head = ['Date [America/Chicago]', 'Direction', 'Call Result', 'AI Summary'];
  const rows = [
    { 'Date [America/Chicago]': '2026-03-02T10:00:00-06:00', Direction: 'Inbound', 'Call Result': 'Missed Call', 'AI Summary': '' },
    { 'Date [America/Chicago]': '2026-03-02T11:00:00-06:00', Direction: 'Inbound', 'Call Result': 'Ended successfully', 'AI Summary': 'Booked a visit.' },
  ];
  await p.withApp({ files: [h.csvFile('call-report-conversations.csv', rows, head)] }, async ({ page, errors, dialogs }) => {
    const s = p.soft();
    s.eq(await p.badText(page), [], 'NaN text'); s.eq(errors, [], 'errors'); s.eq(dialogs, [], 'pop-ups');
    s.eq((await execTile(page, 'Missed (in-shift)')).value, '1', 'Missed (in-shift)');
    s.done();
  });
});

test('calls with no duration are not counted as "under 30 seconds" in the call length distribution', async () => {
  const calls = [
    h.cRow({ date: '2026-03-02T10:00:00-06:00', dur: '' }), h.cRow({ date: '2026-03-02T10:10:00-06:00', dur: '' }), h.cRow({ date: '2026-03-02T10:20:00-06:00', dur: 20000 }), h.cRow({ date: '2026-03-02T10:30:00-06:00', dur: 90000 }),
  ];
  await p.withApp({ files: p.prodFiles({ calls }) }, async ({ page }) => {
    const rows = await p.barsAt(page, '#v-insights', 'Call length distribution');
    assert.equal(rows.find(r => r.k === 'Under 30s').v, '1', 'only the 20-second call is under 30 seconds: ' + JSON.stringify(rows));
  });
});

test('sentiment: calls the AI could not rate ("Unavailable" or blank) are left out of the positive / neutral / negative shares', async () => {
  const mk = (min, sent) => h.cRow({ date: `2026-03-02T10:${String(min).padStart(2, '0')}:00-06:00`, sent });
  const calls = [mk(0, 'Positive'), mk(1, 'Negative'), mk(2, 'Neutral'), mk(3, 'Neutral'), mk(4, 'Unavailable'), Object.assign(mk(5, ''), { Sentiment: '' })];
  await p.withApp({ files: p.prodFiles({ calls }) }, async ({ page }) => {
    const t = await p.tiles(page, '#v-voice');
    // 4 rated calls: positive 25.0%, negative 25.0%, neutral 50.0%. All 6 calls are "analysed".
    assert.deepEqual([p.pick(t, 'Calls analysed').value, p.pick(t, 'Positive').value, p.pick(t, 'Negative').value, p.pick(t, 'Neutral').value], ['6', '25.0%', '25.0%', '50.0%']);
  });
});

/* ================= names ================= */

test('very long names: a 250-character agent name, a 200-character queue name and a 300-character caller text do not break any screen and are not cut off in the CSV files', async () => {
  const agent = 'Alexandria ' + 'Q'.repeat(239), queue = 'Q-' + 'L'.repeat(198), from = '+1' + '9'.repeat(298);
  const rows = [h.qRow({ start: '2026-03-02T10:00:00-06:00', agent, queue, outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 60, ring: 3, call: 65 })];
  const calls = [h.cRow({ date: '2026-03-02T10:30:00-06:00', dir: 'Inbound', res: 'Missed Call', from, dur: 9000 })];
  const ind = [{ 'Agent name': agent, 'Handled calls': 1, 'Avg. handle time (hh:mm:ss)': '00:04:00', 'Avg. wrap up time (hh:mm:ss)': '00:00:30', 'Avg. hold time (hh:mm:ss)': '00:01:00', 'Hold count': 1, 'Transfers': 0, 'Missed ring attempts': 0, 'Missed ring percentage': '0', 'Avg. ring time (millis)': 4000, 'Total talk time (hh:mm:ss)': '00:04:00', 'Workload (hh:mm:ss)': '00:05:00' }];
  await p.withApp({ files: p.prodFiles({ queue: rows, calls, individual: ind, productivity: null, activity: null, pause: null, byDate: null }) }, async ({ page, errors }) => {
    const s = p.soft();
    s.eq(errors, [], 'page errors'); s.eq(await p.badText(page), [], 'NaN text');
    s.eq((await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).slice(2)[0][0], agent, 'scorecard shows the whole name');
    s.eq(await page.evaluate(() => [...document.querySelectorAll('#fQueue option')].map(o => o.value)), ['', queue], 'queue list holds the whole queue name');
    const sc = await h.download(page, () => page.click('#v-report button:has-text("⬇ CSV")'));
    s.eq(h.parseCSVText(sc.text)[1][0], agent, 'scorecard CSV name');
    const ms = await h.download(page, () => page.click('#v-report button:has-text("Download full list")'));
    s.eq(h.parseCSVText(ms.text)[1][0], from, 'missed CSV caller text');
    s.done();
  });
});

test('names containing < > & are shown exactly as written on the scorecard, the missed-call log and the negative-call list', async () => {
  const agent = 'Ann <i>Lee</i> & Co', from = '<b>555</b> & more';
  const rows = [h.qRow({ start: '2026-03-02T10:00:00-06:00', agent, outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 60, ring: 3, call: 65 })];
  const calls = [h.cRow({ date: '2026-03-02T10:30:00-06:00', dir: 'Inbound', res: 'Missed Call', from, dur: 9000 }),
    h.cRow({ date: '2026-03-02T10:40:00-06:00', dir: 'Inbound', from, sent: 'Negative', sum: 'The caller was unhappy about the long wait.' })];
  await p.withApp({ files: p.prodFiles({ queue: rows, calls, individual: null, productivity: null, activity: null, pause: null, byDate: null }) }, async ({ page, errors }) => {
    const s = p.soft();
    s.eq((await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).slice(2)[0][0], agent, 'scorecard name');
    s.eq(await page.evaluate(() => { const t = document.querySelector('#v-coverage .grid3 + .card table tbody tr td:nth-child(2)'); return t ? t.textContent : null; }), from, 'missed-call log number');
    s.eq(await page.evaluate(() => { const t = document.querySelector('#v-voice .convo .from'); return t ? t.textContent.split(' Negative')[0].trim() : null; }), from, 'negative call list number');
    s.eq(errors, [], 'page errors');
    s.done();
  });
});

/* ================= shift hours ================= */

test('shift start equal to shift end: no call is "in shift", windows are empty, nothing shows NaN or breaks', async () => {
  await p.withApp({ filters: { shiftStart: 12, shiftEnd: 12 } }, async ({ page, errors }) => {
    const s = p.soft();
    s.eq([(await execTile(page, 'No-agent (in-shift)')).value, (await execTile(page, 'Missed (in-shift)')).value, (await execTile(page, 'Service level')).value], ['0', '0', '—'], 'in-shift tiles');
    s.eq((await execTile(page, 'Offered')).value, '23', 'offered is not affected by the shift');
    s.eq(await p.badText(page), [], 'NaN text'); s.eq(errors, [], 'errors');
    s.done();
  });
});

test('a shift of 12 AM to 11 PM (wide open) makes every call in-shift: no-agent 4, service level on all 18 verdicts', async () => {
  // all four no-agent calls count (incl. the 7 AM one); SL: the 13 YES + 5 NO verdicts are all in shift anyway
  await p.withApp({ filters: { shiftStart: 0, shiftEnd: 23 } }, async ({ page }) => {
    const s = p.soft();
    s.eq((await execTile(page, 'No-agent (in-shift)')).value, '4', 'no-agent in shift'); s.eq((await execTile(page, 'Service level')).value, '72.2%', 'service level');
    s.eq((await p.tile(page, '#v-coverage', 'No agent (in-shift)')).foot, 'during staffed hours', 'nothing excluded');
    s.done();
  });
});

/* ================= agents in only some files, device lines ================= */

test('an agent who is in only one file: Dina (queue only), Eli (individual only) and Gus (productivity only) each get a scorecard row', async () => {
  const rows = h.standardQueueRows().concat([handledRow(10, 'Dina Ford', { cid: 'd1' }), handledRow(11, 'Dina Ford', { cid: 'd2' })]);
  const ind = h.standardIndividual().concat([Object.assign({}, h.standardIndividual()[0], { 'Agent name': 'Eli Park', 'Handled calls': 6 })]);
  const prod = h.standardProductivity().concat([{ 'Agent name': 'Gus Lee', '# of queues': 1, 'Logged in': '8:00:00', 'Available': '3:00:00', 'Working': '5:00:00', 'Paused': '0:00:00', 'Utilization': '100', 'Occupancy': '62.5' }]);
  await p.withApp({ files: p.prodFiles({ queue: rows, individual: ind, productivity: prod }) }, async ({ page }) => {
    const s = p.soft();
    const sc = (await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).slice(2).filter(r => !['Total', 'Average'].includes(r[0]));
    s.eq(sc.map(r => [r[0], r[1]]), [['Asha Rao', '7'], ['Eli Park', '6'], ['Ben Cole', '5'], ['Cara Diaz', '3'], ['Dina Ford', '2'], ['Gus Lee', '0']], 'rows and handled calls');
    s.eq(sc.find(r => r[0] === 'Dina Ford').slice(2, 4), ['—', '—'], 'Dina has no AHT or holds (not in the individual file)');
    const k = await p.tile(page, '#v-agents', 'Agents logged in');
    s.eq([k.value, k.foot], ['6', '5 handled ≥1 call · 1 took none'], 'agents logged in tile');
    s.done();
  });
});

test('the note "Why this is N agents but Overview says M" quotes the number Overview really shows', async () => {
  // Gus is logged in but took no calls, so the note appears. Overview counts agents from the queue file (Asha, Ben, Cara, Dina = 4).
  const rows = h.standardQueueRows().concat([handledRow(10, 'Dina Ford', { cid: 'd1' })]);
  const ind = h.standardIndividual().concat([Object.assign({}, h.standardIndividual()[0], { 'Agent name': 'Eli Park', 'Handled calls': 6 })]);
  const prod = h.standardProductivity().concat([{ 'Agent name': 'Gus Lee', '# of queues': 1, 'Logged in': '8:00:00', 'Available': '3:00:00', 'Working': '5:00:00', 'Paused': '0:00:00', 'Utilization': '100', 'Occupancy': '62.5' }]);
  await p.withApp({ files: p.prodFiles({ queue: rows, individual: ind, productivity: prod }) }, async ({ page }) => {
    const note = await page.evaluate(() => (document.querySelector('#v-agents').textContent.replace(/\s+/g, ' ').match(/Why this is (\d+) agents but Overview says (\d+)/) || []).slice(1).map(Number));
    const hero = (await p.overview(page, '#v-overview')).meta[3];
    assert.equal(note[1], Number(hero.match(/^(\d+)/)[1]), `note says Overview shows ${note[1]} agents, Overview shows "${hero}"`);
  });
});

test('"Asha Rao (on Yealink T54)" in the queue file is Asha Rao, not a device line', async () => {
  const rows = [handledRow(9, 'Asha Rao', { cid: 'a1' }), handledRow(10, 'Asha Rao (on Yealink T54)', { cid: 'a2' })];
  await p.withApp({ files: p.prodFiles({ queue: rows, ...none }) }, async ({ page }) => {
    const sc = (await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).slice(2).filter(r => !['Total', 'Average'].includes(r[0]));
    assert.deepEqual(sc.map(r => [r[0], r[1]]), [['Asha Rao', '2']]);
  });
});

const DEVICES = ['Yealink T54', 'Front Desk', 'Billing Admin', 'Billing Department', 'Manager Line', '101 Lobby phone', '2nd floor'];
function deviceQueue() {
  const rows = [handledRow(9, 'Asha Rao', { cid: 'r1' }), handledRow(10, 'Asha Rao', { cid: 'r2' })];
  DEVICES.forEach((d, i) => rows.push(handledRow(11 + (i % 5), d, { cid: 'dev' + i })));
  return rows;
}
test('device lines (Yealink, Front Desk, Billing Admin, Billing Department, manager line, names starting with a number) are left out of agent figures, but their calls still count in the call totals', async () => {
  await p.withApp({ files: p.prodFiles({ queue: deviceQueue(), ...none }) }, async ({ page }) => {
    const s = p.soft(); const o = await p.overview(page, '#v-overview');
    s.eq([(await execTile(page, 'Offered')).value, (await execTile(page, 'Handled')).foot], ['9', '9 calls'], 'all 9 calls are offered and handled');
    s.eq(o.meta[3], '1 agents handled calls', 'agents on Overview');
    s.eq((await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).slice(2).filter(r => !['Total', 'Average'].includes(r[0])).map(r => r[0]), ['Asha Rao'], 'scorecard rows');
    s.eq(await page.evaluate(() => [...document.querySelectorAll('#fAgent option')].map(o => o.value)), ['', 'Asha Rao'], 'agent drop-down');
    s.done();
  });
});

test('"Include device lines" on: every device line that handled calls appears on the scorecard with a "device" tag', async () => {
  await p.withApp({ files: p.prodFiles({ queue: deviceQueue(), ...none }), filters: { devices: true } }, async ({ page }) => {
    const sc = (await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).slice(2).filter(r => !['Total', 'Average'].includes(r[0]));
    const names = sc.map(r => r[0].replace(/\s*device$/, '')).sort();
    assert.deepEqual(names, ['Asha Rao'].concat(DEVICES).sort());
    assert.ok(sc.filter(r => /device$/.test(r[0])).length === DEVICES.length, 'each device row is tagged');
  });
});

test('"Include device lines" on: "Billing Admin" (logged in 72 hours, no calls) from the productivity file shows on the scorecard', async () => {
  // The scorecard text says a line logged in for hundreds of hours at 0% occupancy is a device and can be hidden "with the toggle up top".
  await p.withApp({ filters: { devices: true } }, async ({ page }) => {
    const names = (await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).slice(2).map(r => r[0].replace(/\s*device$/, ''));
    assert.ok(names.includes('Billing Admin'), 'rows: ' + names.join(' | '));
  });
});

test('"Include device lines" off then on then off returns the scorecard to exactly where it started', async () => {
  await p.withApp({ files: p.prodFiles({ queue: deviceQueue(), ...none }) }, async ({ page }) => {
    const a = await p.tableAt(page, '#v-agents', 'Per-agent scorecard');
    await p.setFilters(page, { devices: true }); await p.setFilters(page, { devices: false });
    assert.deepEqual(await p.tableAt(page, '#v-agents', 'Per-agent scorecard'), a);
  });
});

test('agents with the same name in different letter case ("asha rao" and "Asha Rao") are one agent', { skip: 'QUESTION: names are matched exactly (only trimmed). A lower-case spelling in another export would show as a second agent.' }, async () => {
  const ind = h.standardIndividual(); ind[0]['Agent name'] = 'asha rao';
  await p.withApp({ files: p.prodFiles({ individual: ind }) }, async ({ page }) => {
    assert.equal((await p.tile(page, '#v-agents', 'Agents logged in')).value, '3');
  });
});

/* ================= day names in a US time zone ================= */

for (const tz of ['America/Chicago', 'America/Los_Angeles']) {
  test(`day names (${tz} viewer): Mar 2 is shown as Mon, Mar 3 as Tue, Mar 4 as Wed in every by-day table`, async () => {
    await p.withApp({ timezoneId: tz, files: p.weekdayFiles(), filters: { groupBy: 'day' } }, async ({ page }) => {
      const s = p.soft();
      s.eq((await p.stackRows(page, '#v-coverage')).map(r => r.d), ['Mar 2Mon', 'Mar 3Tue', 'Mar 4Wed'], 'Coverage by day');
      s.eq((await p.tableAt(page, '#v-coverage', 'In-shift missed calls by')).slice(1, -1).map(r => r[0]), ['Mar 2 Mon', 'Mar 3 Tue', 'Mar 4 Wed'], 'In-shift missed by day');
      s.eq((await p.tableAt(page, '#v-coverage', 'No-agent calls by')).slice(1, -1).map(r => r[0]), ['Mar 2 Mon', 'Mar 4 Wed'], 'No-agent by day');
      s.eq((await p.tableAt(page, '#v-coverage', 'Missed calls by day and 2-hour window')).slice(1, -1).map(r => r[0]), ['Mar 2 Mon', 'Mar 3 Tue', 'Mar 4 Wed'], 'Missed by day and window');
      s.done();
    });
  });
}
