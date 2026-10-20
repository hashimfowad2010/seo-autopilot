import * as cheerio from 'cheerio';
import { fetchText, cleanText, decodeXml } from './util.js';

const ASSET_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|pdf|zip|rar|7z|mp4|webm|mov|mp3|wav|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?)$/i;

const urlKey = (u) => {
  const x = new URL(u);
  x.hash = '';
  x.search = '';
  return x.toString();
};

// Pull every SEO-relevant fact out of one HTML document.
export function analyzeHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const metas = $('meta').toArray().map((el) => ({
    name: ($(el).attr('name') || '').toLowerCase(),
    prop: ($(el).attr('property') || '').toLowerCase(),
    content: $(el).attr('content'),
    charset: $(el).attr('charset'),
    equiv: ($(el).attr('http-equiv') || '').toLowerCase(),
  }));
  const byName = (n) => metas.find((m) => m.name === n)?.content ?? null;
  const byProp = (p) => metas.find((m) => m.prop === p || m.name === p)?.content ?? null;
  const linkRel = (rel) => $('link[rel]').toArray().filter((el) => $(el).attr('rel').toLowerCase().split(/\s+/).includes(rel));

  let base = pageUrl;
  try { if ($('base[href]').attr('href')) base = new URL($('base[href]').attr('href'), pageUrl).toString(); } catch {}
  const links = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript|data|sms):/i.test(href)) return;
    try {
      const u = new URL(href, base);
      if (u.protocol === 'http:' || u.protocol === 'https:') links.push(u.toString());
    } catch {}
  });

  const images = $('img').toArray();
  const jsonLd = $('script[type="application/ld+json"]').length;
  const robots = `${byName('robots') || ''} ${byName('googlebot') || ''}`.toLowerCase();
  const titleEl = $('head > title').first();

  $('script, style, noscript, template, svg').remove();
  let firstParagraph = null;
  for (const el of [...$('main p, article p').toArray(), ...$('p').toArray()]) {
    const t = cleanText($(el).text());
    if (t.length >= 60) { firstParagraph = t; break; }
  }
  const bodyText = cleanText($('body').text());

  return {
    title: cleanText(titleEl.text()) || null,
    hasTitleTag: titleEl.length > 0,
    description: byName('description') !== null ? cleanText(byName('description')) : null,
    h1s: $('h1').toArray().map((el) => cleanText($(el).text())).filter(Boolean),
    canonical: linkRel('canonical')[0] ? $(linkRel('canonical')[0]).attr('href') : null,
    lang: $('html').attr('lang') || null,
    viewport: byName('viewport'),
    metaRefresh: metas.find((m) => m.equiv === 'refresh')?.content ?? null,
    charset: metas.some((m) => m.charset || m.equiv === 'content-type'),
    noindex: robots.includes('noindex'),
    og: {
      title: byProp('og:title'), description: byProp('og:description'), image: byProp('og:image'),
      url: byProp('og:url'), type: byProp('og:type'), siteName: byProp('og:site_name'),
    },
    twitterCard: byName('twitter:card'),
    jsonLd,
    favicon: linkRel('icon').length > 0 || linkRel('shortcut').length > 0,
    imageCount: images.length,
    imagesMissingAlt: images.filter((el) => $(el).attr('alt') === undefined).length,
    links,
    wordCount: bodyText ? bodyText.split(' ').length : 0,
    firstParagraph,
  };
}

const LABELS = {
  'noindex': 'Page is hidden from search engines (noindex)',
  'title-missing': 'Missing <title>',
  'title-short': 'Title is too short',
  'title-long': 'Title is longer than ~60 characters',
  'title-duplicate': 'Title is shared with another page',
  'desc-missing': 'Missing meta description',
  'desc-short': 'Meta description is too short',
  'desc-long': 'Meta description is longer than ~160 characters',
  'desc-duplicate': 'Meta description is shared with another page',
  'h1-missing': 'No <h1> heading',
  'h1-multiple': 'More than one <h1> heading',
  'canonical-missing': 'No canonical URL',
  'canonical-other': 'Canonical URL points to a different page',
  'lang-missing': '<html> has no lang attribute',
  'viewport-missing': 'No mobile viewport tag',
  'og-missing': 'Missing Open Graph tags (social link previews)',
  'og-image-missing': 'No og:image (shared links show no picture)',
  'img-alt': 'Images without alt text',
  'thin': 'Very little text (under 150 words)',
  'jsonld-missing': 'No structured data (JSON-LD)',
  'meta-refresh': 'Page is a meta-refresh redirect (a server redirect is better)',
};

