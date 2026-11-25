'use strict';
/*
 * Uploads and recovery: odd files, wrong files, the Excel reader missing, uploading twice, replacing a period,
 * every order of QA and production, and awkward file contents.
 * Made-up data only. "The person is told" means: the page shows a pop-up message or a visible note in the file list.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

const E = h.EXPECT_QUEUE;
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const putProd = async (page, files) => { await page.setInputFiles('#fileInput', files); await settle(page); };
const putQA = async (page, file) => { await page.setInputFiles('#fileInputQ', file); await settle(page, 700); };

/** Everything the screen currently holds that this file cares about. */
const state = page => page.evaluate(() => ({
  ds: Object.keys(DS).sort(),
  qa: DS.quality ? DS.quality.length : 0,
  qaHasAgentNameColumn: DS.quality ? DS.quality.every(r => 'Agent Name' in r) : true,
  filter: { from: FILTER.from, to: FILTER.to, queue: FILTER.queue, agent: FILTER.agent },
  fFrom: document.getElementById('fFrom').value, fTo: document.getElementById('fTo').value,
  fileList: [...document.querySelectorAll('#fileList .fl')].map(d => ({ kind: d.querySelector('b').textContent.trim(), text: d.querySelector('.meta span').textContent.trim(), bad: d.querySelector('.dot').classList.contains('no') })),
  fileListHasMarkup: !!document.querySelector('#fileList .fl .meta span *'),
  queues: [...document.querySelectorAll('#fQueue option')].map(o => o.textContent),
  agents: [...document.querySelectorAll('#fAgent option')].map(o => o.textContent),
  chips: document.getElementById('headMeta').innerText.replace(/\s+/g, ' '),
  preLoad: document.querySelector('.shell').classList.contains('pre-load'),
  broken: [...document.querySelectorAll('.view .empty h3')].map(e => e.textContent).filter(t => /Couldn.t render/.test(t)),
  core: Object.keys(DS).includes('queueDetails') ? (() => { const m = coreMetrics(); return { total: m.total, handled: m.handled, aband: m.aband }; })() : null,
}));
const BAD_WORDS = /not recogni|wrong|empty|unreadable|can.?t read|couldn.?t|not a |no rows|no data|unsupported|missing/i;
/** Was the person told something is off? (a pop-up, or a flagged line in the file list) */
const wasTold = async (page, dialogs) => dialogs.length > 0 || (await state(page)).fileList.some(f => f.bad || BAD_WORDS.test(f.kind + ' ' + f.text));
const qaLoaded = page => page.evaluate(() => (DS.quality || []).length);
const goodQueueFile = () => h.csvFile('queue-caller-details.csv', h.standardQueueRows(), h.HEAD.queueDetails);

/* ================================================================ files that are empty, header-only or unknown */
test('an empty file in the production box does not break the page and the person is told', async () => {
  const { page, context, errors, dialogs } = await h.openApp();
  await putProd(page, h.rawFile('queue-caller-details.csv', ''));
  const s = await state(page);
  assert.deepEqual(errors, []);
  assert.equal(s.preLoad, true, 'still on the upload page, nothing half-drawn');
  assert.ok(await wasTold(page, dialogs), 'no message at all was shown for an empty file');
  await context.close();
});

test('a file that has only the column names and no rows does not break the page and the person is told', async () => {
  const { page, context, errors, dialogs } = await h.openApp();
  await putProd(page, h.csvFile('queue-caller-details.csv', [], h.HEAD.queueDetails));
  assert.deepEqual(errors, []);
  assert.equal((await state(page)).preLoad, true);
  assert.ok(await wasTold(page, dialogs), 'no message for a header-only file');
  await context.close();
});

