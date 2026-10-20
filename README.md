# SEO Autopilot

[![CI](https://github.com/hashimfowad2010/seo-autopilot/actions/workflows/ci.yml/badge.svg)](https://github.com/hashimfowad2010/seo-autopilot/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/hashimfowad2010/seo-autopilot)](https://github.com/hashimfowad2010/seo-autopilot/releases/latest)

One command to get a website found: it audits the live site, fixes the SEO basics in your source files, deploys them, verifies the site with Google Search Console, submits the sitemap, and notifies Bing/Yandex through IndexNow.

Works best with plain HTML sites (most GitHub Pages sites). It also handles Vite/React/Next/Astro projects, but only edits their HTML shell plus `public/`.

## Install

Needs Node.js 20.18 or newer.

```bash
npm install -g github:hashimfowad2010/seo-autopilot
```

Or install a specific release (download links are on the [releases page](https://github.com/hashimfowad2010/seo-autopilot/releases)):

```bash
npm install -g https://github.com/hashimfowad2010/seo-autopilot/releases/download/v0.1.0/seo-autopilot-0.1.0.tgz
```

From a clone: `npm install && npm install -g .` After installing, `seo-autopilot` works from any folder.

## Use it

Run it from inside your site's folder:

```bash
seo-autopilot https://yourname.github.io/your-repo/
```

The guided setup then:

1. **Audits the live site.** It crawls up to 100 pages and checks titles, descriptions, canonical URLs, viewport, `lang`, Open Graph, structured data, alt text, robots.txt, sitemap, HTTPS, 404 handling and broken links. It also runs a Google PageSpeed test.
2. **Asks a few questions:** your site folder, site name, a one-sentence description and the language.
3. **Fixes your files.** It adds missing tags to each HTML page (it never changes tags you already have) and generates `sitemap.xml` and `robots.txt`.
4. **Connects to Google.** You sign in once in the browser, and it fetches a Google verification file.
5. **Publishes.** It commits only the files it changed and pushes, or waits while you upload them yourself.
6. **Waits until GitHub Pages or your host is serving the new files.**
7. **Registers with Google.** It verifies ownership, adds the property to Search Console and submits the sitemap.
8. **Pings IndexNow.** Bing, Yandex, Seznam, Naver and Yep are notified of every URL.
9. **Re-checks the site** and opens a before/after HTML report (saved in `~/.seo-autopilot/reports/`).

Settings are saved in `.seo-autopilot.json` in your site folder, so later runs don't ask again.

### Other commands

| Command | What it does |
| --- | --- |
| `seo-autopilot audit <url>` | Report only. Changes nothing, and works on any site. |
| `seo-autopilot fix [--dry-run]` | Add missing tags and regenerate the sitemap (run after adding pages). |
| `seo-autopilot submit` | Re-submit the sitemap to Google and ping IndexNow (run after deploying new pages). |
| `seo-autopilot status` | Ask Google which of your pages are indexed and when they were crawled. |
| `seo-autopilot google-setup` | Connect or replace the Google account. |

Useful flags: `--no-push` (you deploy yourself), `--no-google`, `--no-indexnow`, `--no-pagespeed`, `--max-pages 300`, `-y` (accept all defaults).

## One-time Google setup (about 5 minutes)

Google only lets software use Search Console through an OAuth client that you own. The tool prints these steps with clickable links the first time:

1. Create a project at <https://console.cloud.google.com/projectcreate>.
2. Enable the **Google Search Console API** and the **Site Verification API** for it.
3. Under **Google Auth Platform**, click **Get started**. Pick audience **External** and add your own Gmail as a **test user**.
4. Under **Clients → Create client**, choose **Desktop app** and download the JSON file.
5. Give the tool that file's path. It is copied to `~/.seo-autopilot/` and never leaves your machine.

While the Google app stays in "Testing" mode, Google ends the sign-in after 7 days. The tool notices and opens the sign-in page again. To stop that, click **Publish app** on the Audience page.

## What can't be automated (honest list)

- **Google decides when to index.** The tool does everything Google officially allows: it verifies ownership, adds the property and submits the sitemap. New sites usually appear within 1–4 weeks.
- **No "Request indexing" button.** Google offers no public API for it. The Indexing API only allows job postings and livestream pages, and using it for normal pages breaks Google's terms, so this tool doesn't.
- **Bing Webmaster Tools dashboard.** IndexNow gets your pages crawled by Bing, but to see Bing's dashboard, open <https://www.bing.com/webmasters> once and pick **Import from Google Search Console**.
- **Content work.** Alt text, thin pages, duplicate titles and `og:image` show up in the report, but they need a person to write them.
- **GitHub Pages project sites** (`user.github.io/repo/`) can't have their own robots.txt, because only `user.github.io/robots.txt` counts. The sitemap is submitted to Google directly instead, which works just as well.
- **PageSpeed scores.** Google's PageSpeed API often rate-limits requests without a key. A free key from <https://developers.google.com/speed/docs/insights/v5/get-started> fixes that: `set PAGESPEED_API_KEY=...` (Windows) or `export PAGESPEED_API_KEY=...`.

## Releasing a new version

1. Add a `## vX.Y.Z — date` section at the top of [CHANGELOG.md](CHANGELOG.md).
2. Run `npm version patch` (or `minor` / `major`). This bumps `package.json`, commits, and tags.
3. Run `git push --follow-tags`.

GitHub Actions then runs the tests, builds the package, and publishes a release with that changelog section and the `.tgz` attached.
