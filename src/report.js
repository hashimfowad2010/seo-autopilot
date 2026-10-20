import fs from 'node:fs';
import path from 'node:path';
import { c } from './ui.js';
import { HOME, escapeHtml as h } from './util.js';

const RANK = { error: 0, warn: 1, info: 2 };

export function groupIssues(pages) {
  const groups = new Map();
  for (const p of pages) {
    for (const i of p.issues || []) {
      const g = groups.get(i.id) || { id: i.id, label: i.label, severity: i.severity, fixable: i.fixable, count: 0, pages: [] };
      g.count++;
      g.pages.push(p.url);
      groups.set(i.id, g);
    }
  }
  return [...groups.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);
}

const shortUrl = (u, site) => (u.startsWith(site.url) ? '/' + u.slice(site.url.length) : u);

export function printSummary(a) {
  const col = a.score >= 80 ? c.green : a.score >= 50 ? c.yellow : c.red;
  console.log(`\n  SEO score: ${c.bold(col(`${a.score}/100`))}   ${c.dim(`${a.pages.length} page(s) checked`)}`);
  const ps = a.pagespeed;
  if (ps && !ps.error) console.log(`  PageSpeed (mobile): performance ${ps.performance} · SEO ${ps.seo} · accessibility ${ps.accessibility} · best practices ${ps.bestPractices}`);
  else if (ps?.error) console.log(c.dim(`  ${ps.error}`));

  const icons = { pass: c.green('✓'), fail: c.red('✗'), warn: c.yellow('!'), info: c.dim('·'), error: c.red('✗') };
  const fix = (f) => (f ? c.dim('  [auto-fix]') : '');
  console.log(`\n  ${c.bold('Site')}`);
  for (const ch of a.checks) console.log(`   ${icons[ch.status]} ${ch.label}${fix(ch.fixable)}`);

  const groups = groupIssues(a.pages);
  if (groups.length) {
    console.log(`\n  ${c.bold('Pages')}`);
    for (const g of groups) console.log(`   ${icons[g.severity]} ${String(g.count).padStart(3)} × ${g.label}${fix(g.fixable)}`);
  }
  if (a.broken.length) {
    console.log(`\n  ${c.bold('Broken links')}`);
    for (const b of a.broken.slice(0, 8)) {
      const from = b.from[0] ? c.dim(` ← linked from ${shortUrl(b.from[0], a.site)}`) : '';
      console.log(`   ${c.red('✗')} ${shortUrl(b.url, a.site)} ${c.dim(`(${b.status || b.error})`)}${from}`);
    }
    if (a.broken.length > 8) console.log(c.dim(`     …and ${a.broken.length - 8} more in the report`));
  }
}

