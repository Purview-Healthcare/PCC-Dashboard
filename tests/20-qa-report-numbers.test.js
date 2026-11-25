'use strict';
/*
 * QA report: every figure checked against answers worked out by hand from the made-up QA sheets.
 * Made-up names only (Asha Rao, Ben Cole, Cara Diaz ...), made-up caller ids in the 555-01xx range.
 *
 * THE STANDARD QA SET (h.standardQARows(), 8 audits, all "Client One", supervisor Tariq Noor, auditor Lena Kim)
 *   #  agent      audit date (DOA)  call date (DOC)  what was missed                                   score
 *   1  Asha Rao   Tue 3 Mar         2 Mar            nothing                                            100
 *   2  Asha Rao   Wed 4 Mar         3 Mar            nothing                                            100
 *   3  Asha Rao   Tue 10 Mar        9 Mar            nothing                                            100
 *   4  Ben Cole   Tue 3 Mar         2 Mar            Correct appointment handling (FATAL)                 0   feedback shared, dated 4 Mar
 *   5  Ben Cole   Wed 4 Mar         3 Mar            Insurance EV Details Captured (10)                  90   rebuttal raised, Accepted
 *   6  Ben Cole   Wed 11 Mar        10 Mar           nothing                                            100
 *   7  Cara Diaz  Wed 4 Mar         3 Mar            Dead air management (5) + Call ownership (5)        90   rebuttal raised, Rejected
 *   8  Cara Diaz  Wed 11 Mar        10 Mar           Correct information shared (FATAL) + Recap (3)       0
 *
 * Worked answers
 *   Average score          = (100+100+100+0+90+100+90+0)/8 = 580/8 = 72.5
 *   Clean audits (status "No Error") = 1,2,3,6 = 4  -> 4/8 = 50.0%
 *   Fatal errors           = 2 (rows 4 and 8) -> 2 audits scored 0 -> 25%
 *   Non-fatal errors       = 1 (row 5) + 2 (row 7) + 1 (row 8) = 4, spread over 3 audits
 *   Defects in total       = 2 + 4 = 6, every one a different parameter (1 each)
 *   Per agent: Asha 3 audits 100%;  Ben 3 audits, 1 fatal, 1 non-fatal, (0+90+100)/3 = 63.3%;
 *              Cara 2 audits, 1 fatal, 3 non-fatal, (90+0)/2 = 45%
 *   Weeks (Monday start, by audit date):
 *     Week 1 = Mon 2 - Sun 8 Mar: rows 1,2,4,5,7 = 5 audits, (100+100+0+90+90)/5 = 76%, 1 fatal, 2 clean, 3 error, 40% clean, 2 rebuttals
 *     Week 2 = Mon 9 - Sun 15 Mar: rows 3,6,8 = 3 audits, (100+100+0)/3 = 66.7%, 1 fatal, 2 clean, 1 error, 66.7% clean, 0 rebuttals
 *   Outliers (average 95% or below): Ben (63.3) and Cara (45). Asha is above.
 *     Cara: week 1 = 90, week 2 = 0 -> both at or below 95 -> 2 weeks in a row -> QIP / PIP.
 *     Ben:  week 1 = (0+90)/2 = 45, week 2 = 100 -> only 1 week in a row -> "Coach now".
 *   Pareto: 6 defects, each 1. Sorted by count then name. Cumulative 17, 33, 50, 67, 83, 100.
 *     First place the running total reaches 80% is the 5th bar -> 5 vital few, which drive 83% (5 of 6).
 *   Rebuttals: 2 raised, 1 Accepted (Ben), 1 Rejected (Cara), 0 pending. Overturn = 1/(1+1) = 50.0%.
 *   Feedback: 1 shared (row 4). Flagged audits with no feedback = rows 5,7,8 = 3 (row 4 has it).
 *     Cases (agent + parameter that had an error) = 6: Ben/appointment has feedback and no later repeat (cleared 1),
 *     Ben/insurance + Cara x4 never had feedback (5).
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

const E = h.EXPECT_QA;
const close = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

async function openQA(rows, opts) {
  const app = await h.openApp(opts);
  await h.loadQuality(app.page, h.qaCsvFile(rows || h.standardQARows()));
  await h.show(app.page, 'quality');
  return app;
}
const kp = (page, label) => h.kpi(page, 'quality', label);
/** all cells of one table inside a section, as arrays of text */
const tbl = (page, sel, idx = 0) => page.evaluate(([s, i]) => {
  const t = document.querySelectorAll(s)[i]; if (!t) return null;
  return [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim()));
}, [sel, idx]);
/** text of a section (or of the whole QA report), without the drop-down lists (those always list every client / agent) */
const textOf = (page, id) => page.evaluate(i => {
  const el = document.getElementById(i);
  const sels = [...el.querySelectorAll('select')]; const old = sels.map(s => s.style.display);
  sels.forEach(s => { s.style.display = 'none'; });
  const t = el.innerText.replace(/\s+/g, ' ');
  sels.forEach((s, k) => { s.style.display = old[k]; });
  return t;
}, id);
const secText = textOf;
const pageText = page => textOf(page, 'v-quality');
const selectFilter = (page, label, value) =>
  page.locator('#v-quality .qsticky label', { hasText: label }).locator('select').selectOption(value);

