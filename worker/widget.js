// «Мой бюджет» — виджеты для приложения Scriptable (iOS).
// Скрипт копируется из приложения: «Настройки» → «Виджет» → «Скопировать скрипт виджета».
// Адрес сервера и ключ подставляются туда автоматически.
//
// Размер: маленький — краткий, средний — расширенный.
// Parameter (долгое нажатие → «Изменить виджет»):
//   лимит    — дневное кольцо + полоска периода (по умолчанию, если лимит настроен)
//   расходы  — все расходы за месяц по категориям, без учёта лимита

const SERVER = '__URL__';
const KEY = '__KEY__';

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), 'moy-budget-widget.json');

const BG = Color.dynamic(new Color('#ffffff'), new Color('#1c1c1e'));
const FG = Color.dynamic(new Color('#111111'), new Color('#f2f2f7'));
const MUT = Color.dynamic(new Color('#8a8a8e'), new Color('#8e8e93'));
const TRACK = '#8e8e93';
const GREEN = '#22c55e', YELLOW = '#ffb800', RED = '#ff3b30', RED2 = '#d70015';
const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

async function load() {
  try {
    const r = new Request(SERVER + '/summary');
    r.headers = { 'X-Key': KEY };
    r.timeoutInterval = 10;
    const j = await r.loadJSON();
    if (r.response && r.response.statusCode === 200 && j && j.v === 2) {
      fm.writeString(CACHE, JSON.stringify(j));
      j.live = true;
      return j;
    }
  } catch (e) {}
  if (fm.fileExists(CACHE)) { const j = JSON.parse(fm.readString(CACHE)); if (j.v === 2) return j; }
  return null;
}

