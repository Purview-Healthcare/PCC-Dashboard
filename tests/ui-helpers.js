'use strict';
/* Small extra helpers shared by the screen / theme / privacy / security / speed checks (areas 3, 7, 8, 10, 11).
 * Made-up data only. Not a test file itself. */
const h = require('./helpers');

const SECTIONS = ['exec', 'overview', 'coverage', 'agents', 'volume', 'voice', 'insights', 'quality', 'report'];
const BAD_WORDS = /\b(undefined|NaN|null|Infinity)\b|\[object Object\]/;

/** Visit every section; return a list of plain-English problems (empty = clean). */
async function sweep(page, errors, label = '') {
  const problems = [];
  const startErrors = errors ? errors.length : 0;
  for (const id of SECTIONS) {
    await h.show(page, id);
    const r = await page.evaluate(v => {
      const el = document.querySelector('#v-' + v);
      const t = el ? el.innerText : '';
      const bad = [];
      const re = /.{0,30}(\b(?:undefined|NaN|null|Infinity)\b|\[object Object\]).{0,20}/g;
      let m; while ((m = re.exec(t)) && bad.length < 3) bad.push(m[0].replace(/\s+/g, ' '));
      return { bad, couldnt: /Couldn't render/.test(t), html: el ? el.innerHTML : '' };
    }, id);
    if (r.couldnt) problems.push(`${label} ${id}: shows a "Couldn't render" box`);
    r.bad.forEach(b => problems.push(`${label} ${id}: bad text "${b}"`));
    if (/\b(undefined|NaN)\b/.test(r.html.replace(/<[^>]*>/g, ' ')) && !r.bad.length) problems.push(`${label} ${id}: hidden bad text in the page markup`);
  }
  if (errors) errors.slice(startErrors).forEach(e => problems.push(`${label} ${e}`));
  return problems;
}

/** Contrast helpers, run inside the page. Evaluate the returned source once; then call window.__contrast(el). */
function contrastScript() {
  return `(() => {
    function parse(c){ const m=String(c).match(/rgba?\\(([^)]+)\\)/); if(!m) return null; const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; }
    function hex(c){ const m=String(c).trim().match(/^#([0-9a-f]{6})$/i); if(!m) return null; const n=parseInt(m[1],16); return {r:n>>16,g:(n>>8)&255,b:n&255,a:1}; }
    function lum(c){ const f=v=>{v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
    function over(top,bot){ const a=top.a; return {r:top.r*a+bot.r*(1-a),g:top.g*a+bot.g*(1-a),b:top.b*a+bot.b*(1-a),a:1}; }
    function layers(img){ const out=[]; let d=0,cur=''; for(const ch of img){ if(ch==='(')d++; if(ch===')')d--; if(ch===','&&d===0){out.push(cur.trim());cur='';} else cur+=ch; } if(cur.trim()) out.push(cur.trim()); return out; }
    function pageBase(){ const v=getComputedStyle(document.documentElement).getPropertyValue('--bg'); return hex(v)||{r:255,g:255,b:255,a:1}; }
    function bgOf(el){ const stack=[]; // top to bottom
      for(let e=el;e;e=e.parentElement){ const cs=getComputedStyle(e); let done=false;
        const L=layers(cs.backgroundImage||'none'); const bottom=L[L.length-1];
        if(bottom&&/gradient/.test(bottom)){ const gc=parse(bottom.match(/rgba?\\([^)]+\\)/)?bottom.match(/rgba?\\([^)]+\\)/)[0]:''); if(gc&&gc.a>0){ stack.push(gc); if(gc.a>=1){done=true;} } }
        if(!done){ const c=parse(cs.backgroundColor); if(c&&c.a>0){ stack.push(c); if(c.a>=1) done=true; } }
        if(done) break; }
      let base=pageBase(); for(let i=stack.length-1;i>=0;i--) base=over(stack[i],base); return base; }
    window.__contrast = function(el){ const cs=getComputedStyle(el); let fg=parse(cs.color); if(!fg) return null; const bg=bgOf(el); fg=over(fg,bg);
      const l1=lum(fg), l2=lum(bg); const hi=Math.max(l1,l2), lo=Math.min(l1,l2); return {ratio:(hi+0.05)/(lo+0.05), fg:cs.color, bg:'rgb('+Math.round(bg.r)+','+Math.round(bg.g)+','+Math.round(bg.b)+')', bgLum:l2}; };
  })()`;
}

/** Build a one-agent .csv set with hostile text in every place a name can come from. */
module.exports = { SECTIONS, BAD_WORDS, sweep, contrastScript };