/* ---------------------------------------------------------------- overview cards */
test('overview cards: audits, average score, clean rate, fatal, non-fatal, error/FYI, outliers, rebuttals', async () => {
  const { page, context, errors, dialogs } = await openQA();
  assert.equal((await kp(page, 'Audits')).value, '8');
  assert.equal((await kp(page, 'Avg QA score')).value, E.avgScore.toFixed(1) + '%');
  const clean = await kp(page, 'No-error rate');
  assert.equal(clean.value, '50.0%'); assert.match(clean.foot, /4 clean/);
  const fatal = await kp(page, 'Fatal errors');
  assert.equal(fatal.value, '2'); assert.match(fatal.foot, /2 audits scored 0/); assert.match(fatal.foot, /25%/);
  const nf = await kp(page, 'Non-fatal errors');
  assert.equal(nf.value, '4'); assert.match(nf.foot, /across 3 audits/);
  assert.equal((await kp(page, 'Error / FYI')).value, '4 / 0');
  assert.equal((await kp(page, 'Outliers')).value, '2');
  assert.equal((await kp(page, 'Rebuttals')).value, String(E.rebuttalsRaised));
  assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  await context.close();
});

test('the QA-score-by-agent bars show 100, 63 and 45 percent', async () => {
  const { page, context } = await openQA();
  const t = await secText(page, 'q-overview');
  assert.match(t, /Asha Rao 100%/); assert.match(t, /Ben Cole 63%/); assert.match(t, /Cara Diaz 45%/);
  await context.close();
});

test('audit status split shows 4 No Error and 4 Error', async () => {
  const { page, context } = await openQA();
  const t = await secText(page, 'q-overview');
  assert.match(t, /No Error 4/); assert.match(t, /Error 4/);
  await context.close();
});

/* ---------------------------------------------------------------- fatal / non-fatal */
test('fatal and non-fatal errors by parameter: each parameter shows its type, weight, misses and who missed it', async () => {
  const { page, context } = await openQA();
  const t = await h.tableAfterTitle(page, 'quality', 'By parameter');
  const row = name => t.find(r => r[0].startsWith(name));
  // [name+category, type, weight, missed, agents]
  assert.deepEqual(row('Correct appointment handling').slice(1), ['Fatal', '10', '1', 'Ben Cole']);
  assert.deepEqual(row('Correct information shared').slice(1), ['Fatal', '10', '1', 'Cara Diaz']);
  assert.deepEqual(row('Call resolution achieved').slice(1), ['Fatal', '5', '0', '—']);
  assert.deepEqual(row('Insurance EV Details Captured').slice(1), ['Non-fatal', '10', '1', 'Ben Cole']);
  assert.deepEqual(row('Dead air management').slice(1), ['Non-fatal', '5', '1', 'Cara Diaz']);
  assert.deepEqual(row('Call ownership').slice(1), ['Non-fatal', '5', '1', 'Cara Diaz']);
  assert.deepEqual(row('Recap & next steps').slice(1), ['Non-fatal', '3', '1', 'Cara Diaz']);
  assert.deepEqual(row('Proper closing statement').slice(1), ['Non-fatal', '2', '0', '—']);
  // 17 parameters + the header row
  assert.equal(t.length, 18);
  // fatal parameters are listed first
  assert.deepEqual(t.slice(1, 4).map(r => r[1]), ['Fatal', 'Fatal', 'Fatal']);
  await context.close();
});

test('fatal and non-fatal errors by agent: Cara 1 fatal / 3 non-fatal / 1 zero audit, Ben 1 / 1 / 1, Asha is not listed', async () => {
  const { page, context } = await openQA();
  const t = await h.tableAfterTitle(page, 'quality', 'By agent');
  assert.deepEqual(t.slice(1), [['Cara Diaz', '1', '3', '1'], ['Ben Cole', '1', '1', '1']]);
  await context.close();
});

/* ---------------------------------------------------------------- score breakdown */
test('score breakdown: client row, then supervisor, then agents when expanded', async () => {
  const { page, context } = await openQA();
  let t = await tbl(page, '#q-breakdown table');
  assert.deepEqual(t[1], ['▶ Client One', '8', '2', '4', '73%']);          // 72.5 shown as 73
  assert.deepEqual(t[t.length - 1], ['All clients', '8', '2', '4', '73%']);
  assert.equal(t.length, 3, 'collapsed: header, client, total');
  await page.evaluate(() => qToggleSup('c|Client One'));
  t = await tbl(page, '#q-breakdown table');
  assert.deepEqual(t[2], ['▶ Tariq Noor', '8', '2', '4', '73%']);
  await page.evaluate(() => qToggleSup('s|Client One|Tariq Noor'));
  t = await tbl(page, '#q-breakdown table');
  // lowest score first: Cara 45, Ben 63, Asha 100
  const agents = t.filter(r => /^•/.test(r[0]));
  assert.deepEqual(agents.map(r => r.slice(0, 5)), [
    ['•Cara Diaz Outlier', '2', '1', '3', '45%'],
    ['•Ben Cole Outlier', '3', '1', '1', '63%'],
    ['•Asha Rao', '3', '0', '0', '100%'],
  ]);
  await context.close();
});

