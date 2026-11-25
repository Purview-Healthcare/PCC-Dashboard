'use strict';
// Area 8 (continued): the three themes (choice, memory, readable text), phone and tablet layout, and print layout.
// Made-up data only. Contrast = WCAG ratio between the text colour and the colour behind it.
// Rule used: every text must be at least 3:1 (a failure). Text under 4.5:1 is reported as a NOTE in the output.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { contrastScript } = require('./ui-helpers');

after(() => h.closeBrowser());

const THEMES = [['classic', 'Classic'], ['light', 'Purview Light'], ['dark', 'Purview Dark']];
const attrFor = t => (t === 'classic' ? null : t);

/* ---------------- theme choice and memory ---------------- */

for (const [t, label] of THEMES) {
  test(`${label}: clicking the theme button applies the theme and it is remembered after reloading the page`, async () => {
    const { page, context, errors } = await h.openApp();
    await page.click(`#v-upload .themes button[data-t="${t}"]`);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), attrFor(t));
    assert.equal(await page.getAttribute(`#v-upload .themes button[data-t="${t}"]`, 'aria-pressed'), 'true');
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), attrFor(t), 'theme lost after reload');
    assert.equal(await page.getAttribute(`#v-upload .themes button[data-t="${t}"]`, 'aria-pressed'), 'true', 'button not highlighted after reload');
    assert.equal(await page.evaluate(() => localStorage.getItem('pcc-theme')), t);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('the three themes really look different (page background colour differs between Classic, Light and Dark)', async () => {
  const { page, context } = await h.openApp();
  const seen = new Set();
  for (const [t] of THEMES) {
    await page.evaluate(x => setTheme(x), t);
    seen.add(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() + '|' + getComputedStyle(document.querySelector('.sidebar')).backgroundImage.slice(0, 60) + getComputedStyle(document.querySelector('.sidebar')).backgroundColor));
  }
  assert.ok(seen.size >= 3, 'themes look the same: ' + [...seen].join(' / '));
  await context.close();
});

test('the theme is also kept when the browser has already been given a remembered theme (it is applied before the page is drawn)', async () => {
  const { page, context } = await h.openApp({ beforeLoad: page => page.addInitScript(() => { try { localStorage.setItem('pcc-theme', 'dark'); } catch (e) {} }) });
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  await context.close();
});

/* ---------------- readable text in each theme ---------------- */

const CATS = {
  'headings, big figures and table text': el => el.matches('h1,h2,h3,h4,h5,.kpi .val,.big,.num,td,th,.name'),
  'pills, badges, buttons and tabs': el => el.matches('.pill,.ai-badge,.tag,.btn,.seg,.tab,.chip,.themes button,.qnav button'),
  'drop-downs, date boxes and text boxes': el => el.matches('input,select,textarea'),
};
const OTHER = 'notes, labels, legends and links';
const cache = {};
/** One measurement per theme: every visible piece of text on the upload page, the production report and the QA report. */
function measure(theme) {
  if (cache[theme]) return cache[theme];
  cache[theme] = (async () => {
    const { page, context } = await h.openApp();
    await page.evaluate(contrastScript());
    await page.evaluate(x => setTheme(x), theme);
    const collect = async (root) => page.evaluate(([rootSel, cats]) => {
      const catFns = {
        'headings, big figures and table text': 'h1,h2,h3,h4,h5,.kpi .val,.big,.num,td,th,.name',
        'pills, badges, buttons and tabs': '.pill,.ai-badge,.tag,.btn,.seg,.tab,.chip,.themes button,.qnav button',
        'drop-downs, date boxes and text boxes': 'input,select,textarea',
      };
      const out = {};
      document.querySelectorAll(rootSel).forEach(el => {
        if (['SCRIPT', 'STYLE', 'svg', 'path', 'SVG'].includes(el.tagName)) return;
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
        if (getComputedStyle(el).visibility === 'hidden') return;
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || el.matches('input,select,textarea');
        if (!own) return;
        const x = window.__contrast(el); if (!x) return;
        let cat = 'notes, labels, legends and links';
        for (const [name, sel] of Object.entries(catFns)) if (el.matches(sel)) { cat = name; break; }
        const key = el.tagName + '.' + (typeof el.className === 'string' ? el.className : '') + '|' + x.fg + '|' + x.bg;
        out[cat] = out[cat] || {};
        if (!out[cat][key]) out[cat][key] = { ratio: +x.ratio.toFixed(2), n: 0, text: (el.matches('input,select,textarea') ? (el.value || el.placeholder || el.tagName) : el.textContent).trim().replace(/\s+/g, ' ').slice(0, 36), where: el.closest('[id^="v-"]') ? el.closest('[id^="v-"]').id : 'page', who: key };
        out[cat][key].n++;
      });
      return out;
    }, [root, null]);
    const merged = {};
    const add = (res, where) => { for (const [c, items] of Object.entries(res)) { merged[c] = merged[c] || []; Object.values(items).forEach(i => merged[c].push(Object.assign(i, { page: where }))); } };
    add(await collect('#v-upload *, .sidebar *'), 'upload page');
    await h.loadProduction(page); await h.loadQuality(page);
    await page.evaluate(contrastScript());
    for (const v of ['report', 'quality']) { await h.show(page, v); add(await collect('#v-' + v + ' *, .sidebar *, #filterBar *'), v === 'report' ? 'production report' : 'QA report'); }
    await context.close();
    return merged;
  })();
  return cache[theme];
}

