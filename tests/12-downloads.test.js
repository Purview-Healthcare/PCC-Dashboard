'use strict';
/*
 * CSV downloads: Missed calls, No-callback list, Agent scorecard.
 * Each file is opened with the app's own buttons, parsed, and compared with the made-up data and with what the screen shows.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const p = require('./prod-helpers');

after(() => h.closeBrowser());

const MISSED_HEAD = ['Phone number', 'Date', 'Time (CT)', 'Ring (sec)', 'Ring (mm:ss)', 'Called back?', 'Callback date/time (CT)'];
const SCORE_HEAD = ['Agent', 'Present days', 'Handled', 'AHT', 'Miss %', 'Avg ring (s)', 'Holds', 'Avg hold', 'Logged in', 'Working', 'Paused', 'Utilisation %', 'Occupancy %', 'Status'];

const BTN = {
  missed: '#v-report button:has-text("Download full list")',
  noCallback: '#v-report button:has-text("Download no-callback list")',
  scorecard: '#v-report button:has-text("⬇ CSV")',
};
async function grab(page, which) { const d = await h.download(page, () => page.click(BTN[which])); return { name: d.name, raw: d.text, rows: h.parseCSVText(d.text) }; }

/* Standard data, worked out by hand. Missed inbound calls sorted by date/time; ring = call duration in seconds. */
const STD_MISSED = [
  ['+13125550150', '2026-03-02', '12:05', '20.0', '0:20', 'Yes', '2026-03-02 12:35'],
  ['+13125550151', '2026-03-03', '13:05', '15.0', '0:15', 'No', ''],
  ['+13125550154', '2026-03-04', '08:05', '10.0', '0:10', 'No', ''],
  ['+13125550153', '2026-03-04', '12:05', '30.0', '0:30', 'No', ''],
  ['+13125550155', '2026-03-07', '11:05', '12.0', '0:12', 'No', ''],
];
const STD_SCORE = [
  ['Asha Rao', '3', '7', '4:00', '12.5', '4.0', '2', '1:00', '24:00:00', '16:00:00', '2:00:00', '91.7', '66.7', 'Off target'],
  ['Ben Cole', '3', '5', '6:30', '37.5', '4.0', '2', '1:00', '30:00:00', '15:00:00', '10:00:00', '66.7', '50.0', 'Off target'],
  ['Cara Diaz', '2', '3', '3:30', '0.0', '4.0', '2', '1:00', '16:00:00', '11:00:00', '1:00:00', '93.8', '68.8', 'On target'],
];

/* ================= Missed calls ================= */

test('Missed calls CSV: file name, Excel-safe start mark, header and the 5 missed inbound calls in time order with ring time and callback', async () => {
  await p.withApp(async ({ page }) => {
    const d = await grab(page, 'missed'); const s = p.soft();
    s.eq(d.name, 'missed_calls.csv', 'file name');
    s.ok(d.raw.charCodeAt(0) === 0xFEFF, 'file starts with the byte-order mark so Excel reads it as UTF-8');
    s.eq(d.rows[0], MISSED_HEAD, 'header');
    s.eq(d.rows.slice(1), STD_MISSED, 'rows');
    s.done();
  });
});

test('Missed calls CSV: row count equals the "Missed (inbound)" count on screen, and "Yes" rows equal the "Called back" count on screen', async () => {
  await p.withApp(async ({ page }) => {
    const d = await grab(page, 'missed'); const s = p.soft();
    const screenMissed = Number((await p.tile(page, '#v-coverage', 'Missed (inbound)')).value);
    const screenBack = Number((await p.tile(page, '#v-coverage', 'Called back')).value);
    s.eq(screenMissed, d.rows.length - 1, '"Missed (inbound)" tile vs rows in the file');
    s.eq(screenBack, d.rows.slice(1).filter(r => r[5] === 'Yes').length, '"Called back" tile vs "Yes" rows in the file');
    s.done();
  });
});

test('Missed calls CSV: only calls inside the chosen dates (Mar 3 to Mar 4 gives 3 rows)', async () => {
  await p.withApp({ filters: { from: '2026-03-03', to: '2026-03-04' } }, async ({ page }) => {
    const d = await grab(page, 'missed');
    assert.deepEqual(d.rows.slice(1).map(r => r[0]), ['+13125550151', '+13125550154', '+13125550153']);
    assert.ok(d.rows.slice(1).every(r => r[1] >= '2026-03-03' && r[1] <= '2026-03-04'));
  });
});