test('score breakdown with two clients and two supervisors keeps every row under the right parent', async () => {
  const rows = h.standardQARows().concat([
    h.qaRow({ agent: 'Dev Patel', client: 'Client Two', sup: 'Uma Rao', doa: '2026-03-05', doc: '2026-03-04', missed: ['Dead air management'] }),
    h.qaRow({ agent: 'Eli Stone', client: 'Client Two', sup: 'Vik Das', doa: '2026-03-05', doc: '2026-03-04' }),
  ]);
  const { page, context } = await openQA(rows);
  await page.evaluate(() => { qToggleSup('c|Client Two'); qToggleSup('s|Client Two|Uma Rao'); });
  const t = await tbl(page, '#q-breakdown table');
  const txt = t.map(r => r.join('|'));
  const iC2 = txt.findIndex(r => r.startsWith('▶ Client Two'));
  assert.equal(t[iC2][1], '2'); assert.equal(t[iC2][4], '98%');          // (95+100)/2 = 97.5, shown rounded as 98
  const iC1 = txt.findIndex(r => r.startsWith('▶ Client One'));
  assert.equal(t[iC1][1], '8'); assert.equal(t[iC1][4], '73%', 'Client One is not mixed up with Client Two');
  assert.ok(txt.some(r => r.startsWith('▶ Uma Rao|1|0|1|95%')), 'supervisor Uma Rao sits under Client Two with her 1 audit');
  await context.close();
});

/* ---------------------------------------------------------------- weekly breakdown */
test('weekly breakdown: Week 1 (Mar 2-8) and Week 2 (Mar 9-15) with audits, average, fatal, clean rate and rebuttals', async () => {
  const { page, context } = await openQA();
  const tables = await page.evaluate(() => [...document.querySelectorAll('#q-overview table')].length);
  const t = await tbl(page, '#q-overview table', tables - 1);
  // header: Week / agent, Audits, Avg score, Fatal, No error, FYI, Error, No-error rate, Rebuttals
  assert.deepEqual(t[1], ['▶ Week 1 · Mar 2–8', '5', '76%', '1', '2', '0', '3', '40%', '2']);
  assert.deepEqual(t[2], ['▶ Week 2 · Mar 9–15', '3', '67%', '1', '2', '0', '1', '67%', '0']);
  await context.close();
});

test('weekly breakdown can be opened to show each agent for that week', async () => {
  const { page, context } = await openQA();
  const key = await page.evaluate(() => weekOf('2026-03-03').key);
  await page.evaluate(k => qToggleSup('w|' + k), key);
  const tables = await page.evaluate(() => document.querySelectorAll('#q-overview table').length);
  const t = await tbl(page, '#q-overview table', tables - 1);
  const kids = t.filter(r => /^•/.test(r[0]));
  // week 1 agents: Ben (0 and 90 -> 45), Cara (90), Asha (100, 100); lowest first
  assert.deepEqual(kids.map(r => [r[0], r[1], r[2]]), [['•Ben Cole', '2', '45%'], ['•Cara Diaz', '1', '90%'], ['•Asha Rao', '2', '100%']]);
  await context.close();
});

/* ---------------------------------------------------------------- outliers */
test('outliers: Ben and Cara are outliers, only Cara has 2 weeks in a row (QIP / PIP), Asha is within target', async () => {
  const { page, context } = await openQA();
  assert.equal((await kp(page, 'Outliers')).value, '2');
  assert.equal((await kp(page, 'QIP / PIP candidates')).value, '1');
  assert.equal((await kp(page, 'Within target')).value, '1');
  const t = await h.tableAfterTitle(page, 'quality', 'Outlier watchlist');
  assert.deepEqual(t[1].slice(0, 8), ['Cara Diaz Outlier', 'Client One', 'Tariq Noor', '2', '4', '45%', '2', 'Move to QIP / PIP']);
  assert.deepEqual(t[2].slice(0, 8), ['Ben Cole Outlier', 'Client One', 'Tariq Noor', '3', '2', '63%', '1', 'Coach now']);
  const flags = await secText(page, 'q-outliers');
  assert.match(flags, /Cara Diaz scored 95% or below for 2 consecutive weeks \(Mar 2–8 90%, Mar 9–15 0%\)/);
  assert.match(flags, /Ben Cole is at 63%/);
  await context.close();
});

test('the 95% line is "95 and below": an agent averaging exactly 95 is an outlier, 96 is not', async () => {
  // 95 = 100 minus a 5-point miss; 96 = 100 minus a 3 + ... use Total Score overrides
  const rows = [
    h.qaRow({ agent: 'Exactly Ninetyfive', score: 95, doa: '2026-03-03' }),
    h.qaRow({ agent: 'Just Above', score: 96, doa: '2026-03-03' }),
  ];
  const { page, context } = await openQA(rows);
  const t = await h.tableAfterTitle(page, 'quality', 'Outlier watchlist');
  assert.equal(t.length, 2, 'header + exactly one outlier');
  assert.match(t[1][0], /Exactly Ninetyfive/);
  await context.close();
});

test('two weeks in a row needs the weeks to be next to each other: a good week in between breaks the run', async () => {
  // Fay: week of Mar 2 = 80, week of Mar 9 = 100, week of Mar 16 = 80 -> never 2 in a row
  const rows = [
    h.qaRow({ agent: 'Fay Lowe', score: 80, doa: '2026-03-03' }),
    h.qaRow({ agent: 'Fay Lowe', score: 100, doa: '2026-03-10' }),
    h.qaRow({ agent: 'Fay Lowe', score: 80, doa: '2026-03-17' }),
    // Gus: week of Mar 2 = 80, week of Mar 9 = 80 -> 2 in a row
    h.qaRow({ agent: 'Gus Hale', score: 80, doa: '2026-03-04' }),
    h.qaRow({ agent: 'Gus Hale', score: 80, doa: '2026-03-11' }),
  ];
  const { page, context } = await openQA(rows);
  const t = await h.tableAfterTitle(page, 'quality', 'Outlier watchlist');
  const by = n => t.find(r => r[0].startsWith(n));
  assert.equal(by('Gus Hale')[7], 'Move to QIP / PIP');
  // Fay averages (80+100+80)/3 = 86.7, so she is an outlier, but only 1 week in a row
  assert.equal(by('Fay Lowe')[6], '1');
  assert.equal(by('Fay Lowe')[7], 'Coach now');
  await context.close();
});