test('a header-only file dropped after good data does not wipe the good data', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  await putProd(page, h.csvFile('queue-caller-details.csv', [], h.HEAD.queueDetails));
  const s = await state(page);
  assert.equal(s.core.total, E.offered, 'the good queue data is still there');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a CSV the app has never heard of is listed as "Not recognised" and nothing else changes', async () => {
  const { page, context, errors } = await h.openApp();
  await putProd(page, h.csvFile('mystery.csv', [{ Colour: 'red', Size: '3' }, { Colour: 'blue', Size: '4' }]));
  const s = await state(page);
  assert.deepEqual(s.ds, []);
  assert.equal(s.fileList.length, 1);
  assert.equal(s.fileList[0].kind, 'Not recognised');
  assert.equal(s.preLoad, true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a non-CSV file in box 1 (text, picture, Excel) gets a pop-up message and is not read', async () => {
  const { page, context, errors, dialogs } = await h.openApp();
  await putProd(page, [h.rawFile('notes.txt', 'hello', 'text/plain')]);
  assert.equal(dialogs.length, 1); assert.match(dialogs[0], /\.csv/);
  await putProd(page, [h.rawFile('photo.png', Buffer.from([137, 80, 78, 71]), 'image/png')]);
  assert.equal(dialogs.length, 2);
  await putProd(page, [h.qaXlsxFile()]);
  assert.equal(dialogs.length, 3);
  const s = await state(page);
  assert.deepEqual(s.ds, []); assert.equal(s.fileList.length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a mix of good and non-CSV files in box 1 still loads the good ones', async () => {
  const { page, context } = await h.openApp();
  await putProd(page, [goodQueueFile(), h.rawFile('notes.txt', 'hello', 'text/plain')]);
  const s = await state(page);
  assert.equal(s.core && s.core.total, E.offered);
  await context.close();
});

/* ================================================================ the wrong file in the wrong box */
test('a production CSV dropped in the QA box is refused: the person is told and no QA data appears', async () => {
  const { page, context, dialogs } = await h.openApp();
  await putQA(page, goodQueueFile());
  assert.equal(await qaLoaded(page), 0, 'the phone-system file became "QA audits"');
  assert.ok(await wasTold(page, dialogs), 'the person was not told');
  await context.close();
});

test('a production CSV dropped in the QA box does not replace a good QA sheet that is already loaded', async () => {
  const { page, context, dialogs } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile());
  assert.equal(await qaLoaded(page), 8);
  await putQA(page, goodQueueFile());
  assert.equal(await qaLoaded(page), 8, 'good QA data was replaced by the phone file');
  assert.ok(await wasTold(page, dialogs));
  await context.close();
});

test('any CSV with no "Agent Name" column dropped in the QA box is refused', async () => {
  const { page, context, dialogs } = await h.openApp();
  await putQA(page, h.csvFile('roster.csv', [{ Name: 'Asha Rao', Phone: '312-555-0101' }, { Name: 'Ben Cole', Phone: '312-555-0102' }]));
  assert.equal(await qaLoaded(page), 0, 'a name list became "QA audits"');
  assert.ok(await wasTold(page, dialogs));
  await context.close();
});

test('an empty CSV in the QA box does not break the page and the person is told', async () => {
  const { page, context, errors, dialogs } = await h.openApp();
  await putQA(page, h.rawFile('qa.csv', ''));
  assert.equal(await qaLoaded(page), 0);
  assert.deepEqual(errors, [], 'the page threw an error');
  assert.ok(await wasTold(page, dialogs), 'no message for an empty QA file');
  await context.close();
});

test('a header-only CSV (column names, no audits) in the QA box does not break the page and the person is told', async () => {
  const { page, context, errors, dialogs } = await h.openApp();
  await putQA(page, h.csvFile('qa.csv', [], h.QA_HEAD));
  assert.equal(await qaLoaded(page), 0);
  assert.deepEqual(errors, []);
  assert.ok(await wasTold(page, dialogs), 'no message for a QA file with no audits');
  await context.close();
});

test('an empty QA CSV dropped after a good QA sheet does not wipe it or crash', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile());
  await putQA(page, h.rawFile('qa.csv', ''));
  assert.equal(await qaLoaded(page), 8, 'good audits lost');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a QA CSV dropped in the production box is not read as phone data, existing production data stays, and the person is told', async () => {
  const { page, context, errors, dialogs } = await h.openApp();
  await h.loadProduction(page);
  await putProd(page, h.qaCsvFile());
  const s = await state(page);
  assert.equal(s.core.total, E.offered, 'production data changed');
  assert.equal(s.qa, 0, 'a QA file in box 1 must not quietly become QA data either');
  assert.ok(await wasTold(page, dialogs));
  assert.deepEqual(errors, []);
  await context.close();
});

test('wrong file in the QA box, then the right QA file: the right data ends up loaded', async () => {
  const { page, context, errors } = await h.openApp();
  await putQA(page, goodQueueFile());
  await putQA(page, h.qaCsvFile());
  assert.equal(await qaLoaded(page), 8);
  const t = await page.evaluate(() => { const R = qualRows(); return R.reduce((s, r) => s + r._score, 0) / R.length; });
  assert.ok(Math.abs(t - h.EXPECT_QA.avgScore) < 0.01);
  assert.deepEqual(errors, []);
  await context.close();
});

test('wrong file in the production box, then the right files: numbers are right and the wrong file no longer clutters the list', { todo: 'QUESTION: should a rejected file still be listed as "Not recognised" after the right files arrive? (the list only ever grows)' }, async () => {});

test('wrong file in the production box, then the right files: all numbers are right', async () => {
  const { page, context, errors } = await h.openApp();
  await putProd(page, h.csvFile('mystery.csv', [{ Colour: 'red' }]));
  await putProd(page, h.standardProductionFiles());
  const s = await state(page);
  assert.equal(s.core.total, E.offered); assert.equal(s.core.handled, E.handled);
  assert.equal(s.preLoad, false);
  assert.deepEqual(errors, []);
  await context.close();
});

