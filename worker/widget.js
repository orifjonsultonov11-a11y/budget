// «Мой бюджет» — виджет для приложения Scriptable (iOS).
// Скрипт копируется из приложения: «Настройки» → «Виджет» → «Скопировать скрипт виджета».
// Адрес сервера и ключ подставляются туда автоматически.
//
// Параметр виджета (долгое нажатие → «Изменить виджет» → Parameter):
//   пусто      — маленький: кольцо лимита; средний: лимит и категории
//   лимит      — только кольцо лимита
//   категории  — только круговая диаграмма категорий

const SERVER = '__URL__';
const KEY = '__KEY__';

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), 'moy-budget-widget.json');

const BG = Color.dynamic(new Color('#ffffff'), new Color('#1c1c1e'));
const FG = Color.dynamic(new Color('#111111'), new Color('#f2f2f7'));
const MUT = Color.dynamic(new Color('#8a8a8e'), new Color('#8e8e93'));
const GREEN = '#22c55e', YELLOW = '#ffb800', RED = '#ff3b30', RED2 = '#d70015';
const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

async function load() {
  try {
    const r = new Request(SERVER + '/summary');
    r.headers = { 'X-Key': KEY };
    r.timeoutInterval = 10;
    const j = await r.loadJSON();
    if (r.response && r.response.statusCode === 200 && j && j.v) {
      fm.writeString(CACHE, JSON.stringify(j));
      j.live = true;
      return j;
    }
  } catch (e) {}
  if (fm.fileExists(CACHE)) return JSON.parse(fm.readString(CACHE));
  return null;
}