test('Missed calls CSV: a date range with no missed calls shows the message "No missed calls in the current filter range." and downloads nothing', async () => {
  await p.withApp({ filters: { from: '2026-03-05', to: '2026-03-06' } }, async ({ page, dialogs }) => {
    let downloaded = false; page.on('download', () => { downloaded = true; });
    await page.evaluate(() => dlMissedCSV()); await page.waitForTimeout(500);
    assert.deepEqual(dialogs, ['No missed calls in the current filter range.']);
    assert.equal(downloaded, false);
  });
});

test('Missed calls CSV: the queue and shift filters do not hide missed calls (the call log has no queue and the list covers all hours)', async () => {
  await p.withApp({ filters: { queue: 'Billing', shiftStart: 13, shiftEnd: 14 } }, async ({ page }) => {
    const d = await grab(page, 'missed');
    assert.equal(d.rows.length - 1, 5);
  });
});

test('Missed calls CSV: the callback date/time on the screen and in the file agree (callback started 12:35, 30 minutes after the miss)', async () => {
  await p.withApp(async ({ page }) => {
    const d = await grab(page, 'missed');
    const row = d.rows.find(r => r[0] === '+13125550150');
    const execDelay = (await p.tile(page, '#v-exec', 'Avg time to call back')).value;   // minutes:seconds
    const [mm, ss] = execDelay.split(':').map(Number);
    // file: miss 12:05, callback 12:35 -> 30 minutes
    assert.equal(row[6], '2026-03-02 12:35');
    assert.equal(mm * 60 + ss, 30 * 60, `screen says ${execDelay} but the file puts the callback 30 minutes after the miss`);
  });
});

test('Missed calls CSV: a missed call across the November clock change is "called back" in both the file and on the screen', async () => {
  // 1 Nov 2026 the clocks go back at 2 AM. Miss at 01:30 CDT (-05:00); the callback starts 01:10 CST (-06:00) = 40 real minutes later.
  const calls = [
    h.cRow({ date: '2026-11-01T01:30:00-05:00', dir: 'Inbound', res: 'Missed Call', from: '+13125550149', dur: 20000 }),
    h.cRow({ date: '2026-11-01T01:10:00-06:00', end: '2026-11-01T01:15:00-06:00', dir: 'Outbound', res: 'Ended successfully', from: 'Ben Cole', parts: 'Ben Cole, +13125550149' }),
  ];
  await p.withApp({ files: [h.csvFile('call-report-conversations.csv', calls, h.HEAD.conversations)] }, async ({ page }) => {
    const screen = (await p.tile(page, '#v-exec', 'Avg time to call back')).foot;
    const d = await grab(page, 'missed');
    assert.equal(screen, '1 called back', 'screen');
    assert.equal(d.rows[1][5], 'Yes', 'file says "Called back?" = ' + d.rows[1][5]);
  });
});

/* ================= No-callback list ================= */

test('No-callback CSV: same header, the 4 missed calls nobody called back, all marked "No", file name no_callback_list.csv', async () => {
  await p.withApp(async ({ page }) => {
    const d = await grab(page, 'noCallback'); const s = p.soft();
    s.eq(d.name, 'no_callback_list.csv', 'file name');
    s.eq(d.rows[0], MISSED_HEAD, 'header');
    s.eq(d.rows.slice(1), STD_MISSED.filter(r => r[5] === 'No'), 'rows');
    s.done();
  });
});

test('No-callback CSV: row count equals the "missed calls had no callback" figure on Executive summary', async () => {
  await p.withApp(async ({ page }) => {
    const d = await grab(page, 'noCallback');
    const txt = await page.evaluate(() => document.querySelector('#v-exec').textContent.replace(/\s+/g, ' '));
    assert.equal(d.rows.length - 1, Number(txt.match(/([\d,]+) missed calls had no callback/)[1]));
  });
});

test('No-callback CSV: respects the date range (Mar 4 only gives the 2 Wednesday misses)', async () => {
  await p.withApp({ filters: { from: '2026-03-04', to: '2026-03-04' } }, async ({ page }) => {
    const d = await grab(page, 'noCallback');
    assert.deepEqual(d.rows.slice(1).map(r => r[0]), ['+13125550154', '+13125550153']);
  });
});