/* ================================================================ Excel files */
test('an Excel file whose tabs have the wrong names but holds the audit table still loads the 8 audits, or says clearly why not', async () => {
  const { page, context, dialogs } = await h.openApp();
  await putQA(page, h.qaXlsxFile(null, { sheetName: 'Sheet1' }));
  const n = await qaLoaded(page);
  const s = await state(page);
  assert.ok(s.qaHasAgentNameColumn, 'rows were built from a tab that has no "Agent Name" column (the Scoring Key tab was read as audits)');
  assert.ok(n === 8 || dialogs.length > 0, 'neither loaded the audits nor told the person (loaded ' + n + ')');
  await context.close();
});

test('an Excel file with no audit tab at all (only unrelated tabs) is refused with a message and loads nothing', async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Colour', 'Size'], ['red', 3], ['blue', 4]]), 'Stuff');
  const file = { name: 'other.xlsx', mimeType: 'application/octet-stream', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) };
  const { page, context, errors, dialogs } = await h.openApp();
  await putQA(page, file);
  assert.equal(await qaLoaded(page), 0, 'unrelated rows were loaded as audits');
  assert.ok(await wasTold(page, dialogs));
  assert.deepEqual(errors.filter(e => !/Failed to load/.test(e)), []);
  await context.close();
});

