// Анонимный счётчик установок «Мой бюджет». Cloudflare Worker + KV (привязка STATS).
//   POST /ping  {id, v} — приложение раз в день: случайный номер установки и версия. Больше ничего.
//   GET  /stats — сводка для владельца, заголовок X-Key. Сервер запоминает первый
//                 присланный ключ (от 16 символов, KV cfg:admin) и дальше принимает только его.
// Запись установки: ключ i:<id>, всё нужное — в metadata {f: первый день, l: последний день, v: версия}.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const day = (t = Date.now()) => new Date(t + 5 * 3600e3).toISOString().slice(0, 10); // Ташкент, UTC+5
const minus = (d, n) => day(Date.parse(d) - n * 864e5 - 5 * 3600e3 + 12 * 3600e3);

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/ping' && req.method === 'POST') {
        let b = {};
        try { b = JSON.parse(await req.text()); } catch {}
        const id = String(b.id || '');
        if (!/^[a-z0-9]{12,40}$/.test(id)) return json({ error: 'id' }, 400);
        const v = Math.max(0, Math.min(9999, parseInt(b.v, 10) || 0));
        const t = day(), k = 'i:' + id;
        const old = await env.STATS.getWithMetadata(k);
        const m = old.metadata || null;
        if (m && m.l === t && m.v === v) return json({ ok: true });
        await env.STATS.put(k, '', { metadata: { f: m ? m.f : t, l: t, v } });
        return json({ ok: true });
      }
      if (url.pathname === '/stats' && req.method === 'GET') {
        const key = req.headers.get('X-Key') || '';
        let real = await env.STATS.get('cfg:admin');
        if (!real && key.length >= 16) { await env.STATS.put('cfg:admin', key); real = key; }
        if (!real || key !== real) return json({ error: 'key' }, 401);
        const t = day(), d7 = minus(t, 6), d30 = minus(t, 29);
        const s = { today: t, total: 0, active1: 0, active7: 0, active30: 0, new7: 0, versions: {}, daily: {} };
        let cursor;
        do {
          const l = await env.STATS.list({ prefix: 'i:', cursor });
          for (const k of l.keys) {
            const m = k.metadata; if (!m) continue;
            s.total++;
            if (m.l === t) s.active1++;
            if (m.l >= d7) s.active7++;
            if (m.l >= d30) { s.active30++; s.versions[m.v] = (s.versions[m.v] || 0) + 1; }
            if (m.f >= d7) s.new7++;
            if (m.f >= d30) s.daily[m.f] = (s.daily[m.f] || 0) + 1;
          }
          cursor = l.list_complete ? null : l.cursor;
        } while (cursor);
        return json(s);
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server' }, 500);
    }
  },
};
