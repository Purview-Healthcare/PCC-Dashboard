'use strict';
// Area 8: every screen in a real browser. Every section draws without errors or "undefined / NaN" text,
// and every button and control does something without breaking the page. Made-up data only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { SECTIONS, sweep } = require('./ui-helpers');

after(() => h.closeBrowser());

const PRINT_STUB = async page => { await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; }); };

/** Open the app with both made-up data sets loaded. */
async function loaded(opts = {}) {
  const app = await h.openApp(Object.assign({ beforeLoad: PRINT_STUB }, opts));
  await h.loadProduction(app.page);
  await h.loadQuality(app.page, opts.qa);
  return app;
}
/** QA rows for two clients, two supervisors, two auditors, so every QA filter has something to choose. */
function twoClientQA() {
  return [
    h.qaRow({ agent: 'Asha Rao', client: 'Client One', sup: 'Tariq Noor', auditor: 'Lena Kim', doa: '2026-03-03', doc: '2026-03-02' }),
    h.qaRow({ agent: 'Asha Rao', client: 'Client One', sup: 'Tariq Noor', auditor: 'Lena Kim', doa: '2026-03-10', doc: '2026-03-09', missed: ['Dead air management'] }),
    h.qaRow({ agent: 'Ben Cole', client: 'Client One', sup: 'Uma Rane', auditor: 'Omar Faiz', doa: '2026-03-04', doc: '2026-03-03', missed: ['Correct appointment handling'] }),
    h.qaRow({ agent: 'Ben Cole', client: 'Client Two', sup: 'Uma Rane', auditor: 'Omar Faiz', doa: '2026-03-11', doc: '2026-03-10', missed: ['Insurance EV Details Captured'], reb: 'Yes', rebReason: 'It was captured', rebStatus: 'Accepted' }),
    h.qaRow({ agent: 'Cara Diaz', client: 'Client Two', sup: 'Vik Rao', auditor: 'Lena Kim', doa: '2026-03-04', doc: '2026-03-03', missed: ['Call ownership', 'Dead air management'] }),
    h.qaRow({ agent: 'Cara Diaz', client: 'Client Two', sup: 'Vik Rao', auditor: 'Lena Kim', doa: '2026-03-11', doc: '2026-03-10', missed: ['Dead air management'] }),
  ];
}
const fire = (page, sel, value) => page.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, value]);

/* ---------------- the sweep: every section, every data combination ---------------- */

test('with all the made-up data loaded, every section draws with no errors and no "undefined", "NaN", "null", "Infinity" or "[object Object]" on screen', async () => {
  const { page, context, errors, dialogs } = await loaded();
  assert.deepEqual(await sweep(page, errors, 'both data sets'), []);
  assert.deepEqual(dialogs, []);
  await context.close();
});

test('every section really has content (nothing is an empty white page) when all data is loaded', async () => {
  const { page, context } = await loaded();
  for (const id of SECTIONS) {
    await h.show(page, id);
    const n = await page.evaluate(v => document.querySelector('#v-' + v).innerText.trim().length, id);
    assert.ok(n > 200, `${id} shows only ${n} characters of text`);
  }
  await context.close();
});

test('production files only: every section draws cleanly (QA report shows its "no quality file" message)', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  assert.deepEqual(await sweep(page, errors, 'production only'), []);
  await h.show(page, 'quality');
  assert.match(await page.innerText('#v-quality'), /No quality file loaded/);
  await context.close();
});

test('QA sheet only: every section draws cleanly, with no crash boxes in the production sections', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadQuality(page);
  assert.deepEqual(await sweep(page, errors, 'QA only'), []);
  await context.close();
});

for (const f of h.standardProductionFiles()) {
  test(`only the file "${f.name}" loaded: every section draws cleanly`, async () => {
    const { page, context, errors } = await h.openApp();
    await h.loadProduction(page, [f]);
    assert.deepEqual(await sweep(page, errors, f.name), []);
    await context.close();
  });
}

test('a date range with no calls in it (far in the future): every section draws cleanly', async () => {
  const { page, context, errors } = await loaded();
  await fire(page, '#fFrom', '2030-01-01'); await fire(page, '#fTo', '2030-01-02');
  assert.deepEqual(await sweep(page, errors, 'empty range'), []);
  await context.close();
});

