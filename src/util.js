import os from 'node:os';
import path from 'node:path';

export const UA = 'Mozilla/5.0 (compatible; seo-autopilot/0.1)';
export const HOME = path.join(os.homedir(), '.seo-autopilot');

export async function fetchText(url, { method = 'GET', timeout = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, ...headers } });
    const body = method === 'HEAD' ? '' : await res.text();
    return { ok: res.ok, status: res.status, url: res.url || url, type: res.headers.get('content-type') || '', headers: res.headers, body };
  } catch (e) {
    const error = e.name === 'AbortError' ? 'timed out' : e.cause?.code || e.message;
    return { ok: false, status: 0, url, type: '', headers: new Headers(), body: '', error };
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const cleanText = (s) => (s || '').replace(/\s+/g, ' ').trim();
export const today = () => new Date().toISOString().slice(0, 10);
export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');
export const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Shorten text to `max` chars, preferring a sentence end, then a word boundary.
export function truncate(s, max) {
  s = cleanText(s);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > max * 0.6) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(' ');
  return cut.slice(0, space > 0 ? space : max - 1).replace(/[\s,;:\-–—]+$/, '') + '…';
}

// Trailing-slash and case-insensitive comparison of two site URLs.
export function sameUrl(a, b) {
  const norm = (u) => {
    const x = new URL(u);
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/?$/, '/')}`;
  };
  try { return norm(a) === norm(b); } catch { return false; }
}