test('No-callback CSV: when every missed call was called back it says so and downloads nothing', async () => {
  // only the Monday miss (which was called back) is in range
  await p.withApp({ filters: { from: '2026-03-02', to: '2026-03-02' } }, async ({ page, dialogs }) => {
    let downloaded = false; page.on('download', () => { downloaded = true; });
    await page.evaluate(() => dlNoCallbackCSV()); await page.waitForTimeout(500);
    assert.deepEqual(dialogs, ['No missed calls without a callback in range.']);
    assert.equal(downloaded, false);
  });
});

/* ================= Agent scorecard ================= */

test('Scorecard CSV: file name, header and one row per agent with the same figures as the screen (formatted as hours:minutes:seconds)', async () => {
  await p.withApp(async ({ page }) => {
    const d = await grab(page, 'scorecard'); const s = p.soft();
    s.eq(d.name, 'agent_scorecard.csv', 'file name');
    s.eq(d.rows[0], SCORE_HEAD, 'header');
    s.eq(d.rows.slice(1), STD_SCORE, 'rows');
    s.done();
  });
});

test('Scorecard CSV: every row matches the same agent row on screen (handled, present days, miss %, status)', async () => {
  await p.withApp(async ({ page }) => {
    const d = await grab(page, 'scorecard');
    const screen = (await p.tableAt(page, '#v-agents', 'Per-agent scorecard')).slice(2).filter(r => !['Total', 'Average'].includes(r[0]));
    const s = p.soft();
    s.eq(d.rows.length - 1, screen.length, 'row count');
    d.rows.slice(1).forEach(r => {
      const sr = screen.find(x => x[0] === r[0]);
      s.ok(!!sr, 'agent missing on screen: ' + r[0]); if (!sr) return;
      s.eq([r[2], r[1], r[4] + '%', r[13]], [sr[1], sr[9], sr[6], sr[16]], 'handled / present days / miss % / status for ' + r[0]);
    });
    s.done();
  });
});

test('Scorecard CSV: follows the agent filter (only Asha Rao) and leaves out device lines unless the toggle is on', async () => {
  const q = h.standardQueueRows().concat([h.qRow({ start: '2026-03-03T10:20:00-06:00', agent: 'Front Desk', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 100, ring: 3, call: 105 })]);
  await p.withApp({ files: p.prodFiles({ queue: q }) }, async ({ page }) => {
    const s = p.soft();
    s.eq((await grab(page, 'scorecard')).rows.slice(1).map(r => r[0]), ['Asha Rao', 'Ben Cole', 'Cara Diaz'], 'devices off');
    await p.setFilters(page, { devices: true });
    s.ok((await grab(page, 'scorecard')).rows.slice(1).some(r => r[0] === 'Front Desk'), 'devices on shows Front Desk');
    await p.setFilters(page, { devices: false, agent: 'Asha Rao' });
    s.eq((await grab(page, 'scorecard')).rows.slice(1).map(r => r[0]), ['Asha Rao'], 'agent filter');
    s.done();
  });
});

test('Scorecard CSV: handled counts follow the date range the same way the screen does', async () => {
  await p.withApp({ filters: { from: '2026-03-02', to: '2026-03-03' } }, async ({ page }) => {
    const d = await grab(page, 'scorecard');
    const overviewHandled = Number((await p.overview(page, '#v-overview')).handled);
    const total = d.rows.slice(1).reduce((a, r) => a + Number(r[2]), 0);
    assert.equal(total, overviewHandled, `file adds up to ${total} handled calls, Overview shows ${overviewHandled}`);
  });
});

/* ================= odd values ================= */

test('Missed calls CSV: phone/caller text with commas, quotes and line breaks comes back unchanged and does not break the rows', async () => {
  const odd = ['Smith, Pat "PJ"', 'Line one\nline two', 'plain; semicolon', '"quoted"', ' leading and trailing '];
  const calls = odd.map((f, i) => h.cRow({ date: `2026-03-02T1${i}:05:00-06:00`, dir: 'Inbound', res: 'Missed Call', from: f, dur: 12000 }));
  await p.withApp({ files: p.prodFiles({ calls }) }, async ({ page }) => {
    const d = await grab(page, 'missed');
    assert.equal(d.rows.length - 1, odd.length, 'one row per missed call');
    assert.ok(d.rows.every(r => r.length === MISSED_HEAD.length), 'every row has 7 cells: ' + d.rows.map(r => r.length).join(','));
    assert.deepEqual(d.rows.slice(1).map(r => r[0]), odd.map(x => x.trim()));   // the app trims names it reads
  });
});