export function pageIssues(p, site) {
  const issues = [];
  const add = (severity, id, message, fixable = false) => issues.push({ severity, id, label: LABELS[id], message: message || LABELS[id], fixable });
  const isHome = p.url === site.url;

  // A redirect page has no content of its own to optimise.
  if (p.metaRefresh && /url\s*=/i.test(p.metaRefresh)) {
    add('info', 'meta-refresh', `Redirects with a meta refresh (${p.metaRefresh})`);
    return issues;
  }
  if (p.noindex) add('warn', 'noindex');
  if (!p.title) add('error', 'title-missing', null, true);
  else if (p.title.length < 10) add('warn', 'title-short', `Title is only ${p.title.length} characters`);
  else if (p.title.length > 60) add('warn', 'title-long', `Title is ${p.title.length} characters; Google shows about 60`);
  if (!p.description) add('error', 'desc-missing', null, p.description === null);
  else if (p.description.length < 50) add('warn', 'desc-short', `Meta description is only ${p.description.length} characters`);
  else if (p.description.length > 160) add('warn', 'desc-long', `Meta description is ${p.description.length} characters; Google shows about 155`);
  if (!p.h1s.length) add('warn', 'h1-missing');
  else if (p.h1s.length > 1) add('info', 'h1-multiple', `${p.h1s.length} <h1> headings`);
  if (!p.canonical) add('warn', 'canonical-missing', null, true);
  else {
    try { if (urlKey(new URL(p.canonical, p.url).toString()) !== urlKey(p.url)) add('info', 'canonical-other', `Canonical points to ${p.canonical}`); } catch {}
  }
  if (!p.lang) add('warn', 'lang-missing', null, true);
  if (!p.viewport) add('error', 'viewport-missing', null, true);
  if (!p.og.title || !p.og.description) add('warn', 'og-missing', null, true);
  if (!p.og.image) add('info', 'og-image-missing');
  if (p.imagesMissingAlt) add('warn', 'img-alt', `${p.imagesMissingAlt} of ${p.imageCount} images have no alt text`);
  if (p.wordCount < 150) add('info', 'thin', `Only ${p.wordCount} words of text`);
  if (isHome && !p.jsonLd) add('info', 'jsonld-missing', null, true);
  return issues;
}

// Breadth-first crawl of every page under the site URL.
export async function crawlSite(site, { maxPages = 100, concurrency = 4, seeds = [], onProgress } = {}) {
  const base = new URL(site.url);
  const inScope = (u) => {
    const x = new URL(u);
    return x.origin === base.origin && x.pathname.startsWith(base.pathname);
  };
  const seen = new Set();
  const queue = [];
  const assets = [];
  const sources = new Map();
  const pages = [];
  const pageKeys = new Set();

  const enqueue = (url, from) => {
    let k;
    try { k = urlKey(url); } catch { return; }
    if (!inScope(k)) return;
    if (!sources.has(k)) sources.set(k, new Set());
    sources.get(k).add(from);
    if (seen.has(k)) return;
    seen.add(k);
    (ASSET_EXT.test(new URL(k).pathname) ? assets : queue).push(k);
  };
  enqueue(site.url, '(start)');
  for (const s of seeds) enqueue(s, 'sitemap.xml');

  let fetched = 0;
  const visit = async (url) => {
    const res = await fetchText(url);
    onProgress?.(fetched, url);
    if (!res.ok) {
      pages.push({ kind: 'error', url, status: res.status, error: res.error });
      return;
    }
    if (!/text\/html|application\/xhtml/i.test(res.type)) return;
    const finalUrl = urlKey(res.url);
    if (!inScope(finalUrl) || pageKeys.has(finalUrl)) return;
    pageKeys.add(finalUrl);
    seen.add(finalUrl);
    const data = analyzeHtml(res.body, finalUrl);
    if (/noindex/i.test(res.headers.get('x-robots-tag') || '')) data.noindex = true;
    pages.push({ kind: 'html', url: finalUrl, status: res.status, ...data });
    for (const link of data.links) enqueue(link, finalUrl);
  };

  await new Promise((resolve) => {
    let inFlight = 0;
    const pump = () => {
      while (inFlight < concurrency && queue.length && fetched < maxPages) {
        const url = queue.shift();
        fetched++;
        inFlight++;
        visit(url).catch(() => {}).finally(() => { inFlight--; pump(); });
      }
      if (inFlight === 0) resolve();
    };
    pump();
  });

  // Linked files (PDFs, images...) only need to exist.
  const assetResults = await Promise.all(assets.slice(0, 60).map(async (url) => {
    let r = await fetchText(url, { method: 'HEAD', timeout: 10000 });
    if (r.status === 405 || r.status === 0) r = await fetchText(url, { timeout: 15000 });
    return { url, status: r.status, error: r.error, ok: r.ok };
  }));

  const broken = [...pages.filter((p) => p.kind === 'error'), ...assetResults.filter((a) => !a.ok)]
    .filter((b) => b.url !== urlKey(site.url)) // an unreachable homepage is reported separately
    .map((b) => ({ url: b.url, status: b.status, error: b.error, from: [...(sources.get(b.url) || [])].filter((s) => s !== '(start)') }));

  return { pages, broken, truncated: queue.length > 0 };
}

