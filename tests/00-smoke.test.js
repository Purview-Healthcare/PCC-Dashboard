'use strict';
// Smoke check: the app opens, the made-up files load, and the helper's hand-worked totals match the app's own core numbers.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

after(() => h.closeBrowser());

test('the app opens with no errors and shows the upload page', async () => {
  const { page, context, errors } = await h.openApp();
  assert.equal(await page.title(), 'PCC Dashboard — Purview Healthcare');
  assert.ok(await page.isVisible('#drop'), 'production upload box is visible');
  assert.ok(await page.isVisible('#dropQ'), 'quality upload box is visible');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the made-up production files are all recognised and the core call totals match the hand-worked answers', async () => {
  const { page, context, errors } = await h.openApp();
  await h.loadProduction(page);
  const m = await page.evaluate(() => { const m = coreMetrics(); return { total: m.total, handled: m.handled, noagent: m.noagent, noagentDuring: m.noagentDuring, aband: m.aband, timeout: m.timeout, slY: m.slY, slN: m.slN }; });
  const E = h.EXPECT_QUEUE;
  assert.equal(m.total, E.offered, 'offered calls');
  assert.equal(m.handled, E.handled, 'handled calls');
  assert.equal(m.noagent, E.noAgentAll, 'no-agent calls (all hours)');
  assert.equal(m.noagentDuring, E.noAgentInShift, 'no-agent calls in shift');
  assert.equal(m.aband, E.abandoned, 'abandoned calls');
  assert.equal(m.timeout, E.queueTimeout, 'queue timeouts');
  assert.equal(m.slY, E.slYesInShift); assert.equal(m.slN, E.slNoInShift);
  const types = await page.evaluate(() => Object.keys(DS).sort());
  assert.deepEqual(types, ['activity', 'byDate', 'conversations', 'individual', 'pause', 'productivity', 'queueDetails']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the made-up QA sheet loads as CSV and as Excel with the same result', async () => {
  for (const file of [h.qaCsvFile(), h.qaXlsxFile()]) {
    const { page, context, errors, dialogs } = await h.openApp();
    await h.loadQuality(page, file);
    const r = await page.evaluate(() => { const R = qualRows(); return { n: R.length, fatal: R.reduce((s, r) => s + r._fatal.length, 0), nonfatal: R.reduce((s, r) => s + r._nonfatal.length, 0), avg: R.reduce((s, r) => s + r._score, 0) / R.length }; });
    assert.equal(r.n, h.EXPECT_QA.audits, file.name + ': audits');
    assert.equal(r.fatal, h.EXPECT_QA.fatalErrors, file.name + ': fatal errors');
    assert.equal(r.nonfatal, h.EXPECT_QA.nonFatalErrors, file.name + ': non-fatal errors');
    assert.ok(Math.abs(r.avg - h.EXPECT_QA.avgScore) < 0.01, file.name + ': average score ' + r.avg);
    assert.deepEqual(dialogs, []); assert.deepEqual(errors, []);
    await context.close();
  }
});