test('Scorecard CSV: agent names with a comma, a quote or a line break come back unchanged, one row each', async () => {
  const names = ['Diaz, Cara "CJ"', 'Lee\nJordan', 'O\'Neil & Sons'];
  const q = names.map((n, i) => h.qRow({ start: `2026-03-02T1${i}:15:00-06:00`, agent: n, outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 100, ring: 4, call: 105 }));
  const ind = names.map(n => ({ 'Agent name': n, 'Handled calls': 1, 'Avg. handle time (hh:mm:ss)': '00:04:00', 'Avg. wrap up time (hh:mm:ss)': '00:00:30', 'Avg. hold time (hh:mm:ss)': '00:01:00', 'Hold count': 1, 'Transfers': 0, 'Missed ring attempts': 0, 'Missed ring percentage': '0', 'Avg. ring time (millis)': 4000, 'Total talk time (hh:mm:ss)': '00:04:00', 'Workload (hh:mm:ss)': '00:05:00' }));
  await p.withApp({ files: p.prodFiles({ queue: q, individual: ind, productivity: null, activity: null, pause: null, byDate: null }) }, async ({ page }) => {
    const d = await grab(page, 'scorecard');
    assert.equal(d.rows.length - 1, names.length);
    assert.ok(d.rows.every(r => r.length === SCORE_HEAD.length), 'cells per row: ' + d.rows.map(r => r.length).join(','));
    assert.deepEqual(d.rows.slice(1).map(r => r[0]).sort(), names.slice().sort());
  });
});

test('Missed calls CSV: a value with a lone carriage return stays inside one quoted cell', async () => {
  const calls = [h.cRow({ date: '2026-03-02T10:05:00-06:00', dir: 'Inbound', res: 'Missed Call', from: 'A\rB', dur: 12000 })];
  await p.withApp({ files: p.prodFiles({ calls }) }, async ({ page }) => {
    const d = await grab(page, 'missed');
    assert.ok(/"A\rB"/.test(d.raw), 'the value is not quoted in the file: ' + JSON.stringify(d.raw.split('\n')[1]));
  });
});

test('all three CSV files never contain NaN, undefined or null, even with blank and text values in the data', async () => {
  const calls = h.standardCallLog().concat([
    h.cRow({ date: '2026-03-03T10:05:00-06:00', dir: 'Inbound', res: 'Missed Call', from: '', dur: '' }),
    h.cRow({ date: '2026-03-03T11:05:00-06:00', dir: 'Inbound', res: 'Missed Call', from: '+13125550190', dur: 'long' }),
  ]);
  const ind = h.standardIndividual(); ind[0]['Avg. handle time (hh:mm:ss)'] = 'n/a'; ind[1]['Missed ring percentage'] = ''; ind[2]['Avg. ring time (millis)'] = 'abc';
  await p.withApp({ files: p.prodFiles({ calls, individual: ind }) }, async ({ page }) => {
    const s = p.soft();
    for (const w of ['missed', 'noCallback', 'scorecard']) {
      const d = await grab(page, w);
      s.ok(!/NaN|undefined|null|Infinity/.test(d.raw), w + ' contains a bad value: ' + (d.raw.match(/.{0,30}(NaN|undefined|null|Infinity).{0,30}/) || [''])[0]);
    }
    s.done();
  });
});

test('Missed calls CSV: a missed call with no caller number or no ring time still gets its own row with empty cells', async () => {
  const calls = [
    h.cRow({ date: '2026-03-02T10:05:00-06:00', dir: 'Inbound', res: 'Missed Call', from: '', dur: '' }),
    h.cRow({ date: '2026-03-02T11:05:00-06:00', dir: 'Inbound', res: 'Missed Call', from: '+13125550190', dur: 8000 }),
  ];
  await p.withApp({ files: p.prodFiles({ calls }) }, async ({ page }) => {
    const d = await grab(page, 'missed');
    assert.deepEqual(d.rows.slice(1), [['', '2026-03-02', '10:05', '', '', 'No', ''], ['+13125550190', '2026-03-02', '11:05', '8.0', '0:08', 'No', '']]);
  });
});
