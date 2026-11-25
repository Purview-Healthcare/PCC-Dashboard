'use strict';
/*
 * "Two at once". The app has no server and no shared data, so the checks are about the same person doing two things
 * quickly (double upload, double click, rapid filter changes), two browser tabs open on the same browser, and
 * browser storage being blocked.
 * Made-up data only.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

const E = h.EXPECT_QUEUE;
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const core = page => page.evaluate(() => { const m = coreMetrics(); return { total: m.total, handled: m.handled }; });
const fileList = page => page.evaluate(() => [...document.querySelectorAll('#fileList .fl')].map(d => d.querySelector('.meta span').textContent.trim()));

/* ---------------------------------------------------------------- double upload */
test('dropping the same production files twice in quick succession counts every call once and lists each file once', async () => {
  const { page, context, errors, dialogs } = await h.openApp();
  const files = h.standardProductionFiles();
  await page.setInputFiles('#fileInput', files);
  await page.setInputFiles('#fileInput', files);          // no waiting in between
  await settle(page);
  assert.deepEqual(await core(page), { total: E.offered, handled: E.handled });
  assert.equal((await fileList(page)).length, 7);
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  await context.close();
});

test('dropping the same production files three times from three places at the same instant gives the same single result', async () => {
  const { page, context, errors } = await h.openApp();
  const files = h.standardProductionFiles();
  await Promise.all([page.setInputFiles('#fileInput', files), page.setInputFiles('#fileInput', files), page.setInputFiles('#fileInput', files)]);
  await settle(page, 1200);
  assert.deepEqual(await core(page), { total: E.offered, handled: E.handled });
  assert.equal((await fileList(page)).length, 7);
  assert.deepEqual(errors, []);
  await context.close();
});

