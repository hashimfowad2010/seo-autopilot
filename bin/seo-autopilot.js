#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { c, log, ask, confirm, closePrompts, openInBrowser, progress, progressDone } from '../src/ui.js';
import { normalizeSiteUrl, describeSite, detectProject, looksLikeSite, loadConfig, saveConfig, CONFIG_NAME } from '../src/site.js';
import { runAudit, readSitemap, analyzeHtml } from '../src/audit.js';
import { printSummary, writeReport } from '../src/report.js';
import { applyFixes } from '../src/fix.js';
import * as google from '../src/google.js';
import * as indexnow from '../src/indexnow.js';
import * as git from '../src/git.js';
import { fetchText, sleep } from '../src/util.js';

const VERSION = '0.1.0';
const BOOL_FLAGS = new Set(['yes', 'help', 'version', 'pagespeed', 'push', 'google', 'indexnow', 'fix', 'dry-run', 'open', 'replace-sitemap']);
const camel = (s) => s.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-y') out.yes = true;
    else if (a === '-h') out.help = true;
    else if (a.startsWith('--no-')) out[camel(a.slice(5))] = false;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) out[camel(k)] = v;
      else if (BOOL_FLAGS.has(k) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) out[camel(k)] = true;
      else out[camel(k)] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const HELP = `
${c.bold('seo-autopilot')} — audit, fix and register your website with search engines

${c.bold('Usage')}
  seo-autopilot [url]                Guided setup: audit → fix → deploy → Google + Bing
  seo-autopilot audit <url>          Check a live site and open a report (changes nothing)
  seo-autopilot fix [folder]         Add missing meta tags, sitemap.xml and robots.txt
  seo-autopilot submit [folder]      Verify with Google, submit sitemap, ping IndexNow
  seo-autopilot status [folder]      Show which pages Google has indexed
  seo-autopilot google-setup [json]  Connect your Google account (one time)

${c.bold('Options')}
  --url <url>          Site URL (otherwise asked, or read from ${CONFIG_NAME})
  --dir <folder>       Site source folder (default: current folder)
  --max-pages <n>      Crawl limit (default 100)
  --no-pagespeed       Skip the Google PageSpeed test
  --no-google          Skip Google Search Console
  --no-indexnow        Skip Bing/IndexNow
  --no-push            Don't commit & push; you deploy yourself
  --dry-run            (fix) Show what would change without writing
  --replace-sitemap    Overwrite a sitemap.xml you made yourself
  -y, --yes            Accept all defaults
`;

// ---------- shared steps ----------

async function getSite(cfg = {}) {
  const input = args.url || args._[0] || cfg.siteUrl || (await ask('Your website URL (GitHub Pages or any host):'));
  if (!input) throw new Error('A site URL is required.');
  const site = describeSite(normalizeSiteUrl(input));
  const kind = site.githubPages ? `GitHub Pages ${site.isRoot ? 'user site' : 'project site'} (repo: ${site.githubPages.user}/${site.githubPages.repo})` : 'custom host';
  log.info(`${c.bold(site.url)} · ${kind}`);
  return site;
}

async function audit(site, { pagespeed = args.pagespeed !== false } = {}) {
  log.step('Checking your live site');
  if (pagespeed) log.info('Running Google PageSpeed alongside (about 30 seconds)…');
  const result = await runAudit(site, {
    maxPages: Number(args.maxPages) || 100,
    pagespeed,
    onProgress: (n, url) => progress(`crawled ${n} · ${url}`),
  });
  progressDone();
  return result;
}

function guessName(home, site) {
  const fromTitle = home?.title?.split(/\s+[|–—·-]\s+/)[0];
  return home?.og?.siteName || fromTitle || site.githubPages?.repo?.replace(/[-_]/g, ' ') || site.host;
}

// Homepage facts from the live crawl, or from the local index.html when the site isn't live yet.
function findHome(auditResult, site, dirAbs, cfg) {
  const live = auditResult.pages.find((p) => p.url === site.url);
  if (live) return live;
  const file = [path.join(dirAbs, cfg.publishDir || '.', 'index.html'), path.join(dirAbs, 'index.html')].find((f) => fs.existsSync(f));
  return file ? analyzeHtml(fs.readFileSync(file, 'utf8'), site.url) : null;
}