test('a date range where "From" is after "To": every section draws cleanly', async () => {
  const { page, context, errors } = await loaded();
  await fire(page, '#fFrom', '2026-03-04'); await fire(page, '#fTo', '2026-03-02');
  assert.deepEqual(await sweep(page, errors, 'reversed range'), []);
  await context.close();
});

test('odd shift hours (start after end, same start and end, all 24 hours): every section draws cleanly', async () => {
  const { page, context, errors } = await loaded();
  for (const [a, b] of [[18, 9], [9, 9], [0, 23], [23, 0]]) {
    await fire(page, '#fShiftStart', String(a)); await fire(page, '#fShiftEnd', String(b));
    assert.deepEqual(await sweep(page, errors, `shift ${a}-${b}`), []);
  }
  await context.close();
});

test('every filter combination (queue, agent, device lines, group by) still draws every section cleanly', async () => {
  const { page, context, errors } = await loaded();
  for (const q of ['', 'Billing', 'Main Line']) for (const a of ['', 'Asha Rao', 'Cara Diaz']) for (const g of ['day', 'week', 'month']) {
    await fire(page, '#fQueue', q); await fire(page, '#fAgent', a); await fire(page, '#fGroup', g);
    const bad = await page.evaluate(() => [...document.querySelectorAll('.view')].filter(v => /Couldn't render/.test(v.innerHTML)).map(v => v.id));
    assert.deepEqual(bad, [], `queue="${q}" agent="${a}" group=${g}`);
  }
  await fire(page, '#fQueue', ''); await fire(page, '#fAgent', '');
  await page.check('#fDevices'); assert.deepEqual(await sweep(page, errors, 'device lines on'), []);
  await context.close();
});

/* ---------------- sidebar, themes, filters ---------------- */

test('the two sidebar tabs switch between the Production report and the QA report', async () => {
  const { page, context, errors } = await loaded();
  assert.equal(await page.locator('#tabs .tab').count(), 2);
  await page.click('#tabs .tab[data-id="quality"]');
  assert.ok(await page.isVisible('#v-quality')); assert.ok(!(await page.isVisible('#v-report')));
  assert.match(await page.getAttribute('#tabs .tab[data-id="quality"]', 'class'), /active/);
  await page.click('#tabs .tab[data-id="report"]');
  assert.ok(await page.isVisible('#v-report')); assert.ok(!(await page.isVisible('#v-quality')));
  assert.deepEqual(errors, []);
  await context.close();
});

test('the three theme buttons change the look, one at a time, on the upload page and the report', async () => {
  const { page, context, errors } = await loaded();
  for (const [t, attr] of [['light', 'light'], ['dark', 'dark'], ['classic', null]]) {
    await page.click(`#tabs ~ .sidebar-foot .themes button[data-t="${t}"]`);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), attr);
    assert.equal(await page.locator('.sidebar-foot .themes button.on').count(), 1);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('the theme buttons on the first (upload) page work too', async () => {
  const { page, context, errors } = await h.openApp();
  for (const [t, attr] of [['dark', 'dark'], ['light', 'light'], ['classic', null]]) {
    await page.click(`#v-upload .themes button[data-t="${t}"]`);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), attr);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('each filter (from, to, queue, agent, shift start/end, group by, device lines) changes the report and does not break it', async () => {
  const { page, context, errors } = await loaded();
  await h.show(page, 'report');
  const text = () => page.innerText('#v-report');
  const base = await text();
  await fire(page, '#fQueue', 'Billing'); const t1 = await text(); assert.notEqual(t1, base, 'queue filter changed nothing');
  await fire(page, '#fQueue', '');
  await fire(page, '#fAgent', 'Cara Diaz'); const t2 = await text(); assert.notEqual(t2, base, 'agent filter changed nothing');
  await fire(page, '#fAgent', '');
  await fire(page, '#fFrom', '2026-03-03'); const t3 = await text(); assert.notEqual(t3, base, 'from date changed nothing');
  await fire(page, '#fFrom', '2026-03-02');
  await fire(page, '#fTo', '2026-03-03'); const t4 = await text(); assert.notEqual(t4, base, 'to date changed nothing');
  await fire(page, '#fTo', '2026-03-07');
  await fire(page, '#fShiftStart', '12'); const t5 = await text(); assert.notEqual(t5, base, 'shift start changed nothing');
  await fire(page, '#fShiftStart', '9');
  await fire(page, '#fShiftEnd', '12'); const t6 = await text(); assert.notEqual(t6, base, 'shift end changed nothing');
  await fire(page, '#fShiftEnd', '18');
  await page.check('#fDevices'); const t7 = await text(); assert.notEqual(t7, base, 'device lines toggle changed nothing'); await page.uncheck('#fDevices');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the date filter ends at 7 Mar, so the Saturday call is included, and the top-of-page chips show the chosen range and queue', async () => {
  const { page, context } = await loaded();
  assert.deepEqual(await page.evaluate(() => [FILTER.from, FILTER.to]), ['2026-03-02', '2026-03-07']);
  await fire(page, '#fQueue', 'Billing');
  assert.match(await page.innerText('#headMeta'), /Billing/);
  await context.close();
});

test('Day / Week / Month toggles change how the volume is grouped and keep the top filter in step', async () => {
  const { page, context, errors } = await loaded();
  await h.show(page, 'report');
  for (const label of ['Day', 'Week', 'Month']) {
    await page.locator('#v-report button.seg', { hasText: new RegExp('^' + label + '$') }).first().click();
    assert.equal(await page.evaluate(() => FILTER.groupBy), label.toLowerCase());
    assert.equal(await page.inputValue('#fGroup'), label.toLowerCase());
    assert.ok(await page.locator('#v-report button.seg.on', { hasText: label }).count() > 0, label + ' button not highlighted');
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('the heat-map switch (Handled % / No-agent #) works when called, even though no screen draws its buttons today', async () => {
  const { page, context, errors } = await loaded();
  await h.show(page, 'report');
  await page.evaluate(() => { setHeatMetric('count'); setHeatMetric('rate'); });
  assert.deepEqual(errors, []);
  await context.close();
});

test.todo('SUGGESTION: heatToggle() (Handled % / No-agent # buttons) is defined but never drawn on any screen: show it or delete the dead code');

test('the "Print report" button, the report\'s own print button and the QA print button each call the browser print once', async () => {
  const { page, context, errors } = await loaded();
  await page.click('#fPrint'); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__printed), 1, 'top "Print report"');
  assert.ok(await page.isVisible('#v-report'), 'Print report switches to the production report');
  await page.locator('#v-report button', { hasText: 'Print production report' }).click();
  assert.equal(await page.evaluate(() => window.__printed), 2, 'report print button');
  await h.show(page, 'quality');
  await page.locator('#v-quality button', { hasText: /^\s*Print\s*$/ }).first().click();
  assert.equal(await page.evaluate(() => window.__printed), 3, 'QA print button');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Reset puts every filter back to its starting value', async () => {
  const { page, context, errors } = await loaded();
  await fire(page, '#fQueue', 'Billing'); await fire(page, '#fAgent', 'Asha Rao'); await fire(page, '#fGroup', 'day');
  await fire(page, '#fShiftStart', '11'); await fire(page, '#fFrom', '2026-03-03'); await page.check('#fDevices');
  await page.click('#fReset');
  const s = await page.evaluate(() => ({ q: $('#fQueue').value, a: $('#fAgent').value, g: $('#fGroup').value, s: $('#fShiftStart').value, e: $('#fShiftEnd').value, f: $('#fFrom').value, t: $('#fTo').value, d: $('#fDevices').checked, F: FILTER }));
  assert.deepEqual([s.q, s.a, s.g, s.s, s.e, s.f, s.d], ['', '', 'month', '9', '18', '2026-03-02', false]);
  assert.equal(s.F.from, '2026-03-02'); assert.equal(s.F.queue, ''); assert.equal(s.F.agent, ''); assert.equal(s.F.devices, false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('"Load / replace data" returns to the upload page and a second set of files replaces the first without errors', async () => {
  const { page, context, errors } = await loaded();
  await page.click('#fReload');
  assert.ok(await page.isVisible('#v-upload')); assert.ok(await page.isVisible('#drop'));
  await h.loadProduction(page, h.standardProductionFiles().slice(0, 1));
  assert.ok(await page.isVisible('#v-report'));
  assert.deepEqual(await sweep(page, errors, 'after replace'), []);
  await context.close();
});

/* ---------------- downloads ---------------- */

test('every CSV download button hands over a file with a header row and data rows', async () => {
  const { page, context, errors } = await loaded();
  await h.show(page, 'report');
  const buttons = [
    ['Download full list', 'missed_calls.csv', 'Phone number'],
    ['Download no-callback list', 'no_callback_list.csv', 'Phone number'],
    ['⬇ CSV', 'agent_scorecard.csv', 'Agent'],
  ];
  for (const [text, file, firstHead] of buttons) {
    const d = await h.download(page, () => page.locator('#v-report button', { hasText: text }).first().click());
    assert.equal(d.name, file);
    const rows = h.parseCSVText(d.text);
    assert.equal(rows[0][0], firstHead, file + ' header'); assert.ok(rows.length >= 2, file + ' has no data rows');
  }
  await h.show(page, 'quality');
  const q = await h.download(page, () => page.locator('#v-quality button', { hasText: '⬇ CSV' }).first().click());
  assert.equal(q.name, 'quality_audits.csv');
  assert.equal(h.parseCSVText(q.text).length, 1 + 8);
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------------- QA report controls ---------------- */

test('the QA filters (client, agent, auditor, audit dates, Reset) change the audit count and the report stays clean', async () => {
  const { page, context, errors } = await loaded({ qa: h.qaCsvFile(twoClientQA()) });
  await h.show(page, 'quality');
  const shown = () => page.evaluate(() => (document.querySelector('#v-quality .sub').textContent.match(/([\d,]+) of ([\d,]+) audits/) || []).slice(1).map(Number));
  assert.deepEqual(await shown(), [6, 6]);
  const sel = label => page.locator('#v-quality .qsticky label', { hasText: label }).locator('select, input');
  await sel('Client').selectOption('Client Two'); assert.deepEqual(await shown(), [3, 6]);
  await sel('Agent').selectOption('Cara Diaz'); assert.deepEqual(await shown(), [2, 6]);
  await sel('Auditor').selectOption('Omar Faiz'); assert.match(await page.innerText('#v-quality'), /No audits match these filters/);
  await page.locator('#v-quality button', { hasText: 'Reset' }).first().click(); assert.deepEqual(await shown(), [6, 6]);
  await sel('Audit from').fill('2026-03-10'); assert.deepEqual(await shown(), [3, 6]);
  await sel('Audit to').fill('2026-03-10'); assert.deepEqual(await shown(), [1, 6]);
  assert.deepEqual(await sweep(page, errors, 'QA filters'), []);
  await context.close();
});

test('the "Client" drop-down in each QA section heading filters the whole QA report too', async () => {
  const { page, context, errors } = await loaded({ qa: h.qaCsvFile(twoClientQA()) });
  await h.show(page, 'quality');
  await page.locator('#q-overview select').first().selectOption('Client One');
  assert.equal(await page.evaluate(() => QFILTER.client), 'Client One');
  assert.match(await page.innerText('#v-quality .sub'), /3 of 6 audits/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('QA score breakdown: clicking a client opens its supervisors, clicking a supervisor opens its agents, and clicking again closes', async () => {
  const { page, context, errors } = await loaded({ qa: h.qaCsvFile(twoClientQA()) });
  await h.show(page, 'quality');
  const rows = () => page.locator('#q-breakdown tbody tr').count();
  assert.equal(await rows(), 2);
  await page.locator('#q-breakdown tr.row-parent', { hasText: 'Client One' }).click();
  assert.equal(await rows(), 4, 'two supervisors appear');
  await page.locator('#q-breakdown tr.row-parent', { hasText: 'Uma Rane' }).click();
  assert.ok(await rows() > 4, 'agents appear');
  assert.ok(await page.locator('#q-breakdown tr.row-child').count() > 0);
  await page.locator('#q-breakdown tr.row-parent', { hasText: 'Client One' }).first().click();
  assert.equal(await rows(), 2, 'collapsed again');
  assert.deepEqual(errors, []);
  await context.close();
});

test('contents links in both reports point at a section that exists, and clicking them causes no error', async () => {
  const { page, context, errors } = await loaded();
  for (const view of ['report', 'quality']) {
    await h.show(page, view);
    const hrefs = await page.evaluate(v => [...document.querySelectorAll('#v-' + v + ' .rep-index a')].map(a => a.getAttribute('href')), view);
    assert.ok(hrefs.length >= 7, view + ' contents list is too short: ' + hrefs.length);
    for (const href of hrefs) {
      assert.ok(await page.evaluate(sel => !!document.querySelector(sel), href), `${view}: contents link ${href} has no target`);
      await page.locator(`#v-${view} .rep-index a[href="${href}"]`).click();
      assert.equal(await page.evaluate(() => location.hash), href);
    }
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('every "Top" link in the reports goes back to the top without error', async () => {
  const { page, context, errors } = await loaded();
  for (const view of ['report', 'quality']) {
    await h.show(page, view);
    const n = await page.locator(`#v-${view} a.totop`).count();
    assert.ok(n >= 5, `${view}: only ${n} "Top" links`);
    for (let i = 0; i < n; i++) { await page.locator(`#v-${view} a.totop`).nth(i).click(); }
    assert.match(await page.evaluate(() => location.hash), /#(rep|q)-top/);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('supervisor notes: typing a note is kept in the browser and comes back after a reload and re-upload', async () => {
  const { page, context, errors } = await loaded();
  await h.show(page, 'report');
  const box = page.locator('#v-report input.scnote[data-agent="Asha Rao"]').first();
  await box.fill('Coach on holds next week');
  assert.equal(await page.evaluate(() => localStorage.getItem('pcc_note_Asha Rao')), 'Coach on holds next week');
  await page.reload();
  await h.loadProduction(page);
  assert.equal(await page.locator('#v-report input.scnote[data-agent="Asha Rao"]').first().inputValue(), 'Coach on holds next week');
  assert.deepEqual(errors, []);
  await context.close();
});

test('root-cause notes: choosing a cause, typing the analysis and plan and setting a status are saved, and the item turns "Documented"', async () => {
  const { page, context, errors } = await loaded();
  await h.show(page, 'quality');
  const item = page.locator('#q-pareto .rca-item').first();
  assert.ok(await item.count() > 0, 'no root-cause items for this data');
  const key = await item.getAttribute('data-key');
  await item.locator('select[data-f="why"]').selectOption('Knowledge gap');
  await item.locator('textarea[data-f="rca"]').fill('Agents were never trained on this step');
  await item.locator('textarea[data-f="mitigation"]').fill('Add the step to the checklist');
  await item.locator('select[data-f="status"]').selectOption('Implemented');
  const saved = await page.evaluate(k => JSON.parse(localStorage.getItem('pcc_rca_' + k)), key);
  assert.equal(saved.why, 'Knowledge gap'); assert.equal(saved.rca, 'Agents were never trained on this step');
  assert.equal(saved.status, 'Implemented'); assert.ok(saved.implementedAt);
  assert.match(await item.getAttribute('class'), /is-done/);
  await item.locator('select[data-f="why"]').selectOption('Other');
  assert.ok(await item.locator('input[data-f="whyOther"]').isVisible(), '"Other" reveals the type-in box');
  // after redraw (a filter change) the note is still there
  await page.locator('#v-quality button', { hasText: 'Reset' }).first().click();
  assert.equal(await page.locator(`#q-pareto .rca-item[data-key="${key}"] textarea[data-f="rca"]`).inputValue(), 'Agents were never trained on this step');
  assert.deepEqual(errors, []);
  await context.close();
});

test('expandable and scrolling helpers (qScrollTo, repScrollTo) do nothing bad when the target is missing', async () => {
  const { page, context, errors } = await loaded();
  await page.evaluate(() => { qScrollTo('nope'); repScrollTo('nope'); });
  assert.deepEqual(errors, []);
  await context.close();
});

test('the upload page itself: both boxes open the file chooser, and the file list names each recognised file', async () => {
  const { page, context, errors } = await h.openApp();
  for (const sel of ['#drop', '#dropQ']) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(sel)]);
    assert.ok(chooser);
  }
  await h.loadProduction(page);
  await page.click('#fReload');
  assert.equal(await page.locator('#fileList .fl').count(), 7);
  assert.equal(await page.locator('#fileList .fl .dot.ok').count(), 7);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the "no quality file" screen has a working "Upload quality file" button', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  await h.show(page, 'quality');
  await page.locator('#v-quality button', { hasText: 'Upload quality file' }).click();
  assert.ok(await page.isVisible('#v-upload'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('the page has no repeated element ids (repeated ids break links and screen readers)', async () => {
  const { page, context } = await loaded();
  const dup = await page.evaluate(() => { const c = {}; document.querySelectorAll('[id]').forEach(e => c[e.id] = (c[e.id] || 0) + 1); return Object.entries(c).filter(([, n]) => n > 1).map(([k, n]) => k + ' x' + n); });
  await context.close();
  assert.deepEqual(dup, []);
});