// ---------- даты и числа ----------
function ymd(dt) { return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2); }
function utc(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function days(a, b) { return Math.round((utc(b) - utc(a)) / 864e5); }
function day(s) { const [y, m, d] = s.split('-').map(Number); return d + ' ' + MON[m - 1]; }
function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function short(n) {
  n = Math.round(n);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' млн';
  if (Math.abs(n) >= 1e3) return Math.round(n / 1e3) + ' тыс.';
  return String(n);
}
function hm(t) { const d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function color(p) { return p > 1 ? RED : p >= 0.8 ? YELLOW : GREEN; }

// ---------- рисование ----------
function canvas(w, h) { const c = new DrawContext(); c.size = new Size(w, h); c.opaque = false; c.respectScreenScale = true; return c; }
function pt(c, r, f) { const a = -Math.PI / 2 + f * 2 * Math.PI; return new Point(c + r * Math.cos(a), c + r * Math.sin(a)); }
function dot(ctx, p, rad, col) { ctx.setFillColor(col); ctx.fillEllipse(new Rect(p.x - rad, p.y - rad, rad * 2, rad * 2)); }
function arc(ctx, c, r, f0, f1, col, w, caps) {
  if (f1 <= f0) return;
  const n = Math.max(2, Math.ceil((f1 - f0) * 240)), path = new Path();
  path.move(pt(c, r, f0));
  for (let i = 1; i <= n; i++) path.addLine(pt(c, r, f0 + (f1 - f0) * i / n));
  ctx.addPath(path); ctx.setStrokeColor(col); ctx.setLineWidth(w); ctx.strokePath();
  if (caps) { dot(ctx, pt(c, r, f0), w / 2, col); dot(ctx, pt(c, r, f1), w / 2, col); }
}
// кольцо как в Apple Health: больше 100 % — второй круг с тенью на конце
function ringImage(p, size, w) {
  const ctx = canvas(size, size), c = size / 2, r = (size - w) / 2, base = color(p);
  arc(ctx, c, r, 0, 1, new Color(base, 0.18), w, false);
  if (p > 0) arc(ctx, c, r, 0, Math.min(p, 1), new Color(base), w, true);
  if (p > 1) {
    const f = Math.min(p - 1, 0.995);
    for (let k = 3; k >= 1; k--) dot(ctx, pt(c, r, f + 0.012), w / 2 + k, new Color('#000000', 0.1));
    arc(ctx, c, r, 0, f, new Color(RED2), w, true);
  }
  return ctx.getImage();
}
// «долька» кольца со скруглёнными углами
function sector(ctx, c, r, w, f0, f1, rc, col) {
  const ro = r + w / 2, ri = r - w / 2, span = (f1 - f0) * 2 * Math.PI;
  rc = Math.max(0.5, Math.min(rc, w / 2 - 0.5, span * ri / 2 - 0.2));
  const P = (rad, f) => pt(c, rad, f), dO = rc / ro / (2 * Math.PI), dI = rc / ri / (2 * Math.PI);
  const path = new Path(), n = (a, b) => Math.max(2, Math.ceil((b - a) * 240));
  path.move(P(ro, f0 + dO));
  for (let i = 1, k = n(f0 + dO, f1 - dO); i <= k; i++) path.addLine(P(ro, f0 + dO + (f1 - dO - f0 - dO) * i / k));
  path.addQuadCurve(P(ro - rc, f1), P(ro, f1));
  path.addLine(P(ri + rc, f1));
  path.addQuadCurve(P(ri, f1 - dI), P(ri, f1));
  for (let i = 1, k = n(f0 + dI, f1 - dI); i <= k; i++) path.addLine(P(ri, f1 - dI - (f1 - dI - f0 - dI) * i / k));
  path.addQuadCurve(P(ri + rc, f0), P(ri, f0));
  path.addLine(P(ro - rc, f0));
  path.addQuadCurve(P(ro, f0 + dO), P(ro, f0));
  path.closeSubpath();
  ctx.addPath(path); ctx.setFillColor(col); ctx.fillPath();
}
function donutImage(cats, size, w) {
  const ctx = canvas(size, size), c = size / 2, r = (size - w) / 2, L = 2 * Math.PI * r;
  const sum = cats.reduce((a, x) => a + x.p, 0) || 1;
  if (!cats.length) { arc(ctx, c, r, 0, 1, new Color(TRACK, 0.25), w, false); return ctx.getImage(); }
  if (cats.length === 1) { arc(ctx, c, r, 0, 1, new Color(cats[0].c), w, false); return ctx.getImage(); }
  const gap = 2.5 / L;
  let f = 0;
  for (const x of cats) {
    const len = x.p / sum;
    if (len > gap * 1.5) sector(ctx, c, r, w, f + gap / 2, f + len - gap / 2, 3.5, new Color(x.c));
    f += len;
  }
  return ctx.getImage();
}
// полоска периода с отметкой темпа
function barImage(p, pace, w, h) {
  const ctx = canvas(w, h + 6), y = 3, col = color(p);
  const rr = (x, ww, c) => { const pth = new Path(); pth.addRoundedRect(new Rect(x, y, ww, h), h / 2, h / 2); ctx.addPath(pth); ctx.setFillColor(c); ctx.fillPath(); };
  rr(0, w, new Color(TRACK, 0.22));
  if (p > 0) rr(0, Math.max(h, Math.min(p, 1) * w), new Color(col));
  if (pace != null) { ctx.setFillColor(new Color(TRACK, 0.95)); ctx.fillRect(new Rect(Math.max(0, Math.min(w - 2, pace * w - 1)), 0, 2, h + 6)); }
  return ctx.getImage();
}

// ---------- текст и блоки ----------
function text(stack, s, size, col, weight, mono) {
  const t = stack.addText(s);
  t.font = mono ? (weight === 'bold' ? Font.boldMonospacedSystemFont(size) : Font.regularMonospacedSystemFont(size))
    : weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semibold' ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = col || FG; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  return t;
}
function row(parent) { const s = parent.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; }
function centered(parent) { const s = row(parent); s.addSpacer(); const inner = s.addStack(); s.addSpacer(); return inner; }
function col(parent, w, right) { const s = parent.addStack(); s.size = new Size(w, 0); s.layoutHorizontally(); if (right) s.addSpacer(); return s; }
function header(w, left, right, rightStrong) {
  const h = row(w);
  text(h, left, 12, MUT, 'semibold');
  h.addSpacer();
  if (right) text(h, right, rightStrong ? 12 : 11, rightStrong ? FG : MUT, rightStrong ? 'bold' : null);
}
function ringBox(parent, p, size, w) {
  const box = parent.addStack();
  box.size = new Size(size, size);
  box.backgroundImage = ringImage(p, size, w);
  box.centerAlignContent();
  box.addSpacer();
  text(box, Math.round(p * 100) + '%', size * 0.21, p > 1 ? new Color(RED) : FG, 'bold');
  box.addSpacer();
}
function donutBox(parent, exp, size, w) {
  const box = parent.addStack();
  box.size = new Size(size, size);
  box.backgroundImage = donutImage(exp.cats || [], size, w);
  box.layoutVertically();
  box.addSpacer();
  text(centered(box), short(exp.total), size * 0.15, FG, 'bold');
  text(centered(box), 'сум', size * 0.085, MUT);
  box.addSpacer();
}
function barBlock(w, L, width) {
  const r = row(w);
  text(r, L.label, 11, MUT);
  r.addSpacer();
  text(r, Math.round(L.pp * 100) + '%', 11, L.pp > 1 ? new Color(RED) : FG, 'bold');
  w.addSpacer(2);
  const img = w.addImage(barImage(L.pp, L.pace, width, 7));
  img.imageSize = new Size(width, 13);
}
function stale(w, d) {
  if (d.live && !d.old) return;
  w.addSpacer(2);
  text(centered(w), d.old ? 'откройте приложение для свежих данных' : 'нет связи · данные на ' + hm(d.t), 9, MUT);
}

// ---------- расчёт с учётом оплат Apple Pay «в пути» ----------
function limitNow(d) {
  const L = d.lim; if (!L) return null;
  const T = ymd(new Date()), items = (d.pend && d.pend.items) || [];
  const pendToday = items.filter(x => ymd(new Date(x.t)) === T).reduce((a, x) => a + x.a, 0);
  const pendAll = items.reduce((a, x) => a + x.a, 0);
  let dayLim = L.dayLim, daySpent = L.daySpent + pendToday, carry = L.carry;
  if (d.date !== T) {
    if (days(d.date, T) === 1 && L.tom) { dayLim = L.tom.lim; carry = L.tom.carry; daySpent = pendToday; }
    else d.old = true;
  }
  const spent = L.spent + pendAll, idx = Math.min(L.N, Math.max(1, days(L.s, T) + 1));
  return {
    dp: dayLim > 0 ? daySpent / dayLim : (daySpent > 0 ? 2 : 0), dayLim, daySpent,
    left: dayLim - daySpent, withCarry: carry + dayLim - daySpent,
    pp: spent / L.L, spent, L: L.L, pace: idx / L.N, daysLeft: Math.max(0, days(T, L.e)),
    label: 'Период', per: day(L.s) + '–' + day(L.e), last7: L.last7 || [], pend: pendAll
  };
}

// ---------- виджеты ----------
function limitSmall(w, d) {
  const L = limitNow(d), now = new Date();
  header(w, 'Сегодня', WD[now.getDay()] + ', ' + day(ymd(now)));
  w.addSpacer(2);
  ringBox(centered(w), L.dp, 74, 10);
  w.addSpacer(2);
  const a = centered(w); text(a, num(L.daySpent), 11, FG, 'semibold'); text(a, ' из ' + num(L.dayLim), 11, MUT);
  w.addSpacer();
  barBlock(w, L, 142);
  stale(w, d);
}
function limitMedium(w, d) {
  const L = limitNow(d);
  const top = row(w); top.topAlignContent();
  const left = top.addStack(); left.layoutVertically(); left.size = new Size(104, 0);
  text(left, 'Сегодня', 12, MUT, 'semibold');
  left.addSpacer(2);
  ringBox(centered(left), L.dp, 84, 11);
  left.addSpacer(2);
  const a = centered(left); text(a, num(L.daySpent), 11, FG, 'semibold'); text(a, ' из ' + num(L.dayLim), 11, MUT);
  top.addSpacer(14);
  const RW = 216, right = top.addStack(); right.layoutVertically(); right.spacing = 3; right.size = new Size(RW, 0);
  right.addSpacer(14);
  const kv = (k, v, c) => { const r = row(right); r.size = new Size(RW, 0); text(r, k, 12.5, MUT); r.addSpacer(); text(r, v, 12.5, c || FG, 'semibold', true); };
  kv('Сегодня ещё можно', L.left >= 0 ? num(L.left) : '−' + num(-L.left), L.left < 0 ? new Color(RED) : FG);
  kv('С остатками', (L.withCarry < 0 ? '−' : '') + num(Math.abs(L.withCarry)), new Color(L.withCarry < 0 ? RED : '#12935a'));
  kv('До конца периода', L.daysLeft + ' дн.');
  text(right, 'Последние 7 дней', 12.5, MUT);
  const dots = row(right); dots.spacing = 5;
  for (const x of L.last7) {
    const s = dots.addStack(); s.size = new Size(13, 13); s.cornerRadius = 6.5;
    s.backgroundColor = x === 'g' ? new Color(GREEN) : x === 'r' ? new Color(RED) : new Color(TRACK, 0.3);
  }
  w.addSpacer();
  L.label = 'Период ' + L.per + ' · ' + num(L.spent) + ' из ' + num(L.L);
  barBlock(w, L, 336);
  stale(w, d);
}
function expSmall(w, d) {
  const E = d.exp;
  header(w, 'Расходы', E.m);
  w.addSpacer(4);
  donutBox(centered(w), E, 96, 15);
  w.addSpacer(4);
  if (E.prev) { const pc = Math.round((E.total - E.prev) / E.prev * 100); text(centered(w), (pc > 0 ? '↑ ' : '↓ ') + Math.abs(pc) + ' % к ' + E.prevLabel, 11, MUT); }
  stale(w, d);
}
function expMedium(w, d) {
  const E = d.exp, NAME = 112, SUM = 62, PCT = 34;
  header(w, 'Расходы · ' + E.m, num(E.total) + ' сум', true);
  w.addSpacer(4);
  const r = row(w);
  donutBox(r, E, 100, 16);
  r.addSpacer(14);
  const lg = r.addStack(); lg.layoutVertically(); lg.spacing = 3;
  const hd = row(lg); col(hd, 14); col(hd, NAME); text(col(hd, SUM, true), 'сум', 10, MUT); text(col(hd, PCT, true), '%', 10, MUT);
  for (const x of (E.cats || []).slice(0, 6)) {
    const l = row(lg);
    const dt = l.addStack(); dt.size = new Size(8, 8); dt.cornerRadius = 2.5; dt.backgroundColor = new Color(x.c);
    l.addSpacer(6);
    text(col(l, NAME), x.n, 12, FG);
    text(col(l, SUM, true), num(x.s), 11, MUT, null, true);
    text(col(l, PCT, true), x.p + '%', 12, FG, 'bold', true);
  }
  w.addSpacer();
  if (E.prev) {
    const pc = Math.round((E.total - E.prev) / E.prev * 100), f = row(w);
    text(f, 'К ' + E.prevLabel + ': ' + num(E.prev), 11, MUT);
    f.addSpacer();
    text(f, (pc > 0 ? '↑ ' : '↓ ') + Math.abs(pc) + ' %', 11, new Color(pc > 0 ? RED : '#12935a'), 'bold');
  }
  if (d.pend && d.pend.n) text(w, '+ ' + d.pend.n + ' опл. Apple Pay ещё не разнесены', 9, MUT);
  stale(w, d);
}

// ---------- сборка ----------
const d = await load();
const fam = config.widgetFamily || 'medium';
const param = String(args.widgetParameter || '').trim().toLowerCase();
const w = new ListWidget();
w.backgroundColor = BG;
w.setPadding(12, 14, 12, 14);
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

if (fam.startsWith('accessory')) {
  text(w, 'Мой бюджет: добавьте виджет на экран «Домой»', 11, Color.white());
} else if (!d) {
  text(w, 'Мой бюджет', 13, FG, 'bold');
  w.addSpacer(4);
  const t = w.addText('Откройте приложение «Мой бюджет» с интернетом и скопируйте скрипт заново: «Настройки» → «Виджет».');
  t.font = Font.systemFont(11); t.textColor = MUT;
} else {
  const wantExp = param.startsWith('рас') || param.startsWith('кат') || !d.lim;
  if (wantExp) fam === 'small' ? expSmall(w, d) : expMedium(w, d);
  else fam === 'small' ? limitSmall(w, d) : limitMedium(w, d);
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