async function siteInfo(cfg, auditResult, site, dirAbs, { askAll }) {
  const home = findHome(auditResult, site, dirAbs, cfg);
  const want = (key) => askAll || !cfg[key];
  if (args.yes) {
    cfg.siteName ||= guessName(home, site);
    cfg.siteDescription ||= home?.description || '';
    cfg.lang ||= home?.lang || 'en';
    return;
  }
  if (want('siteName')) cfg.siteName = await ask('Site name:', cfg.siteName || guessName(home, site));
  if (want('siteDescription')) cfg.siteDescription = await ask('Describe the site in one sentence (used as the homepage description):', cfg.siteDescription || home?.description || '');
  if (want('lang')) cfg.lang = await ask('Main language code (en, ur, ar, …):', cfg.lang || home?.lang || 'en');
}

function printFixResult(result, dryRun) {
  for (const p of result.pageChanges) log.ok(`${p.file} ${c.dim(`+ ${p.changes.join(', ')}`)}`);
  for (const f of result.changed.filter((f) => !result.pageChanges.some((p) => p.file === f))) log.ok(`${f} ${c.dim('written')}`);
  if (!result.changed.length) log.info('Nothing to change — everything that can be auto-fixed already is.');
  for (const n of result.notes) log.info(n);
  if (dryRun) log.warn('Dry run: no files were written.');
}