for (const [t, label] of THEMES) {
  for (const cat of [...Object.keys(CATS), OTHER]) {
    test(`${label}: ${cat} are readable (at least 3:1 contrast against what is behind them)`, async (tc) => {
      const items = ((await measure(t))[cat] || []);
      const notes = items.filter(i => i.ratio >= 3 && i.ratio < 4.5);
      const fails = items.filter(i => i.ratio < 3).sort((a, b) => a.ratio - b.ratio);
      notes.sort((a, b) => a.ratio - b.ratio).slice(0, 5).forEach(i => tc.diagnostic(`NOTE (under 4.5:1) ${label}, ${i.page}: ${i.ratio}:1 "${i.text}" (${i.n} places) ${i.who}`));
      assert.deepEqual(fails.slice(0, 8).map(i => `${i.ratio}:1 on ${i.page}: "${i.text}" (${i.n} places) ${i.who}`), []);
    });
  }
}

/* ---------------- phone and tablet ---------------- */

const SIZES = [['phone 390x844', { width: 390, height: 844 }], ['tablet 768x1024', { width: 768, height: 1024 }]];
const overflowers = page => page.evaluate(() => {
  const out = [];
  document.querySelectorAll('body *').forEach(e => {
    const r = e.getBoundingClientRect(); if (r.right <= innerWidth + 1 || !r.width) return;
    if (getComputedStyle(e).position === 'fixed') return;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return;
    out.push(Math.round(r.right) + ' ' + e.tagName.toLowerCase() + '.' + (typeof e.className === 'string' ? e.className : '') + ' "' + (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) + '"');
  });
  return out.sort((a, b) => parseInt(b) - parseInt(a)).slice(0, 4);
});
const widthOK = async (page, what) => {
  const m = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(m[0] <= m[1] + 1, `${what}: the page scrolls sideways (page ${m[0]}px wide, screen ${m[1]}px). Widest parts: ${(await overflowers(page)).join(' | ')}`);
};