// ---------- форматирование ----------
function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function short(n) {
  n = Math.round(n);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' млн';
  if (Math.abs(n) >= 1e3) return Math.round(n / 1e3) + ' тыс.';
  return String(n);
}
function day(s) { const [y, m, d] = s.split('-').map(Number); return d + ' ' + MON[m - 1]; }
function hm(t) { const d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

// ---------- рисование ----------
function pt(c, r, f) { const a = -Math.PI / 2 + f * 2 * Math.PI; return new Point(c + r * Math.cos(a), c + r * Math.sin(a)); }
function dot(ctx, p, rad, color) { ctx.setFillColor(color); ctx.fillEllipse(new Rect(p.x - rad, p.y - rad, rad * 2, rad * 2)); }
function arc(ctx, c, r, f0, f1, color, w, caps) {
  if (f1 <= f0) return;
  const n = Math.max(2, Math.ceil((f1 - f0) * 240));
  const path = new Path();
  path.move(pt(c, r, f0));
  for (let i = 1; i <= n; i++) path.addLine(pt(c, r, f0 + (f1 - f0) * i / n));
  ctx.addPath(path);
  ctx.setStrokeColor(color);
  ctx.setLineWidth(w);
  ctx.strokePath();
  if (caps) { dot(ctx, pt(c, r, f0), w / 2, color); dot(ctx, pt(c, r, f1), w / 2, color); }
}
function canvas(size) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  return ctx;
}
function ringColor(p) { return p > 1 ? RED : p >= 0.8 ? YELLOW : GREEN; }
// кольцо как в Apple Health: больше 100 % — второй круг с тенью на конце
function ringImage(p, size, w, mono) {
  const ctx = canvas(size), c = size / 2, r = (size - w) / 2;
  const base = mono ? '#ffffff' : ringColor(p);
  arc(ctx, c, r, 0, 1, new Color(base, mono ? 0.3 : 0.18), w, false);
  if (p > 0) arc(ctx, c, r, 0, Math.min(p, 1), new Color(base), w, true);
  if (p > 1) {
    const f = Math.min(p - 1, 0.995);
    for (let k = 3; k >= 1; k--) dot(ctx, pt(c, r, f + 0.012), w / 2 + k, new Color('#000000', 0.1));
    arc(ctx, c, r, 0, f, new Color(mono ? '#ffffff' : RED2), w, true);
  }
  return ctx.getImage();
}
// сегмент кольца («долька») со скруглёнными углами: дуги + квадратичные кривые в углах
function sector(ctx, c, r, w, f0, f1, rc, color) {
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
  ctx.addPath(path);
  ctx.setFillColor(color);
  ctx.fillPath();
}
function donutImage(cats, size, w) {
  const ctx = canvas(size), c = size / 2, r = (size - w) / 2, L = 2 * Math.PI * r;
  const sum = cats.reduce((a, x) => a + x.p, 0) || 1;
  if (!cats.length) { arc(ctx, c, r, 0, 1, new Color('#b5b4ad', 0.3), w, false); return ctx.getImage(); }
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

// ---------- блоки ----------
function text(stack, s, size, color, weight) {
  const t = stack.addText(s);
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semibold' ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || FG;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}
function centered(parent) { const s = parent.addStack(); s.layoutHorizontally(); s.addSpacer(); const inner = s.addStack(); s.addSpacer(); return inner; }
function ringBlock(parent, d, size, w) {
  const p = d.lim ? (d.spent + (d.pend ? d.pend.sum : 0)) / d.lim : 0;
  const box = parent.addStack();
  box.size = new Size(size, size);
  box.backgroundImage = ringImage(p, size, w, false);
  box.centerAlignContent();
  box.layoutHorizontally();
  box.addSpacer();
  text(box, Math.round(p * 100) + '%', size * 0.2, p > 1 ? new Color(RED) : FG, 'bold');
  box.addSpacer();
  return p;
}
function donutBlock(parent, d, size, w, withTotal) {
  const box = parent.addStack();
  box.size = new Size(size, size);
  box.backgroundImage = donutImage(d.cats || [], size, w);
  box.layoutVertically();
  box.centerAlignContent();
  if (withTotal) {
    box.addSpacer();
    const a = centered(box); text(a, short(d.total), size * 0.15, FG, 'bold');
    const b = centered(box); text(b, 'сум', size * 0.085, MUT);
    box.addSpacer();
  }
}
function legend(parent, cats, n, size, nameW) {
  const col = parent.addStack();
  col.layoutVertically();
  col.spacing = 3;
  for (const x of cats.slice(0, n)) {
    const row = col.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    const sq = row.addStack();
    sq.size = new Size(8, 8);
    sq.cornerRadius = 2.5;
    sq.backgroundColor = new Color(x.c);
    row.addSpacer(5);
    const nm = row.addStack();
    nm.size = new Size(nameW, 0);
    text(nm, x.n, size, FG);
    nm.addSpacer();
    text(row, x.p + '%', size, FG, 'semibold');
  }
}
function header(w, left, right) {
  const h = w.addStack();
  h.layoutHorizontally();
  text(h, left, 12, MUT, 'semibold');
  h.addSpacer();
  if (right) text(h, right, 11, MUT);
}
function amounts(parent, d, size, twoLines) {
  const spent = d.spent + (d.pend ? d.pend.sum : 0);
  if (twoLines) {
    const a = centered(parent); text(a, num(spent), size + 1, FG, 'bold');
    const b = centered(parent); text(b, 'из ' + num(d.lim), size, MUT);
  } else {
    const a = centered(parent);
    text(a, num(spent), size, FG, 'semibold');
    text(a, ' из ' + num(d.lim), size, MUT);
  }
  if (d.pend && d.pend.n) { const c = centered(parent); text(c, '≈ вкл. Apple Pay +' + num(d.pend.sum), size - 2, MUT); }
}
function footer(w, d) {
  if (d.live) return;
  w.addSpacer(2);
  const f = centered(w); text(f, 'нет связи · данные на ' + hm(d.t), 9, MUT);
}

// ---------- виджеты ----------
function smallLimit(w, d) {
  header(w, 'Лимит', d.per ? day(d.per.s) + '–' + day(d.per.e) : '');
  w.addSpacer(4);
  ringBlock(centered(w), d, 88, 12);
  w.addSpacer(4);
  amounts(w, d, 11, false);
  footer(w, d);
}
function smallCats(w, d) {
  header(w, 'Категории', d.per ? day(d.per.s) + '–' + day(d.per.e) : '');
  w.addSpacer(6);
  donutBlock(centered(w), d, 100, 16, true);
  footer(w, d);
}
function mediumCats(w, d) {
  header(w, 'Расходы по категориям', d.per ? day(d.per.s) + ' – ' + day(d.per.e) : '');
  w.addSpacer(6);
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  donutBlock(row, d, 104, 17, true);
  row.addSpacer(14);
  legend(row, d.cats || [], 6, 12.5, 120);
  footer(w, d);
}
function mediumCombo(w, d) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const left = row.addStack();
  left.layoutVertically();
  ringBlock(centered(left), d, 96, 13);
  left.addSpacer(4);
  amounts(left, d, 11, true);
  row.addSpacer(12);
  const line = row.addStack();
  line.size = new Size(1, 120);
  line.backgroundColor = Color.dynamic(new Color('#eceef0'), new Color('#2c2c2e'));
  row.addSpacer(12);
  donutBlock(row, d, 74, 12, false);
  row.addSpacer(10);
  legend(row, d.cats || [], 4, 12, 64);
  footer(w, d);
}
function lockCircular(w, d) {
  const p = d.lim ? (d.spent + (d.pend ? d.pend.sum : 0)) / d.lim : 0;
  const box = w.addStack();
  box.size = new Size(60, 60);
  box.backgroundImage = ringImage(p, 60, 6, true);
  box.centerAlignContent();
  box.addSpacer();
  text(box, Math.round(p * 100) + '%', 13, Color.white(), 'bold');
  box.addSpacer();
}
function lockRect(w, d) {
  const p = d.lim ? (d.spent + (d.pend ? d.pend.sum : 0)) / d.lim : 0;
  text(w, 'Лимит · ' + Math.round(p * 100) + '%', 13, Color.white(), 'bold');
  text(w, short(d.spent + (d.pend ? d.pend.sum : 0)).replace(' млн', '') + ' из ' + short(d.lim) + ' сум', 12, Color.white());
  if (d.today) { const left = d.today.avail - d.today.spent; text(w, left >= 0 ? 'сегодня можно ' + short(left) : 'сегодня перерасход ' + short(-left), 12, new Color('#ffffff', 0.75)); }
}

// ---------- сборка ----------
const d = await load();
const fam = config.widgetFamily || 'medium';
const param = String(args.widgetParameter || '').trim().toLowerCase();
const w = new ListWidget();
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

if (!d) {
  w.backgroundColor = BG;
  text(w, 'Мой бюджет', 13, FG, 'bold');
  w.addSpacer(4);
  const t = w.addText('Откройте приложение «Мой бюджет» с интернетом — появятся данные. Проверьте, что Apple Pay подключён.');
  t.font = Font.systemFont(11);
  t.textColor = MUT;
} else if (fam === 'accessoryCircular') {
  if (d.lim) lockCircular(w, d); else text(w, '—', 14, Color.white(), 'bold');
} else if (fam === 'accessoryRectangular' || fam === 'accessoryInline') {
  if (d.lim) lockRect(w, d); else text(w, 'Расходы ' + short(d.total), 13, Color.white(), 'bold');
} else {
  w.backgroundColor = BG;
  w.setPadding(12, 14, 12, 14);
  const wantCats = param.startsWith('кат') || !d.lim;
  const wantLimit = param.startsWith('лим');
  if (fam === 'small') wantCats ? smallCats(w, d) : smallLimit(w, d);
  else if (wantCats) mediumCats(w, d);
  else if (wantLimit) { w.setPadding(12, 14, 12, 14); smallLimit(w, d); }
  else mediumCombo(w, d);
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