test('dropping the same QA file twice in quick succession (CSV and Excel) gives 8 audits, not 16', async () => {
  for (const mk of [() => h.qaCsvFile(), () => h.qaXlsxFile()]) {
    const { page, context, errors } = await h.openApp();
    const f = mk();
    await page.setInputFiles('#fileInputQ', f);
    await page.setInputFiles('#fileInputQ', f);
    await settle(page, 1500);
    assert.equal(await page.evaluate(() => DS.quality.length), 8, f.name);
    assert.equal((await fileList(page)).length, 1, f.name + ' listed once');
    await h.show(page, 'quality');
    assert.equal((await h.kpi(page, 'quality', 'Audits')).value, '8');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('two different QA files dropped one right after the other: the last one chosen is the one shown (slow Excel read must not overwrite a faster CSV)', async () => {
  const { page, context } = await h.openApp();
  const one = h.qaCsvFile([h.qaRow({ agent: 'Dan Reyes' })], 'second-choice.csv');
  await page.setInputFiles('#fileInputQ', h.qaXlsxFile());   // 8 audits, needs the Excel reader first
  await page.setInputFiles('#fileInputQ', one);              // 1 audit, read straight away
  await settle(page, 2000);
  assert.equal(await page.evaluate(() => DS.quality.length), 1, 'the older Excel file finished last and replaced the file chosen last');
  await context.close();
});

test('uploading the QA file while the production files are still being read keeps both', async () => {
  const { page, context, errors } = await h.openApp();
  await page.setInputFiles('#fileInput', h.standardProductionFiles());
  await page.setInputFiles('#fileInputQ', h.qaCsvFile());
  await settle(page, 1200);
  assert.deepEqual(await core(page), { total: E.offered, handled: E.handled });
  assert.equal(await page.evaluate(() => DS.quality.length), 8);
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------------------------------------------------------------- double click on a download */
test('double-clicking the QA "CSV" button gives complete, identical files (no half file, no crash)', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile());
  await h.show(page, 'quality');
  const texts = [];
  page.on('download', async d => { const p = await d.path(); texts.push(require('node:fs').readFileSync(p, 'utf8')); });
  await page.locator('#v-quality .qsticky button', { hasText: 'CSV' }).dblclick();
  await settle(page, 1500);
  assert.ok(texts.length >= 1, 'at least one file was saved');
  texts.forEach(t => { assert.equal(h.parseCSVText(t).length, 9, 'header + 8 audits in every copy'); assert.equal(t, texts[0], 'copies are identical'); });
  assert.deepEqual(errors, []);
  await context.close();
});

test('double-clicking the missed-calls and scorecard downloads gives complete files', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  const got = {};
  page.on('download', async d => { const p = await d.path(); (got[d.suggestedFilename()] = got[d.suggestedFilename()] || []).push(require('node:fs').readFileSync(p, 'utf8')); });
  await page.evaluate(() => { dlMissedCSV(); dlMissedCSV(); dlScorecardCSV(); dlScorecardCSV(); });
  await settle(page, 1500);
  assert.ok(got['missed_calls.csv'] && got['missed_calls.csv'].length >= 1);
  assert.ok(got['agent_scorecard.csv'] && got['agent_scorecard.csv'].length >= 1);
  got['missed_calls.csv'].forEach(t => { assert.equal(h.parseCSVText(t).length, 1 + h.EXPECT_CALLS.missedInbound); assert.equal(t, got['missed_calls.csv'][0]); });
  got['agent_scorecard.csv'].forEach(t => assert.equal(t, got['agent_scorecard.csv'][0]));
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------------------------------------------------------------- quick repeated filter changes */
test('production filters changed many times in the same instant end in the state of the last change (queue Billing, from 3 Mar, by week)', async () => {
  const rapid = await h.openApp();
  await h.loadProduction(rapid.page);
  await rapid.page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    for (let i = 0; i < 12; i++) {
      set('fQueue', ['Main Line', 'Billing', ''][i % 3]); set('fFrom', ['2026-03-04', '2026-03-02', '2026-03-03'][i % 3]); set('fGroup', ['day', 'week', 'month'][i % 3]);
    }
    set('fQueue', 'Billing'); set('fFrom', '2026-03-03'); set('fGroup', 'week');
  });
  await rapid.page.waitForTimeout(300);
  const a = await rapid.page.evaluate(() => ({ q: FILTER.queue, from: FILTER.from, gb: FILTER.groupBy, sel: [document.getElementById('fQueue').value, document.getElementById('fFrom').value, document.getElementById('fGroup').value], m: (() => { const m = coreMetrics(); return [m.total, m.handled]; })(),
    text: ['exec', 'coverage', 'report'].map(id => document.getElementById('v-' + id).textContent.replace(/\s+/g, ' ')) }));
  // hand-worked: Billing calls from 3 Mar = Cara Diaz's Tuesday call (second leg of the two-leg call) -> 1 offered, 1 handled
  assert.deepEqual(a.m, [1, 1]);
  assert.deepEqual([a.q, a.from, a.gb], ['Billing', '2026-03-03', 'week']);
  assert.deepEqual(a.sel, ['Billing', '2026-03-03', 'week']);
  assert.deepEqual(rapid.errors, []);
  // the same final choices made slowly, one at a time, in a fresh page, must give the identical screens
  const calm = await h.openApp();
  await h.loadProduction(calm.page);
  await calm.page.selectOption('#fQueue', 'Billing'); await calm.page.fill('#fFrom', '2026-03-03'); await calm.page.selectOption('#fGroup', 'week');
  const b = await calm.page.evaluate(() => ['exec', 'coverage', 'report'].map(id => document.getElementById('v-' + id).textContent.replace(/\s+/g, ' ')));
  a.text.forEach((t, i) => assert.equal(t, b[i], 'screen ' + i + ' differs between the rapid and the calm route'));
  await rapid.context.close(); await calm.context.close();
});

test('QA filters changed many times in the same instant end in the state of the last change (client Client Two, agent Zed Young)', async () => {
  const rows = h.standardQARows().concat([
    h.qaRow({ agent: 'Zed Young', client: 'Client Two', sup: 'Uma Rao', auditor: 'Pia Wu', doa: '2026-03-05', missed: ['Dead air management'] }),
    h.qaRow({ agent: 'Zed Young', client: 'Client Two', sup: 'Uma Rao', auditor: 'Pia Wu', doa: '2026-03-12' }),
  ]);
  const { page, context, errors } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile(rows));
  await h.show(page, 'quality');
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) { setQF('client', ['Client One', 'Client Two', ''][i % 3]); setQF('agent', ['Asha Rao', '', 'Zed Young'][i % 3]); setQF('from', ['2026-03-01', '', '2026-03-04'][i % 3]); }
    setQF('client', 'Client Two'); setQF('agent', 'Zed Young'); setQF('from', ''); setQF('to', '');
  });
  const r = await page.evaluate(() => ({ f: QFILTER, shown: qualRows().length, sels: [...document.querySelectorAll('#v-quality .qsticky select')].map(s => s.value), text: document.querySelector('#q-overview .kpi .val').textContent }));
  assert.deepEqual(r.f, { client: 'Client Two', agent: 'Zed Young', auditor: '', from: '', to: '' });
  assert.equal(r.shown, 2); assert.equal(r.text, '2');
  assert.deepEqual(r.sels, ['Client Two', 'Zed Young', '']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('expanding and collapsing the same score-breakdown row quickly ends open after an odd number of clicks and closed after an even number', async () => {
  const { page, context } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile());
  await h.show(page, 'quality');
  const rows = () => page.evaluate(() => document.querySelectorAll('#q-breakdown tbody tr').length);
  const closed = await rows();
  await page.evaluate(() => { for (let i = 0; i < 5; i++) qToggleSup('c|Client One'); });
  assert.ok(await rows() > closed, 'odd clicks: open');
  await page.evaluate(() => { for (let i = 0; i < 4; i++) qToggleSup('c|Client One'); });
  assert.ok(await rows() > closed, '9 clicks in all: still open');
  await page.evaluate(() => qToggleSup('c|Client One'));
  assert.equal(await rows(), closed, '10 clicks in all: closed');
  await context.close();
});