test('a damaged "Excel" file gives a clear message and the page keeps working', async () => {
  const { page, context, dialogs } = await h.openApp();
  await putQA(page, { name: 'broken.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('this is not a zip file at all') });
  assert.equal(await qaLoaded(page), 0);
  assert.ok(dialogs.length > 0, 'no message for a damaged workbook');
  // the page still works afterwards
  await putQA(page, h.qaCsvFile());
  assert.equal(await qaLoaded(page), 8);
  await context.close();
});

test('an Excel file with no Scoring Key tab uses the built-in key (3 fatal parameters)', async () => {
  const { page, context, dialogs } = await h.openApp();
  await h.loadQuality(page, h.qaXlsxFile(null, { noKey: true }));
  assert.equal(await qaLoaded(page), 8);
  const fatal = await page.evaluate(() => [...QFATAL].sort());
  assert.deepEqual(fatal, ['Call resolution achieved', 'Correct appointment handling', 'Correct information shared']);
  const avg = await page.evaluate(() => { const R = qualRows(); return R.reduce((s, r) => s + r._score, 0) / R.length; });
  assert.ok(Math.abs(avg - 72.5) < 0.01);
  assert.deepEqual(dialogs, []);
  await context.close();
});

/** a Scoring Key where "Dead air management" is fatal, "Correct information shared" is not, and two weights change (total still 100) */
function changedKey() {
  return h.QA_PARAMS.map(([c, n, w, st]) => {
    if (n === 'Dead air management') return [c, n, w, 'Fatal Error'];
    if (n === 'Correct information shared') return [c, n, w, 'Non Fatal Error'];
    if (n === 'Recap & next steps') return [c, n, 8, st];          // 3 -> 8
    if (n === 'Escalation protocol followed') return [c, n, 0, st]; // 5 -> 0
    return [c, n, w, st];
  });
}

test('a Scoring Key with a different fatal list and weights changes which errors are fatal and how blank scores are worked out', async () => {
  const rows = [
    h.qaRow({ agent: 'Asha Rao', score: '', missed: ['Dead air management'] }),        // now fatal -> 0
    h.qaRow({ agent: 'Ben Cole', score: '', missed: ['Correct information shared'] }), // now non-fatal -> 100-10 = 90
    h.qaRow({ agent: 'Cara Diaz', score: '', missed: ['Recap & next steps'] }),        // weight 8 -> 92
    h.qaRow({ agent: 'Dev Patel', score: '', missed: ['Escalation protocol followed'] }), // weight 0 -> 100
  ];
  const { page, context, errors } = await h.openApp();
  await h.loadQuality(page, h.qaXlsxFile(rows, { params: changedKey() }));
  const r = await page.evaluate(() => ({ s: qualRows().map(x => [x._agent, x._score, x._fatal.length, x._nonfatal.length]), fatal: [...QFATAL].sort() }));
  assert.deepEqual(r.fatal, ['Call resolution achieved', 'Correct appointment handling', 'Dead air management']);
  assert.deepEqual(r.s, [['Asha Rao', 0, 1, 0], ['Ben Cole', 90, 0, 1], ['Cara Diaz', 92, 0, 1], ['Dev Patel', 100, 0, 1]]);
  await h.show(page, 'quality');
  const t = await h.tableAfterTitle(page, 'quality', 'By parameter');
  assert.deepEqual(t.find(x => x[0].startsWith('Dead air management')).slice(1, 4), ['Fatal', '5', '1']);
  assert.deepEqual(t.find(x => x[0].startsWith('Correct information shared')).slice(1, 4), ['Non-fatal', '10', '1']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('uploading a workbook without a Scoring Key after one that had a changed key goes back to the built-in key', async () => {
  const { page, context } = await h.openApp();
  await putQA(page, h.qaXlsxFile([h.qaRow({ score: '' })], { params: changedKey(), name: 'with-key.xlsx' }));
  assert.ok(await page.evaluate(() => isFatal('Dead air management')));
  await putQA(page, h.qaXlsxFile([h.qaRow({ score: '', missed: ['Dead air management'] })], { noKey: true, name: 'no-key.xlsx' }));
  const r = await page.evaluate(() => ({ fatal: isFatal('Dead air management'), score: qualRows()[0]._score }));
  assert.equal(r.fatal, false, '"Dead air management" is still fatal from the previous workbook\'s key');
  assert.equal(r.score, 95);
  await context.close();
});

test('uploading a CSV QA sheet after a workbook with a changed key goes back to the built-in key', async () => {
  const { page, context } = await h.openApp();
  await putQA(page, h.qaXlsxFile([h.qaRow({ score: '' })], { params: changedKey(), name: 'with-key.xlsx' }));
  await putQA(page, h.qaCsvFile([h.qaRow({ score: '', missed: ['Dead air management'] })]));
  assert.equal(await page.evaluate(() => isFatal('Dead air management')), false, 'old key still applied to a CSV that carries no key');
  await context.close();
});

test('Excel reader unavailable: a clear message, no QA data, and the page keeps working (CSV QA and production still load)', async () => {
  const { page, context, errors, dialogs } = await h.openApp({ xlsx: 'fail' });
  await putQA(page, h.qaXlsxFile());
  assert.ok(dialogs.some(d => /Excel reader/i.test(d)), 'message mentions the Excel reader: ' + JSON.stringify(dialogs));
  assert.ok(dialogs.some(d => /CSV/i.test(d)), 'message says what to do instead (save as CSV)');
  assert.equal(await qaLoaded(page), 0);
  // everything else still works
  await h.loadProduction(page);
  assert.equal((await state(page)).core.total, E.offered);
  await h.loadQuality(page, h.qaCsvFile());
  assert.equal(await qaLoaded(page), 8);
  assert.deepEqual(errors.filter(e => !/Failed to load|net::/.test(e)), []);
  await context.close();
});

test('Excel reader unavailable, then available again later: a second try works', async () => {
  // first request for the reader fails, later ones are served
  let n = 0;
  const { page, context } = await h.openApp({ xlsx: 'local', beforeLoad: async (pg, ctx) => {
    await ctx.unroute(/^https?:\/\//);
    await ctx.route(/^https?:\/\//, route => {
      const url = route.request().url();
      if (/xlsx\.full\.min\.js/.test(url)) { n++; return n === 1 ? route.abort() : route.fulfill({ path: h.ROOT + '/node_modules/xlsx/dist/xlsx.full.min.js', contentType: 'application/javascript' }); }
      return route.abort();
    });
  } });
  await putQA(page, h.qaXlsxFile());
  assert.equal(await qaLoaded(page), 0);
  await putQA(page, h.qaXlsxFile());
  assert.equal(await qaLoaded(page), 8, 'second attempt, once the reader can be fetched, should work');
  await context.close();
});

/* ================================================================ unreadable files (the browser could not read the file) */
const breakReading = (word) => async (pg) => {
  await pg.addInitScript(w => {
    const a = FileReader.prototype.readAsText, b = FileReader.prototype.readAsArrayBuffer;
    const fail = function () { const self = this; setTimeout(() => { const ev = new Event('error'); if (self.onerror) self.onerror(ev); self.dispatchEvent(ev); }, 0); };
    FileReader.prototype.readAsText = function (f) { return f.name.includes(w) ? fail.call(this) : a.call(this, f); };
    FileReader.prototype.readAsArrayBuffer = function (f) { return f.name.includes(w) ? fail.call(this) : b.call(this, f); };
  }, word);
};

test('a production file the browser cannot read: the person is told, and the other files in the same drop still load', async () => {
  const { page, context, dialogs } = await h.openApp({ beforeLoad: breakReading('unreadable') });
  await putProd(page, [h.csvFile('unreadable-queue.csv', h.standardQueueRows(), h.HEAD.queueDetails), h.csvFile('pause-usage.csv', h.standardPause(), h.HEAD.pause)]);
  const s = await state(page);
  assert.ok(s.ds.includes('pause') && !s.preLoad, 'the readable file was never shown because its neighbour failed (the page stays on the upload screen)');
  assert.ok(dialogs.length > 0 || s.fileList.some(f => f.bad), 'no message about the unreadable file');
  await context.close();
});

test('a QA file the browser cannot read: the person is told and existing QA data stays', async () => {
  const { page, context, dialogs } = await h.openApp({ beforeLoad: breakReading('unreadable') });
  await h.loadQuality(page, h.qaCsvFile());
  await putQA(page, h.qaCsvFile(null, 'unreadable-qa.csv'));
  assert.equal(await qaLoaded(page), 8);
  assert.ok(dialogs.length > 0, 'no message about the unreadable QA file');
  await context.close();
});

/* ================================================================ same file twice, replacing a period */
test('the same production files uploaded twice give the same numbers and the file list does not double', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  const a = await state(page);
  await putProd(page, h.standardProductionFiles());
  const b = await state(page);
  assert.equal(b.core.total, E.offered, 'calls were counted twice');
  assert.equal(b.core.handled, E.handled);
  assert.deepEqual(b.fileList, a.fileList); assert.equal(b.fileList.length, 7);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the same QA file uploaded twice still shows 8 audits and the same average', async () => {
  const { page, context } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile());
  await putQA(page, h.qaCsvFile());
  assert.equal(await qaLoaded(page), 8);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#fileList .fl').length), 1);
  await context.close();
});

/** A second, different period: April, one queue, one agent. Works out by hand: 4 calls, 3 handled, 1 abandoned. */
function aprilFiles(prefix = 'april-') {
  const q = [
    h.qRow({ start: '2026-04-06T10:15:00-05:00', queue: 'Spring Desk', agent: 'Dan Reyes', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 100, ring: 3, call: 105 }),
    h.qRow({ start: '2026-04-06T11:15:00-05:00', queue: 'Spring Desk', agent: 'Dan Reyes', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 6, talk: 110, ring: 3, call: 116 }),
    h.qRow({ start: '2026-04-06T13:15:00-05:00', queue: 'Spring Desk', agent: 'Dan Reyes', outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 7, talk: 120, ring: 3, call: 127 }),
    h.qRow({ start: '2026-04-07T14:20:00-05:00', queue: 'Spring Desk', outcome: 'abandoned', reason: 'caller hung up', sl: 'NO', wait: 50 }),
  ];
  const c = [h.cRow({ date: '2026-04-06T10:05:00-05:00', res: 'Missed Call', from: '+13125550177', dur: 9000 }), h.cRow({ date: '2026-04-07T10:05:00-05:00' })];
  const prod = [{ 'Agent name': 'Dan Reyes', '# of queues': 1, 'Logged in': '8:00:00', 'Available': '2:00:00', 'Working': '5:00:00', 'Paused': '1:00:00', 'Utilization': '87.5', 'Occupancy': '62.5' }];
  const ind = [{ 'Agent name': 'Dan Reyes', 'Handled calls': 3, 'Avg. handle time (hh:mm:ss)': '00:02:00', 'Avg. wrap up time (hh:mm:ss)': '00:00:20', 'Avg. hold time (hh:mm:ss)': '00:00:30', 'Hold count': 1, 'Transfers': 0, 'Missed ring attempts': 0, 'Missed ring percentage': '0', 'Avg. ring time (millis)': 3000, 'Total talk time (hh:mm:ss)': '00:06:00', 'Workload (hh:mm:ss)': '00:07:00' }];
  const act = [{ 'User Name': 'Dan Reyes', 'Start Time': '2026-04-06T09:00:00-05:00', 'Superstate': 'Working', 'Substate': 'Talking', 'Duration': '05:00:00' }];
  const pause = [{ 'Agent name': 'Dan Reyes', 'Pause reason': 'Break', 'Pause Duration (hh:mm:ss)': '01:00:00', 'Pause Count': 2 }];
  const byDate = [{ 'Start time [US/Central]': '2026-04-06T00:00:00-05:00', 'End time': '2026-04-06T23:59:59-05:00', 'Total calls count': 3, 'Handled count': 3, 'Abandoned count': 0, 'Outflowed system count': 0, 'Average speed of answer (s)': 6, 'Longest wait for answer (s)': 7, 'Met SL %': '100' }];
  return [h.csvFile(prefix + 'queue.csv', q, h.HEAD.queueDetails), h.csvFile(prefix + 'calls.csv', c, h.HEAD.conversations), h.csvFile(prefix + 'productivity.csv', prod, h.HEAD.productivity),
    h.csvFile(prefix + 'individual.csv', ind, h.HEAD.individual), h.csvFile(prefix + 'activity.csv', act, h.HEAD.activity), h.csvFile(prefix + 'pause.csv', pause, h.HEAD.pause), h.csvFile(prefix + 'by-date.csv', byDate, h.HEAD.byDate)];
}

test('a second upload for a different period replaces the first: numbers, date range and date boxes show only the new period', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  await putProd(page, aprilFiles());
  const s = await state(page);
  assert.equal(s.core.total, 4, 'calls offered'); assert.equal(s.core.handled, 3); assert.equal(s.core.aband, 1);
  assert.deepEqual([s.filter.from, s.filter.to], ['2026-04-06', '2026-04-07']);
  assert.deepEqual([s.fFrom, s.fTo], ['2026-04-06', '2026-04-07']);
  assert.match(s.chips, /Apr 6 – Apr 7/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a second upload for a different period: the queue and agent drop-downs list only the new queues and agents', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page);
  await putProd(page, aprilFiles());
  const s = await state(page);
  assert.deepEqual(s.queues, ['All queues', 'Spring Desk']);
  assert.deepEqual(s.agents, ['All agents', 'Dan Reyes']);
  await context.close();
});

test('a second upload for a different period: nothing from the old period is left on the production report', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page);
  await putProd(page, aprilFiles());
  const text = await page.evaluate(() => document.getElementById('v-report').innerText);
  assert.doesNotMatch(text, /Asha Rao|Ben Cole|Cara Diaz|Mar 2/, 'the old period is still on the report');
  await context.close();
});

test('a second upload for a different period: the file list shows only the files now in use', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page);
  await putProd(page, aprilFiles());
  const s = await state(page);
  assert.deepEqual(s.fileList.map(f => f.text.split(' · ')[0]).sort(), aprilFiles().map(f => f.name).sort(), 'old files are still listed next to the new ones');
  await context.close();
});

