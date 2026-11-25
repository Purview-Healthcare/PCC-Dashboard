'use strict';
// Areas 3 and 7: who sees what, nothing leaves the page, what the browser remembers, and the Feedback email.
// Made-up data only (invented names, 555-01xx numbers). The app has no accounts, so "who sees what" means:
// what goes outside the page, what stays in the browser, and where caller numbers / call summaries show up.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { SECTIONS } = require('./ui-helpers');

after(() => h.closeBrowser());

const OWNERS = ['sweety.t@purviewservices.com', 'shreya.k@purview-healthcare.com'];
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const isFont = u => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
const PHONE = /\+?1?[ -]?\(?312\)?[ -]?555[ -]?01\d\d/;

/** Watches every way a page can talk to the outside, inside the page and at the network. */
async function watched(opts = {}) {
  const sent = [];
  const app = await h.openApp(Object.assign({
    beforeLoad: async page => {
      page.on('request', r => { const u = r.url(); if (!/^(file|data|blob):/.test(u)) sent.push({ url: u, method: r.method(), body: r.postData() }); });
      await page.addInitScript(() => {
        window.__net = [];
        const of = window.fetch; window.fetch = function (...a) { window.__net.push('fetch ' + a[0]); return of.apply(this, a); };
        const oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { window.__net.push('xhr ' + u); return oo.apply(this, arguments); };
        if (navigator.sendBeacon) { const ob = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function (u) { window.__net.push('beacon ' + u); return ob.apply(navigator, arguments); }; }
        const OW = window.WebSocket; window.WebSocket = function (u) { window.__net.push('websocket ' + u); return new OW(u); };
        const OE = window.EventSource; if (OE) window.EventSource = function (u) { window.__net.push('eventsource ' + u); return new OE(u); };
      });
    },
  }, opts));
  app.sent = sent;
  return app;
}
const noWork = (sent) => sent.filter(r => !isFont(r.url));

/* ---------------- nothing leaves the page ---------------- */

test('opening the page makes no outside request except Google Fonts (styling only)', async () => {
  const { page, context, sent } = await watched();
  await page.waitForTimeout(300);
  assert.deepEqual(noWork(sent).map(r => r.url), []);
  assert.ok(sent.every(r => r.method === 'GET'), 'a font request was not a plain GET');
  assert.deepEqual(await page.evaluate(() => window.__net), []);
  await context.close();
});

test('loading production CSV files and a QA CSV, then using every screen, filter and download, sends nothing anywhere', async () => {
  const { page, context, sent } = await watched();
  await h.loadProduction(page); await h.loadQuality(page);
  await page.evaluate(() => { window.print = () => {}; });
  for (const v of SECTIONS) await h.show(page, v);
  for (const [sel, val] of [['#fQueue', 'Billing'], ['#fAgent', 'Asha Rao'], ['#fGroup', 'day']]) await page.selectOption(sel, val);
  await page.click('#fReset');
  await h.show(page, 'report');
  await h.download(page, () => page.locator('#v-report button', { hasText: 'Download full list' }).first().click());
  await h.download(page, () => page.locator('#v-report button', { hasText: '⬇ CSV' }).first().click());
  await h.show(page, 'quality');
  await h.download(page, () => page.locator('#v-quality button', { hasText: '⬇ CSV' }).first().click());
  await page.click('#pvfbTab'); await page.fill('#pvfbMsg', 'typing but not sending'); await page.click('#pvfbClose');
  await page.waitForTimeout(300);
  assert.deepEqual(noWork(sent).map(r => r.method + ' ' + r.url.slice(0, 80)), []);
  assert.deepEqual(await page.evaluate(() => window.__net), [], 'the page used fetch / XHR / beacon / WebSocket');
  assert.ok(sent.every(r => r.method === 'GET' && !r.body), 'a request carried a body');
  await context.close();
});

test('uploading a QA .xlsx file fetches only the Excel reader from cdnjs (pinned version 0.18.5) and nothing else', async () => {
  const { page, context, sent } = await watched();
  await h.loadQuality(page, h.qaXlsxFile());
  assert.equal(await page.evaluate(() => DS.quality.length), 8);
  assert.deepEqual(noWork(sent).map(r => r.url), [XLSX_URL]);
  assert.deepEqual(await page.evaluate(() => window.__net), []);
  await context.close();
});

test('a QA .csv upload never asks cdnjs for the Excel reader', async () => {
  const { page, context, sent } = await watched();
  await h.loadQuality(page, h.qaCsvFile());
  assert.deepEqual(noWork(sent), []);
  await context.close();
});