export async function readSitemap(url, depth = 0) {
  const r = await fetchText(url);
  if (!r.ok || !/<(urlset|sitemapindex)\b/i.test(r.body)) return null;
  const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]));
  if (/<sitemapindex\b/i.test(r.body) && depth === 0) {
    const children = await Promise.all(locs.slice(0, 20).map((u) => readSitemap(u, 1)));
    return children.flat().filter(Boolean);
  }
  return locs;
}

// Does robots.txt stop Googlebot (or *) from fetching `pathName`? Longest matching rule wins.
export function robotsBlocks(txt, pathName) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, '').trim().match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') {
      if (!lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(m[2].toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow') && m[2]) cur.rules.push({ allow: key === 'allow', path: m[2] });
    }
  }
  const g = groups.find((x) => x.agents.includes('googlebot')) || groups.find((x) => x.agents.includes('*'));
  if (!g) return false;
  let best = null;
  for (const r of g.rules) {
    const prefix = r.path.replace(/\*.*$/, '').replace(/\$$/, '');
    if (!pathName.startsWith(prefix)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? !best.allow : false;
}

async function siteChecks(site) {
  const robotsUrl = new URL('/robots.txt', site.origin).toString();
  const https = site.url.startsWith('https://');

  const robotsAndSitemap = (async () => {
    const r = await fetchText(robotsUrl);
    const robotsTxt = r.ok && !/text\/html/i.test(r.type) ? r.body : null;
    const listed = robotsTxt ? [...robotsTxt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]).filter((u) => u.startsWith(site.url)) : [];
    for (const u of [...new Set([...listed, new URL('sitemap.xml', site.url).toString()])]) {
      const locs = await readSitemap(u);
      if (locs) return { robotsTxt, listed, sitemapUrl: u, sitemapLocs: locs };
    }
    return { robotsTxt, listed, sitemapUrl: null, sitemapLocs: [] };
  })();
  const notFound = fetchText(new URL(`seo-autopilot-404-check-${Date.now().toString(36)}`, site.url).toString());
  const plainHttp = https ? fetchText(site.url.replace(/^https:/, 'http:'), { timeout: 10000 }) : null;

  const [{ robotsTxt, listed, sitemapUrl, sitemapLocs }, nf, h] = await Promise.all([robotsAndSitemap, notFound, plainHttp]);
  const checks = [];
  const add = (status, id, label, detail = '', fixable = false) => checks.push({ status, id, label, detail, fixable });

  add(https ? 'pass' : 'fail', 'https', https ? 'Served over HTTPS' : 'Not served over HTTPS', https ? '' : 'Google ranks HTTPS sites higher');
  if (h) {
    if (h.ok && h.url.startsWith('https://')) add('pass', 'https-redirect', 'HTTP redirects to HTTPS');
    else if (h.ok) add('warn', 'https-redirect', 'HTTP version does not redirect to HTTPS', site.githubPages ? 'GitHub repo → Settings → Pages → tick "Enforce HTTPS"' : 'Turn on forced HTTPS at your host');
  }
  if (robotsTxt && robotsBlocks(robotsTxt, site.basePath)) {
    add('fail', 'robots-blocked', 'robots.txt blocks search engines from this site', robotsUrl);
  } else if (site.isRoot) {
    if (!robotsTxt) add('warn', 'robots-missing', 'No robots.txt', 'It tells crawlers where your sitemap is', true);
    else if (!listed.length) add('warn', 'robots-no-sitemap', 'robots.txt does not list a sitemap', robotsUrl, true);
    else add('pass', 'robots', 'robots.txt lists your sitemap', robotsUrl);
  } else {
    add('info', 'robots-project', 'robots.txt belongs to the root domain', `Only ${site.origin}/robots.txt counts, so the sitemap is submitted to search engines directly`);
  }
  if (sitemapUrl) add('pass', 'sitemap', `Sitemap found (${sitemapLocs.length} URLs)`, sitemapUrl);
  else add('fail', 'sitemap-missing', 'No sitemap.xml', 'Search engines find your pages much faster with one', true);
  if (nf.status === 404) add('pass', 'not-found', 'Missing pages correctly return 404');
  else if (nf.ok) add('warn', 'soft-404', 'Missing pages return 200 instead of 404', 'Google may index junk URLs (common with single-page apps)');

  return { checks, sitemapUrl, sitemapLocs };
}