test('replacing the period while a queue and agent filter are chosen does not leave a hidden filter that empties the new data', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page);
  await page.selectOption('#fQueue', 'Billing');
  await page.selectOption('#fAgent', 'Cara Diaz');
  await putProd(page, aprilFiles());
  const s = await state(page);
  assert.equal(s.core.total, 4, 'queue "Billing" / agent filter from the old data is still applied to the new data (drop-downs say All)');
  assert.equal(await page.inputValue('#fQueue'), '');
  assert.equal(s.filter.queue, '');
  await context.close();
});

test('replacing the QA sheet with one for another client does not leave the old client filter on (new audits are shown)', async () => {
  const { page, context } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile());
  await h.show(page, 'quality');
  await page.locator('#v-quality .qsticky label', { hasText: 'Client' }).locator('select').selectOption('Client One');
  const spring = [h.qaRow({ agent: 'Dan Reyes', client: 'Client Two', doa: '2026-04-07', doc: '2026-04-06' }), h.qaRow({ agent: 'Eli Stone', client: 'Client Two', doa: '2026-04-08', doc: '2026-04-07' })];
  await putQA(page, h.qaCsvFile(spring, 'april-qa.csv'));
  const r = await page.evaluate(() => ({ n: DS.quality.length, shown: qualRows().length, filter: QFILTER.client, text: document.getElementById('v-quality').innerText }));
  assert.equal(r.n, 2);
  assert.equal(r.shown, 2, 'old "Client One" filter hides every new audit');
  assert.doesNotMatch(r.text, /No audits match/);
  await context.close();
});