test('when the Excel reader cannot be fetched, the user gets a message and still nothing else is sent anywhere', async () => {
  const { page, context, sent, dialogs } = await watched({ xlsx: 'fail' });
  await page.setInputFiles('#fileInputQ', h.qaXlsxFile());
  await page.waitForTimeout(800);
  assert.ok(dialogs.some(d => /Excel reader/.test(d)), 'no friendly message: ' + JSON.stringify(dialogs));
  assert.deepEqual(noWork(sent).map(r => r.url), [XLSX_URL]);
  await context.close();
});

test('the web page has no forms, no tracking pixels, no analytics scripts and no outside iframes', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page);
  const found = await page.evaluate(() => ({
    forms: document.querySelectorAll('form').length,
    iframes: document.querySelectorAll('iframe').length,
    imgs: [...document.querySelectorAll('img')].map(i => i.src).filter(s => /^https?:/.test(s)),
    scripts: [...document.querySelectorAll('script[src]')].map(s => s.src),
    sendsData: /navigator\.sendBeacon|\bfetch\s*\(|XMLHttpRequest|WebSocket|gtag|google-analytics|googletagmanager|mixpanel|segment\.|hotjar|sentry/i.test(document.documentElement.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '')),
  }));
  assert.deepEqual(found, { forms: 0, iframes: 0, imgs: [], scripts: [], sendsData: false });
  await context.close();
});

/* ---------------- what the browser remembers ---------------- */

const ALLOWED_KEYS = /^(pcc-theme|pcc_note_.+|pcc_rca_[a-z0-9]+|pvfb-name)$/;

test('the browser memory holds only theme, supervisor notes, root-cause notes and the feedback name (no call data, no phone numbers)', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page); await h.loadQuality(page);
  await page.evaluate(() => setTheme('dark'));
  await h.show(page, 'report');
  await page.locator('#v-report input.scnote[data-agent="Asha Rao"]').first().fill('Coach on holds');
  await h.show(page, 'quality');
  const item = page.locator('#q-pareto .rca-item').first();
  await item.locator('textarea[data-f="rca"]').fill('Training gap');
  await page.click('#pvfbTab'); await page.fill('#pvfbName', 'Tester Test'); await page.fill('#pvfbMsg', 'hello there'); await page.click('#pvfbSend');
  const mem = await page.evaluate(async () => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    sessionKeys: Object.keys(sessionStorage),
    idb: indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : [],
    caches: window.caches ? await caches.keys() : [],
  }));
  assert.deepEqual(Object.keys(mem.local).filter(k => !ALLOWED_KEYS.test(k)), [], 'unexpected things kept in the browser');
  const all = JSON.stringify(mem.local);
  assert.ok(!/\+?1?3125550\d\d\d/.test(all), 'a phone number is stored in the browser');
  assert.ok(!/Caller booked|unhappy about a long wait/.test(all), 'a call summary is stored in the browser');
  assert.ok(!/Ended successfully|Missed Call|queue-caller-details/i.test(all), 'call data is stored in the browser');
  assert.deepEqual(mem.sessionKeys, []); assert.deepEqual(mem.idb, []); assert.deepEqual(mem.caches, []);
  assert.deepEqual((await context.cookies()), []);
  for (const k of ['pcc-theme', 'pvfb-name']) assert.ok(k in mem.local, k + ' should be remembered');
  await context.close();
});

test('uploading data alone writes nothing to the browser memory', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page); await h.loadQuality(page);
  for (const v of SECTIONS) await h.show(page, v);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert.ok(keys.every(k => k === 'pcc-theme'), 'keys written: ' + keys.join(', '));
  await context.close();
});

test('closing the page and opening it again shows no data (nothing about the calls is kept)', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page); await h.loadQuality(page);
  await page.reload();
  assert.equal(await page.evaluate(() => Object.keys(DS).length), 0);
  assert.ok(await page.isVisible('#drop'));
  await context.close();
});

/* ---------------- one client's QA rows do not leak into another client's view ---------------- */

