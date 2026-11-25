'use strict';
// Area 11: basic security. Secrets in the code, data from files running as code on the page (XSS),
// quotes in names breaking buttons, spreadsheet-formula tricks in CSV downloads, outside scripts.
// Made-up data only. The "hostile" text below is a harmless marker that only counts how often it ran.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const h = require('./helpers');
const { SECTIONS } = require('./ui-helpers');

after(() => h.closeBrowser());

/* ---------------- secrets in the repository ---------------- */

function trackedFiles() {
  let list;
  try { list = execSync('git ls-files', { cwd: h.ROOT, encoding: 'utf8' }).split('\n').filter(Boolean); } catch (e) { list = ['index.html']; }
  // also check the working copy files that are not committed yet (new tests)
  try { list = list.concat(execSync('git ls-files --others --exclude-standard', { cwd: h.ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)); } catch (e) {}
  return [...new Set(list)].filter(f => fs.existsSync(path.join(h.ROOT, f)) && !/package-lock\.json$|node_modules\//.test(f));
}
const SECRET_PATTERNS = [
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['an OpenAI / Anthropic style key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  ['a bearer token', /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/],
  ['a password written into the code', /\b(password|passwd|pwd)\b\s*[:=]\s*['"][^'"\s]{4,}['"]/i],
  ['an API key / secret / token written into the code', /\b(api[_-]?key|secret|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"][A-Za-z0-9_\-\/+=]{8,}['"]/i],
  ['a Google Apps Script web address', /script\.google(usercontent)?\.com/i],
  ['a database / backend address with a key', /https?:\/\/[a-z0-9-]+\.(supabase\.co|firebaseio\.com|herokuapp\.com|azurewebsites\.net|execute-api\.[a-z0-9-]+\.amazonaws\.com)/i],
  ['a web address with a key or token in it', /https?:\/\/[^\s"'<>]+[?&](api_?key|key|token|access_token|secret|sig|signature)=[A-Za-z0-9_\-%]{8,}/i],
  ['a web address with a user name and password in it', /https?:\/\/[^\s\/:@"'<>]+:[^\s\/@"'<>]+@/],
];

test('no secrets in the repository: no API keys, tokens, passwords, private keys or Google Apps Script addresses in any tracked or new file', () => {
  const hits = [];
  for (const f of trackedFiles()) {
    if (f === 'tests/33-security.test.js') continue;       // this file contains the patterns themselves
    let text; try { text = fs.readFileSync(path.join(h.ROOT, f), 'utf8'); } catch (e) { continue; }
    if (text.includes('\u0000')) continue;
    for (const [what, re] of SECRET_PATTERNS) { const m = text.match(re); if (m) hits.push(`${f}: looks like ${what}: ${m[0].slice(0, 40)}`); }
  }
  assert.deepEqual(hits, []);
});

test('no environment / key files are tracked in the repository (.env, *.pem, *.key, credentials)', () => {
  const bad = trackedFiles().filter(f => /(^|\/)\.env(\.|$)|\.(pem|key|p12|pfx)$|credentials|secrets?\.(json|ya?ml)$/i.test(f));
  assert.deepEqual(bad, []);
});

test('the only places the page can send anything are the feedback email link and the Excel reader / font links (no hard-coded web addresses to post data to)', () => {
  const html = fs.readFileSync(path.join(h.ROOT, 'index.html'), 'utf8');
  const urls = [...new Set((html.match(/https?:\/\/[^\s"'<>)`]+/g) || []))].filter(u => !/^https?:\/\/(www\.)?w3\.org\//.test(u));
  const allowed = [/^https:\/\/fonts\.googleapis\.com/, /^https:\/\/fonts\.gstatic\.com/, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/0\.18\.5\//];
  assert.deepEqual(urls.filter(u => !allowed.some(a => a.test(u))), []);
});

/* ---------------- code injection through file contents ---------------- */

const P1 = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const P2 = '<script>window.__xss=1</script>';
const P3 = '"><b id=inj>';
const PAY = P1 + P2 + P3;
const PAYF = PAY.replace(/[\\/:*?|]/g, '');           // same text as a file name (no characters a file system refuses)

/** Replace one field on some rows. */
const hit = (rows, field, v = PAY, which = () => true) => rows.map((r, i) => (which(r, i) ? Object.assign({}, r, { [field]: v }) : r));

async function openHostile(prodFiles, qaFile) {
  const app = await h.openApp();
  app.page.on('dialog', () => {});
  if (prodFiles) await h.loadProduction(app.page, prodFiles);
  if (qaFile) await h.loadQuality(app.page, qaFile);
  return app;
}
/** Visit every screen, open every expandable row, show the upload page and its file list. */
async function visitAll(page) {
  for (const v of SECTIONS) {
    await h.show(page, v);
    if (v === 'quality') {
      for (let i = 0; i < 12; i++) {
        const closed = page.locator('#v-quality tr.row-parent:not(.open)').first();
        if (!(await closed.count())) break;
        await closed.click().catch(() => {});
      }
    }
  }
  await page.click('#fReload');
  await page.waitForTimeout(100);
  await h.show(page, 'report');
}
async function assertSafe(page, errors, what) {
  const r = await page.evaluate(() => ({ xss: window.__xss, inj: document.querySelectorAll('#inj').length, crash: [...document.querySelectorAll('.view')].filter(v => /Couldn't render/.test(v.innerHTML)).map(v => v.id) }));
  assert.equal(r.xss, undefined, `${what}: text from the file ran as code (${r.xss} time(s))`);
  assert.equal(r.inj, 0, `${what}: text from the file created a real page element (id "inj")`);
  assert.deepEqual(r.crash, [], `${what}: a screen crashed on this text`);
  assert.deepEqual(errors, [], `${what}: page errors`);
}

const Q = h.HEAD.queueDetails, C = h.HEAD.conversations;
const prod = (over = {}) => {
  const f = { queue: h.standardQueueRows(), conv: h.standardCallLog(), prodv: h.standardProductivity(), indiv: h.standardIndividual(), act: h.standardActivity(), pause: h.standardPause(), byDate: h.standardByDate() };
  Object.assign(f, over);
  return [h.csvFile('queue-caller-details.csv', f.queue, Q), h.csvFile('call-report-conversations.csv', f.conv, C), h.csvFile('agent-productivity.csv', f.prodv, h.HEAD.productivity),
    h.csvFile('individual-performance.csv', f.indiv, h.HEAD.individual), h.csvFile('agent-activity.csv', f.act, h.HEAD.activity), h.csvFile('pause-usage.csv', f.pause, h.HEAD.pause), h.csvFile('grouped-by-date.csv', f.byDate, h.HEAD.byDate)];
};
const isBen = r => /Ben Cole/.test(JSON.stringify(r));
const PROD_CASES = [
  ['agent name in the queue file', { queue: hit(h.standardQueueRows(), 'Agent Name', PAY, r => r['Agent Name'] === 'Ben Cole') }],
  ['queue name in the queue file', { queue: hit(h.standardQueueRows(), 'Queue', PAY, (r, i) => i % 2 === 0) }],
  ['"left queue reason" in the queue file', { queue: hit(h.standardQueueRows(), 'Left Queue Reason', PAY, r => r['Outcome'] === 'abandoned') }],
  ['"outcome" in the queue file', { queue: hit(h.standardQueueRows(), 'Outcome', PAY, (r, i) => i === 3) }],
  ['agent name in the productivity file', { prodv: hit(h.standardProductivity(), 'Agent name', PAY, isBen) }],
  ['agent name in the individual performance file', { indiv: hit(h.standardIndividual(), 'Agent name', PAY, isBen) }],
  ['agent name in the agent activity file', { act: hit(h.standardActivity(), 'User Name', PAY, isBen) }],
  ['substate in the agent activity file', { act: hit(h.standardActivity(), 'Substate', PAY, isBen) }],
  ['agent name in the pause file', { pause: hit(h.standardPause(), 'Agent name', PAY, isBen) }],
  ['pause reason in the pause file', { pause: hit(h.standardPause(), 'Pause reason', PAY) }],
  ['caller number ("From") in the call log', { conv: hit(h.standardCallLog(), 'From', PAY, (r, i) => i % 3 === 0) }],
  ['participants in the call log', { conv: hit(h.standardCallLog(), 'Participants', PAY) }],
  ['topics in the call log', { conv: hit(h.standardCallLog(), 'Topics', PAY) }],
  ['AI summary in the call log', { conv: hit(h.standardCallLog(), 'AI Summary', PAY) }],
  ['AI summary (negative call) in the call log', { conv: hit(h.standardCallLog(), 'AI Summary', PAY + ' unhappy wait', r => r['Sentiment'] === 'Negative' || r['Call Result'] === 'Missed Call') }],
  ['call result in the call log', { conv: hit(h.standardCallLog(), 'Call Result', PAY, (r, i) => i % 4 === 1) }],
  ['sentiment in the call log', { conv: hit(h.standardCallLog(), 'Sentiment', PAY) }],
  ['direction in the call log', { conv: hit(h.standardCallLog(), 'Direction', PAY, (r, i) => i % 5 === 1) }],
];
for (const [what, over] of PROD_CASES) {
  test(`hostile text as the ${what} cannot run code or create page elements, on any screen`, async () => {
    const { page, context, errors } = await openHostile(prod(over), h.qaCsvFile());
    await visitAll(page);
    await assertSafe(page, errors, what);
    await context.close();
  });
}

const qaMut = (field, v = PAY, which = (r, i) => i >= 3) => hit(h.standardQARows(), field, v, which);
const QA_CASES = [
  ['agent name in the QA sheet', 'Agent Name'], ['auditor name', 'Auditor Name'], ['client name', 'Client'],
  ['supervisor name', 'Supervisior'], ['manager name', 'Manager'], ['comments', 'Comments'], ['rebuttal reason', 'Rebuttal Reason'],
  ['QA status', 'QA Status'], ['caller ID', 'Caller ID'], ['rebuttal status', 'Rebuttal Status'], ['feedback shared', 'Feedback Shared'],
];
for (const [what, field] of QA_CASES) {
  test(`hostile text as the ${what} (QA sheet) cannot run code or create page elements, on any screen`, async () => {
    const rows = qaMut(field);
    if (field === 'Rebuttal Reason' || field === 'Rebuttal Status') rows.forEach(r => { r['Rebuttal Raised'] = 'Yes'; });
    const { page, context, errors } = await openHostile(prod(), h.qaCsvFile(rows));
    await visitAll(page);
    await assertSafe(page, errors, what);
    await context.close();
  });
}

test('hostile text as a scoring-key parameter name (Excel "Scoring Key" tab and its column heading) cannot run code or create page elements', async () => {
  const orig = h.QA_PARAMS[3][1];
  const params = h.QA_PARAMS.map((p, i) => (i === 3 ? [p[0], PAY, p[2], p[3]] : p));
  const rows = h.standardQARows().map((r, i) => { const o = Object.assign({}, r); o[PAY] = i % 2 ? 'N' : 'Y'; delete o[orig]; return o; });
  const head = h.QA_HEAD.map(x => (x === orig ? PAY : x));
  const { page, context, errors } = await openHostile(prod(), h.qaXlsxFile(rows, { params, head }));
  assert.ok(await page.evaluate(() => DS.quality && DS.quality.length > 0), 'the sheet did not load');
  await visitAll(page);
  await assertSafe(page, errors, 'scoring key parameter');
  await context.close();
});

test('hostile text as a category name in the Excel "Scoring Key" tab cannot run code or create page elements', async () => {
  const params = h.QA_PARAMS.map((p, i) => (i === 3 ? [PAY, p[1], p[2], p[3]] : p));
  const { page, context, errors } = await openHostile(prod(), h.qaXlsxFile(h.standardQARows(), { params }));
  await visitAll(page);
  await assertSafe(page, errors, 'scoring key category');
  await context.close();
});

test('hostile text in the NAME of an uploaded production file cannot run code or create page elements (file list on the upload page)', async () => {
  const files = prod().map((f, i) => (i < 3 ? Object.assign({}, f, { name: `${PAYF}-${i}.csv` }) : f));
  const { page, context, errors } = await openHostile(files, null);
  await visitAll(page);
  await assertSafe(page, errors, 'production file name');
  await context.close();
});

test('hostile text in the NAME of the uploaded QA file (CSV) cannot run code or create page elements', async () => {
  const q = Object.assign({}, h.qaCsvFile(), { name: `${PAYF}.csv` });
  const { page, context, errors } = await openHostile(prod(), q);
  await visitAll(page);
  await assertSafe(page, errors, 'QA csv file name');
  await context.close();
});

test('hostile text in the NAME of the uploaded QA Excel file cannot run code or create page elements', async () => {
  const q = h.qaXlsxFile(null, { name: `${PAYF}.xlsx` });
  const { page, context, errors } = await openHostile(prod(), q);
  await visitAll(page);
  await assertSafe(page, errors, 'QA xlsx file name');
  await context.close();
});

test('hostile text in a file whose columns are not recognised is only shown as plain text', async () => {
  const odd = h.rawFile(`${PAYF}.csv`, `${PAY},b\r\n${PAY},2\r\n`);
  const { page, context, errors } = await openHostile([odd], null);
  await page.waitForTimeout(200);
  await assertSafe(page, errors, 'unrecognised file');
  await context.close();
});

test('hostile text typed into a supervisor note or the feedback box is not run as code when the screen redraws', async () => {
  const { page, context, errors } = await openHostile(prod(), h.qaCsvFile());
  await h.show(page, 'report');
  await page.locator('#v-report input.scnote').first().fill(PAY);
  await page.evaluate(() => renderAll());
  await h.show(page, 'quality');
  const item = page.locator('#q-pareto .rca-item').first();
  await item.locator('textarea[data-f="rca"]').fill(PAY);
  await item.locator('select[data-f="why"]').selectOption('Other');
  await item.locator('input[data-f="whyOther"]').fill(PAY);
  await page.evaluate(() => renderAll());
  await visitAll(page);
  await assertSafe(page, errors, 'typed notes');
  await context.close();
});

test('hostile text in the supervisor-note box does not break the note box itself (quotes in an agent\'s name keep the note under the right name)', async () => {
  const name = 'Zoe "Z" O\'Neil';
  const mk = (rows, k) => rows.map(r => (r[k] === 'Cara Diaz' ? Object.assign({}, r, { [k]: name }) : r));
  const files = prod({ queue: mk(h.standardQueueRows(), 'Agent Name'), prodv: mk(h.standardProductivity(), 'Agent name'), indiv: mk(h.standardIndividual(), 'Agent name') });
  const { page, context, errors } = await openHostile(files, null);
  await h.show(page, 'report');
  const box = page.locator('#v-report input.scnote').filter({ has: page.locator('xpath=.') });
  const names = await page.evaluate(() => [...document.querySelectorAll('#v-report input.scnote')].map(i => i.getAttribute('data-agent')));
  assert.ok(names.includes(name), 'the note box is not tied to the full name: ' + JSON.stringify(names));
  await page.locator('#v-report input.scnote').nth(names.indexOf(name)).fill('remember me');
  assert.equal(await page.evaluate(n => localStorage.getItem('pcc_note_' + n), name), 'remember me');
  assert.deepEqual(errors, []);
  void box;
  await context.close();
});

/* ---------------- names with quotes in buttons that are built from data ---------------- */

const AWKWARD = [
  ['an apostrophe and quotes', `O'Brien & "Sons"`, `D'Arcy "DJ" Lee`],
  ['a backslash', 'Back\\slash Clinic', 'Sam\\Jones'],
  ['angle brackets and an ampersand', 'A<B> & C', 'R&D <lead>'],
  ['a percent sign and a hash', '100% Care #1', 'Pat #2 100%'],
  ['accents and symbols', 'Clínica Ñandú 日本', 'Zoë ✓'],
];
for (const [what, client, sup] of AWKWARD) {
  test(`QA breakdown: a client and supervisor name with ${what} can still be opened and closed by clicking`, async () => {
    const rows = [
      h.qaRow({ agent: 'Asha Rao', client, sup }), h.qaRow({ agent: 'Ben Cole', client, sup, missed: ['Dead air management'] }),
      h.qaRow({ agent: 'Cara Diaz', client: 'Plain Client', sup: 'Plain Sup', missed: ['Call ownership'] }),
    ];
    const { page, context, errors } = await openHostile(null, h.qaCsvFile(rows));
    await h.show(page, 'quality');
    const count = () => page.locator('#q-breakdown tbody tr').count();
    assert.equal(await count(), 2);
    await page.locator('#q-breakdown tr.row-parent').filter({ hasText: client }).first().click();
    assert.equal(await count(), 3, 'client row did not open its supervisor');
    await page.locator('#q-breakdown tr.row-parent').filter({ hasText: sup }).first().click();
    assert.equal(await count(), 5, 'supervisor row did not open its agents');
    assert.equal(await page.locator('#q-breakdown tr.row-child').count(), 2);
    await page.locator('#q-breakdown tr.row-parent').filter({ hasText: sup }).first().click();
    assert.equal(await count(), 3, 'supervisor row did not close again');
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('QA breakdown: a client name that contains a line break can still be opened by clicking', async () => {
  const client = 'Line one\nLine two';
  const rows = [h.qaRow({ agent: 'Asha Rao', client }), h.qaRow({ agent: 'Ben Cole', client, missed: ['Call ownership'] })];
  const { page, context, errors } = await openHostile(null, h.qaCsvFile(rows));
  await h.show(page, 'quality');
  await page.locator('#q-breakdown tr.row-parent').first().click();
  assert.equal(await page.locator('#q-breakdown tbody tr').count(), 2, 'the row did not open');
  assert.deepEqual(errors, []);
  await context.close();
});

test('QA filters: a client name with quotes can be chosen in the drop-down and filters the report', async () => {
  const client = `O'Brien & "Sons"`;
  const rows = [h.qaRow({ agent: 'Asha Rao', client }), h.qaRow({ agent: 'Cara Diaz', client: 'Plain Client', missed: ['Call ownership'] })];
  const { page, context, errors } = await openHostile(null, h.qaCsvFile(rows));
  await h.show(page, 'quality');
  await page.locator('#v-quality .qsticky label', { hasText: 'Client' }).first().locator('select').selectOption({ label: client });
  assert.match(await page.innerText('#v-quality .sub'), /1 of 2 audits/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('names that look like built-in JavaScript words (__proto__, constructor, toString, hasOwnProperty) do not break any screen', async () => {
  const words = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
  const swap = (rows, k) => rows.map(r => { const i = ['Asha Rao', 'Ben Cole', 'Cara Diaz'].indexOf(r[k]); return i >= 0 ? Object.assign({}, r, { [k]: words[i] }) : r; });
  const files = prod({ queue: hit(swap(h.standardQueueRows(), 'Agent Name'), 'Queue', 'constructor', (r, i) => i % 3 === 0), prodv: swap(h.standardProductivity(), 'Agent name'), indiv: swap(h.standardIndividual(), 'Agent name'), act: swap(h.standardActivity(), 'User Name'), pause: swap(h.standardPause(), 'Agent name') });
  const qa = h.standardQARows().map(r => Object.assign({}, r, { 'Agent Name': words[['Asha Rao', 'Ben Cole', 'Cara Diaz'].indexOf(r['Agent Name'])] || r['Agent Name'], Client: 'constructor', Supervisior: '__proto__' }));
  const { page, context, errors } = await openHostile(files, h.qaCsvFile(qa));
  await visitAll(page);
  const crash = await page.evaluate(() => [...document.querySelectorAll('.view')].filter(v => /Couldn't render/.test(v.innerHTML)).map(v => v.id));
  assert.deepEqual(crash, [], 'screens that crashed');
  assert.deepEqual(errors, []);
  await context.close();
});

/* ---------------- spreadsheet formulas in CSV downloads ---------------- */

const FORMULAS = ['=1+1', '=HYPERLINK("http://example.invalid/","click")', '@SUM(1+1)', '+cmd|\' /C calc\'!A0', '-2+3+cmd', '=cmd|\' /C calc\'!A0'];
const unsafeStart = s => /^[=+\-@\t\r]/.test(s) && !/^\+?\d[\d\s().-]*$/.test(s) && !/^-?\d+(\.\d+)?$/.test(s);
function dangerous(csvText) {
  const rows = h.parseCSVText(csvText); const out = [];
  rows.forEach((r, i) => r.forEach((c, j) => { if (i > 0 && unsafeStart(c)) out.push(`row ${i + 1}, column ${j + 1}: ${c.slice(0, 40)}`); }));
  return out;
}

test('CSV downloads: text from the data that starts with = + - or @ is made safe for Excel (missed calls, agent scorecard and quality audits)', async (tc) => {
  const conv = h.standardCallLog().concat(FORMULAS.map((f, i) => h.cRow({ date: `2026-03-0${2 + (i % 3)}T10:${10 + i}:00-06:00`, dir: 'Inbound', res: 'Missed Call', from: f, dur: 10000 })));
  const rename = (rows, k) => rows.map(r => (r[k] === 'Ben Cole' ? Object.assign({}, r, { [k]: '=1+1' }) : r));
  const files = prod({ conv, queue: rename(h.standardQueueRows(), 'Agent Name'), prodv: rename(h.standardProductivity(), 'Agent name'), indiv: rename(h.standardIndividual(), 'Agent name') });
  const qa = h.standardQARows().map((r, i) => Object.assign({}, r, { 'Agent Name': ['=1+1', '@SUM(1+1)', '+cmd|x', '-2+3+cmd'][i % 4], Client: '=HYPERLINK("http://example.invalid/","x")', Comments: "=cmd|' /C calc'!A0", 'Rebuttal Reason': '@x' }));
  const { page, context } = await openHostile(files, h.qaCsvFile(qa));
  await h.show(page, 'report');
  const found = {};
  for (const [btn, file] of [['Download full list', 'missed_calls.csv'], ['Download no-callback list', 'no_callback_list.csv'], ['⬇ CSV', 'agent_scorecard.csv']]) {
    const d = await h.download(page, () => page.locator('#v-report button', { hasText: btn }).first().click());
    found[file] = dangerous(d.text);
  }
  await h.show(page, 'quality');
  found['quality_audits.csv'] = dangerous((await h.download(page, () => page.locator('#v-quality button', { hasText: '⬇ CSV' }).first().click())).text);
  await context.close();
  for (const [f, list] of Object.entries(found)) tc.diagnostic(`${f}: ${list.length} cell(s) that Excel would read as a formula: ${list.slice(0, 3).join(' | ')}`);
  assert.deepEqual(Object.fromEntries(Object.entries(found).map(([f, l]) => [f, l.length])), { 'missed_calls.csv': 0, 'no_callback_list.csv': 0, 'agent_scorecard.csv': 0, 'quality_audits.csv': 0 });
});

test('CSV downloads: real phone numbers (+13125550150) and negative numbers stay readable as they are', async () => {
  const qa = h.standardQARows().map(r => Object.assign({}, r, { 'Caller ID': '+13125550150', Comments: '-12.5' }));
  const { page, context } = await openHostile(prod(), h.qaCsvFile(qa));
  await h.show(page, 'report');
  const missed = h.parseCSVText((await h.download(page, () => page.locator('#v-report button', { hasText: 'Download full list' }).first().click())).text);
  assert.ok(missed.slice(1).some(r => r[0] === '+13125550150'), 'phone number changed: ' + JSON.stringify(missed.slice(1, 3)));
  await h.show(page, 'quality');
  const q = h.parseCSVText((await h.download(page, () => page.locator('#v-quality button', { hasText: '⬇ CSV' }).first().click())).text);
  const head = q[0];
  assert.equal(q[1][head.indexOf('Caller ID')], '+13125550150');
  assert.equal(q[1][head.indexOf('Comments')], '-12.5');
  await context.close();
});

test('CSV downloads: a cell with a comma, a quote or a line break stays in its own cell', async () => {
  const qa = h.standardQARows().map(r => Object.assign({}, r, { Comments: 'He said "stop", then\nleft' }));
  const { page, context } = await openHostile(null, h.qaCsvFile(qa));
  await h.show(page, 'quality');
  const q = h.parseCSVText((await h.download(page, () => page.locator('#v-quality button', { hasText: '⬇ CSV' }).first().click())).text);
  assert.equal(q.length, 9);
  assert.equal(q[1][q[0].indexOf('Comments')], 'He said "stop", then\nleft');
  assert.ok(q.every(r => r.length === q[0].length), 'a row has the wrong number of cells');
  await context.close();
});

/* ---------------- outside scripts and page-level protection (documented) ---------------- */

test('the Excel reader is loaded from one pinned version on cdnjs over https', async () => {
  const { page, context } = await h.openApp();
  await h.loadQuality(page, h.qaXlsxFile());
  const s = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(x => ({ src: x.src, integrity: x.integrity, cross: x.crossOrigin })));
  await context.close();
  assert.equal(s.length, 1);
  assert.equal(s[0].src, 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
});

test('the Excel reader script is protected by an integrity hash (so a tampered file would be refused)', { todo: 'SUGGESTION (documented): the script is added without an "integrity" hash or crossorigin attribute, so whatever cdnjs serves is run with full access to the page and the loaded data' }, async () => {
  const { page, context } = await h.openApp();
  await h.loadQuality(page, h.qaXlsxFile());
  const integrity = await page.evaluate(() => document.querySelector('script[src*="cdnjs"]').integrity);
  await context.close();
  assert.match(integrity, /^sha(256|384|512)-/);
});

test('the page declares a Content-Security-Policy that blocks other outside scripts', { todo: 'SUGGESTION (documented): no Content-Security-Policy, so nothing stops injected or tampered content from loading or sending to other sites' }, async () => {
  const { page, context } = await h.openApp();
  const csp = await page.evaluate(() => (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '');
  await context.close();
  assert.ok(/script-src/.test(csp));
});
