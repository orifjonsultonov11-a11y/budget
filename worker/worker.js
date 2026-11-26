// Очередь платежей Apple Pay для приложения «Мой бюджет».
// Cloudflare Worker. Нужно KV-хранилище с именем привязки QUEUE.
// Ключ: если задан секрет KEY — используется он. Иначе сервер запоминает первый
// присланный ключ (от 16 символов) и дальше принимает только его.
//   POST /add   — команда iPhone присылает платёж {amount, merchant}
//   GET  /list  — приложение забирает платежи
//   POST /ack   — приложение подтверждает {ids:[...]}, записи удаляются
//   POST /rekey — замена ключа {key: новый} (с текущим ключом в X-Key)
//   POST /summary — приложение кладёт короткую сводку для виджета (лимит, проценты категорий)
//   GET  /summary — виджет забирает сводку; pend — оплаты из очереди, которых приложение ещё не видело
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

// «25 400,00 UZS» -> 25400 (копейки отбрасываются), как parseAmt() в приложении
function amt(v) {
  let s = String(v ?? '').replace(/[^\d.,]/g, '').replace(/[.,]\d{1,2}$/, '');
  return +s.replace(/\D/g, '') || 0;
}

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
    let real = env.KEY || await env.QUEUE.get('cfg:key');
    if (!real && key.length >= 16) { await env.QUEUE.put('cfg:key', key); real = key; }
    if (!real || key !== real) return json({ error: 'key' }, 401);

    if (url.pathname === '/rekey' && req.method === 'POST') {
      if (env.KEY) return json({ error: 'secret KEY is set, change it in Cloudflare' }, 409);
      const b = await body(req);
      const nk = String(b.key || '');
      if (nk.length < 16) return json({ error: 'short key' }, 400);
      await env.QUEUE.put('cfg:key', nk);
      return json({ ok: true });
    }

    if (url.pathname === '/add' && req.method === 'POST') {
      const b = await body(req);
      const t = Date.now();
      const id = t.toString(36) + crypto.randomUUID().slice(0, 6);
      const item = { id, t, amount: String(b.amount ?? '').slice(0, 40), merchant: String(b.merchant ?? '').slice(0, 100) };
      await env.QUEUE.put('tx:' + id, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 30 });
      return json({ ok: true, id });
    }
    if (url.pathname === '/summary' && req.method === 'POST') {
      const text = await req.text();
      if (text.length > 8000) return json({ error: 'too big' }, 413);
      try { JSON.parse(text); } catch { return json({ error: 'json' }, 400); }
      await env.QUEUE.put('cfg:sum', text);
      return json({ ok: true });
    }
    if (url.pathname === '/summary' && req.method === 'GET') {
      const sum = await env.QUEUE.get('cfg:sum', 'json');
      if (!sum) return json({ error: 'no summary' }, 404);
      const list = await env.QUEUE.list({ prefix: 'tx:' });
      const items = (await Promise.all(list.keys.map(k => env.QUEUE.get(k.name, 'json')))).filter(Boolean);
      const fresh = items.filter(it => it.t > (sum.t || 0));
      sum.pend = { n: fresh.length, sum: fresh.reduce((a, it) => a + amt(it.amount), 0), items: fresh.map(it => ({ t: it.t, a: amt(it.amount) })) };
      return json(sum);
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