function twoClients() {
  return [
    h.qaRow({ agent: 'Asha Rao', client: 'Client One', sup: 'Tariq Noor', auditor: 'Lena Kim', caller: '+13125550177', comments: 'Alpha-only comment' }),
    h.qaRow({ agent: 'Ben Cole', client: 'Client One', sup: 'Tariq Noor', auditor: 'Lena Kim', missed: ['Dead air management'] }),
    h.qaRow({ agent: 'Zed Zane', client: 'Client Two', sup: 'Quin Quark', auditor: 'Omar Faiz', caller: '+13125550188', comments: 'Beta-only comment', missed: ['Call ownership'] }),
    h.qaRow({ agent: 'Yara Yule', client: 'Client Two', sup: 'Quin Quark', auditor: 'Omar Faiz', missed: ['Call ownership', 'Dead air management'] }),
  ];
}
test('choosing one client hides the other client\'s agents, supervisors, auditors, caller IDs and comments on every QA screen, in the print view and in the CSV', async () => {
  const { page, context } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile(twoClients()));
  await h.show(page, 'quality');
  await page.locator('#v-quality .qsticky label', { hasText: 'Client' }).first().locator('select').selectOption('Client One');
  const other = ['Zed Zane', 'Yara Yule', 'Quin Quark', 'Omar Faiz', '3125550188', 'Beta-only comment', 'Client Two'];
  const fieldOptions = await page.evaluate(() => [...document.querySelectorAll('#v-quality .qsticky select option')].map(o => o.textContent));
  const text = (await page.innerText('#v-quality'));
  const screen = other.filter(w => text.includes(w) && !fieldOptions.includes(w));
  assert.deepEqual(screen, [], 'other client shows on screen');
  await page.emulateMedia({ media: 'print' });
  const printed = await page.innerText('#v-quality');
  assert.deepEqual(other.filter(w => printed.includes(w) && !fieldOptions.includes(w)), [], 'other client shows in print');
  await page.emulateMedia({ media: 'screen' });
  const csv = (await h.download(page, () => page.locator('#v-quality button', { hasText: '⬇ CSV' }).first().click())).text;
  assert.deepEqual(other.filter(w => csv.includes(w)), [], 'other client is in the CSV');
  assert.equal(h.parseCSVText(csv).length, 1 + 2);
  await context.close();
});

test('the Agent / Auditor drop-downs only list people from the chosen client', { todo: 'SUGGESTION: after choosing Client One the Agent and Auditor drop-downs still list every client\'s people (qOpts reads the whole sheet)' }, async () => {
  const { page, context } = await h.openApp();
  await h.loadQuality(page, h.qaCsvFile(twoClients()));
  await h.show(page, 'quality');
  await page.locator('#v-quality .qsticky label', { hasText: 'Client' }).first().locator('select').selectOption('Client One');
  const agents = await page.locator('#v-quality .qsticky label', { hasText: 'Agent' }).locator('option').allTextContents();
  await context.close();
  assert.ok(!agents.includes('Zed Zane'), 'Zed Zane (Client Two) is listed under Client One');
});

/* ---------------- the Feedback email ---------------- */

/** Opens the app, opens the Feedback tab, fills it, presses Send and returns the mailto: address the page tried to open. */
async function sendFeedback(page, { kind, name, message }) {
  const mailtos = [];
  page.on('request', r => { if (r.url().startsWith('mailto:')) mailtos.push(r.url()); });
  await page.click('#pvfbTab');
  if (kind) await page.locator('#pvfbKinds button', { hasText: kind }).click();
  if (name !== undefined) await page.fill('#pvfbName', name);
  await page.fill('#pvfbMsg', message);
  await page.click('#pvfbSend');
  await page.waitForTimeout(300);
  return mailtos;
}
const parseMailto = u => {
  const m = u.match(/^mailto:([^?]*)\?(.*)$/);
  const q = {}; m[2].split('&').forEach(p => { const i = p.indexOf('='); q[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); });
  return { to: decodeURIComponent(m[1]).split(','), q, rawQuery: m[2] };
};