/* ---------------------------------------------------------------- pareto */
test('Pareto: 6 defects, 5 are the vital few that make up 83%', async () => {
  const { page, context } = await openQA();
  const t = await secText(page, 'q-pareto');
  assert.match(t, /These 5 defects drive 83% of all 6 defects/);
  assert.match(t, /Top-80% contributors: Cara Diaz \(3\) · Ben Cole \(2\)/);
  assert.match(t, /Call Handling 2 \(33%\)/); assert.match(t, /Process Accuracy 2 \(33%\)/);
  assert.match(t, /Resolution 1 \(17%\)/); assert.match(t, /Closing 1 \(17%\)/);
  assert.match(t, /Pareto: rebuttal reasons/); assert.match(t, /These 2 rebuttals drive 100% of all 2 rebuttals/);
  await context.close();
});

test('Pareto with uneven counts: the vital few stop at the first bar that reaches 80%', async () => {
  // Greeting x5, Tone x3, Dead air x1, Closing x1 -> total 10; cumulative 50, 80, 90, 100 -> vital = first 2 (reaches exactly 80 on the 2nd)
  const rows = [];
  const miss = (agent, p, n) => { for (let i = 0; i < n; i++) rows.push(h.qaRow({ agent, missed: [p], doa: '2026-03-0' + (3 + (i % 4)) })); };
  miss('Asha Rao', 'Proper greeting with clinic/provider name', 5);
  miss('Ben Cole', 'Professional tone & empathy', 3);
  miss('Cara Diaz', 'Dead air management', 1);
  miss('Cara Diaz', 'Proper closing statement', 1);
  const { page, context } = await openQA(rows);
  const t = await secText(page, 'q-pareto');
  assert.match(t, /These 2 defects drive 80% of all 10 defects/);
  const rca = await page.evaluate(() => [...document.querySelectorAll('.rca-sumgrid tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).slice(0, 3)));
  assert.deepEqual(rca, [['Proper greeting with clinic/provider name', '5', '50%'], ['Professional tone & empathy', '3', '30%']]);
  await context.close();
});

/* ---------------------------------------------------------------- rebuttals */
test('rebuttals: 2 raised, 1 accepted (overturned), 1 rejected (upheld), 0 pending, overturn rate 50%', async () => {
  const { page, context } = await openQA();
  assert.equal((await kp(page, 'Rebuttals raised')).value, '2');
  assert.equal((await kp(page, 'Accepted (overturned)')).value, '1');
  assert.equal((await kp(page, 'Rejected (upheld)')).value, '1');
  assert.equal((await kp(page, 'Pending')).value, '0');
  assert.equal((await kp(page, 'Overturn rate')).value, '50.0%');
  const t = await h.tableAfterTitle(page, 'quality', 'Rebuttal & overturn rate by auditor');
  assert.deepEqual(t[1].slice(0, 7), ['Lena Kim', '8', '2', '1', '1', '0', '50%']);
  await context.close();
});

test('rebuttals with a pending one and different wording: Overturned/Upheld/Awaiting decision are read correctly', async () => {
  const rows = [
    h.qaRow({ agent: 'Asha Rao', missed: ['Dead air management'], reb: 'Yes', rebStatus: 'Overturned' }),
    h.qaRow({ agent: 'Asha Rao', missed: ['Call ownership'], reb: 'Y', rebStatus: 'Upheld' }),
    h.qaRow({ agent: 'Ben Cole', missed: ['Dead air management'], reb: 'yes', rebStatus: 'Awaiting decision' }),
    h.qaRow({ agent: 'Ben Cole', reb: 'No', rebStatus: 'Not Required' }),
    h.qaRow({ agent: 'Cara Diaz', missed: ['Call ownership'], reb: 'Yes', rebStatus: 'Declined' }),
  ];
  const { page, context } = await openQA(rows);
  assert.equal((await kp(page, 'Rebuttals raised')).value, '4');
  assert.equal((await kp(page, 'Accepted (overturned)')).value, '1');
  assert.equal((await kp(page, 'Rejected (upheld)')).value, '2');
  assert.equal((await kp(page, 'Pending')).value, '1');
  // 1 accepted out of 3 decided = 33.3%
  assert.equal((await kp(page, 'Overturn rate')).value, '33.3%');
  await context.close();
});

test('a rebuttal whose status says "Not Accepted" is counted as rejected, not accepted', async () => {
  const rows = [h.qaRow({ agent: 'Asha Rao', missed: ['Dead air management'], reb: 'Yes', rebStatus: 'Not Accepted' })];
  const { page, context } = await openQA(rows);
  assert.equal((await kp(page, 'Accepted (overturned)')).value, '0', 'a "Not Accepted" rebuttal was not overturned');
  assert.equal((await kp(page, 'Rejected (upheld)')).value, '1');
  await context.close();
});

test('overturn rate is a dash (not 0.0%) when no rebuttal has been decided yet', { todo: 'QUESTION: with only pending rebuttals the card says 0.0% "accepted / decided"; unclear if a dash is wanted' }, async () => {});

/* ---------------------------------------------------------------- feedback */
test('feedback tiles: 1 shared, 3 pending on flagged audits, 0 repeated, 1 cleared, 5 error cases without feedback', async () => {
  const { page, context } = await openQA();
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#q-feedback .fb-tile')].map(t => [t.querySelector('.ft-n').textContent.trim(), t.querySelector('.ft-l').textContent.trim()]));
  assert.deepEqual(tiles, [['1', 'Feedback shared'], ['3', 'Pending on flagged audits'], ['0', 'Repeated after feedback'],
    ['0', 'Repeat errors after feedback'], ['1', 'Cleared after feedback'], ['5', 'Error cases, no feedback given']]);
  const t = await h.tableAfterTitle(page, 'quality', 'Feedback status by agent');
  assert.deepEqual(t.slice(1), [['Cara Diaz', '2', '0', '2', '—'], ['Ben Cole', '2', '1', '1', 'Mar 4'], ['Asha Rao', '0', '0', '0', '—']]);
  await context.close();
});

test('error repeated after feedback: the same parameter failing on a call made after the feedback date is counted', async () => {
  // Hal: missed "Call ownership" on call 2 Mar (audited 3 Mar), got feedback dated 4 Mar,
  //      missed it AGAIN on calls made 9 Mar and 10 Mar (after feedback) -> repeated 2 times.
  // Ivy: missed "Dead air management" on 2 Mar, feedback 4 Mar, never again -> cleared.
  const rows = [
    h.qaRow({ agent: 'Hal Moss', doc: '2026-03-02', doa: '2026-03-03', missed: ['Call ownership'], fb: 'Yes', fbDate: '2026-03-04' }),
    h.qaRow({ agent: 'Hal Moss', doc: '2026-03-09', doa: '2026-03-10', missed: ['Call ownership'] }),
    h.qaRow({ agent: 'Hal Moss', doc: '2026-03-10', doa: '2026-03-11', missed: ['Call ownership'] }),
    h.qaRow({ agent: 'Ivy Park', doc: '2026-03-02', doa: '2026-03-03', missed: ['Dead air management'], fb: 'Shared', fbDate: '2026-03-04' }),
    h.qaRow({ agent: 'Ivy Park', doc: '2026-03-09', doa: '2026-03-10' }),
  ];
  const { page, context } = await openQA(rows);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#q-feedback .fb-tile .ft-n')].map(t => t.textContent.trim()));
  // [shared, pending, repeated cases, repeat errors, cleared, no-feedback cases]
  assert.equal(tiles[2], '1', 'one agent+parameter case repeated');
  assert.equal(tiles[3], '2', 'two repeat errors after the feedback');
  assert.equal(tiles[4], '1', 'Ivy cleared');
  const t = await h.tableAfterTitle(page, 'quality', 'Error repeated after feedback');
  const hal = t.find(r => r[0] === 'Hal Moss');
  assert.match(hal[1], /Call ownership ×3/); assert.match(hal[1], /\+2 after/);
  assert.equal(hal[2], '3'); assert.equal(hal[3], '1');
  assert.match(hal[5], /Yes · 2 more/);
  assert.equal(t.find(r => r[0] === 'Ivy Park')[5], 'No');
  await context.close();
});

test('feedback wording: Yes / Shared / Done count as shared; No / Pending / Not shared / blank do not', async () => {
  const mk = (fb) => h.qaRow({ agent: 'Asha Rao', missed: ['Call ownership'], fb, fbDate: fb ? '2026-03-04' : '' });
  const rows = ['Yes', 'Shared', 'Done', 'No', 'Pending', 'Not shared', ''].map(mk);
  const { page, context } = await openQA(rows);
  const r = await page.evaluate(() => qualRows().map(x => [x['Feedback Shared'], x._fbShared]));
  assert.deepEqual(r, [['Yes', true], ['Shared', true], ['Done', true], ['No', false], ['Pending', false], ['Not shared', false], ['', false]]);
  await context.close();
});

/* ---------------------------------------------------------------- duplicate audits */
test('duplicate audits: the same Caller ID scored by two auditors shows the spread; two audits by one auditor is not a duplicate', async () => {
  // CALL-A: Lena 100, Omar 80 -> spread 20 (divergent)
  // CALL-B: Lena 100, Omar 95 -> spread 5  (minor)
  // CALL-C: Lena twice (100 and 90) -> same auditor, so it is NOT a double audit
  // average spread of the two double-audited calls = (20 + 5) / 2 = 12.5
  const rows = [
    h.qaRow({ agent: 'Asha Rao', caller: '312-555-0101', auditor: 'Lena Kim' }),
    h.qaRow({ agent: 'Asha Rao', caller: '312-555-0101', auditor: 'Omar Ali', score: 80, missed: ['Dead air management', 'Call ownership', 'Periodic hold updates', 'Long hold time control'] }),
    h.qaRow({ agent: 'Ben Cole', caller: '312-555-0102', auditor: 'Lena Kim' }),
    h.qaRow({ agent: 'Ben Cole', caller: '312-555-0102', auditor: 'Omar Ali', score: 95, missed: ['Call ownership'] }),
    h.qaRow({ agent: 'Cara Diaz', caller: '312-555-0103', auditor: 'Lena Kim' }),
    h.qaRow({ agent: 'Cara Diaz', caller: '312-555-0103', auditor: 'Lena Kim', score: 90, missed: ['Call ownership', 'Dead air management'] }),
    h.qaRow({ agent: 'Cara Diaz', caller: '-', auditor: 'Lena Kim' }),
  ];
  const { page, context } = await openQA(rows);
  assert.equal((await kp(page, 'Calls double-audited')).value, '2');
  assert.equal((await kp(page, 'Avg score spread')).value, '12.5 pts');
  assert.equal((await kp(page, 'Divergent (≥10 pts)')).value, '1');
  const t = await h.tableAfterTitle(page, 'quality', 'Duplicate audit: same call, multiple auditors');
  assert.deepEqual(t.slice(1).map(r => r.slice(0, 4)), [['312-555-0101', '2', '2', '20'], ['312-555-0102', '2', '2', '5']]);
  assert.match(t[1][4], /Lena Kim: 100% · Omar Ali: 80%/);
  assert.equal(t[1][5], 'Divergent'); assert.equal(t[2][5], 'Minor difference');
  await context.close();
});

test('duplicate audits: when no Caller ID is filled the page says so instead of showing an empty table', async () => {
  const { page, context } = await openQA();
  const t = await secText(page, 'q-duplicate');
  assert.match(t, /No Caller ID on the audit rows/);
  await context.close();
});

/* ---------------------------------------------------------------- recommendations */
test('recommendations list the right facts for the standard set', async () => {
  const { page, context } = await openQA();
  const recs = await page.evaluate(() => [...document.querySelectorAll('#q-recs .ib-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  const all = recs.join('\n');
  assert.match(all, /2 audits scored 0 for a fatal error \(Correct appointment handling ×1, Correct information shared ×1\)\. Give same-day feedback to Ben Cole, Cara Diaz/);
  assert.match(all, /Move Cara Diaz to QIP \/ PIP, at 95% or below for 2\+ consecutive weeks/);
  assert.match(all, /Coach Cara Diaz \(45%\), Ben Cole \(63%\); 2 agent\(s\) sit at or below the 95% line/);
  assert.match(all, /These 5 parameter\(s\) drive 83% of all defects/);
  assert.match(all, /Call Handling is the weakest category \(2 defects\)/);
  assert.match(all, /Auditor overturn rate is 50% \(1 of 2 decided rebuttals accepted\)/);
  assert.match(all, /Run a calibration/);
  await context.close();
});

test('recommendations for a perfect set say no fatal errors and no coaching flags', async () => {
  const rows = [h.qaRow({ agent: 'Asha Rao' }), h.qaRow({ agent: 'Ben Cole' })];
  const { page, context } = await openQA(rows);
  const all = (await page.evaluate(() => [...document.querySelectorAll('#q-recs .ib-row')].map(r => r.textContent))).join('\n');
  assert.match(all, /No fatal errors in range/);
  assert.match(all, /Every agent is above the 95% line/);
  assert.doesNotMatch(all, /Move .* to QIP/);
  await context.close();
});

/* ---------------------------------------------------------------- scoring rule */
test('Total Score written as 0.9, 90, "90%" and "0.90" all read as 90', async () => {
  const rows = [0.9, 90, '90%', '0.90', ' 90 ', '90.0'].map((s, i) => h.qaRow({ agent: 'Agent' + i, score: s, missed: ['Insurance EV Details Captured'] }));
  const { page, context } = await openQA(rows);
  const sc = await page.evaluate(() => qualRows().map(r => r._score));
  sc.forEach((s, i) => assert.ok(close(s, 90), 'value #' + i + ' read as ' + s));
  await context.close();
});

test('Total Score of 100%, 1 and 1.0 all read as 100, and 0 reads as 0', async () => {
  const rows = ['100%', 100, 1, '1.0', 0, '0%'].map((s, i) => h.qaRow({ agent: 'Agent' + i, score: s }));
  const { page, context } = await openQA(rows);
  const sc = await page.evaluate(() => qualRows().map(r => r._score));
  assert.deepEqual(sc, [100, 100, 100, 100, 0, 0]);
  await context.close();
});

test('blank Total Score is worked out: 100 minus the weights missed, or 0 when a fatal parameter is missed', async () => {
  const rows = [
    h.qaRow({ agent: 'No Miss', score: '' }),                                                     // 100
    h.qaRow({ agent: 'Insurance', score: '', missed: ['Insurance EV Details Captured'] }),       // 100-10 = 90
    h.qaRow({ agent: 'Two Misses', score: '', missed: ['Recap & next steps', 'Proper closing statement'] }), // 100-3-2 = 95
    h.qaRow({ agent: 'Fatal', score: '', missed: ['Call resolution achieved', 'Dead air management'] }),     // fatal -> 0
  ];
  const { page, context } = await openQA(rows);
  const sc = await page.evaluate(() => qualRows().map(r => r._score));
  assert.deepEqual(sc.map(s => Math.round(s * 100) / 100), [100, 90, 95, 0]);
  await context.close();
});

test('a lower-case "n" is a miss, "N/A" and blank are not', async () => {
  const r = h.qaRow({ agent: 'Asha Rao' });
  r['Dead air management'] = 'n'; r['Call ownership'] = 'N/A'; r['Periodic hold updates'] = '';
  r['Long hold time control'] = ' N ';
  const { page, context } = await openQA([r]);
  const d = await page.evaluate(() => qualRows()[0]._defects);
  assert.deepEqual(d.sort(), ['Dead air management', 'Long hold time control']);
  await context.close();
});

test('an audit that missed a fatal parameter but carries a high Total Score in the sheet', { todo: 'QUESTION: rule says a fatal miss scores 0, but the app trusts the sheet\'s Total Score when it is filled (a 95 stays 95). Which is right?' }, async () => {});

/* ---------------------------------------------------------------- filters */
function twoClientSet() {
  return h.standardQARows().concat([
    h.qaRow({ agent: 'Zed Young', client: 'Client Two', sup: 'Uma Rao', auditor: 'Pia Wu', doa: '2026-03-05', doc: '2026-03-04', missed: ['Dead air management'], comments: 'ZEDONLY' }),
    h.qaRow({ agent: 'Zed Young', client: 'Client Two', sup: 'Uma Rao', auditor: 'Pia Wu', doa: '2026-03-12', doc: '2026-03-11', missed: ['Correct appointment handling'] }),
    h.qaRow({ agent: 'Yan Fox', client: 'Client Two', sup: 'Uma Rao', auditor: 'Lena Kim', doa: '2026-03-12', doc: '2026-03-11' }),
  ]);
}

test('client filter: choosing Client One never shows Client Two rows or names anywhere in the QA report', async () => {
  const { page, context } = await openQA(twoClientSet());
  assert.equal((await kp(page, 'Audits')).value, '11');
  await selectFilter(page, 'Client', 'Client One');
  assert.equal((await kp(page, 'Audits')).value, '8');
  const text = await pageText(page);
  assert.doesNotMatch(text, /Zed Young|Yan Fox|Uma Rao|Pia Wu|Client Two/);
  assert.match(text, /8 of 11 audits shown/);
  assert.equal((await kp(page, 'Avg QA score')).value, '72.5%');
  // the mini client picker inside each section follows the same filter
  assert.equal(await page.evaluate(() => QFILTER.client), 'Client One');
  await context.close();
});

test('client filter: choosing Client Two shows only its 3 audits and its numbers', async () => {
  // Zed: 03-05 misses Dead air (non-fatal, 95); 03-12 misses a fatal parameter (0). Yan: 100. Average = (95+0+100)/3 = 65
  const { page, context } = await openQA(twoClientSet());
  await selectFilter(page, 'Client', 'Client Two');
  assert.equal((await kp(page, 'Audits')).value, '3');
  assert.equal((await kp(page, 'Avg QA score')).value, '65.0%');
  assert.equal((await kp(page, 'Fatal errors')).value, '1');
  assert.equal((await kp(page, 'Non-fatal errors')).value, '1');
  const text = await pageText(page);
  assert.doesNotMatch(text, /Asha Rao|Ben Cole|Cara Diaz|Tariq Noor|Client One/);
  await context.close();
});

test('the client filter picked in one section keeps the same client in every section', async () => {
  const { page, context } = await openQA(twoClientSet());
  await page.locator('#q-rebuttals select').selectOption('Client Two');
  assert.equal(await page.evaluate(() => QFILTER.client), 'Client Two');
  const t = await secText(page, 'q-rebuttals');
  assert.match(t, /of 3 audits/);
  await context.close();
});

test('agent filter and auditor filter narrow the audits', async () => {
  const { page, context } = await openQA(twoClientSet());
  await selectFilter(page, 'Agent', 'Ben Cole');
  assert.equal((await kp(page, 'Audits')).value, '3');
  assert.equal((await kp(page, 'Avg QA score')).value, '63.3%');
  await selectFilter(page, 'Agent', '');
  await selectFilter(page, 'Auditor', 'Pia Wu');
  assert.equal((await kp(page, 'Audits')).value, '2');
  assert.equal((await kp(page, 'Avg QA score')).value, '47.5%');   // (95 + 0)/2
  await context.close();
});

test('audit date filter: from 4 Mar to 10 Mar includes both end dates (4 audits, average 95)', async () => {
  // DOA in range: row2 4 Mar Asha 100, row5 4 Mar Ben 90, row7 4 Mar Cara 90, row3 10 Mar Asha 100 -> (100+90+90+100)/4 = 95
  const { page, context } = await openQA();
  await page.locator('#v-quality .qsticky input[type=date]').nth(0).fill('2026-03-04');
  await page.locator('#v-quality .qsticky input[type=date]').nth(1).fill('2026-03-10');
  assert.equal((await kp(page, 'Audits')).value, '4');
  assert.equal((await kp(page, 'Avg QA score')).value, '95.0%');
  assert.match(await pageText(page), /4 of 8 audits shown/);
  await context.close();
});

test('audit date filter with only a "from" or only a "to" date, and a from-date after the to-date (no audits message)', async () => {
  const { page, context } = await openQA();
  await page.evaluate(() => setQF('from', '2026-03-11'));
  assert.equal((await kp(page, 'Audits')).value, '2');              // rows 6 and 8
  await page.evaluate(() => { setQF('from', ''); setQF('to', '2026-03-03'); });
  assert.equal((await kp(page, 'Audits')).value, '2');              // rows 1 and 4
  await page.evaluate(() => { setQF('from', '2026-03-20'); setQF('to', '2026-03-01'); });
  assert.match(await pageText(page), /No audits match these filters/);
  await context.close();
});

test('the Reset button on the QA filters clears client, agent, auditor and both dates', async () => {
  const { page, context } = await openQA(twoClientSet());
  await selectFilter(page, 'Client', 'Client Two');
  await page.locator('#v-quality .qsticky input[type=date]').nth(0).fill('2026-03-05');
  await page.locator('#v-quality .qsticky button', { hasText: 'Reset' }).click();
  assert.deepEqual(await page.evaluate(() => QFILTER), { client: '', agent: '', auditor: '', from: '', to: '' });
  assert.equal((await kp(page, 'Audits')).value, '11');
  await context.close();
});

/* ---------------------------------------------------------------- the quality CSV download */
test('the quality CSV has every audit, the right columns, the scored fatal / non-fatal counts, and opens in Excel (byte-order mark)', async () => {
  const { page, context } = await openQA();
  const dl = await h.download(page, () => page.locator('#v-quality .qsticky button', { hasText: 'CSV' }).click());
  assert.equal(dl.name, 'quality_audits.csv');
  assert.equal(dl.text.charCodeAt(0), 0xFEFF, 'starts with a byte-order mark so Excel reads it as UTF-8');
  const rows = h.parseCSVText(dl.text);
  assert.equal(rows.length, 9, 'header + 8 audits');
  const head = rows[0];
  ['Client', 'Supervisor', 'Agent Name', 'Auditor Name', 'DOA (Audit Date)', 'Total Score', 'Fatal Error', 'Non Fatal Error', 'Correct appointment handling', 'Rebuttal Status', 'Feedback Shared', 'Comments']
    .forEach(c => assert.ok(head.includes(c), 'column ' + c));
  const col = c => head.indexOf(c);
  const ben1 = rows.find(r => r[col('Agent Name')] === 'Ben Cole' && r[col('DOA (Audit Date)')] === '2026-03-03');
  assert.equal(ben1[col('Fatal Error')], '1'); assert.equal(ben1[col('Non Fatal Error')], '0');
  assert.equal(ben1[col('Correct appointment handling')], 'N');
  assert.equal(ben1[col('Supervisor')], 'Tariq Noor');
  const cara2 = rows.find(r => r[col('Agent Name')] === 'Cara Diaz' && r[col('DOA (Audit Date)')] === '2026-03-11');
  assert.equal(cara2[col('Fatal Error')], '1'); assert.equal(cara2[col('Non Fatal Error')], '1');
  assert.equal(rows.filter(r => r[col('Agent Name')] === 'Asha Rao').length, 3);
  await context.close();
});

test('the quality CSV only holds the audits that match the filters (a client filter never exports another client)', async () => {
  const { page, context } = await openQA(twoClientSet());
  await selectFilter(page, 'Client', 'Client Two');
  const dl = await h.download(page, () => page.locator('#v-quality .qsticky button', { hasText: 'CSV' }).click());
  const rows = h.parseCSVText(dl.text);
  assert.equal(rows.length, 4, 'header + 3 audits');
  const c = rows[0].indexOf('Client');
  assert.ok(rows.slice(1).every(r => r[c] === 'Client Two'));
  assert.doesNotMatch(dl.text, /Asha Rao|Ben Cole|Cara Diaz/);
  await context.close();
});

test('the quality CSV keeps commas, quotes and new lines inside a comment in one cell', async () => {
  const rows = [h.qaRow({ agent: 'Asha Rao', comments: 'Said "hello", then\r\nput caller on hold' })];
  const { page, context } = await openQA(rows);
  const dl = await h.download(page, () => page.locator('#v-quality .qsticky button', { hasText: 'CSV' }).click());
  const parsed = h.parseCSVText(dl.text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1][parsed[0].indexOf('Comments')].replace(/\r/g, ''), 'Said "hello", then\nput caller on hold');
  await context.close();
});

/* ---------------------------------------------------------------- insights cards (production + QA) */
test('Insights & flags: "Rao, Asha" in the QA sheet and "Asha Rao" in the phone files become ONE person card with both sets of facts', async () => {
  const qa = [
    h.qaRow({ agent: 'Rao, Asha', doa: '2026-03-03', doc: '2026-03-02', missed: ['Call ownership'] }),
    h.qaRow({ agent: 'Rao, Asha', doa: '2026-03-04', doc: '2026-03-03' }),
    h.qaRow({ agent: 'COLE, BEN.', doa: '2026-03-03', doc: '2026-03-02' }),
    h.qaRow({ agent: 'cara diaz', doa: '2026-03-03', doc: '2026-03-02' }),
  ];
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  await h.loadQuality(page, h.qaCsvFile(qa));
  await h.show(page, 'insights');
  const cards = await page.evaluate(() => [...document.querySelectorAll('#v-insights .ai-card')].map(c => ({ name: c.querySelector('.ai-head b').textContent.trim(), text: c.innerText.replace(/\s+/g, ' ') })));
  const names = cards.map(c => c.name).sort();
  assert.deepEqual(names, ['Asha Rao', 'Ben Cole', 'Cara Diaz'], 'exactly one card per person: ' + names.join(' / '));
  const asha = cards.find(c => c.name === 'Asha Rao');
  assert.match(asha.text, /Handled 7 calls/, 'phone-system facts are on the card');
  assert.match(asha.text, /QA score 97\.5 across 2 audits/, 'QA facts (95 and 100, average 97.5) are on the same card');
  assert.match(asha.text, /Call ownership/);
  const ben = cards.find(c => c.name === 'Ben Cole');
  assert.match(ben.text, /Handled 5 calls/); assert.match(ben.text, /QA score 100\.0 across 1 audit/);
  assert.deepEqual(errors, []);
  await context.close();
});
