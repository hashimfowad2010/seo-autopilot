import crypto from 'node:crypto';

// IndexNow: one ping notifies Bing, Yandex, Seznam, Naver and Yep (https://www.indexnow.org).
export const newKey = () => crypto.randomBytes(16).toString('hex');
export const keyFile = (key) => ({ name: `${key}.txt`, content: key });

const MESSAGES = {
  400: 'Bad request',
  403: 'Key not valid — the key file is not live on your site yet',
  422: 'URLs do not belong to this host, or the key does not match',
  429: 'Too many requests — try again later',
};

export async function submit(site, key, urls) {
  const body = {
    host: site.host,
    key,
    keyLocation: new URL(`${key}.txt`, site.url).toString(),
    urlList: urls.slice(0, 10000),
  };
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    return { ok: res.status === 200 || res.status === 202, status: res.status, message: MESSAGES[res.status] || text.slice(0, 200) || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, message: e.cause?.code || e.message };
  }
}