export function writeReport(data) {
  const a = data.after || data.before;
  const dir = path.join(HOME, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const slug = (a.site.host + a.site.basePath).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const file = path.join(dir, `${slug}-${a.at.slice(0, 19).replace(/[:T]/g, '-')}.html`);
  fs.writeFileSync(file, renderReport(data));
  return file;
}

const tone = (n) => (n == null ? 'muted' : n >= 80 ? 'good' : n >= 50 ? 'warn' : 'bad');

function ring(score, label) {
  return `<div class="metric"><div class="ring" style="--p:${score ?? 0};--col:var(--${tone(score)})"><span>${score ?? '–'}</span></div><div class="metric-label">${h(label)}</div></div>`;
}

function renderReport({ before, after, actions = [], notes = [] }) {
  const a = after || before;
  const site = a.site;
  const ps = before.pagespeed && !before.pagespeed.error ? before.pagespeed : null;
  const groups = groupIssues(a.pages);
  const statusIcon = { pass: '✓', fail: '✗', warn: '!', info: 'i' };
  const sevName = { error: 'Error', warn: 'Warning', info: 'Tip' };
  const manual = groups.filter((g) => !g.fixable && g.severity !== 'info').map((g) => g.label);

  const scores = after
    ? `${ring(before.score, 'SEO score before')}<div class="arrow">→</div>${ring(after.score, 'SEO score now')}`
    : ring(a.score, 'SEO score');
  const speed = ps
    ? ['performance', 'seo', 'accessibility', 'bestPractices'].map((k) => ring(ps[k], { performance: 'Performance', seo: 'Lighthouse SEO', accessibility: 'Accessibility', bestPractices: 'Best practices' }[k])).join('')
    : `<p class="muted">${h(before.pagespeed?.error || 'PageSpeed was skipped.')}</p>`;

  const pagesRows = a.pages
    .map((p) => {
      const issues = p.issues.slice().sort((x, y) => RANK[x.severity] - RANK[y.severity]);
      const worst = issues[0]?.severity;
      return `<details${worst === 'error' ? ' open' : ''}><summary><span class="dot ${worst || 'ok'}"></span><span class="path">${h(shortUrl(p.url, site))}</span><span class="count">${issues.length ? `${issues.length} issue${issues.length > 1 ? 's' : ''}` : 'All good'}</span></summary>
        <div class="page-body"><div class="kv"><b>Title</b> ${h(p.title || '—')}</div><div class="kv"><b>Description</b> ${h(p.description || '—')}</div>
        ${issues.length ? `<ul>${issues.map((i) => `<li><span class="pill ${i.severity}">${sevName[i.severity]}</span> ${h(i.message)}</li>`).join('')}</ul>` : ''}</div></details>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SEO report · ${h(site.host + site.basePath)}</title>
<style>
:root{--bg:#f6f6f3;--card:#fff;--text:#1d1d1b;--muted:#6d6c67;--line:#e5e4de;--good:#16794a;--warn:#a35a00;--bad:#c23a2b;--info:#4f6475;--ok:#16794a}
@media (prefers-color-scheme:dark){:root{--bg:#131312;--card:#1d1d1b;--text:#ecebe5;--muted:#9c9b94;--line:#2f2e2b;--good:#4cc38a;--warn:#e3a33f;--bad:#f06b5b;--info:#93a6b8;--ok:#4cc38a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:40px 16px 72px}h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}h2{font-size:17px;margin:36px 0 12px}
a{color:inherit}.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.row{display:flex;flex-wrap:wrap;gap:16px;align-items:center}.metrics{display:flex;flex-wrap:wrap;gap:22px;align-items:center}
.metric{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:96px}.metric-label{font-size:13px;color:var(--muted);text-align:center}
.ring{width:84px;height:84px;border-radius:50%;background:conic-gradient(var(--col) calc(var(--p)*1%),var(--line) 0);display:grid;place-items:center}
.ring span{width:68px;height:68px;border-radius:50%;background:var(--card);display:grid;place-items:center;font-size:24px;font-weight:650;font-variant-numeric:tabular-nums}
.arrow{font-size:22px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
ul.list{list-style:none;margin:0;padding:0}ul.list li{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line)}ul.list li:first-child{border-top:0}
.icon{flex:0 0 22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff}
.icon.pass,.icon.true{background:var(--good)}.icon.fail,.icon.false{background:var(--bad)}.icon.warn{background:var(--warn)}.icon.info{background:var(--info)}
.detail{display:block;font-size:13px;color:var(--muted);word-break:break-word}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px 6px;border-top:1px solid var(--line);vertical-align:top}th{font-size:13px;color:var(--muted);font-weight:500;border-top:0}
td.n{text-align:right;font-variant-numeric:tabular-nums;width:60px}
.pill{display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid currentColor;margin-right:4px}
.pill.error{color:var(--bad)}.pill.warn{color:var(--warn)}.pill.info{color:var(--info)}.pill.fix{color:var(--good)}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:8px}summary{cursor:pointer;padding:10px 14px;display:flex;gap:10px;align-items:center}
.dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px}.dot.error{background:var(--bad)}.dot.warn{background:var(--warn)}.dot.info{background:var(--info)}.dot.ok{background:var(--good)}
.path{font-family:ui-monospace,Consolas,monospace;font-size:13.5px;word-break:break-all;flex:1}.count{font-size:13px;color:var(--muted);white-space:nowrap}
.page-body{padding:0 14px 12px 33px}.page-body ul{margin:8px 0 0;padding-left:18px}.kv{font-size:13.5px;color:var(--muted)}.kv b{color:var(--text);font-weight:600;margin-right:6px}
ol{padding-left:20px}ol li{margin:6px 0}
</style></head><body><main>
<p class="muted" style="margin:0 0 6px">SEO Autopilot report · ${h(new Date(a.at).toLocaleString())}</p>
<h1><a href="${h(site.url)}">${h(site.host + site.basePath)}</a></h1>
<p class="muted" style="margin-top:0">${a.pages.length} page(s) checked${site.githubPages ? ' · GitHub Pages' : ''}</p>

<div class="grid" style="margin-top:20px">
  <div class="card"><div class="metrics">${scores}</div></div>
  <div class="card"><div class="metrics">${speed}</div>${ps?.lcp ? `<p class="muted" style="margin:12px 0 0;font-size:13px">LCP ${h(ps.lcp)} · CLS ${h(ps.cls)} · TBT ${h(ps.tbt)} (mobile)</p>` : ''}</div>
</div>

${actions.length ? `<h2>What was done</h2><div class="card"><ul class="list">${actions.map((x) => `<li><span class="icon ${x.ok}">${x.ok ? '✓' : '✗'}</span><span>${h(x.text)}</span></li>`).join('')}</ul></div>` : ''}
${notes.length ? `<div class="card" style="margin-top:12px"><ul class="list">${notes.map((n) => `<li><span class="icon info">i</span><span>${h(n)}</span></li>`).join('')}</ul></div>` : ''}

<h2>Site checks</h2>
<div class="card"><ul class="list">${a.checks.map((ch) => `<li><span class="icon ${ch.status}">${statusIcon[ch.status]}</span><span>${h(ch.label)}${ch.detail ? `<span class="detail">${h(ch.detail)}</span>` : ''}</span></li>`).join('')}</ul></div>

${groups.length ? `<h2>Issues by type</h2><div class="card"><table><tr><th>Issue</th><th class="n">Pages</th><th></th></tr>${groups.map((g) => `<tr><td><span class="pill ${g.severity}">${sevName[g.severity]}</span> ${h(g.label)}</td><td class="n">${g.count}</td><td>${g.fixable ? '<span class="pill fix">auto-fix</span>' : ''}</td></tr>`).join('')}</table></div>` : ''}

${a.broken.length ? `<h2>Broken links</h2><div class="card"><table><tr><th>URL</th><th>Status</th><th>Linked from</th></tr>${a.broken.map((b) => `<tr><td class="path">${h(shortUrl(b.url, site))}</td><td>${h(b.status || b.error)}</td><td class="path">${b.from.map((f) => h(f === 'sitemap.xml' ? f : shortUrl(f, site))).join('<br>')}</td></tr>`).join('')}</table></div>` : ''}

<h2>Pages</h2>
${pagesRows || '<p class="muted">No pages could be loaded.</p>'}

<h2>Next steps</h2>
<div class="card"><ol>
<li>Google usually reads a new sitemap within a few days. New sites typically take 1–4 weeks to show up in results.</li>
<li>Run <code>seo-autopilot status</code> in a few days to see which pages Google has indexed.</li>
<li>After adding pages, run <code>seo-autopilot fix</code>, deploy, then <code>seo-autopilot submit</code>.</li>
<li>Bing: open <a href="https://www.bing.com/webmasters">Bing Webmaster Tools</a> and choose "Import from Google Search Console" to get Bing's dashboard too.</li>
${manual.length ? `<li>Needs a human touch: ${manual.map(h).join('; ')}.</li>` : ''}
</ol></div>
</main></body></html>`;
}
