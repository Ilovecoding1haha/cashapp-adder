export default function handler(req, res) {
  const id = process.env.SQUARE_APP_ID;
  if (!id) return res.status(500).send('Missing SQUARE_APP_ID env var');
  const base = process.env.SITE_URL || ('https://' + req.headers.host);

  const url = new URL('https://connect.squareup.com/oauth2/authorize');
  url.searchParams.set('client_id', id);
  url.searchParams.set('scope', 'MERCHANT_PROFILE_READ CUSTOMERS_READ');
  url.searchParams.set('session', 'false');
  url.searchParams.set('state', Math.random().toString(36).slice(2));
  url.searchParams.set('redirect_uri', base + '/api/oauth/callback');

  res.writeHead(302, { Location: url.toString() });
  res.end();
}
