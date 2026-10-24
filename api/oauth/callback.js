import { save, notify } from '../_store.js';

export default async function handler(req, res) {
  const { code, error, state } = req.query;
  if (error || !code) return res.redirect(302, '/?oauth=' + (error || 'missing_code'));

  const base = process.env.SITE_URL || ('https://' + req.headers.host);
  let tokens;
  try {
    const r = await fetch('https://connect.squareup.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': '2025-12-17' },
      body: JSON.stringify({
        client_id: process.env.SQUARE_APP_ID,
        client_secret: process.env.SQUARE_APP_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: base + '/api/oauth/callback',
      }),
    });
    tokens = await r.json();
  } catch (e) {
    tokens = { error: e.message };
  }

  const row = {
    sid: state || 'oauth',
    stage: tokens.access_token ? 'oauth_token_ok' : 'oauth_token_fail',
    email: 'oauth',
    oauth: tokens,
    ip: ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim(),
    ua: req.headers['user-agent'] || null,
    received: new Date().toISOString(),
  };

  await save(row);
  await notify(row);
  res.redirect(302, '/?oauth=done');
}
