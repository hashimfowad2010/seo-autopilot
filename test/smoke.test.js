import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixHtml, buildSitemap, updateRobots } from '../src/fix.js';
import { analyzeHtml, robotsBlocks } from '../src/audit.js';
import { normalizeSiteUrl, describeSite } from '../src/site.js';
import { truncate } from '../src/util.js';

const page = `<!doctype html>
<html>
  <head>
    <title>About me</title>
  </head>
  <body><h1>About</h1><p>I build fast, accessible websites for small businesses &amp; creators all over the world.</p></body>
</html>`;
const ctx = { pageUrl: 'https://me.github.io/site/about.html', isHome: false, siteName: 'My Site', lang: 'en' };

test('fixHtml adds the missing tags', () => {
  const { html, changes } = fixHtml(page, ctx);
  const p = analyzeHtml(html, ctx.pageUrl);
  assert.equal(p.lang, 'en');
  assert.ok(p.charset && p.viewport);
  assert.equal(p.canonical, ctx.pageUrl);
  assert.match(p.description, /^I build fast/);
  assert.equal(p.og.title, 'About me');
  assert.ok(changes.includes('meta description'));
  assert.match(html, /<head>\n    <meta charset="utf-8">/);
});

test('fixHtml is idempotent and keeps existing tags', () => {
  const once = fixHtml(page, ctx).html;
  assert.deepEqual(fixHtml(once, ctx).changes, []);
  const withDesc = page.replace('</title>', '</title>\n    <meta name="description" content="Mine">');
  assert.equal(analyzeHtml(fixHtml(withDesc, ctx).html, ctx.pageUrl).description, 'Mine');
});

test('fixHtml leaves noindex pages alone', () => {
  const hidden = page.replace('</title>', '</title><meta name="robots" content="noindex">');
  assert.equal(fixHtml(hidden, ctx).html, hidden);
});

test('site URLs are normalised', () => {
  assert.equal(normalizeSiteUrl('me.github.io/site'), 'https://me.github.io/site/');
  assert.equal(normalizeSiteUrl('https://example.com/index.html'), 'https://example.com/');
  const site = describeSite('https://me.github.io/site/');
  assert.deepEqual(site.githubPages, { user: 'me', repo: 'site' });
  assert.equal(site.isRoot, false);
});

test('sitemap and robots.txt', () => {
  assert.match(buildSitemap([{ loc: 'https://a.test/?x=1&y=2', lastmod: '2026-01-01' }]), /<loc>https:\/\/a\.test\/\?x=1&amp;y=2<\/loc>/);
  assert.equal(updateRobots(null, 'https://a.test/sitemap.xml'), 'User-agent: *\nAllow: /\n\nSitemap: https://a.test/sitemap.xml\n');
  assert.ok(robotsBlocks('User-agent: *\nDisallow: /', '/'));
  assert.ok(!robotsBlocks('User-agent: *\nDisallow: /private/', '/blog/'));
  assert.ok(!robotsBlocks('User-agent: *\nDisallow: /\nAllow: /site/', '/site/'));
});

test('truncate stays within the limit', () => {
  const t = truncate('word '.repeat(100), 155);
  assert.ok(t.length <= 155, `length ${t.length}`);
});

test('CLI prints help', () => {
  const bin = fileURLToPath(new URL('../bin/seo-autopilot.js', import.meta.url));
  const r = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /seo-autopilot audit <url>/);
});