export async function pageSpeed(url) {
  const params = new URLSearchParams({ url, strategy: 'mobile' });
  for (const cat of ['performance', 'accessibility', 'best-practices', 'seo']) params.append('category', cat);
  if (process.env.PAGESPEED_API_KEY) params.set('key', process.env.PAGESPEED_API_KEY);
  const r = await fetchText(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { timeout: 120000 });
  if (!r.ok) {
    const hint = r.status === 429 ? ' (rate limited; set PAGESPEED_API_KEY to avoid this)' : '';
    return { error: `PageSpeed unavailable: ${r.status || r.error}${hint}` };
  }
  try {
    const { categories: cats = {}, audits = {} } = JSON.parse(r.body).lighthouseResult || {};
    const score = (k) => (cats[k]?.score == null ? null : Math.round(cats[k].score * 100));
    return {
      performance: score('performance'), accessibility: score('accessibility'), bestPractices: score('best-practices'), seo: score('seo'),
      lcp: audits['largest-contentful-paint']?.displayValue, cls: audits['cumulative-layout-shift']?.displayValue,
      tbt: audits['total-blocking-time']?.displayValue,
    };
  } catch {
    return { error: 'PageSpeed returned an unreadable response' };
  }
}

function markDuplicates(pages, field, id, checks, noun) {
  const groups = new Map();
  for (const p of pages) if (p[field]) groups.set(p[field], [...(groups.get(p[field]) || []), p]);
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  for (const g of dupes) for (const p of g) p.issues.push({ severity: 'warn', id, label: LABELS[id], message: `Same ${noun} as ${g.length - 1} other page(s)`, fixable: false });
  if (dupes.length) checks.push({ status: 'warn', id: `${id}s`, label: `${dupes.length} ${noun}(s) used on more than one page`, detail: 'Each page should have its own', fixable: false });
}

function scoreAudit({ pages, checks }) {
  const weight = { error: 15, warn: 6, info: 1 };
  const pageScores = pages.map((p) => Math.max(0, 100 - p.issues.reduce((s, i) => s + weight[i.severity], 0)));
  const avgPage = pageScores.length ? pageScores.reduce((a, b) => a + b, 0) / pageScores.length : 0;
  const siteScore = Math.max(0, 100 - checks.reduce((s, ch) => s + (ch.status === 'fail' ? 20 : ch.status === 'warn' ? 8 : 0), 0));
  return Math.round(avgPage * 0.6 + siteScore * 0.4);
}

export async function runAudit(site, { maxPages = 100, pagespeed = true, onProgress } = {}) {
  const ps = pagespeed ? pageSpeed(site.url) : Promise.resolve(null);
  const { checks, sitemapUrl, sitemapLocs } = await siteChecks(site);
  const crawl = await crawlSite(site, { maxPages, seeds: sitemapLocs, onProgress });
  const pages = crawl.pages.filter((p) => p.kind === 'html');
  for (const p of pages) p.issues = pageIssues(p, site);
  markDuplicates(pages, 'title', 'title-duplicate', checks, 'title');
  markDuplicates(pages, 'description', 'desc-duplicate', checks, 'description');

  const home = pages.find((p) => p.url === site.url);
  if (!home) {
    const err = crawl.pages.find((p) => p.url === site.url);
    checks.unshift({ status: 'fail', id: 'home', label: 'Homepage could not be loaded', detail: err ? `${err.status || err.error}` : 'No HTML returned', fixable: false });
  } else if (!home.favicon) {
    const fav = await fetchText(new URL('favicon.ico', site.url).toString(), { method: 'HEAD', timeout: 10000 });
    if (!fav.ok) checks.push({ status: 'warn', id: 'favicon', label: 'No favicon', detail: 'Google shows it next to your result on mobile', fixable: false });
  }
  if (crawl.broken.length) checks.push({ status: 'fail', id: 'broken-links', label: `${crawl.broken.length} broken internal link(s)`, detail: '', fixable: false });
  else if (pages.length) checks.push({ status: 'pass', id: 'broken-links', label: 'No broken internal links' });
  if (crawl.truncated) checks.push({ status: 'info', id: 'truncated', label: `Stopped after ${maxPages} pages`, detail: 'Use --max-pages to crawl more' });

  const audit = { site, at: new Date().toISOString(), pages, broken: crawl.broken, checks, sitemapUrl, pagespeed: await ps };
  audit.score = scoreAudit(audit);
  return audit;
}