test('replacing the QA sheet fully replaces the old audits (nothing from the first sheet is left)', async () => {
  const { page, context } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile());
  const next = [h.qaRow({ agent: 'Dan Reyes', doa: '2026-04-07', doc: '2026-04-06' })];
  await putQA(page, h.qaCsvFile(next, 'april-qa.csv'));
  await h.show(page, 'quality');
  const r = await page.evaluate(() => ({ n: DS.quality.length, text: document.getElementById('v-quality').innerText, files: [...document.querySelectorAll('#fileList .fl')].length }));
  assert.equal(r.n, 1);
  assert.doesNotMatch(r.text, /Asha Rao|Ben Cole|Cara Diaz/);
  assert.equal(r.files, 1, 'the first QA file is still listed');
  await context.close();
});

test('uploading only one new production file for a different period leaves the other files from the old period mixed in', { todo: 'QUESTION: when only the queue file is replaced, the call log, productivity, activity etc. from the old period stay loaded. Is a mixed-period report wanted, or should the person be warned?' }, async () => {});

/* ================================================================ QA and production in every order */
test('QA only: the QA report shows, the production sections say nothing is loaded, no section breaks', async () => {
  const { page, context, errors, dialogs } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile());
  const s = await state(page);
  assert.equal(s.qa, 8); assert.deepEqual(s.broken, []);
  assert.equal(await page.evaluate(() => document.querySelector('.view.active').id), 'v-quality');
  assert.match(s.chips, /Quality: 8 audits/);
  await h.show(page, 'insights');
  const cards = await page.evaluate(() => document.querySelectorAll('#v-insights .ai-card').length);
  assert.equal(cards, 3, 'one insight card per QA agent even with no phone data');
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  await context.close();
});

