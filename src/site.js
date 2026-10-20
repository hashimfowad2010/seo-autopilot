import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_NAME = '.seo-autopilot.json';

// "user.github.io/repo" -> "https://user.github.io/repo/"
export function normalizeSiteUrl(input) {
  let s = String(input).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  u.hash = '';
  u.search = '';
  if (!u.pathname.endsWith('/')) {
    u.pathname = /\.[a-z0-9]+$/i.test(u.pathname) ? u.pathname.replace(/[^/]*$/, '') : u.pathname + '/';
  }
  return u.toString();
}

export function describeSite(siteUrl) {
  const u = new URL(siteUrl);
  const gh = u.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  const isRoot = u.pathname === '/';
  return {
    url: siteUrl,
    origin: u.origin,
    host: u.hostname,
    basePath: u.pathname,
    isRoot,
    githubPages: gh ? { user: gh[1], repo: isRoot ? `${gh[1]}.github.io` : u.pathname.split('/')[1] } : null,
  };
}

const FRAMEWORK_FILES = {
  'vite.config.js': 'Vite', 'vite.config.ts': 'Vite', 'vite.config.mjs': 'Vite',
  'next.config.js': 'Next.js', 'next.config.mjs': 'Next.js', 'next.config.ts': 'Next.js',
  'astro.config.mjs': 'Astro', 'astro.config.ts': 'Astro',
  'svelte.config.js': 'SvelteKit', 'nuxt.config.ts': 'Nuxt', 'nuxt.config.js': 'Nuxt',
  'angular.json': 'Angular', 'gatsby-config.js': 'Gatsby', 'gatsby-config.ts': 'Gatsby',
};

// Work out what kind of project a folder is and which folder ends up at the site root.
export function detectProject(dirAbs) {
  const has = (p) => fs.existsSync(path.join(dirAbs, p));
  let framework = Object.entries(FRAMEWORK_FILES).find(([f]) => has(f))?.[1];
  if (!framework && has('package.json') && /"react-scripts"/.test(fs.readFileSync(path.join(dirAbs, 'package.json'), 'utf8'))) {
    framework = 'Create React App';
  }
  if (framework) return { kind: 'framework', framework, publishDir: 'public' };
  if (has('index.html')) return { kind: 'static', publishDir: '.' };
  if (has('docs/index.html')) return { kind: 'static', publishDir: 'docs' };
  if (has('_config.yml')) return { kind: 'static', framework: 'Jekyll', publishDir: '.' };
  return { kind: 'static', publishDir: '.' };
}

export const looksLikeSite = (dirAbs) =>
  ['index.html', 'docs/index.html', 'package.json', '_config.yml'].some((p) => fs.existsSync(path.join(dirAbs, p)));

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'vendor', 'coverage']);

export function findHtmlFiles(rootAbs, max = 2000) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= max) return;
      if (ent.isDirectory()) {
        // Jekyll ignores _folders; dot-folders are never published.
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.') || ent.name.startsWith('_')) continue;
        walk(path.join(dir, ent.name));
      } else if (/\.html?$/i.test(ent.name)) {
        out.push(path.join(dir, ent.name));
      }
    }
  };
  if (fs.existsSync(rootAbs)) walk(rootAbs);
  return out;
}

export function fileToUrl(siteUrl, publishAbs, fileAbs) {
  const rel = path.relative(publishAbs, fileAbs).split(path.sep).join('/').replace(/(^|\/)index\.html?$/i, '$1');
  return new URL(rel.split('/').map(encodeURIComponent).join('/'), siteUrl).toString();
}

export function loadConfig(dirAbs) {
  try { return JSON.parse(fs.readFileSync(path.join(dirAbs, CONFIG_NAME), 'utf8')); } catch { return {}; }
}

export function saveConfig(dirAbs, cfg) {
  fs.writeFileSync(path.join(dirAbs, CONFIG_NAME), JSON.stringify(cfg, null, 2) + '\n');
}
