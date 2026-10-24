/* ============================================================
   api/_discord.js
   ============================================================ */

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1563567703581659357/n6c8m5SiQINgr2as8OSF6eV8FVEMomCyUEC98e64x7aKEEEif06gigl2ZD1nVhC7t4zW';

const API = 'https://discord.com/api/v10';

const GREEN  = 0x00d54b;
const AMBER  = 0xffb400;
const RED    = 0xe74c3c;
const BLUE   = 0x00b0ff;
const PURPLE = 0x9b59b6;
const GREY   = 0x5c6b62;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function webhookConfigured() {
  return !!(process.env.DISCORD_WEBHOOK || WEBHOOK_URL);
}

function hook() {
  const raw = process.env.DISCORD_WEBHOOK || WEBHOOK_URL;
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length < 2) return null;
  return {
    base: API + '/webhooks/' + seg[0] + '/' + seg[1],
    thread: process.env.DISCORD_THREAD_ID || u.searchParams.get('thread_id') || null,
  };
}

async function call(method, path, payload, opts) {
  opts = opts || {};
  const h = hook();
  if (!h) return null;

  let url = h.base + path;
  const q = [];
  if (h.thread) q.push('thread_id=' + encodeURIComponent(h.thread));
  if (opts.wait) q.push('wait=true');
  if (q.length) url += '?' + q.join('&');

  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: method,
        headers: opts.form ? undefined : { 'Content-Type': 'application/json' },
        body: opts.form || (payload ? JSON.stringify(payload) : undefined),
      });
    } catch (e) {
      console.error('[discord] network:', e.message);
      await sleep(350 * (attempt + 1));
      continue;
    }

    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      const wait = Math.ceil((j.retry_after || 1) * 1000) + 300;
      console.warn('[discord] rate limited, retrying in', wait, 'ms');
      await sleep(wait);
      continue;
    }

   