async function ensureGoogleClient() {
  if (google.hasClient()) return true;
  console.log(google.SETUP_GUIDE);
  const file = await ask('Path to the downloaded client JSON (leave blank to skip Google):');
  if (!file) return false;
  google.importClient(path.resolve(file.replace(/^["']|["']$/g, '')));
  log.ok('Google client saved');
  return true;
}

async function waitUntilLive(site, files) {
  const pending = new Map(files.map((f) => [new URL(f.name, site.url).toString(), f.content.trim()]));
  const started = Date.now();
  while (pending.size) {
    for (const [url, content] of pending) {
      const r = await fetchText(`${url}?nocache=${Date.now()}`, { timeout: 10000 });
      if (r.ok && r.body.trim() === content) { pending.delete(url); progressDone(); log.ok(`Live: ${url}`); }
    }
    if (!pending.size) return true;
    const secs = Math.round((Date.now() - started) / 1000);
    if (secs > 600) {
      progressDone();
      if (args.yes || !(await confirm('Still not live after 10 minutes. Keep waiting?'))) return false;
      return waitUntilLive(site, files.filter((f) => pending.has(new URL(f.name, site.url).toString())));
    }
    progress(`waiting for your host to publish (${secs}s)… GitHub Pages usually takes 1–2 minutes`);
    await sleep(10000);
  }
  return true;
}

async function googleRegister(site, sitemapUrl, actions) {
  log.step('Google Search Console');
  try {
    if (await google.isVerified(site.url)) {
      log.ok('Site is already verified with Google');
    } else {
      for (let attempt = 1; ; attempt++) {
        try {
          await google.verify(site.url);
          break;
        } catch (e) {
          if (attempt === 3) throw e;
          log.warn('Google could not see the verification file yet — retrying in 30s…');
          await sleep(30000);
        }
      }
      log.ok('Ownership verified');
      actions.push({ ok: true, text: 'Verified site ownership with Google' });
    }
    await google.addSite(site.url);
    log.ok('Property added to Search Console');
    actions.push({ ok: true, text: `Added ${site.url} to Google Search Console` });
    await google.submitSitemap(site.url, sitemapUrl);
    log.ok(`Sitemap submitted: ${sitemapUrl}`);
    actions.push({ ok: true, text: `Submitted sitemap to Google: ${sitemapUrl}` });
    log.info(`Dashboard: https://search.google.com/search-console?resource_id=${encodeURIComponent(site.url)}`);
    return true;
  } catch (e) {
    log.err(e.message);
    actions.push({ ok: false, text: `Google: ${e.message.split('\n')[0]}` });
    return false;
  }
}

async function indexNowSubmit(site, key, urls, actions) {
  log.step('Bing, Yandex & others (IndexNow)');
  if (!urls.length) { log.warn('No URLs to submit.'); return; }
  const r = await indexnow.submit(site, key, urls);
  if (r.ok) {
    log.ok(`Submitted ${urls.length} URL(s) — Bing, Yandex, Seznam, Naver and Yep were notified`);
    actions.push({ ok: true, text: `Notified Bing, Yandex and others of ${urls.length} URL(s) via IndexNow` });
  } else {
    log.err(`IndexNow: ${r.message}`);
    actions.push({ ok: false, text: `IndexNow: ${r.message}` });
  }
}

function finishReport(data) {
  const file = writeReport(data);
  log.ok(`Report saved: ${file}`);
  if (args.open !== false) openInBrowser(pathToFileURL(file).href);
}

// ---------- commands ----------

async function cmdRun() {
  console.log(`\n${c.bold('SEO Autopilot')} ${c.dim(`v${VERSION}`)} — get your site found on Google & Bing\n`);
  const startDir = path.resolve(args.dir || '.');
  const site = await getSite(loadConfig(startDir));
  const before = await audit(site);
  printSummary(before);

  log.step("Your site's files");
  const dirIn = args.dir || (await ask('Folder with your site\'s source (leave blank to stop at the report):', looksLikeSite(startDir) ? startDir : ''));
  if (!dirIn) return finishReport({ before });
  const dirAbs = path.resolve(dirIn.replace(/^["']|["']$/g, ''));
  if (!fs.existsSync(dirAbs)) throw new Error(`Folder not found: ${dirAbs}`);

  const cfg = { ...loadConfig(dirAbs), siteUrl: site.url };
  const project = detectProject(dirAbs);
  if (project.framework) log.info(`Detected ${project.framework} project`);
  cfg.publishDir = args.publishDir || (args.yes ? cfg.publishDir || project.publishDir : await ask('Folder that gets published at your site root:', cfg.publishDir || project.publishDir));
  await siteInfo(cfg, before, site, dirAbs, { askAll: true });

  const yes = (q) => args.yes || confirm(q);
  const doFix = args.fix !== false && (await yes('Auto-fix SEO issues (meta tags, sitemap, robots.txt)?'));
  const doGoogle = args.google !== false && (await yes('Register the site with Google Search Console?'));
  const doIndexNow = args.indexnow !== false && (await yes('Notify Bing, Yandex & others via IndexNow?'));

  const actions = [];
  const extraFiles = [];
  let googleReady = false;
  if (doGoogle) {
    log.step('Connecting to Google');
    try {
      if (await ensureGoogleClient()) {
        await google.getAccessToken();
        log.ok('Signed in to Google');
        googleReady = true;
        if (!(await google.isVerified(site.url))) {
          const file = await google.getVerificationFile(site.url);
          extraFiles.push(file);
          log.ok(`Got verification file ${file.name}`);
        }
      } else log.info('Skipping Google for now. Run `seo-autopilot google-setup` later.');
    } catch (e) {
      log.err(e.message);
      actions.push({ ok: false, text: `Google sign-in: ${e.message.split('\n')[0]}` });
    }
  }
  if (doIndexNow) {
    cfg.indexNowKey ||= indexnow.newKey();
    extraFiles.push(indexnow.keyFile(cfg.indexNowKey));
  }

  log.step('Updating your site files');
  let replaceSitemap = !!args.replaceSitemap;
  const smPath = path.join(dirAbs, cfg.publishDir, 'sitemap.xml');
  if (doFix && !replaceSitemap && !args.yes && fs.existsSync(smPath) && !fs.readFileSync(smPath, 'utf8').includes('generated by seo-autopilot')) {
    replaceSitemap = await confirm('You already have a sitemap.xml. Replace it with a generated one?', false);
  }
  // Search engines need a sitemap to submit, so one is generated even without the other fixes.
  const needSitemap = doFix || ((googleReady || doIndexNow) && !before.sitemapUrl);
  const result = applyFixes({ dirAbs, project, site, cfg, crawledPages: before.pages, extraFiles, htmlFixes: doFix, sitemap: needSitemap, replaceSitemap });
  cfg.sitemapUrl = before.sitemapUrl && !result.changed.some((f) => f.endsWith('sitemap.xml')) ? before.sitemapUrl : result.sitemapUrl;
  saveConfig(dirAbs, cfg);
  printFixResult(result, false);
  if (result.pageChanges.length) actions.push({ ok: true, text: `Added missing SEO tags to ${result.pageChanges.length} page(s)` });
  if (result.changed.some((f) => f.endsWith('sitemap.xml'))) actions.push({ ok: true, text: `Generated sitemap.xml with ${result.sitemapEntries.length} URL(s)` });
  if (result.changed.some((f) => f.endsWith('robots.txt'))) actions.push({ ok: true, text: 'Created/updated robots.txt' });

  const toDeploy = [...result.changed, CONFIG_NAME];
  let deployed = !result.changed.length;
  if (result.changed.length) {
    log.step('Publishing the changes');
    const branch = git.isGitRepo(dirAbs) ? git.currentBranch(dirAbs) : null;
    if (branch && args.push !== false && (await yes(`Commit these ${toDeploy.length} file(s) and push branch "${branch}"?`))) {
      const r = git.commitAndPush(dirAbs, toDeploy, 'Improve SEO: meta tags, sitemap and search engine verification');
      if (r.ok) { log.ok('Pushed'); actions.push({ ok: true, text: `Committed and pushed ${toDeploy.length} file(s)` }); deployed = true; }
      else log.err(r.error);
    }
    if (!deployed) {
      log.info('Deploy/upload the changed files to your host now.');
      await ask('Press Enter once they are live…');
      deployed = true;
    }
  }

  if (extraFiles.length) {
    log.step('Waiting for the new files to go live');
    if (!(await waitUntilLive(site, extraFiles))) {
      log.warn('Files are not live yet. Once they are, run: seo-autopilot submit');
      actions.push({ ok: false, text: 'Deploy not detected — run `seo-autopilot submit` once the site is updated' });
      return finishReport({ before, actions, notes: result.notes });
    }
  }

  const sitemapUrls = result.sitemapEntries.length ? result.sitemapEntries.map((e) => e.loc) : (await readSitemap(cfg.sitemapUrl)) || [site.url];
  if (googleReady) await googleRegister(site, cfg.sitemapUrl, actions);
  if (doIndexNow) await indexNowSubmit(site, cfg.indexNowKey, sitemapUrls, actions);

  const after = result.changed.length ? await audit(site, { pagespeed: false }) : null;
  if (after) after.pagespeed = before.pagespeed;
  if (after) console.log(`\n  SEO score: ${c.dim(before.score)} → ${c.bold(c.green(after.score))}`);
  finishReport({ before, after, actions, notes: result.notes });
  console.log(`\n  ${c.green('Done.')} Google usually picks up a new sitemap within a few days.`);
  console.log(`  Check progress any time with ${c.bold('seo-autopilot status')} (run it inside ${dirAbs}).\n`);
}

async function cmdAudit() {
  const site = await getSite(loadConfig(path.resolve(args.dir || '.')));
  const result = await audit(site);
  printSummary(result);
  finishReport({ before: result });
}

async function cmdFix() {
  const dirAbs = path.resolve(args.dir || args._.shift() || '.');
  const cfg = loadConfig(dirAbs);
  const site = await getSite(cfg);
  const project = detectProject(dirAbs);
  cfg.siteUrl = site.url;
  cfg.publishDir ||= args.publishDir || project.publishDir;
  const crawl = await audit(site, { pagespeed: false });
  await siteInfo(cfg, crawl, site, dirAbs, { askAll: false });
  log.step(args.dryRun ? 'Changes that would be made' : 'Updating your site files');
  const extra = cfg.indexNowKey ? [indexnow.keyFile(cfg.indexNowKey)] : [];
  const result = applyFixes({ dirAbs, project, site, cfg, crawledPages: crawl.pages, extraFiles: extra, replaceSitemap: !!args.replaceSitemap, dryRun: !!args.dryRun });
  printFixResult(result, args.dryRun);
  if (!args.dryRun) {
    cfg.sitemapUrl ||= result.sitemapUrl;
    saveConfig(dirAbs, cfg);
    if (result.changed.length) log.info('Review the changes, commit & deploy, then run `seo-autopilot submit`.');
  }
}

async function cmdSubmit() {
  const dirAbs = path.resolve(args.dir || '.');
  const cfg = loadConfig(dirAbs);
  const site = await getSite(cfg);
  const sitemapUrl = cfg.sitemapUrl || new URL('sitemap.xml', site.url).toString();
  const urls = (await readSitemap(sitemapUrl)) || [];
  if (!urls.length) log.warn(`No live sitemap at ${sitemapUrl} — run \`seo-autopilot fix\` and deploy first.`);
  const actions = [];

  if (args.google !== false && (await ensureGoogleClient())) {
    await google.getAccessToken();
    if (!(await google.isVerified(site.url))) {
      const file = await google.getVerificationFile(site.url);
      const live = await fetchText(new URL(file.name, site.url).toString());
      if (!live.ok) {
        const publishAbs = path.resolve(dirAbs, cfg.publishDir || detectProject(dirAbs).publishDir);
        fs.writeFileSync(path.join(publishAbs, file.name), file.content);
        log.warn(`Wrote ${path.relative(dirAbs, path.join(publishAbs, file.name))}. Deploy it, then run \`seo-autopilot submit\` again.`);
        return;
      }
    }
    if (urls.length) await googleRegister(site, sitemapUrl, actions);
  }
  if (args.indexnow !== false && urls.length) {
    if (cfg.indexNowKey) await indexNowSubmit(site, cfg.indexNowKey, urls, actions);
    else log.info('No IndexNow key yet — run the guided setup (`seo-autopilot`) once to add one.');
  }
}

async function cmdStatus() {
  const dirAbs = path.resolve(args.dir || '.');
  const cfg = loadConfig(dirAbs);
  const site = await getSite(cfg);
  if (!(await ensureGoogleClient())) return;

  log.step('Sitemaps in Search Console');
  const sitemaps = await google.listSitemaps(site.url);
  if (!sitemaps.length) log.warn('No sitemaps submitted yet — run `seo-autopilot submit`.');
  for (const s of sitemaps) {
    const submitted = s.contents?.reduce((n, x) => n + Number(x.submitted || 0), 0) ?? '?';
    const problems = Number(s.errors || 0) + Number(s.warnings || 0);
    const line = `${s.path} · ${submitted} URLs · last read ${s.lastDownloaded ? s.lastDownloaded.slice(0, 10) : 'not yet'}`;
    problems ? log.warn(`${line} · ${s.errors || 0} errors, ${s.warnings || 0} warnings`) : log.ok(line);
  }

  log.step('Index status (Google URL Inspection)');
  const urls = ((await readSitemap(cfg.sitemapUrl || new URL('sitemap.xml', site.url).toString())) || [site.url]).slice(0, Number(args.limit) || 25);
  let indexed = 0;
  for (const u of urls) {
    try {
      const st = (await google.inspect(site.url, u))?.indexStatusResult;
      if (st?.verdict === 'PASS') indexed++;
      const icon = st?.verdict === 'PASS' ? c.green('✓') : st?.verdict === 'FAIL' ? c.red('✗') : c.dim('·');
      const short = u.startsWith(site.url) ? '/' + u.slice(site.url.length) : u;
      console.log(`   ${icon} ${short}  ${c.dim(st?.coverageState || 'unknown')}${st?.lastCrawlTime ? c.dim(` · crawled ${st.lastCrawlTime.slice(0, 10)}`) : ''}`);
    } catch (e) {
      log.err(`${u}: ${e.message.split('\n')[0]}`);
      if (e.status === 403 || e.status === 429) break;
    }
  }
  console.log(`\n  ${c.bold(`${indexed}/${urls.length}`)} checked pages are indexed on Google.`);
}

async function cmdGoogleSetup() {
  const file = args._.shift();
  if (file) {
    google.importClient(path.resolve(file));
    log.ok('Google client saved');
  } else if (google.hasClient() && !(await confirm('A Google client is already set up. Replace it?', false))) {
    // keep the current client and just test it
  } else {
    console.log(google.SETUP_GUIDE);
    const p = await ask('Path to the downloaded client JSON:');
    if (!p) return;
    google.importClient(path.resolve(p.replace(/^["']|["']$/g, '')));
    log.ok('Google client saved');
  }
  await google.getAccessToken();
  const sites = await google.listSites();
  log.ok(`Connected. Your Search Console has ${sites.length} propert${sites.length === 1 ? 'y' : 'ies'}.`);
  for (const s of sites) log.info(`${s.siteUrl} ${c.dim(s.permissionLevel)}`);
}

// ---------- main ----------

const COMMANDS = { run: cmdRun, audit: cmdAudit, fix: cmdFix, submit: cmdSubmit, status: cmdStatus, 'google-setup': cmdGoogleSetup };
let command = 'run';
if (args.help || args._[0] === 'help') command = 'help';
else if (args.version) command = 'version';
else if (COMMANDS[args._[0]]) command = args._.shift();

try {
  if (command === 'help') console.log(HELP);
  else if (command === 'version') console.log(VERSION);
  else await COMMANDS[command]();
} catch (e) {
  progressDone();
  log.err(e.message);
  if (process.env.DEBUG) console.error(e);
  process.exitCode = 1;
} finally {
  closePrompts();
  process.exit(process.exitCode ?? 0);
}