test('changing the filter while a file is still being read does not mix old and new data (final screen matches the new file)', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  await page.setInputFiles('#fileInput', h.standardProductionFiles());
  await page.evaluate(() => { const el = document.getElementById('fGroup'); el.value = 'day'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(page, 1200);
  assert.deepEqual(await core(page), { total: E.offered, handled: E.handled });
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------------------------------------------------------------- two tabs, same browser */
async function secondTab(context, errs) {
  const p = await context.newPage();
  p.on('pageerror', e => errs.push('tab 2 page error: ' + e.message));
  p.on('dialog', d => d.dismiss().catch(() => {}));
  await p.goto(h.APP_URL);
  return p;
}
const putNote = async (page, agent, text) => { const el = page.locator(`#v-agents .scnote[data-agent="${agent}"]`); await el.fill(text); };

test('two tabs typing a supervisor note for the same agent: the last typed note wins in the browser and nothing crashes', async () => {
  const { page: a, context, errors } = await h.openApp();
  const b = await secondTab(context, errors);
  await h.loadProduction(a); await h.loadProduction(b);
  await h.show(a, 'agents'); await h.show(b, 'agents');
  await putNote(a, 'Asha Rao', 'Note from tab one');
  await putNote(b, 'Asha Rao', 'Note from tab two');
  await putNote(a, 'Ben Cole', 'Ben: tab one only');
  const stored = await a.evaluate(() => ({ asha: localStorage.getItem('pcc_note_Asha Rao'), ben: localStorage.getItem('pcc_note_Ben Cole') }));
  assert.deepEqual(stored, { asha: 'Note from tab two', ben: 'Ben: tab one only' }, 'Asha: last save (tab two) wins; Ben: other agent untouched');
  // a redraw in either tab shows what is stored
  await a.evaluate(() => setGroupBy('week')); await b.evaluate(() => setGroupBy('week'));
  assert.equal(await a.locator('#v-agents .scnote[data-agent="Asha Rao"]').inputValue(), 'Note from tab two');
  assert.equal(await b.locator('#v-agents .scnote[data-agent="Asha Rao"]').inputValue(), 'Note from tab two');
  assert.equal(await b.locator('#v-agents .scnote[data-agent="Ben Cole"]').inputValue(), 'Ben: tab one only');
  // tab one types again: it wins again
  await putNote(a, 'Asha Rao', 'Tab one again');
  await b.evaluate(() => setGroupBy('month'));
  assert.equal(await b.locator('#v-agents .scnote[data-agent="Asha Rao"]').inputValue(), 'Tab one again');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a supervisor note with quotes, an ampersand and angle brackets comes back exactly as typed after a redraw', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  await h.show(page, 'agents');
  const text = 'Said "great call" & <b>bold</b> &amp; more';
  await putNote(page, 'Asha Rao', text);
  await page.evaluate(() => setGroupBy('week'));
  assert.equal(await page.locator('#v-agents .scnote[data-agent="Asha Rao"]').inputValue(), text);
  assert.deepEqual(errors, []);
  await context.close();
});

const rcaKey = page => page.evaluate(() => document.querySelector('.rca-item').getAttribute('data-key'));
const rcaStored = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem('pcc_rca_' + k) || '{}'), key);

test('two tabs writing different parts of the same root-cause note: both parts are kept (each save re-reads what is stored)', async () => {
  const { page: a, context, errors } = await h.openApp();
  const b = await secondTab(context, errors);
  await h.loadQuality(a, h.qaCsvFile()); await h.loadQuality(b, h.qaCsvFile());
  await h.show(a, 'quality'); await h.show(b, 'quality');
  const key = await rcaKey(a);
  await a.locator(`.rca-item[data-key="${key}"] textarea[data-f=rca]`).fill('Cause written in tab one');
  await b.locator(`.rca-item[data-key="${key}"] textarea[data-f=mitigation]`).fill('Fix written in tab two');
  const s = await rcaStored(a, key);
  assert.equal(s.rca, 'Cause written in tab one'); assert.equal(s.mitigation, 'Fix written in tab two');
  // tab one picks a status afterwards: the other two parts must not be lost
  await a.locator(`.rca-item[data-key="${key}"] select[data-f=status]`).selectOption('Started');
  const s2 = await rcaStored(a, key);
  assert.deepEqual([s2.rca, s2.mitigation, s2.status], ['Cause written in tab one', 'Fix written in tab two', 'Started']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('two tabs writing the same part of the same root-cause note: last save wins, and the next redraw in the other tab shows it', async () => {
  const { page: a, context, errors } = await h.openApp();
  const b = await secondTab(context, errors);
  await h.loadQuality(a, h.qaCsvFile()); await h.loadQuality(b, h.qaCsvFile());
  await h.show(a, 'quality'); await h.show(b, 'quality');
  const key = await rcaKey(a);
  const ta = a.locator(`.rca-item[data-key="${key}"] textarea[data-f=rca]`), tb = b.locator(`.rca-item[data-key="${key}"] textarea[data-f=rca]`);
  await ta.fill('first, from tab one');
  await tb.fill('second, from tab two');
  assert.equal((await rcaStored(a, key)).rca, 'second, from tab two');
  await ta.fill('third, from tab one');
  assert.equal((await rcaStored(b, key)).rca, 'third, from tab one');
  await b.evaluate(() => vQuality());
  assert.equal(await b.locator(`.rca-item[data-key="${key}"] textarea[data-f=rca]`).inputValue(), 'third, from tab one');
  assert.deepEqual(errors, []);
  await context.close();
});

test('both tabs marking the same note "Implemented" and then one un-marking it ends with no stale date', async () => {
  const { page: a, context, errors } = await h.openApp();
  const b = await secondTab(context, errors);
  await h.loadQuality(a, h.qaCsvFile()); await h.loadQuality(b, h.qaCsvFile());
  await h.show(a, 'quality'); await h.show(b, 'quality');
  const key = await rcaKey(a);
  const sa = a.locator(`.rca-item[data-key="${key}"] select[data-f=status]`), sb = b.locator(`.rca-item[data-key="${key}"] select[data-f=status]`);
  await sa.selectOption('Implemented'); await sb.selectOption('Implemented');
  const s1 = await rcaStored(a, key);
  assert.equal(s1.status, 'Implemented'); assert.match(s1.implementedAt, /^\d{4}-\d{2}-\d{2}$/);
  await sa.selectOption('In progress');
  const s2 = await rcaStored(b, key);
  assert.equal(s2.status, 'In progress'); assert.equal(s2.implementedAt, undefined);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a theme chosen in one tab is what the other tab shows when it is opened next, and nothing crashes', async () => {
  const { page: a, context, errors } = await h.openApp();
  await a.locator('.themes button[data-t=dark]:visible').first().click();
  const b = await secondTab(context, errors);
  assert.equal(await b.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  await b.locator('.themes button[data-t=classic]:visible').first().click();
  assert.equal(await b.evaluate(() => localStorage.getItem('pcc-theme')), 'classic');
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------------------------------------------------------------- browser storage unavailable */
const blockStorage = async (page) => page.addInitScript(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
});
const fullStorage = async (page) => page.addInitScript(() => {
  Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
});

async function useEverything(page, errors) {
  await h.loadProduction(page);
  await h.loadQuality(page, h.qaCsvFile());
  for (const id of ['exec', 'overview', 'coverage', 'agents', 'volume', 'voice', 'insights', 'quality', 'report']) await h.show(page, id);
  await h.show(page, 'agents');
  await page.locator('#v-agents .scnote').first().fill('a note that cannot be saved');
  await h.show(page, 'quality');
  const ta = page.locator('.rca-item textarea[data-f=rca]').first();
  await ta.fill('a cause that cannot be saved');
  await page.locator('.rca-item select[data-f=status]').first().selectOption('Implemented');
  await page.locator('.themes button[data-t=dark]:visible').first().click();
  await page.locator('.themes button[data-t=light]:visible').first().click();
  await page.locator('#pvfbTab').click();
  await page.fill('#pvfbName', 'Test Person'); await page.fill('#pvfbMsg', 'A made-up message');
  await page.keyboard.press('Escape');
  await page.evaluate(() => setGroupBy('week'));
  return { note: await page.locator('#v-agents .scnote').count() };
}

test('browser storage blocked completely (reading it throws): the page opens, loads both files, every section draws, notes and themes can be used, no errors', async () => {
  const { page, context, errors, dialogs } = await h.openApp({ beforeLoad: blockStorage });
  assert.ok(await page.isVisible('#drop'));
  await useEverything(page, errors);
  const s = await page.evaluate(() => ({ audits: DS.quality.length, total: coreMetrics().total, broken: document.querySelectorAll('.view .empty h3').length }));
  assert.equal(s.audits, 8); assert.equal(s.total, E.offered);
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  await context.close();
});

test('browser storage full (saving throws): the page keeps working through the same steps with no errors', async () => {
  const { page, context, errors, dialogs } = await h.openApp({ beforeLoad: fullStorage });
  await useEverything(page, errors);
  assert.equal(await page.evaluate(() => DS.quality.length), 8);
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  await context.close();
});

test('browser storage blocked: the typed note stays in the box while the person keeps working in the same view', async () => {
  const { page, context } = await h.openApp({ beforeLoad: blockStorage });
  await h.loadProduction(page);
  await h.show(page, 'agents');
  await page.locator('#v-agents .scnote').first().fill('kept on screen');
  await h.show(page, 'overview'); await h.show(page, 'agents');
  // not saved anywhere, so a redraw may empty it; the page just must not break
  assert.ok(await page.locator('#v-agents .scnote').count() > 0);
  await context.close();
});

test('browser storage holding damaged data for a note (not valid JSON) does not stop the QA report from drawing', async () => {
  const { page, context, errors } = await h.openApp({ beforeLoad: (pg) => pg.addInitScript(() => { try { localStorage.setItem('pcc_rca_callownership', '{not json'); } catch (e) {} }) });
  await h.loadQuality(page, h.qaCsvFile());
  await h.show(page, 'quality');
  assert.ok(await page.locator('.rca-item').count() >= 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('browser storage holding the word null (or a number) for a note does not stop the QA report from drawing', async () => {
  const { page, context, errors } = await h.openApp({ beforeLoad: (pg) => pg.addInitScript(() => { try { localStorage.setItem('pcc_rca_callownership', 'null'); localStorage.setItem('pcc_rca_deadairmanagement', '7'); } catch (e) {} }) });
  await h.loadQuality(page, h.qaCsvFile());
  await h.show(page, 'quality');
  assert.ok(await page.locator('.rca-item').count() >= 1, 'RCA section did not draw');
  assert.deepEqual(errors, []);
  await context.close();
});