test('production only: the production report shows and the QA tab invites the person to load a QA file', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  assert.equal(await page.evaluate(() => document.querySelector('.view.active').id), 'v-report');
  await h.show(page, 'quality');
  assert.match(await page.evaluate(() => document.getElementById('v-quality').innerText), /No quality file loaded/);
  assert.deepEqual((await state(page)).broken, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('QA first, then production: both reports are complete and correct', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile());
  await h.loadProduction(page);
  const s = await state(page);
  assert.equal(s.qa, 8); assert.equal(s.core.total, E.offered); assert.deepEqual(s.broken, []);
  assert.match(s.chips, /Quality: 8 audits/); assert.match(s.chips, /7 \/ 9 files/);
  assert.deepEqual(s.fileList.length, 8);
  assert.deepEqual(errors, []);
  await context.close();
});

test('production first, then QA: both reports are complete and correct', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  await h.loadQuality(page, h.qaXlsxFile());
  const s = await state(page);
  assert.equal(s.qa, 8); assert.equal(s.core.total, E.offered); assert.deepEqual(s.broken, []);
  assert.equal(s.fileList.length, 8);
  await h.show(page, 'quality');
  assert.equal((await h.kpi(page, 'quality', 'Audits')).value, '8');
  assert.deepEqual(errors, []);
  await context.close();
});

test('production files dropped one at a time give the same final numbers as all together', async () => {
  const { page, context } = await h.openApp();
  for (const f of h.standardProductionFiles()) await putProd(page, [f]);
  const s = await state(page);
  assert.equal(s.core.total, E.offered); assert.equal(s.core.handled, E.handled);
  assert.equal(s.fileList.length, 7);
  await context.close();
});

/* ================================================================ awkward file contents */
const asText = rows => h.toCSV(rows, h.HEAD.queueDetails);

test('a production file with a byte-order mark, with LF-only line ends and with CRLF all read the same', async () => {
  const text = asText(h.standardQueueRows());
  const variants = {
    plain: Buffer.from(text), bom: Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text)]),
    lf: Buffer.from(text.replace(/\r\n/g, '\n')), noFinalNewline: Buffer.from(text.replace(/\r\n$/, '')),
  };
  for (const [name, buf] of Object.entries(variants)) {
    const { page, context, errors } = await h.openApp();
    await putProd(page, h.rawFile('queue.csv', buf));
    const s = await state(page);
    assert.equal(s.core && s.core.total, E.offered, name + ': offered');
    assert.equal(s.core.handled, E.handled, name + ': handled');
    assert.deepEqual(s.fileList.map(f => f.kind), ['Queue caller detail'], name);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('a QA file with a byte-order mark, LF-only lines and a last line with no line break still has 8 audits', async () => {
  const text = h.toCSV(h.standardQARows(), h.QA_HEAD);
  for (const buf of [Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text)]), Buffer.from(text.replace(/\r\n/g, '\n')), Buffer.from(text.replace(/\r\n$/, ''))]) {
    const { page, context } = await h.openApp();
    await putQA(page, h.rawFile('qa.csv', buf));
    assert.equal(await qaLoaded(page), 8);
    assert.equal(await page.evaluate(() => qualRows()[0]._agent), 'Asha Rao', 'first column name must not carry the invisible byte-order mark');
    await context.close();
  }
});