for (const [name, vp] of SIZES) {
  test(`${name}: the upload page does not scroll sideways and both upload boxes are usable`, async () => {
    const { page, context, errors } = await h.openApp({ viewport: vp });
    await widthOK(page, 'upload page');
    for (const sel of ['#drop', '#dropQ']) {
      const r = await page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, h: b.height }; }, sel);
      assert.ok(r.l >= 0 && r.r <= vp.width, sel + ' sticks out of the screen');
      assert.ok(r.w >= 240 && r.h >= 80, sel + ' is too small to use: ' + JSON.stringify(r));
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(sel)]);
      assert.ok(chooser);
    }
    const boxes = await page.evaluate(() => ['#drop', '#dropQ'].map(s => document.querySelector(s).getBoundingClientRect()).map(b => [b.left, b.top, b.right, b.bottom]));
    const [a, b] = boxes; assert.ok(a[2] <= b[0] + 1 || a[3] <= b[1] + 1 || b[2] <= a[0] + 1 || b[3] <= a[1] + 1, 'the two upload boxes overlap');
    assert.deepEqual(errors, []);
    await context.close();
  });

  test(`${name}: the Production report does not scroll sideways`, async () => {
    const { page, context } = await h.openApp({ viewport: vp });
    await h.loadProduction(page); await h.loadQuality(page);
    await h.show(page, 'report');
    await widthOK(page, 'Production report');
    await context.close();
  });

  test(`${name}: the QA report does not scroll sideways`, async () => {
    const { page, context } = await h.openApp({ viewport: vp });
    await h.loadProduction(page); await h.loadQuality(page);
    await h.show(page, 'quality');
    await widthOK(page, 'QA report');
    await context.close();
  });

  test(`${name}: the sidebar tabs fit on screen, can be tapped (at least 32px tall) and switch reports`, async () => {
    const { page, context, errors } = await h.openApp({ viewport: vp });
    await h.loadProduction(page); await h.loadQuality(page);
    for (const id of ['quality', 'report']) {
      const r = await page.evaluate(i => { const b = document.querySelector('#tabs .tab[data-id="' + i + '"]').getBoundingClientRect(); return { l: b.left, r: b.right, h: b.height, w: b.width }; }, id);
      assert.ok(r.l >= 0 && r.r <= vp.width, id + ' tab sticks out of the screen');
      assert.ok(r.h >= 32 && r.w >= 60, id + ' tab too small: ' + JSON.stringify(r));
      await page.click(`#tabs .tab[data-id="${id}"]`);
      assert.ok(await page.isVisible('#v-' + id));
    }
    assert.deepEqual(errors, []);
    await context.close();
  });

  test(`${name}: every filter control is fully on screen and big enough to use`, async () => {
    const { page, context } = await h.openApp({ viewport: vp });
    await h.loadProduction(page); await h.show(page, 'report');
    const bad = await page.evaluate(() => [...document.querySelectorAll('#filterBar select, #filterBar input:not([type=checkbox]), #filterBar button, #filterBar .switch')].map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent.trim().slice(0, 12), l: r.left, r: r.right, w: r.width, h: r.height }; }).filter(r => r.w > 0 && (r.l < 0 || r.r > innerWidth + 1 || r.h < 28)));
    assert.deepEqual(bad, []);
    await context.close();
  });

  test(`${name}: wide tables scroll inside their own box instead of pushing the page wider`, async () => {
    const { page, context } = await h.openApp({ viewport: vp });
    await h.loadProduction(page); await h.loadQuality(page);
    for (const v of ['report', 'quality']) {
      await h.show(page, v);
      const bad = await page.evaluate(() => [...document.querySelectorAll('table')].filter(t => t.getBoundingClientRect().width > 0).map(t => {
        const r = t.getBoundingClientRect(); let sc = null;
        for (let e = t.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') { sc = e; break; } }
        const title = (t.closest('.card') && t.closest('.card').querySelector('h3,h4') || {}).textContent;
        if (r.right <= innerWidth + 1) return null;           // fits on screen
        if (!sc) return 'a table sticks out and has no scroll box: ' + (title || '').trim();
        const sr = sc.getBoundingClientRect();
        if (sr.right > innerWidth + 1) return 'its scroll box itself is wider than the screen: ' + (title || '').trim();
        return null;
      }).filter(Boolean));
      assert.deepEqual(bad, [], v);
    }
    await context.close();
  });

  test(`${name}: the Feedback tab does not sit on top of any button, link or field`, async () => {
    const { page, context } = await h.openApp({ viewport: vp });
    await h.loadProduction(page); await h.loadQuality(page);
    const covered = new Set();
    for (const v of ['report', 'quality']) {
      await h.show(page, v);
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < total; y += Math.floor(vp.height * 0.8)) {
        await page.evaluate(yy => window.scrollTo(0, yy), y);
        const hit = await page.evaluate(() => {
          const t = document.getElementById('pvfbTab').getBoundingClientRect();
          return [...document.querySelectorAll('button:not(#pvfbTab), a[href], input, select, textarea, .row-parent')]
            .filter(e => !e.closest('.pvfb-panel') && e.offsetParent !== null)
            .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top; })
            .map(e => e.tagName.toLowerCase() + ' "' + (e.textContent || e.value || e.id || '').trim().slice(0, 20) + '"');
        });
        hit.forEach(x => covered.add(v + ': ' + x));
      }
    }
    assert.deepEqual([...covered].slice(0, 6), []);
    await context.close();
  });

  test(`${name}: the Feedback panel opens fully on screen, can be filled in and closes`, async () => {
    const { page, context, errors } = await h.openApp({ viewport: vp });
    await h.loadProduction(page);
    await page.click('#pvfbTab');
    const r = await page.evaluate(() => { const p = document.getElementById('pvfbPanel').getBoundingClientRect(); return { l: p.left, r: p.right, t: p.top, b: p.bottom }; });
    assert.ok(r.l >= 0 && r.r <= vp.width && r.t >= 0 && r.b <= vp.height, 'panel not fully on screen ' + JSON.stringify(r));
    await page.fill('#pvfbMsg', 'It is hard to read the table on my phone');
    assert.ok(await page.isEnabled('#pvfbSend'));
    await widthOK(page, 'with the feedback panel open');
    await page.click('#pvfbClose');
    assert.ok(await page.isVisible('#pvfbTab'));
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('phone 390x844: the stuck-on-top filter bar leaves most of the screen for the report (under one third of the screen height)', async () => {
  const { page, context } = await h.openApp({ viewport: { width: 390, height: 844 } });
  await h.loadProduction(page); await h.show(page, 'report');
  await page.evaluate(() => window.scrollTo(0, 900));
  const m = await page.evaluate(() => { const f = document.getElementById('filterBar'); const r = f.getBoundingClientRect(); return { h: r.height, top: r.top, pos: getComputedStyle(f).position, vh: innerHeight }; });
  await context.close();
  if (m.pos === 'sticky' || m.pos === 'fixed') assert.ok(m.h <= m.vh / 3, `the filter bar stays stuck at the top and takes ${Math.round(m.h)}px of a ${m.vh}px tall screen (${Math.round(100 * m.h / m.vh)}%)`);
});

/* ---------------- print ---------------- */

for (const [t, label] of THEMES) {
  for (const view of ['report', 'quality']) {
    test(`${label}: printing the ${view === 'report' ? 'Production' : 'QA'} report hides the sidebar, filters, buttons and Feedback tab, and prints dark text on white`, async () => {
      const { page, context } = await h.openApp();
      await h.loadProduction(page); await h.loadQuality(page);
      await page.evaluate(x => setTheme(x), t);
      await h.show(page, view);
      await page.evaluate(contrastScript());
      await page.emulateMedia({ media: 'print' });
      const shown = await page.evaluate(() => {
        const vis = e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
        const out = [];
        for (const sel of ['.sidebar', '#filterBar', '#pvfbTab', '#pvfbPanel', '.q-noprint', '.qsticky .btn', '#v-report > .q-noprint', '#v-upload', 'a.totop']) {
          document.querySelectorAll(sel).forEach(e => { if (sel === '.qsticky .btn' && !e.closest('.q-noprint')) return; if (vis(e)) out.push(sel); });
        }
        return [...new Set(out)];
      });
      assert.deepEqual(shown, [], 'still visible when printing');
      const look = await page.evaluate(() => {
        const bgOf = e => window.__contrast(e);
        const body = getComputedStyle(document.body).backgroundColor;
        const cardBgs = [...document.querySelectorAll('.view.active .card, .view.active .kpi:not(.hero)')].slice(0, 60).map(e => { const c = getComputedStyle(e).backgroundColor; return c; });
        const dark = cardBgs.filter(c => { const m = c.match(/\d+/g).map(Number); return m[3] !== 0 && (m[0] + m[1] + m[2]) / 3 < 200 && !(m.length > 3 && m[3] < 0.2); });
        // text colour against plain white paper (browsers do not print background colours by default)
        const bad = new Map();
        document.querySelectorAll('.view.active *').forEach(el => {
          if (['SCRIPT', 'STYLE', 'svg', 'path'].includes(el.tagName)) return;
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
          if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
          if (el.closest('.ov-hero,.kpi.hero,.pill,.tag,.insight .ic,.heat,.ov-res-bar,.barrow,.stackrow,.donut')) return; // coloured blocks print their own background
          const cs = getComputedStyle(el); const m = cs.color.match(/[\d.]+/g).map(Number);
          if (m[0] === 255 && m[1] === 255 && m[2] === 255) return; // white text sits on a coloured block (buttons, bars) that prints its own background
          const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          const l = 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
          const ratio = 1.05 / (l + 0.05);
          if (ratio < 3) { const k = cs.color + ' ' + el.tagName; if (!bad.has(k)) bad.set(k, { ratio: +ratio.toFixed(2), text: el.textContent.trim().slice(0, 30), n: 0 }); bad.get(k).n++; }
        });
        return { body, dark, bad: [...bad.entries()].slice(0, 6) };
      });
      assert.ok(/rgb\(255, 255, 255\)/.test(look.body), 'printed page background is ' + look.body);
      assert.deepEqual(look.dark, [], 'cards still have a dark background in print');
      assert.deepEqual(look.bad, [], 'text too pale to read on white paper');
      await context.close();
    });
  }
}

for (const view of ['report', 'quality']) {
  test(`printing the ${view === 'report' ? 'Production' : 'QA'} report leaves out the on-screen buttons (CSV downloads, Print, filters)`, async () => {
    const { page, context } = await h.openApp();
    await h.loadProduction(page); await h.loadQuality(page);
    await h.show(page, view);
    await page.emulateMedia({ media: 'print' });
    const shown = await page.evaluate(() => [...document.querySelectorAll('.view.active button:not(.seg)')]
      .filter(b => { const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0; })
      .map(b => 'button "' + b.textContent.trim().slice(0, 24) + '"'));
    await context.close();
    assert.deepEqual([...new Set(shown)], [], 'buttons that would be printed on paper');
  });
}

test('print: the running header on every printed page carries a fixed client name (see the owner question about "Village Eye Care")', { skip: 'QUESTION for the owner: the printed header and report title are hard-coded to "Village Eye Care" (index.html updatePrintChrome and vReport). Not a bug if this dashboard is for one client only.' }, () => {});