test('Feedback: the tab opens a panel with three kinds, a name box, a message box and a disabled Send button; it closes with the X, Escape and "Close"', async () => {
  const { page, context, errors } = await h.openApp();
  assert.ok(await page.isVisible('#pvfbTab')); assert.ok(!(await page.isVisible('#pvfbPanel')));
  await page.click('#pvfbTab');
  assert.ok(await page.isVisible('#pvfbPanel')); assert.ok(!(await page.isVisible('#pvfbTab')));
  assert.deepEqual(await page.locator('#pvfbKinds button').allTextContents(), ['Something is wrong', 'I have an idea', 'This helped me']);
  assert.ok(await page.isDisabled('#pvfbSend'));
  assert.match(await page.innerText('#pvfbPanel'), /Never include patient details/);
  await page.click('#pvfbClose'); assert.ok(await page.isVisible('#pvfbTab'));
  await page.click('#pvfbTab'); await page.keyboard.press('Escape'); assert.ok(!(await page.isVisible('#pvfbPanel')));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pvfbTab', 'focus returns to the tab');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Feedback: Send stays off until there are at least 3 real characters (empty, spaces only and 2 characters are refused)', async () => {
  const { page, context } = await h.openApp();
  await page.click('#pvfbTab');
  for (const [text, enabled] of [['', false], ['   ', false], ['ab', false], ['  a  ', false], ['abc', true], ['   abc   ', true]]) {
    await page.fill('#pvfbMsg', text);
    assert.equal(await page.isEnabled('#pvfbSend'), enabled, JSON.stringify(text));
  }
  await context.close();
});

test('Feedback: the message box stops at 1000 characters and the "left" counter counts down', async () => {
  const { page, context } = await h.openApp();
  await page.click('#pvfbTab');
  await page.locator('#pvfbMsg').pressSequentially('x'.repeat(1050), { delay: 0 });
  assert.equal(await page.inputValue('#pvfbMsg').then(v => v.length), 1000);
  assert.equal(await page.innerText('#pvfbLeft'), '0 left');
  await page.fill('#pvfbMsg', 'x'.repeat(250));
  assert.equal(await page.innerText('#pvfbLeft'), '750 left');
  await context.close();
});

for (const [kind, label] of [['Something is wrong', 'problem'], ['I have an idea', 'idea'], ['This helped me', 'good']]) {
  test(`Feedback "${kind}": builds an email to exactly the two review addresses with the app name, type, name, page and message`, async () => {
    const { page, context, errors } = await h.openApp();
    await h.loadProduction(page); await h.loadQuality(page);
    await h.show(page, 'quality');
    const mails = await sendFeedback(page, { kind, name: 'Tester Test', message: 'The table is hard to read.' });
    assert.equal(mails.length, 1, 'exactly one email should be opened');
    const m = parseMailto(mails[0]);
    assert.deepEqual(m.to.sort(), OWNERS.slice().sort(), 'recipients');
    assert.deepEqual(Object.keys(m.q).sort(), ['body', 'subject'], 'no cc / bcc or other hidden fields');
    assert.equal(m.q.subject, 'PCC Dashboard feedback: ' + kind);
    assert.equal(m.q.body, `App: PCC Dashboard\nType: ${kind}\nFrom: Tester Test\nPage: QA report\n\nThe table is hard to read.`);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('Feedback: the email holds no call data even though call data is on screen (no phone numbers, summaries, agent names or counts)', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page); await h.loadQuality(page);
  await h.show(page, 'report');
  const mails = await sendFeedback(page, { name: 'Tester Test', message: 'The missed calls list is confusing.' });
  const body = parseMailto(mails[0]).q.body + parseMailto(mails[0]).q.subject;
  for (const bad of ['3125550', 'Caller booked', 'unhappy about a long wait', 'Asha Rao', 'Ben Cole', 'Cara Diaz', 'Main Line', 'Billing', 'Mar 2']) assert.ok(!body.includes(bad), 'found "' + bad + '" in the email');
  await context.close();
});

test('Feedback: odd characters (ampersand, quotes, plus, percent, hash, new lines, accents, emoji) arrive intact in the email', async () => {
  const { page, context } = await h.openApp();
  const msg = 'Fish & chips "quoted" 100% + more #1\nline two é ü 日本 ✓ <b>not html</b>';
  const mails = await sendFeedback(page, { name: "Dana O'Brien & Sons", message: msg });
  const m = parseMailto(mails[0]);
  assert.ok(m.q.body.endsWith(msg), 'message changed in transit: ' + JSON.stringify(m.q.body));
  assert.ok(m.q.body.includes("From: Dana O'Brien & Sons"));
  assert.ok(!/[&#]/.test(m.rawQuery.replace(/&body=/, '')), 'raw & or # left unencoded in the link');
  await context.close();
});

test('Feedback: on the first page (no report open) the "Page" line says "-", and the name line says "-" when no name is typed', async () => {
  const { page, context } = await h.openApp();
  const mails = await sendFeedback(page, { name: '', message: 'Nothing loads for me' });
  const b = parseMailto(mails[0]).q.body;
  assert.match(b, /From: -\nPage: -\n/);
  await context.close();
});

test('Feedback: after sending, the thank-you note shows, the message box is cleared, the page stays open (data is not lost) and the name is remembered next time', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page);
  await sendFeedback(page, { name: 'Tester Test', message: 'Looks good to me' });
  assert.ok(await page.isVisible('#pvfbDone'));
  assert.equal(await page.inputValue('#pvfbMsg'), '');
  assert.equal(await page.evaluate(() => Object.keys(DS).length > 0), true, 'the loaded data disappeared');
  assert.equal(page.url().startsWith('file://'), true);
  await page.click('#pvfbDoneClose');
  await page.click('#pvfbTab');
  assert.ok(await page.isVisible('#pvfbForm') && !(await page.isVisible('#pvfbDone')), 'form shows again');
  assert.equal(await page.inputValue('#pvfbName'), 'Tester Test');
  await page.reload(); await page.click('#pvfbTab');
  assert.equal(await page.inputValue('#pvfbName'), 'Tester Test', 'name lost after reload');
  await context.close();
});

test('Feedback: a message with many spaces and line breaks still makes a link short enough for common email programs (under 2000 characters)', async () => {
  const { page, context } = await h.openApp();
  const msg = ('Line of text with several words in it.\n').repeat(26).slice(0, 1000);
  const mails = await sendFeedback(page, { name: 'Tester Test', message: msg });
  await context.close();
  assert.ok(mails[0].length < 2000, 'link is ' + mails[0].length + ' characters long');
});

test('Feedback: the longest allowed message in a non-English language still fits in an email link', { todo: 'SUGGESTION: 1000 accented / non-Latin characters make a link of about 9000 characters; some email programs cut links at about 2000, so the message could arrive cut off' }, async () => {
  const { page, context } = await h.openApp();
  const mails = await sendFeedback(page, { name: 'Tester Test', message: 'é'.repeat(1000) });
  await context.close();
  assert.ok(mails[0].length < 2000, 'link is ' + mails[0].length + ' characters long');
});

test('Feedback: tab and panel are not printed', async () => {
  const { page, context } = await h.openApp();
  await h.loadProduction(page);
  await page.emulateMedia({ media: 'print' });
  assert.ok(!(await page.isVisible('#pvfbTab')));
  await page.emulateMedia({ media: 'screen' });
  await page.click('#pvfbTab'); await page.emulateMedia({ media: 'print' });
  assert.ok(!(await page.isVisible('#pvfbPanel')));
  await context.close();
});

/* ---------------- DOCUMENTED, not failed: where patient-identifying data appears ---------------- */

test('DOCUMENTED (a question for the owner): where caller phone numbers, AI call summaries and QA caller IDs / comments appear (screen, print, CSV)', async (tc) => {
  const qa = [
    h.qaRow({ agent: 'Asha Rao', caller: '+13125550177', comments: 'Patient asked about test results', missed: ['Dead air management'] }),
    h.qaRow({ agent: 'Ben Cole', caller: '+13125550178', comments: 'Caller was upset about billing', missed: ['Call ownership'] }),
  ];
  const { page, context } = await h.openApp({ beforeLoad: p => p.addInitScript(() => { window.print = () => {}; }) });
  await h.loadProduction(page); await h.loadQuality(page, h.qaCsvFile(qa));
  const markers = { 'caller phone number (call log)': /3125550(1[0-5]\d)/, 'AI call summary': /Caller booked|unhappy about a long wait/, 'QA caller ID': /3125550177|3125550178/, 'QA comment': /Patient asked about test results|Caller was upset/ };
  const table = [];
  const scan = (where, text) => Object.entries(markers).forEach(([k, re]) => { if (re.test(text)) table.push(`${where}: ${k}`); });
  for (const v of SECTIONS) { await h.show(page, v); scan('screen, ' + v, await page.innerText('#v-' + v)); }
  await page.emulateMedia({ media: 'print' });
  for (const v of ['report', 'quality']) { await h.show(page, v); scan('PRINT, ' + (v === 'report' ? 'production report' : 'QA report'), await page.innerText('#v-' + v)); }
  await page.emulateMedia({ media: 'screen' });
  await h.show(page, 'report');
  for (const [btn, file] of [['Download full list', 'missed_calls.csv'], ['Download no-callback list', 'no_callback_list.csv'], ['⬇ CSV', 'agent_scorecard.csv']]) {
    const d = await h.download(page, () => page.locator('#v-report button', { hasText: btn }).first().click()); scan('CSV DOWNLOAD ' + file, d.text);
  }
  await h.show(page, 'quality');
  scan('CSV DOWNLOAD quality_audits.csv', (await h.download(page, () => page.locator('#v-quality button', { hasText: '⬇ CSV' }).first().click())).text);
  table.forEach(l => tc.diagnostic(l));
  tc.diagnostic('Nothing is sent anywhere or stored in the browser; the question is whether these screens / prints / files may show these details.');
  assert.ok(table.length > 0);
  await context.close();
});
