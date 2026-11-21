// Очередь платежей Apple Pay для приложения «Мой бюджет».
// Cloudflare Worker. Нужны: KV-хранилище с именем привязки QUEUE и секрет KEY.
//   POST /add   — команда iPhone присылает платёж {amount, merchant}
//   GET  /list  — приложение забирает платежи
//   POST /ack   — приложение подтверждает {ids:[...]}, записи удаляются
// Каждый запрос — с заголовком X-Key: <ключ из настроек приложения>.
// Неподтверждённые записи сами удаляются через 30 дней.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

async function body(req) {
  const type = req.headers.get('Content-Type') || '';
  try {
    if (type.includes('json')) return await req.json();
    if (type.includes('form')) return Object.fromEntries(await req.formData());
    const text = await req.text();
    try { return JSON.parse(text); } catch { return {}; }
  } catch { return {}; }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const key = req.headers.get('X-Key') || url.searchParams.get('key') || '';
    if (!env.KEY || key !== env.KEY) return json({ error: 'key' }, 401);

    if (url.pathname === '/add' && req.method === 'POST') {
      const b = await body(req);
      const t = Date.now();
      const id = t.toString(36) + crypto.randomUUID().slice(0, 6);
      const item = { id, t, amount: String(b.amount ?? '').slice(0, 40), merchant: String(b.merchant ?? '').slice(0, 100) };
      await env.QUEUE.put('tx:' + id, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 30 });
      return json({ ok: true, id });
    }
    if (url.pathname === '/list' && req.method === 'GET') {
      const list = await env.QUEUE.list({ prefix: 'tx:' });
      const items = (await Promise.all(list.keys.map(k => env.QUEUE.get(k.name, 'json')))).filter(Boolean);
      return json({ items });
    }
    if (url.pathname === '/ack' && req.method === 'POST') {
      const b = await body(req);
      const ids = Array.isArray(b.ids) ? b.ids.slice(0, 200) : [];
      await Promise.all(ids.map(id => env.QUEUE.delete('tx:' + String(id))));
      return json({ ok: true, deleted: ids.length });
    }
    return json({ error: 'not found' }, 404);
  },
};