test('quoted commas, quotes and line breaks inside cells do not split rows (agent "Rao, Asha", queue with a comma, a note with a new line)', async () => {
  const rows = h.standardQueueRows();
  rows[0]['Agent Name'] = 'Rao, Asha'; rows[0]['Queue'] = 'Main, "Front" Line';
  rows[1]['Queue'] = 'Main\nLine';
  const { page, context, errors } = await h.openApp();
  await putProd(page, h.csvFile('queue.csv', rows, h.HEAD.queueDetails));
  const s = await state(page);
  assert.equal(s.core.total, E.offered, 'row count survives commas and new lines in cells');
  assert.ok(s.queues.includes('Main, "Front" Line'), 'queue names: ' + JSON.stringify(s.queues));
  assert.ok(s.agents.includes('Rao, Asha'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('QA comments with commas, quotes and new lines stay in one audit', async () => {
  const rows = h.standardQARows(); rows[0].comments = 'x';
  rows[0]['Comments'] = 'Caller said "thanks", then\r\nhung up, politely';
  rows[3]['Comments'] = 'a,b,c';
  const { page, context } = await h.openApp();
  await putQA(page, h.qaCsvFile(rows));
  assert.equal(await qaLoaded(page), 8);
  assert.equal(await page.evaluate(() => DS.quality[0]['Comments'].replace(/\r/g, '')), 'Caller said "thanks", then\nhung up, politely');
  await context.close();
});

test('blank lines and extra empty columns at the end of a production file are ignored', async () => {
  const text = asText(h.standardQueueRows()).replace(/\r\n/g, ',,,\r\n') + '\r\n\r\n,,,,,,,,,,,\r\n';
  const { page, context } = await h.openApp();
  await putProd(page, h.rawFile('queue.csv', text));
  const s = await state(page);
  assert.equal(s.core.total, E.offered);
  await context.close();
});

test('file names with odd characters are shown as plain text, never as page markup', async () => {
  const names = ['<b>x</b>.csv', 'a&b "quoted".csv', "o'neil <i>.csv", '<img src=x onerror=window.__pwned=1>.csv'];
  for (const name of names) {
    const { page, context, errors } = await h.openApp();
    await putProd(page, h.csvFile(name, [{ Colour: 'red' }]));
    const s = await state(page);
    assert.equal(s.fileList.length, 1, name);
    assert.equal(s.fileListHasMarkup, false, 'file name "' + name + '" was written into the page as markup');
    assert.ok(s.fileList[0].text.startsWith(name), 'shown name: ' + s.fileList[0].text);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'a file name ran code');
    await context.close();
  }
});

test('a QA file with an odd name is shown as plain text in the file list', async () => {
  const { page, context } = await h.openApp();
  await putQA(page, h.qaCsvFile(null, '<b>qa</b>.csv'));
  const s = await state(page);
  assert.equal(s.fileListHasMarkup, false);
  assert.ok(s.fileList[0].text.startsWith('<b>qa</b>.csv'));
  await context.close();
});

test('odd text inside a QA sheet (angle brackets, quotes) is shown as text and does not run', async () => {
  const rows = [h.qaRow({ agent: '<b>Zed</b>', client: '<i>Cl</i>', sup: "O'Neil \"Q\"", auditor: 'A&B', missed: ['Call ownership'], reb: 'Yes', rebReason: '<script>window.__pwned=1</script>', rebStatus: 'Pending' })];
  const { page, context, errors } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile(rows));
  await h.show(page, 'quality');
  await page.evaluate(() => { qToggleSup('c|<i>Cl</i>'); });
  const r = await page.evaluate(() => ({ b: !!document.querySelector('#v-quality b[class=""],#v-quality .name b'), pwned: window.__pwned, text: document.getElementById('v-quality').innerText }));
  assert.equal(r.pwned, undefined);
  assert.match(r.text, /<b>Zed<\/b>/);
  assert.deepEqual(errors, []);
  await context.close();
});

/* ================================================================ big files */
test('a large production file (20,000 calls) loads, counts every call and stays responsive', async () => {
  const rows = [];
  for (let i = 0; i < 20000; i++) {
    const day = 2 + (i % 20); const dd = String(day).padStart(2, '0'); const hr = 9 + (i % 9);
    rows.push(h.qRow({ start: `2026-03-${dd}T${String(hr).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00-06:00`, agent: 'Agent ' + (i % 12), outcome: 'handled', reason: 'agent answered', sl: 'YES', wait: 5, talk: 100, ring: 3, call: 105, cid: 'big-' + i }));
  }
  const { page, context, errors } = await h.openApp();
  const t0 = Date.now();
  await page.setInputFiles('#fileInput', h.csvFile('queue.csv', rows, h.HEAD.queueDetails));
  await page.waitForFunction(() => typeof DS !== 'undefined' && DS.queueDetails && DS.queueDetails.length === 20000 && !document.querySelector('.shell').classList.contains('pre-load'), null, { timeout: 40000 });
  const took = Date.now() - t0;
  const s = await state(page);
  assert.equal(s.core.total, 20000); assert.equal(s.core.handled, 20000);
  assert.ok(took < 30000, 'took ' + took + ' ms');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a large QA file (5,000 audits) loads and the report draws', async () => {
  const rows = [];
  for (let i = 0; i < 5000; i++) rows.push(h.qaRow({ agent: 'Agent ' + (i % 40), doa: `2026-03-${String(2 + (i % 25)).padStart(2, '0')}`, doc: '2026-03-02', missed: i % 7 === 0 ? ['Call ownership'] : [] }));
  const { page, context, errors } = await h.openApp();
  await page.setInputFiles('#fileInputQ', h.qaCsvFile(rows));
  await page.waitForFunction(() => DS.quality && DS.quality.length === 5000, null, { timeout: 40000 });
  await h.show(page, 'quality');
  assert.equal((await h.kpi(page, 'quality', 'Audits')).value, '5,000');
  assert.deepEqual(errors, []);
  await context.close();
});
