import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { c, log, openInBrowser } from './ui.js';
import { HOME, escapeHtml, sameUrl } from './util.js';

const CLIENT_FILE = path.join(HOME, 'google-client.json');
const TOKEN_FILE = path.join(HOME, 'google-token.json');
const SCOPES = ['https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/siteverification'];
const SV = 'https://www.googleapis.com/siteVerification/v1';
const WM = 'https://www.googleapis.com/webmasters/v3';
const enc = encodeURIComponent;

export const SETUP_GUIDE = `
  ${c.bold('One-time Google setup (about 5 minutes)')}
  Google only lets apps use Search Console through an OAuth client that you own.

   1. Create a project (any name):
        ${c.cyan('https://console.cloud.google.com/projectcreate')}
   2. With that project selected, click "Enable" on both of these:
        ${c.cyan('https://console.cloud.google.com/apis/library/searchconsole.googleapis.com')}
        ${c.cyan('https://console.cloud.google.com/apis/library/siteverification.googleapis.com')}
   3. Open ${c.cyan('https://console.cloud.google.com/auth/overview')} and click "Get started".
        App name: SEO Autopilot · Audience: External · use your own email.
   4. Audience → Test users → "Add users" → add your Gmail address.
   5. Clients → "Create client" → Application type: ${c.bold('Desktop app')} → Create → Download JSON.
   6. Paste the downloaded file's path below. It is copied to ${HOME}.
`;

export const hasClient = () => fs.existsSync(CLIENT_FILE);

export function importClient(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw.installed?.client_id || !raw.installed?.client_secret) {
    throw new Error(raw.web ? 'That is a "Web application" client. Create a "Desktop app" client instead.' : 'That file is not a Google OAuth client JSON.');
  }
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CLIENT_FILE, JSON.stringify(raw, null, 2), { mode: 0o600 });
  fs.rmSync(TOKEN_FILE, { force: true });
}

const loadClient = () => JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8')).installed;
function readToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}
function saveToken(t) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  return data;
}

let cached = null;
export async function getAccessToken() {
  if (cached && cached.expiry - 60_000 > Date.now()) return cached.access_token;
  const stored = readToken();
  if (stored && stored.expiry - 60_000 > Date.now()) return (cached = stored).access_token;
  const client = loadClient();
  if (stored?.refresh_token) {
    try {
      const d = await tokenRequest({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: stored.refresh_token, grant_type: 'refresh_token' });
      cached = { ...stored, access_token: d.access_token, expiry: Date.now() + d.expires_in * 1000 };
      saveToken(cached);
      return cached.access_token;
    } catch {
      // Refresh tokens of apps in "Testing" mode expire after 7 days; just sign in again.
    }
  }
  cached = await signIn(client);
  saveToken(cached);
  return cached.access_token;
}

// OAuth for installed apps: loopback redirect + PKCE.
async function signIn(client) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
  })}`;

  log.info('Sign in with the Google account that should own the site. If no browser opens, visit:');
  console.log(`    ${c.cyan(authUrl)}`);
  log.info('Google may warn that the app is unverified: it is your own app, so click Continue.');
  openInBrowser(authUrl);

  const page = (msg) => `<!doctype html><meta charset="utf-8"><title>SEO Autopilot</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh"><p>${escapeHtml(msg)}</p></body>`;
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Google sign-in')), 5 * 60_000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== '/' || (!u.searchParams.has('code') && !u.searchParams.has('error'))) { res.writeHead(404).end(); return; }
      const error = u.searchParams.get('error');
      const got = u.searchParams.get('code');
      const valid = u.searchParams.get('state') === state;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(error ? `Sign-in failed: ${error}` : 'Signed in. You can close this tab and go back to the terminal.'));
      clearTimeout(timer);
      if (error) reject(new Error(`Google sign-in was cancelled (${error})`));
      else if (!valid || !got) reject(new Error('Unexpected response from Google sign-in'));
      else resolve(got);
    });
  }).finally(() => { server.closeAllConnections?.(); server.close(); });

  const d = await tokenRequest({
    code, client_id: client.client_id, client_secret: client.client_secret,
    redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
  });
  const granted = (d.scope || '').split(' ');
  const missing = SCOPES.filter((s) => !granted.includes(s));
  if (missing.length) throw new Error('Not all permissions were granted. Run again and tick every box on the Google consent screen.');
  return { access_token: d.access_token, refresh_token: d.refresh_token, expiry: Date.now() + d.expires_in * 1000 };
}

async function api(method, url, body) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    // Google rejects body-less PUT/POST without Content-Length, so send an empty body.
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' ? undefined : '',
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || text || `HTTP ${res.status}`;
    const hint = /has not been used|is disabled/i.test(msg) ? '\n    → Enable that API in Google Cloud (link above), wait a minute, then run again.' : '';
    const err = new Error(`Google API ${res.status}: ${msg}${hint}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function getVerificationFile(siteUrl) {
  const d = await api('POST', `${SV}/token`, { site: { type: 'SITE', identifier: siteUrl }, verificationMethod: 'FILE' });
  return { name: d.token, content: `google-site-verification: ${d.token}` };
}

export const verify = (siteUrl) => api('POST', `${SV}/webResource?verificationMethod=FILE`, { site: { type: 'SITE', identifier: siteUrl } });

// Verified directly, or the account already has full access to the property in Search Console.
export async function isVerified(siteUrl) {
  const [resources, sites] = await Promise.all([api('GET', `${SV}/webResource`), listSites()]);
  if ((resources.items || []).some((i) => i.site?.type === 'SITE' && sameUrl(i.site.identifier, siteUrl))) return true;
  return sites.some((s) => s.siteUrl.startsWith('http') && sameUrl(s.siteUrl, siteUrl) && /siteOwner|siteFullUser/.test(s.permissionLevel));
}

export const listSites = async () => (await api('GET', `${WM}/sites`)).siteEntry || [];
export const addSite = (siteUrl) => api('PUT', `${WM}/sites/${enc(siteUrl)}`);
export const submitSitemap = (siteUrl, sitemapUrl) => api('PUT', `${WM}/sites/${enc(siteUrl)}/sitemaps/${enc(sitemapUrl)}`);
export const listSitemaps = async (siteUrl) => (await api('GET', `${WM}/sites/${enc(siteUrl)}/sitemaps`)).sitemap || [];
export const inspect = async (siteUrl, url) =>
  (await api('POST', 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { inspectionUrl: url, siteUrl })).inspectionResult;
