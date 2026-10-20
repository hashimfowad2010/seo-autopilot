# Changelog

## v0.1.0 — 2026-10-20

First release.

- **Guided setup** (`seo-autopilot <url>`): audit → fix → commit & push → wait for deploy → Google Search Console → IndexNow → before/after report.
- **Audit** of the live site: crawls up to 100 pages and checks titles, meta descriptions, canonical URLs, viewport, `lang`, Open Graph and Twitter tags, JSON-LD, image alt text, thin and duplicate content, robots.txt, sitemap, HTTPS, soft 404s and broken links. It also runs Google PageSpeed (mobile).
- **Auto-fix** for plain HTML sites: adds only the tags that are missing and never changes existing ones, so it is safe to re-run. It also generates `sitemap.xml` and `robots.txt`. For Vite, React, Next and Astro projects, only the HTML shell is edited.
- **Google Search Console**: sign in through the browser, verify ownership with an HTML file, add the property, submit the sitemap, and check index status with `seo-autopilot status`.
- **IndexNow**: Bing, Yandex, Seznam, Naver and Yep are notified of every URL.
- Self-contained HTML report with light and dark themes.
