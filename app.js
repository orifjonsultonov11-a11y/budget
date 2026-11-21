/* Мой бюджет — учёт доходов/расходов + дневной лимит. Данные хранятся только на этом устройстве. */
(function(){
'use strict';
var APP_VERSION=6; /* = version in version.json and CACHE in sw.js */
var app=document.getElementById('app'),ov=document.getElementById('ov'),tipEl=document.getElementById('tip'),toastEl=document.getElementById('toast');

/* ================= utils ================= */
function pad(n){return String(n).padStart(2,'0')}
function ds(y,m,d){return y+'-'+pad(m)+'-'+pad(d)}
function P(s){var a=s.split('-').map(Number);return{y:a[0],m:a[1],d:a[2]}}
function U(s){var p=P(s);return Date.UTC(p.y,p.m-1,p.d)}
function fromU(t){var D=new Date(t);return ds(D.getUTCFullYear(),D.getUTCMonth()+1,D.getUTCDate())}
function addDays(s,n){return fromU(U(s)+n*864e5)}
function diff(a,b){return Math.round((U(b)-U(a))/864e5)}
function today(){var D=new Date();return ds(D.getFullYear(),D.getMonth()+1,D.getDate())}
function localDay(t){var D=new Date(t);return ds(D.getFullYear(),D.getMonth()+1,D.getDate())}
function dim(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate()}
function isDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')}
function wdi(s){return (new Date(U(s)).getUTCDay()+6)%7}
function weekStart(s){return addDays(s,-wdi(s))}
function mkOf(s){return s.slice(0,7)}
function addMonths(mk,n){var a=mk.split('-').map(Number),y=a[0],m=a[1]+n;while(m>12){m-=12;y++}while(m<1){m+=12;y--}return y+'-'+pad(m)}
function mRange(mk){var a=mk.split('-').map(Number);return{from:mk+'-01',to:ds(a[0],a[1],dim(a[0],a[1]))}}
var MON=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
var MONS=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
var MONG=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
var WD=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
function mTitle(mk){var a=mk.split('-').map(Number);return MON[a[1]-1]+' '+a[0]}
function shortDate(s){var p=P(s);return p.d+' '+MONS[p.m-1]}
function longDate(s){var p=P(s);return ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'][wdi(s)]+', '+p.d+' '+MONG[p.m-1]}
function range(p){return shortDate(p.start)+' – '+shortDate(p.end)}
var nf=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
function fmt(n){n=Math.round(n);return (n<0?'−':'')+nf.format(Math.abs(n))}
function fmtS(n){return (Math.round(n)>0?'+':'')+fmt(n)}
function cls(n){n=Math.round(n);return n<0?'neg':n>0?'pos':''}
function fmtK(n){var a=Math.abs(n),s=n<0?'−':'';if(a<1000)return s+Math.round(a);if(a<1e4)return s+(a/1e3).toFixed(1).replace('.0','').replace('.',',')+'к';if(a<1e6)return s+Math.round(a/1e3)+'к';return s+(a/1e6).toFixed(a<1e7?1:0).replace('.0','').replace('.',',')+'м'}
function digits(v){return String(v==null?'':v).replace(/\D/g,'')}
function hm(t){var D=new Date(t);return pad(D.getHours())+':'+pad(D.getMinutes())}
function newId(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4)}
function plural(n,a,b,c){n=Math.abs(n)%100;var n1=n%10;if(n>10&&n<20)return c;if(n1>1&&n1<5)return b;if(n1===1)return a;return c}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function clone(o){return JSON.parse(JSON.stringify(o))}
function draft(k,def){return UI.d[k]!==undefined?UI.d[k]:def}
function money(k,def){var v=digits(draft(k,def==null?'':String(def)));return v===''?'':nf.format(+v)}
var ICRE=/^\s*((?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|⃣)+)\s*/u;
function splitName(n){n=String(n||'').trim();var m=n.match(ICRE);if(m){var rest=n.slice(m[0].length).trim();return{icon:m[1],label:rest||n}}return{icon:null,label:n}}
function cap(s){return s?s.charAt(0).toUpperCase()+s.slice(1):s}

/* ================= state ================= */
var D=null; /* data */
var UI={tab:'ops',ov:'days',month:mkOf(today()),year:+today().slice(0,4),calSel:null,search:null,
  sp:'month',sAnchor:today(),sType:'exp',sCat:null,
  lv:'today',hist:null,sheet:null,editor:null,catEdit:null,setView:null,catType:'exp',
  d:{},pending:null,pendingKind:null,resetArm:false,loaded:false,focusK:null,lastDay:null,dismiss:{}};
var C={cat:{},byDate:{},top:{}};

function randKey(){var a=new Uint8Array(18),r='';try{crypto.getRandomValues(a)}catch(e){for(var i=0;i<a.length;i++)a[i]=Math.random()*256}for(var j=0;j<a.length;j++)r+='abcdefghijkmnpqrstuvwxyz23456789'.charAt(a[j]%32);return r}
function emptyData(){return{v:2,cats:[],tx:[],limit:null,zero:{},lastBackup:null,importedAt:null}}
function normalize(d){
  d=d||emptyData();
  d.v=2;d.cats=Array.isArray(d.cats)?d.cats:[];d.tx=Array.isArray(d.tx)?d.tx:[];d.zero=d.zero||{};
  if(d.limit&&(!Array.isArray(d.limit.periods)||!d.limit.periods.length))d.limit=null;
  d.inbox=Array.isArray(d.inbox)?d.inbox:[];d.mcat=d.mcat||{};d.apSeen=Array.isArray(d.apSeen)?d.apSeen:[];
  d.ap=d.ap||{url:'',key:''};if(!d.ap.key)d.ap.key=randKey();
  return d;
}
function rebuild(){
  C.cat={};C.byDate={};
  D.cats.forEach(function(c){C.cat[c.id]=c});
  D.tx.forEach(function(t){(C.byDate[t.date]||(C.byDate[t.date]=[])).push(t)});
  Object.keys(C.byDate).forEach(function(k){C.byDate[k].sort(function(a,b){return (b.t||0)-(a.t||0)})});
  /* fixed colour slot per top-level category (by order, active first) */
  C.slot={};
  var vol={};D.tx.forEach(function(t){var k=topId(t.cat);vol[k]=(vol[k]||0)+t.amount});
  ['exp','inc'].forEach(function(type){
    tops(type,true).sort(function(a,b){return (vol[b.id]||0)-(vol[a.id]||0)||a.order-b.order}).forEach(function(c,i){C.slot[c.id]=i});
  });
}
function tops(type,withArch){return D.cats.filter(function(c){return c.type===type&&!c.parent&&(withArch||!c.archived)}).sort(function(a,b){return (a.archived-b.archived)||(a.order-b.order)})}
function subs(pid,withArch){return D.cats.filter(function(c){return c.parent===pid&&(withArch||!c.archived)}).sort(function(a,b){return (a.archived-b.archived)||(a.order-b.order)})}
function topId(id){var c=C.cat[id];return c&&c.parent&&C.cat[c.parent]?c.parent:id}
function catLabel(id){var c=C.cat[id];if(!c)return 'Без категории';var p=c.parent&&C.cat[c.parent];return p?splitName(p.name).label+' · '+c.name:splitName(c.name).label}
function catIcon(id){var t=C.cat[topId(id)]||C.cat[id];if(!t)return '<div class="cic">?</div>';var s=splitName(t.name);return '<div class="cic">'+(s.icon?esc(s.icon):esc(s.label.charAt(0).toUpperCase()))+'</div>'}
function counts(id){var c=C.cat[id];if(!c)return true;if(c.nl)return false;var p=c.parent&&C.cat[c.parent];if(p&&p.nl)return false;return true}
var PAL=['--s1','--s2','--s3','--s4','--s5','--s6','--s7','--s8'];
function colorOf(id){var s=C.slot[id];return s!=null&&s<8?'var('+PAL[s]+')':'var(--other)'}

/* ================= persistence ================= */
var idb=null,saveT=null;
function idbOpen(){return new Promise(function(res){try{var r=indexedDB.open('budget-app',1);r.onupgradeneeded=function(){r.result.createObjectStore('kv')};r.onsuccess=function(){res(r.result)};r.onerror=function(){res(null)};r.onblocked=function(){res(null)}}catch(e){res(null)}})}
function idbGet(k){return new Promise(function(res){try{var q=idb.transaction('kv','readonly').objectStore('kv').get(k);q.onsuccess=function(){res(q.result)};q.onerror=function(){res(undefined)}}catch(e){res(undefined)}})}
function idbPut(k,v){return new Promise(function(res,rej){try{var t=idb.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=function(){res()};t.onerror=function(){rej(t.error)};t.onabort=function(){rej(t.error)}}catch(e){rej(e)}})}
function lsSave(d){try{localStorage.setItem('budget-app-v2',JSON.stringify(d));return true}catch(e){toast('Не удалось сохранить!');return false}}
function persist(){clearTimeout(saveT);saveT=setTimeout(flush,120)}
function flush(){clearTimeout(saveT);saveT=null;if(!D)return;var data=clone(D);if(idb)idbPut('state',data).catch(function(){lsSave(data)});else lsSave(data)}
document.addEventListener('visibilitychange',function(){if(document.hidden&&saveT)flush();else if(!document.hidden)tick()});
window.addEventListener('pagehide',function(){if(saveT)flush()});

/* ================= Apple Pay ================= */
/* Shortcuts «Транзакция» -> Cloudflare Worker queue (worker/worker.js) -> here.
   Known merchant -> saved at once in its last category; new merchant -> D.inbox. */
function normM(s){return String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-яўқғҳ]+/g,'')}
function parseAmt(v){
  if(typeof v==='number')return Math.round(Math.abs(v));
  var s=String(v==null?'':v).replace(/[^\d.,]/g,'');
  s=s.replace(/[.,]\d{1,2}$/,'');
  return +s.replace(/\D/g,'')||0;
}
function merCat(mer){var id=D.mcat[normM(mer)],c=id&&C.cat[id];return c&&!c.archived&&c.type==='exp'?id:null}
function apBase(){return String(D.ap.url||'').trim().replace(/\/+$/,'')}
var apBusy=false,apT=0;
function apSync(force){
  if(!D||!apBase()||!D.ap.key||apBusy||!navigator.onLine)return Promise.resolve();
  if(!force&&Date.now()-apT<30000)return Promise.resolve();
  apBusy=true;apT=Date.now();var base=apBase(),key=D.ap.key;
  return fetch(base+'/list',{headers:{'X-Key':key},cache:'no-store'}).then(function(r){
    if(r.status===401)throw new Error('Неверный ключ');if(!r.ok)throw new Error('Ошибка сервера '+r.status);return r.json();
  }).then(function(j){
    var items=(j&&j.items||[]).sort(function(a,b){return a.t-b.t}),seen={},ids=[],added=0,wait=0;
    D.apSeen.forEach(function(id){seen[id]=1});
    items.forEach(function(it){
      if(!it||!it.id)return;ids.push(it.id);if(seen[it.id])return;seen[it.id]=1;D.apSeen.push(it.id);
      var amt=parseAmt(it.amount),mer=String(it.merchant||'').trim().slice(0,80),t=+it.t||Date.now(),date=localDay(t);if(!(amt>0))return;
      var c=merCat(mer);
      if(mer&&c){D.tx.push({id:'ap'+it.id,type:'exp',date:date,amount:amt,cat:c,note:mer,memo:'',t:t,mer:mer});added++}
      else{D.inbox.push({id:it.id,amount:amt,mer:mer,date:date,t:t});wait++}
    });
    if(D.apSeen.length>500)D.apSeen=D.apSeen.slice(-500);
    D.ap.last=Date.now();D.ap.err=null;rebuild();flush();
    if(added||wait)toast('Apple Pay: '+(added?'добавлено '+added:'')+(added&&wait?', ':'')+(wait?'ждут категорию '+wait:''));
    if(!UI.editor)render();
    if(ids.length)return fetch(base+'/ack',{method:'POST',headers:{'X-Key':key,'Content-Type':'application/json'},body:JSON.stringify({ids:ids})}).catch(function(){});
  }).catch(function(e){D.ap.err=(e&&e.message&&/ключ|сервер/.test(e.message))?e.message:'Нет связи с сервером';if(force&&!UI.editor)render()})
  .then(function(){apBusy=false});
}

/* ================= limit engine ================= */
function mStart(y,m,sd){return ds(y,m,Math.min(sd,dim(y,m)))}
function nextStartAfter(date,sd){var p=P(date);var c=mStart(p.y,p.m,sd);if(c>date)return c;return p.m===12?mStart(p.y+1,1,sd):mStart(p.y,p.m+1,sd)}
function monthPeriodFor(date,sd){var p=P(date);var st=mStart(p.y,p.m,sd);if(st>date)st=p.m===1?mStart(p.y-1,12,sd):mStart(p.y,p.m-1,sd);return{start:st,end:addDays(nextStartAfter(st,sd),-1)}}
function dayLim(L,N,i){return Math.round(L*(i+1)/N)-Math.round(L*i/N)}
function entered(date){return !!(C.byDate[date]&&C.byDate[date].length)||!!D.zero[date]}
function limitSpent(date){var s=0;(C.byDate[date]||[]).forEach(function(t){if(t.type==='exp'&&counts(t.cat))s+=t.amount});return s}
function spentOf(date){return entered(date)?limitSpent(date):null}
function compute(){
  var st=D.limit,carry=+st.initialCarry||0;
  return st.periods.map(function(p,idx){
    var N=diff(p.start,p.end)+1,rows=[],c=carry,tot=0;
    for(var i=0;i<N;i++){var date=addDays(p.start,i),l=dayLim(p.limit,N,i),sp=spentOf(date),before=c;c=c+l-(sp||0);tot+=sp||0;rows.push({date:date,i:i,lim:l,carry:before,spent:sp,rest:c})}
    var r={start:p.start,end:p.end,limit:p.limit,idx:idx,N:N,rows:rows,carryIn:carry,spent:tot,final:c};carry=c;return r;
  });
}
function locate(all,t){for(var i=0;i<all.length;i++)if(all[i].start<=t&&t<=all[i].end)return{cur:all[i]};if(!all.length)return{};if(t>all[all.length-1].end)return{ended:all[all.length-1]};return{upcoming:all[0]}}
function reconcile(){
  var st=D.limit;if(!st||st.mode!=='month')return false;
  var last=st.periods[st.periods.length-1],t=today(),ch=false,g=0;
  while(t>last.end&&g++<120){var s=addDays(last.end,1);last={start:s,end:addDays(nextStartAfter(s,st.startDay||1),-1),limit:last.limit};st.periods.push(last);ch=true}
  if(ch)persist();return ch;
}
/* month mode: fit the current period to startDay right away (neighbours are trimmed) */
function realign(){
  var st=D.limit;if(!st||st.mode!=='month')return null;
  var t=today(),per=monthPeriodFor(t,st.startDay||12),ps=st.periods,ci=ps.length-1;
  for(var i=0;i<ps.length;i++)if(ps[i].start<=t&&t<=ps[i].end){ci=i;break}
  var cur=ps[ci];ps.splice(ci+1);
  while(ci>0&&ps[ci-1].start>=per.start){ps.splice(ci-1,1);ci--}
  if(ci>0)ps[ci-1].end=addDays(per.start,-1);
  cur.start=per.start;cur.end=per.end;return cur;
}
function limitRowFor(date){if(!D.limit)return null;var all=compute();for(var i=0;i<all.length;i++){var p=all[i];if(p.start<=date&&date<=p.end)return p.rows[diff(p.start,date)]}return null}

/* ================= aggregates ================= */
function txIn(from,to,type){return D.tx.filter(function(t){return t.date>=from&&t.date<=to&&(!type||t.type===type)})}
function sumIn(from,to,type){var s=0;D.tx.forEach(function(t){if(t.type===type&&t.date>=from&&t.date<=to)s+=t.amount});return s}
function byTop(list){var m={};list.forEach(function(t){var k=topId(t.cat);m[k]=(m[k]||0)+t.amount});return m}

/* ================= icons ================= */
var I={
  ops:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
  stats:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/></svg>',
  limit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none"/></svg>',
  set:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  l:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  r:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l-6 6 6 6"/></svg>'
};

/* ================= common bits ================= */
function wrap(h){return '<div class="wrap">'+h+'</div>'}
function seg(act,val,label,cur,extra){return '<button data-act="'+act+'" data-val="'+val+'"'+(extra||'')+' class="'+(cur===val?'on':'')+'">'+label+'</button>'}
function sb(txt,c){return '<b class="'+(c||'')+(String(txt).length>9?' long':'')+'">'+txt+'</b>'}
function kv(label,value,c,extra){return '<div class="kv'+(extra?' '+extra:'')+'"><span>'+label+'</span><b class="'+(c||'')+'">'+value+'</b></div>'}
function tabbar(){
  function b(t,icon,label){return '<button data-act="tab" data-val="'+t+'" class="'+(UI.tab===t?'on':'')+'">'+icon+label+'</button>'}
  return '<nav class="tabbar">'+b('ops',I.ops,'Операции'+(D&&D.inbox&&D.inbox.length?'<i class="dot"></i>':''))+b('stats',I.stats,'График')+b('limit',I.limit,'Лимит')+b('settings',I.set,'Настройки'+(UI.upd?'<i class="dot"></i>':''))+'</nav>';
}
function txRow(t,opts){
  var title=t.note||catLabel(t.cat),sub=t.note?catLabel(t.cat):(t.memo||'');
  var nl=t.type==='exp'&&!counts(t.cat)&&opts&&opts.markNl;
  return '<div class="tx'+(nl?' nl':'')+'" data-act="edit-tx" data-id="'+t.id+'">'+catIcon(t.cat)+
    '<div class="tmid"><b>'+esc(title)+'</b>'+(sub||nl?'<span>'+esc(sub)+(nl?(sub?' · ':'')+'не в лимите':'')+'</span>':'')+'</div>'+
    '<div class="tamt '+(t.type==='inc'?'pos':'')+'">'+(t.type==='inc'?'+':'')+fmt(t.amount)+'</div></div>';
}
function dayGroup(date,list){
  var inc=0,exp=0;list.forEach(function(t){if(t.type==='inc')inc+=t.amount;else exp+=t.amount});
  var p=P(date);
  return '<div class="dgroup"><div class="dhead"><div class="dnum">'+p.d+'</div><div class="dwd"><span class="wdb">'+WD[wdi(date)]+'</span><br>'+MON[p.m-1].toLowerCase()+' '+p.y+'</div><div class="dsum">'+
    (inc?'<span class="pos">+'+fmt(inc)+'</span>':'')+(exp?'<span>−'+fmt(exp)+'</span>':'')+'</div></div>'+
    list.map(function(t){return txRow(t)}).join('')+'</div>';
}

/* ================= welcome ================= */
function viewWelcome(){
  var h='<h1>Мой бюджет</h1><p class="sub">Доходы, расходы и дневной лимит — в одном приложении. Данные хранятся только на этом телефоне.</p>';
  h+='<div class="card"><h3>Перенести из «Умного счёта»</h3><p class="small">В «Умном счёте» сделай резервную копию и сохрани файл (.mmbak) в «Файлы». Потом выбери его здесь — перенесутся все операции и категории.</p>'+
    '<label class="btn block mt2 filebtn">Выбрать файл .mmbak<input type="file" data-file="mm" hidden></label>'+pendingBox()+'</div>';
  h+='<div class="card"><label class="btn ghost block filebtn">Восстановить из резервной копии<input type="file" accept="application/json,.json,text/plain" data-file="backup" hidden></label>'+
    '<button class="btn ghost block mt" data-act="start-empty">Начать с нуля</button></div>';
  return wrap(h);
}

/* ================= operations ================= */
function viewOps(){
  if(UI.search!==null)return viewSearch();
  var h='<div class="topbar"><h1>Операции</h1><button class="icon solid" data-act="search" aria-label="Поиск">'+I.search+'</button></div>';
  h+='<div class="seg">'+seg('ov','days','По дням',UI.ov)+seg('ov','cal','Календарь',UI.ov)+seg('ov','months','По месяцам',UI.ov)+'</div>';
  if(D.inbox.length)h+=viewInbox();
  if(UI.ov==='months')return wrap(h+viewMonths());
  var r=mRange(UI.month),list=txIn(r.from,r.to),inc=0,exp=0;
  list.forEach(function(t){if(t.type==='inc')inc+=t.amount;else exp+=t.amount});
  h+='<div class="navp"><button class="icon" data-act="month" data-val="-1" aria-label="Назад">'+I.l+'</button><div class="ttl"><b>'+mTitle(UI.month)+'</b></div><button class="icon" data-act="month" data-val="1" aria-label="Вперёд">'+I.r+'</button></div>';
  h+='<div class="sumrow"><div><span>Доход</span><b class="pos">'+fmt(inc)+'</b></div><div><span>Расход</span><b>'+fmt(exp)+'</b></div><div><span>Итого</span><b class="'+cls(inc-exp)+'">'+fmtS(inc-exp)+'</b></div></div>';
  if(UI.ov==='cal')return wrap(h+viewCal(r));
  var dates=Object.keys(C.byDate).filter(function(d){return d>=r.from&&d<=r.to}).sort().reverse();
  if(!dates.length)h+='<div class="empty">В этом месяце операций нет</div>';
  dates.forEach(function(d){h+=dayGroup(d,C.byDate[d])});
  return wrap(h);
}
function viewInbox(){
  var l=D.inbox.slice().sort(function(a,b){return b.t-a.t});
  return '<div class="card inbox"><div class="label">Apple Pay · ждут категорию: '+l.length+'</div>'+l.map(function(x){
    return '<div class="tx" data-act="inbox-open" data-id="'+esc(x.id)+'"><div class="cic">?</div><div class="tmid"><b>'+esc(x.mer||'Без названия')+'</b><span>'+shortDate(x.date)+', '+hm(x.t)+'</span></div><div class="tamt">'+fmt(x.amount)+'</div></div>'}).join('')+'</div>';
}
function viewCal(r){
  var t=today(),first=r.from,last=r.to,off=wdi(first),n=diff(first,last)+1,cells='';
  for(var i=0;i<off;i++)cells+='<div class="cc out"></div>';
  var sel=UI.calSel&&UI.calSel>=first&&UI.calSel<=last?UI.calSel:(t>=first&&t<=last?t:null);
  for(var j=0;j<n;j++){
    var d=addDays(first,j),inc=0,exp=0;(C.byDate[d]||[]).forEach(function(x){if(x.type==='inc')inc+=x.amount;else exp+=x.amount});
    cells+='<button class="cc'+(d===t?' today':'')+(d===sel?' sel':'')+(wdi(d)===6?' wk7':'')+'" data-act="cal-day" data-date="'+d+'"><b>'+(j+1)+'</b>'+(inc?'<i class="pos">+'+fmtK(inc)+'</i>':'')+(exp?'<i class="e">'+fmtK(exp)+'</i>':'')+'</button>';
  }
  var h='<div class="cal"><div class="cwd">'+WD.map(function(w){return '<span>'+w+'</span>'}).join('')+'</div><div class="cgrid">'+cells+'</div></div>';
  if(sel){var list=C.byDate[sel]||[];h+=list.length?dayGroup(sel,list):'<div class="dgroup"><div class="dhead"><div class="dnum">'+P(sel).d+'</div><div class="dwd"><span class="wdb">'+WD[wdi(sel)]+'</span></div></div><div class="empty" style="padding:18px">Операций нет</div></div>'}
  return h;
}
function viewMonths(){
  var y=UI.year,t=today(),h='<div class="navp"><button class="icon" data-act="year" data-val="-1" aria-label="Назад">'+I.l+'</button><div class="ttl"><b>'+y+'</b></div><button class="icon" data-act="year" data-val="1" aria-label="Вперёд">'+I.r+'</button></div>';
  var ti=sumIn(y+'-01-01',y+'-12-31','inc'),te=sumIn(y+'-01-01',y+'-12-31','exp');
  h+='<div class="sumrow"><div><span>Доход</span><b class="pos">'+fmt(ti)+'</b></div><div><span>Расход</span><b>'+fmt(te)+'</b></div><div><span>Итого</span><b class="'+cls(ti-te)+'">'+fmtS(ti-te)+'</b></div></div>';
  var rows='';
  for(var m=12;m>=1;m--){var mk=y+'-'+pad(m);if(mk>mkOf(t))continue;var r=mRange(mk),inc=sumIn(r.from,r.to,'inc'),exp=sumIn(r.from,r.to,'exp');
    rows+='<div class="mrow" data-act="open-month" data-val="'+mk+'"><div class="mn">'+MON[m-1]+'</div><div class="mv"><span class="pos">'+(inc?'+'+fmt(inc):'—')+'</span><span>'+(exp?'−'+fmt(exp):'—')+'</span></div><div class="mv" style="min-width:96px"><span class="'+cls(inc-exp)+'">'+(inc||exp?fmtS(inc-exp):'')+'</span></div></div>'}
  return h+'<div class="card" style="padding:4px 16px">'+(rows||'<div class="empty">Нет данных</div>')+'</div>';
}
function viewSearch(){
  var q=(UI.search||'').trim().toLowerCase(),h='<div class="searchbar"><input data-k="search" placeholder="Поиск по заметкам и категориям" value="'+esc(UI.search)+'" autocomplete="off"><button class="btn sm ghost" data-act="search-close">Отмена</button></div>';
  if(!q)return wrap(h+'<div class="empty">Например: такси, суши, подарки</div>');
  var res=D.tx.filter(function(t){return (t.note||'').toLowerCase().indexOf(q)>=0||(t.memo||'').toLowerCase().indexOf(q)>=0||catLabel(t.cat).toLowerCase().indexOf(q)>=0});
  var se=0,si=0;res.forEach(function(t){if(t.type==='exp')se+=t.amount;else si+=t.amount});
  h+='<div class="sumrow"><div><span>Найдено</span><b>'+res.length+'</b></div><div><span>Расход</span><b>'+fmt(se)+'</b></div><div><span>Доход</span><b class="pos">'+fmt(si)+'</b></div></div>';
  var by={};res.slice(0,400).forEach(function(t){(by[t.date]||(by[t.date]=[])).push(t)});
  Object.keys(by).sort().reverse().forEach(function(d){h+=dayGroup(d,by[d])});
  if(!res.length)h+='<div class="empty">Ничего не найдено</div>';
  return wrap(h);
}

/* ================= editor ================= */
function openEditor(opts){
  var t=opts.id?D.tx.filter(function(x){return x.id===opts.id})[0]:null;
  var ib=opts.inbox?D.inbox.filter(function(x){return x.id===opts.inbox})[0]:null;
  if(t)UI.editor={id:t.id,type:t.type,date:t.date,expr:String(t.amount),cat:t.cat,note:t.note||'',memo:t.memo||'',panel:null,catParent:null,del:false,t:t.t,mer:t.mer};
  else if(ib)UI.editor={id:null,inbox:ib.id,mer:ib.mer,type:'exp',date:ib.date,expr:String(ib.amount),cat:merCat(ib.mer),note:ib.mer||'',memo:'',panel:'cat',catParent:null,del:false,t:ib.t};
  else UI.editor={id:null,type:opts.type||'exp',date:opts.date||today(),expr:'',cat:null,note:'',memo:'',panel:'calc',catParent:null,del:false};
}
function calcEval(expr){
  var toks=String(expr).match(/\d+|[+\-×÷]/g)||[];
  while(toks.length&&/[+\-×÷]/.test(toks[toks.length-1]))toks.pop();
  if(!toks.length)return 0;
  var st=[+toks[0]||0],ops=[];
  for(var i=1;i<toks.length;i+=2){var op=toks[i],n=+toks[i+1];if(op==='×')st[st.length-1]*=n;else if(op==='÷')st[st.length-1]=n?st[st.length-1]/n:st[st.length-1];else{ops.push(op);st.push(n)}}
  var r=st[0];ops.forEach(function(op,i){r=op==='+'?r+st[i+1]:r-st[i+1]});
  return Math.round(r);
}
function exprView(expr){return String(expr).replace(/\d+/g,function(n){return nf.format(+n)}).replace(/([+\-×÷])/g,' $1 ')}
function viewEditor(){
  var E=UI.editor,hasOp=/[+\-×÷]/.test(E.expr),val=calcEval(E.expr);
  var catTxt=E.cat&&C.cat[E.cat]?catLabel(E.cat):null;
  var h='<div class="ed" id="ed"><div class="edin"><div class="edhead"><button class="icon" data-act="ed-close" aria-label="Закрыть">'+I.x+'</button>'+
    '<div class="seg">'+seg('ed-type','exp','Расход',E.type)+seg('ed-type','inc','Доход',E.type)+'</div>'+
    (E.id||E.inbox?'<button class="icon" data-act="ed-del" aria-label="Удалить">'+I.trash+'</button>':'<span style="width:40px"></span>')+'</div>';
  h+='<div class="edbody">';
  h+='<button class="amt'+(E.panel==='calc'?' on':'')+'" data-act="ed-panel" data-val="calc"><span class="expr">'+(hasOp?esc(exprView(E.expr)):'')+'</span>'+
    (E.expr?'<b>'+(hasOp?'= ':'')+fmt(val)+'</b>':'<b class="ph">0</b>')+'<em>сум</em></button>';
  h+='<div class="fbox"><div class="frow'+(E.panel==='cat'?' on':'')+'" data-act="ed-panel" data-val="cat"><span>Категория</span><b class="'+(catTxt?'':'ph')+'">'+(catTxt?esc(catTxt):'Выбрать')+'</b></div>'+
    '<label class="frow"><span>Дата</span><input type="date" data-e="date" value="'+E.date+'"></label>'+
    '<label class="frow"><span>Заметка</span><input data-e="note" value="'+esc(E.note)+'" placeholder="Например, Суши" autocomplete="off" enterkeyhint="done"></label>'+
    '<label class="frow"><span>Описание</span><input data-e="memo" value="'+esc(E.memo)+'" placeholder="Необязательно" autocomplete="off" enterkeyhint="done"></label></div>';
  if(E.inbox)h+='<p class="small" style="margin:10px 4px 0">Оплата Apple Pay'+(E.mer?' в «'+esc(E.mer)+'»':'')+'. Выбранная категория запомнится — следующие оплаты здесь запишутся в неё сами.</p>';
  if(E.del)h+='<div class="confirm"><b>Удалить операцию?</b><div class="btnrow mt"><button class="btn ghost" data-act="ed-del-no">Отмена</button><button class="btn" data-act="ed-del-yes" style="background:var(--neg);color:#fff">Удалить</button></div></div>';
  h+='<div class="edbtns">'+(E.id||E.inbox?'':'<button class="btn ghost" data-act="ed-save" data-val="more">Продолжить</button>')+'<button class="btn" data-act="ed-save">Сохранить</button></div>';
  h+='</div>';
  if(E.panel==='calc'){
    var k=function(v,c,l){return '<button class="'+(c||'')+'" data-act="key" data-val="'+v+'">'+(l||v)+'</button>'};
    h+='<div class="panel"><div class="keys">'+k('7')+k('8')+k('9')+k('÷','op')+k('4')+k('5')+k('6')+k('×','op')+k('1')+k('2')+k('3')+k('−','op')+k('000','fn')+k('0')+k('⌫','fn')+k('+','op')+k('C','fn')+k('=','op')+k('next','go',catTxt?'Готово':'Далее')+'</div></div>';
  }else if(E.panel==='cat'){
    var tiles='',head='';
    if(E.catParent){var pc=C.cat[E.catParent];head='<div class="phead"><button class="icon" data-act="cat-back" aria-label="Назад">'+I.back+'</button>'+esc(pc?pc.name:'')+'</div>';
      tiles+=tile(E.catParent,((splitName(pc?pc.name:'').icon||'')+' Вся категория').trim(),E.cat===E.catParent);
      subs(E.catParent).forEach(function(s){tiles+=tile(s.id,s.name,E.cat===s.id)});
    }else tops(E.type).forEach(function(c){tiles+=tile(c.id,c.name,E.cat===c.id||topId(E.cat)===c.id)});
    h+='<div class="panel">'+head+'<div class="cgrid2">'+tiles+'</div></div>';
  }
  return h+'</div></div>';
  function tile(id,name,on){var s=splitName(name);return '<button class="ctile'+(on?' on':'')+'" data-act="pick-cat" data-id="'+id+'"><span class="ci'+(s.icon?'':' l')+'">'+(s.icon?esc(s.icon):esc(s.label.charAt(0).toUpperCase()))+'</span><span class="cn">'+esc(s.label)+'</span></button>'}
}
function edSave(more){
  var E=UI.editor,a=calcEval(E.expr);
  if(!(a>0)){E.panel='calc';toast('Введи сумму');return false}
  if(!E.cat||!C.cat[E.cat]||C.cat[E.cat].type!==E.type){E.panel='cat';E.catParent=null;toast('Выбери категорию');return false}
  if(!isDate(E.date)){toast('Проверь дату');return false}
  var rec={id:E.id||(E.inbox?'ap'+E.inbox:newId()),type:E.type,date:E.date,amount:a,cat:E.cat,note:E.note.trim(),memo:E.memo.trim(),t:E.t||Date.now()};
  if(!E.id&&!E.inbox&&E.date!==today()){rec.t=U(E.date)+12*36e5}
  if(E.mer){rec.mer=E.mer;if(E.type==='exp'&&normM(E.mer))D.mcat[normM(E.mer)]=E.cat}
  if(E.inbox){var ibid=E.inbox;D.inbox=D.inbox.filter(function(x){return x.id!==ibid})}
  if(E.id){D.tx=D.tx.map(function(x){return x.id===E.id?rec:x})}else D.tx.push(rec);
  rebuild();persist();
  if(more){UI.editor={id:null,type:E.type,date:E.date,expr:'',cat:null,note:'',memo:'',panel:'calc',catParent:null,del:false};toast('Сохранено, вводи следующую')}
  else{UI.editor=null;toast(E.id?'Изменено':'Сохранено')}
  return true;
}

/* ================= limit tab ================= */
function viewLimit(){
  if(!D.limit)return wrap('<h1>Лимит</h1><p class="sub">Задай сумму на период — приложение посчитает лимит на каждый день. Траты берутся из операций.</p>'+viewLimitSetup());
  var all=compute();
  var h='<div class="topbar"><h1>Лимит</h1></div><div class="seg">'+seg('lv','today','Сегодня',UI.lv)+seg('lv','history','История',UI.lv)+'</div><div class="mt2"></div>';
  return wrap(h+(UI.lv==='today'?viewLimitToday(all):viewLimitHistory(all)));
}
function viewLimitSetup(){
  var mode=draft('ob-mode','month'),sign=draft('ob-sign','+'),t=today();
  var per=mode==='month'?'<div class="row"><span>Месяц начинается с числа</span><input class="in xs" data-k="ob-day" inputmode="numeric" value="'+esc(draft('ob-day','12'))+'"></div>'
    :'<div class="row"><span>Начало</span><input class="in" type="date" data-k="ob-start" value="'+draft('ob-start',t)+'"></div><div class="row"><span>Конец</span><input class="in" type="date" data-k="ob-end" value="'+draft('ob-end',addDays(t,29))+'"></div>';
  return '<div class="card"><div class="label">Сумма на период</div>'+
    '<div class="row" style="border:0"><input class="in wide" data-k="ob-limit" data-money inputmode="numeric" placeholder="2 500 000" value="'+money('ob-limit')+'"></div>'+
    '<div class="label mt">Период</div><div class="seg mt">'+seg('dseg','month','Месяц',mode,' data-key="ob-mode"')+seg('dseg','custom','Свои даты',mode,' data-key="ob-mode"')+'</div>'+per+
    '<div class="row"><span>Перенос с прошлого<br><small>необязательно</small></span><div class="carry"><div class="seg mini">'+seg('dseg','+','+',sign,' data-key="ob-sign"')+seg('dseg','-','−',sign,' data-key="ob-sign"')+'</div><input class="in" data-k="ob-carry" data-money inputmode="numeric" placeholder="0" value="'+money('ob-carry')+'"></div></div>'+
    '<button class="btn block mt2" data-act="limit-start">Начать</button></div>';
}
function backupNag(){
  if(!D.tx.length)return '';var lb=D.lastBackup;if(lb&&diff(lb,today())<14)return '';
  return '<div class="card warn"><div class="wt">'+(lb?'Копия не сохранялась '+diff(lb,today())+' '+plural(diff(lb,today()),'день','дня','дней'):'Резервная копия ещё не сохранялась')+'</div><p class="small">Данные хранятся только на телефоне. Сохрани копию в «Файлы» — это 10 секунд.</p><button class="btn sm mt" data-act="export">Сохранить копию</button></div>';
}
function viewLimitToday(all){
  var t=today(),loc=locate(all,t);
  if(loc.ended)return viewNewPeriod(loc.ended);
  if(loc.upcoming)return '<div class="card"><div class="label">Период начнётся '+shortDate(loc.upcoming.start)+'</div></div>';
  var p=loc.cur,i=diff(p.start,t),r=p.rows[i],spentT=r.spent||0,avail=r.lim+r.carry,left=avail-spentT;
  var pct=avail>0?Math.min(100,spentT/avail*100):100,daysLeft=p.N-i,R=r.carry;for(var j=i;j<p.N;j++)R+=p.rows[j].lim;
  var missing=p.rows.filter(function(x){return x.date<t&&x.spent===null});
  var list=(C.byDate[t]||[]).filter(function(x){return x.type==='exp'});
  var inL=list.filter(function(x){return counts(x.cat)}),outL=list.filter(function(x){return !counts(x.cat)});
  var h='<p class="sub" style="margin-top:-4px">'+longDate(t)+'</p>';
  if(p.idx>0&&i<=2&&!UI.dismiss[p.start]){var pr=all[p.idx-1];
    h+='<div class="card"><div class="between"><b>Итог: '+range(pr)+'</b><button class="icon" data-act="dismiss" data-val="'+p.start+'" aria-label="Скрыть">'+I.x+'</button></div>'+kv('Бюджет',fmt(pr.limit))+(pr.carryIn?kv('Перенос с прошлого',fmtS(pr.carryIn),cls(pr.carryIn)):'')+kv('Потрачено',fmt(pr.spent))+kv(pr.final<0?'Недостаток перешёл':'Остаток перешёл',fmtS(pr.final),cls(pr.final),'total')+'</div>'}
  h+='<div class="card"><div class="label">'+(left<0?'Перерасход сегодня':'Можно потратить сегодня')+'</div><div class="big '+(left<0?'neg':'')+'">'+fmt(left)+'<small>сум</small></div>'+
    '<div class="bar'+(left<0?' over':'')+'"><i style="width:'+pct.toFixed(1)+'%"></i></div>'+
    '<div class="stats"><div class="stat"><span>Лимит дня</span><b>'+fmt(r.lim)+'</b></div><div class="stat"><span>'+(r.carry<0?'Недостаток':'Остатки')+'</span>'+sb(fmtS(r.carry),cls(r.carry))+'</div><div class="stat"><span>Потрачено</span><b>'+fmt(spentT)+'</b></div></div>'+
    (daysLeft>1?'<div class="hint">Если делить поровну до '+shortDate(p.end)+': ≈ '+fmt(R/daysLeft)+' в день</div>':'')+'</div>';
  h+='<div class="card"><div class="between"><h3>Расходы сегодня</h3><button class="btn sm" data-act="add" data-date="'+t+'">+ Расход</button></div>';
  if(inL.length)h+='<div class="mt">'+inL.map(function(x){return txRow(x)}).join('')+'</div>';
  else if(!entered(t))h+='<button class="link" data-act="zero" data-date="'+t+'">Сегодня без расходов — внести 0</button>';
  else h+='<p class="small">Расходов в лимите нет.</p>';
  if(outL.length)h+='<p class="small">Не в лимите сегодня: '+fmt(outL.reduce(function(a,x){return a+x.amount},0))+' сум ('+outL.length+')</p>';
  h+='</div>';
  if(missing.length)h+='<div class="card warn"><div class="wt">Не внесено: '+missing.length+' '+plural(missing.length,'день','дня','дней')+'</div><div class="chips">'+missing.slice(-8).reverse().map(function(x){return '<button class="chip" data-act="open-day" data-date="'+x.date+'">'+shortDate(x.date)+'</button>'}).join('')+'</div><p class="small">Пока в дне нет ни одной операции, его лимит считается неиспользованным. Если трат не было — внеси 0.</p></div>';
  h+=backupNag();
  h+='<div class="card"><div class="between"><span class="label">Период · '+range(p)+'</span><span class="label">день '+(i+1)+' из '+p.N+'</span></div><div class="mt">'+kv('Бюджет',fmt(p.limit))+(p.carryIn?kv('Перенос с прошлого',fmtS(p.carryIn),cls(p.carryIn)):'')+kv('Потрачено (в лимите)',fmt(p.spent))+kv('Осталось на период',fmt(p.final),cls(p.final),'total')+'</div></div>';
  return h;
}
function viewNewPeriod(last){
  var t=today(),start=addDays(last.end,1),defEnd=addDays(start,last.N-1);if(defEnd<t)defEnd=t;
  return '<div class="card"><div class="label">Период '+range(last)+' завершён</div><div class="mt">'+kv('Бюджет',fmt(last.limit))+(last.carryIn?kv('Перенос с прошлого',fmtS(last.carryIn),cls(last.carryIn)):'')+kv('Потрачено',fmt(last.spent))+kv('Переходит дальше',fmtS(last.final),cls(last.final),'total')+'</div></div>'+
    '<div class="card"><div class="label">Новый период</div><div class="row"><span>Начало</span><b>'+shortDate(start)+'</b></div><div class="row"><span>Конец</span><input class="in" type="date" data-k="np-end" value="'+draft('np-end',defEnd)+'"></div><div class="row"><span>Сумма</span><input class="in" data-k="np-limit" data-money inputmode="numeric" value="'+money('np-limit',last.limit)+'"></div><button class="btn block mt" data-act="np-start">Начать период</button></div>';
}
function viewLimitHistory(all){
  var t=today(),loc=locate(all,t),curIdx=loc.cur?loc.cur.idx:all.length-1;
  if(UI.hist===null||UI.hist>=all.length)UI.hist=curIdx;
  var p=all[UI.hist],isCur=p.start<=t&&t<=p.end,past=p.end<t,rows=p.rows.filter(function(r){return r.date<=t}).reverse();
  var h='<div class="navp" style="margin-top:0"><button class="icon" data-act="hist" data-val="-1" '+(UI.hist===0?'disabled':'')+' aria-label="Назад">'+I.l+'</button><div class="ttl"><b>'+range(p)+'</b><span>'+(isCur?'текущий период':past?'завершён':'ещё не начался')+'</span></div><button class="icon" data-act="hist" data-val="1" '+(UI.hist>=all.length-1?'disabled':'')+' aria-label="Вперёд">'+I.r+'</button></div>';
  h+='<div class="card">'+kv('Бюджет',fmt(p.limit)+' · '+fmt(p.rows[0].lim)+'/день')+(p.carryIn?kv('Перенос с прошлого',fmtS(p.carryIn),cls(p.carryIn)):'')+kv('Потрачено (в лимите)',fmt(p.spent))+kv(past?(p.final<0?'Итог · недостаток перенесён':'Итог · остаток перенесён'):'Осталось на период',past?fmtS(p.final):fmt(p.final),cls(p.final),'total')+'</div>';
  if(!rows.length)return h+'<div class="card"><p class="small" style="margin:0">Дней пока нет.</p></div>';
  h+='<div class="card" style="padding:12px 10px"><div class="lhint" style="justify-content:space-between;padding:0 8px 8px"><span>День</span><span>Потрачено · остатки</span></div>'+rows.map(function(r){
    var it=(C.byDate[r.date]||[]).filter(function(x){return x.type==='exp'&&counts(x.cat)}),mid;
    if(r.spent===null)mid='<span class="tag">не внесено</span>';else if(!it.length)mid='без расходов';else mid=it.length+' '+plural(it.length,'трата','траты','трат');
    if(r.date===t)mid='<span class="today-dot"></span>'+mid;
    return '<div class="day'+(r.spent===null?' miss':'')+'" data-act="open-day" data-date="'+r.date+'"><div class="d"><b>'+P(r.date).d+'</b><span>'+WD[wdi(r.date)]+'</span></div><div class="mid">'+mid+'</div><div class="r"><b>'+(r.spent===null?'—':fmt(r.spent))+'</b><span class="'+cls(r.rest)+'">'+fmtS(r.rest)+'</span></div></div>';
  }).join('')+'</div>';
  return h;
}
function viewDaySheet(){
  var date=UI.sheet,row=limitRowFor(date);if(!row)return '';
  var list=(C.byDate[date]||[]).filter(function(x){return x.type==='exp'}),inL=list.filter(function(x){return counts(x.cat)}),outL=list.filter(function(x){return !counts(x.cat)}),avail=row.lim+row.carry;
  var h='<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet" role="dialog"><div class="grab"></div><div class="between"><h2>'+longDate(date)+'</h2><button class="icon" data-act="close-sheet" aria-label="Закрыть">'+I.x+'</button></div>'+
    '<div class="stats mt2"><div class="stat"><span>Лимит дня</span><b>'+fmt(row.lim)+'</b></div><div class="stat"><span>'+(row.carry<0?'Недостаток':'Остатки')+'</span>'+sb(fmtS(row.carry),cls(row.carry))+'</div><div class="stat"><span>Доступно</span>'+sb(fmt(avail),avail<0?'neg':'')+'</div></div>';
  h+='<div class="mt">'+inL.map(function(x){return txRow(x)}).join('')+outL.map(function(x){return txRow(x,{markNl:true})}).join('')+'</div>';
  if(!entered(date))h+='<div class="missnote">День не внесён</div>';
  h+='<div class="btnrow mt2"><button class="btn" data-act="add" data-date="'+date+'">+ Расход</button>'+(!entered(date)?'<button class="btn ghost" data-act="zero" data-date="'+date+'">Расходов не было</button>':'')+'</div>';
  h+='<div class="sumline"><span>Потрачено <b>'+fmt(row.spent||0)+'</b></span><span>На конец дня <b class="'+cls(row.rest)+'">'+fmtS(row.rest)+'</b></span></div></div>';
  return h;
}

/* ================= charts (SVG) ================= */
function niceMax(v){if(v<=0)return 1;var e=Math.pow(10,Math.floor(Math.log10(v))),f=v/e,n=f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10;return n*e}
function donut(segs,center,sub){
  var R=78,w=24,Cc=2*Math.PI*R,tot=segs.reduce(function(a,s){return a+s.v},0),acc=0,g='';
  if(!tot)return '';
  var gap=segs.length>1?2.5:0;
  segs.forEach(function(s){var len=s.v/tot*Cc,dash=Math.max(.01,len-gap);
    g+='<circle r="'+R+'" cx="100" cy="100" fill="none" stroke="'+s.color+'" stroke-width="'+w+'" stroke-dasharray="'+dash+' '+(Cc-dash)+'" stroke-dashoffset="'+(-acc)+'" transform="rotate(-90 100 100)" data-tip="'+esc(s.tip)+'" style="cursor:pointer"/>';acc+=len});
  return '<div class="donutw"><svg viewBox="0 0 200 200" role="img" aria-label="Круговая диаграмма">'+g+
    '<text x="100" y="96" text-anchor="middle" style="font-size:20px;font-weight:700;fill:var(--text)">'+esc(center)+'</text><text x="100" y="118" text-anchor="middle" style="font-size:11px;fill:var(--muted)">'+esc(sub)+'</text></svg></div>';
}
function lineChart(o){
  /* o: {labels[], series:[{vals[],color,dash,name}], tips[], hiIdx} */
  var W=340,H=170,L=38,Rp=8,T=10,B=22,n=o.labels.length,max=0;
  o.series.forEach(function(s){s.vals.forEach(function(v){if(v!=null&&v>max)max=v})});
  max=niceMax(max);var x=function(i){return L+(n<=1?0:(W-L-Rp)*i/(n-1))},y=function(v){return T+(H-T-B)*(1-v/max)};
  var g='';for(var k=0;k<=3;k++){var v=max*k/3,yy=y(v);g+='<line x1="'+L+'" x2="'+(W-Rp)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--'+(k?'grid':'axis')+')" stroke-width="1"/><text x="'+(L-6)+'" y="'+(yy+3)+'" text-anchor="end">'+fmtK(v)+'</text>'}
  var step=Math.ceil(n/7);o.labels.forEach(function(l,i){if(i%step===0||i===n-1)g+='<text x="'+x(i)+'" y="'+(H-6)+'" text-anchor="middle">'+esc(l)+'</text>'});
  o.series.forEach(function(s){var d='',started=false;s.vals.forEach(function(v,i){if(v==null){started=false;return}d+=(started?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1);started=true});
    g+='<path d="'+d+'" fill="none" stroke="'+s.color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"'+(s.dash?' stroke-dasharray="4 4"':'')+'/>';
    if(s.marker){var li=-1;s.vals.forEach(function(v,i){if(v!=null)li=i});if(li>=0)g+='<circle cx="'+x(li)+'" cy="'+y(s.vals[li])+'" r="4.5" fill="'+s.color+'" stroke="var(--card)" stroke-width="2"/>'}
    if(s.dots)s.vals.forEach(function(v,i){if(v!=null)g+='<circle cx="'+x(i)+'" cy="'+y(v)+'" r="3" fill="'+s.color+'"/>'});
  });
  var bw=n>1?(W-L-Rp)/(n-1):W-L-Rp;
  o.labels.forEach(function(l,i){g+='<rect x="'+(x(i)-bw/2)+'" y="'+T+'" width="'+bw+'" height="'+(H-T-B)+'" fill="transparent" data-tip="'+esc(o.tips[i])+'"/>'});
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img">'+g+'</svg>';
}
function barChart(o){
  /* o: {labels[], series:[{vals[],color,name}], tips[]} grouped bars */
  var W=340,H=170,L=38,Rp=4,T=10,B=22,n=o.labels.length,ns=o.series.length,max=0;
  o.series.forEach(function(s){s.vals.forEach(function(v){if(v>max)max=v})});max=niceMax(max);
  var y=function(v){return T+(H-T-B)*(1-v/max)},gw=(W-L-Rp)/n,bw=Math.min(18,(gw-6)/ns-2);
  var g='';for(var k=0;k<=3;k++){var v=max*k/3,yy=y(v);g+='<line x1="'+L+'" x2="'+(W-Rp)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--'+(k?'grid':'axis')+')" stroke-width="1"/><text x="'+(L-6)+'" y="'+(yy+3)+'" text-anchor="end">'+fmtK(v)+'</text>'}
  o.labels.forEach(function(l,i){var gx=L+gw*i+gw/2,start=gx-(ns*bw+(ns-1)*2)/2;
    o.series.forEach(function(s,j){var v=s.vals[i]||0;if(v<=0)return;var bx=start+j*(bw+2),by=y(v),bh=y(0)-by,r=Math.min(4,bw/2,bh);
      g+='<path d="M'+bx+' '+y(0)+'V'+(by+r)+'Q'+bx+' '+by+' '+(bx+r)+' '+by+'H'+(bx+bw-r)+'Q'+(bx+bw)+' '+by+' '+(bx+bw)+' '+(by+r)+'V'+y(0)+'Z" fill="'+s.color+'"/>'});
    if(n<=12||i%2===0)g+='<text x="'+gx+'" y="'+(H-6)+'" text-anchor="middle"'+(o.hi===i?' style="fill:var(--text);font-weight:700"':'')+'>'+esc(l)+'</text>';
    g+='<rect x="'+(L+gw*i)+'" y="'+T+'" width="'+gw+'" height="'+(H-T-B)+'" fill="transparent" data-tip="'+esc(o.tips[i])+'"/>';
  });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img">'+g+'</svg>';
}
function legend(items){return '<div class="legend">'+items.map(function(it){return '<span><i class="'+(it.cls||'')+'" style="'+(it.cls==='line'?'border-color:':'background:')+it.color+'"></i>'+esc(it.name)+'</span>'}).join('')+'</div>'}

/* ================= stats tab ================= */
function sRange(){
  var a=UI.sAnchor,p=UI.sp;
  if(p==='week'){var f=weekStart(a);return{from:f,to:addDays(f,6),title:shortDate(f)+' – '+shortDate(addDays(f,6)),prev:{from:addDays(f,-7),to:addDays(f,-1)},prevName:'прошлой неделе'}}
  if(p==='year'){var y=+a.slice(0,4);return{from:y+'-01-01',to:y+'-12-31',title:String(y),prev:{from:(y-1)+'-01-01',to:(y-1)+'-12-31'},prevName:(y-1)+' году'}}
  var mk=mkOf(a),r=mRange(mk),pm=mRange(addMonths(mk,-1));return{from:r.from,to:r.to,title:mTitle(mk),prev:pm,prevName:MON[+addMonths(mk,-1).slice(5)-1].toLowerCase()+'у',mk:mk};
}
function viewStats(){
  if(UI.sCat)return viewStatCat();
  var rg=sRange(),type=UI.sType,t=today();
  var h='<div class="topbar"><h1>График</h1></div><div class="seg">'+seg('sp','week','Неделя',UI.sp)+seg('sp','month','Месяц',UI.sp)+seg('sp','year','Год',UI.sp)+'</div>';
  h+='<div class="navp"><button class="icon" data-act="snav" data-val="-1" aria-label="Назад">'+I.l+'</button><div class="ttl"><b>'+rg.title+'</b></div><button class="icon" data-act="snav" data-val="1" aria-label="Вперёд">'+I.r+'</button></div>';
  h+='<div class="seg" style="margin-bottom:12px">'+seg('stype','exp','Расходы',type)+seg('stype','inc','Доходы',type)+'</div>';
  var list=txIn(rg.from,rg.to,type),total=list.reduce(function(a,x){return a+x.amount},0),prevT=sumIn(rg.prev.from,rg.prev.to,type);
  /* 1. total + donut + legend */
  var dl='';if(prevT>0){var pc=Math.round((total-prevT)/prevT*100);var bad=type==='exp'?pc>0:pc<0;dl='<span class="delta '+(pc===0?'muted':bad?'neg':'pos')+'">'+(pc>0?'▲ +':pc<0?'▼ ':'')+pc+'% к '+rg.prevName+'</span>'}
  h+='<div class="card"><div class="label">'+(type==='exp'?'Расходы':'Доходы')+' · '+rg.title.toLowerCase()+'</div><div class="headline"><b>'+fmt(total)+'</b>'+dl+'</div>';
  if(!list.length)h+='<div class="empty" style="padding:24px 0 8px">Нет операций за этот период</div>';
  else{
    var m=byTop(list),ent=Object.keys(m).map(function(k){return{id:k,v:m[k]}}).sort(function(a,b){return b.v-a.v});
    var segs=[],other=0;ent.forEach(function(e){var c=C.cat[e.id],nm=c?splitName(c.name).label:'Без категории';if(C.slot[e.id]!=null&&C.slot[e.id]<8)segs.push({v:e.v,color:colorOf(e.id),tip:nm+'\n'+fmt(e.v)+' сум · '+Math.round(e.v/total*100)+'%'});else other+=e.v});
    if(other)segs.push({v:other,color:'var(--other)',tip:'Другое\n'+fmt(other)+' сум · '+Math.round(other/total*100)+'%'});
    h+=donut(segs,fmtK(total),list.length+' '+plural(list.length,'операция','операции','операций'));
    h+='<div class="mt">'+ent.map(function(e){var c=C.cat[e.id],s=c?splitName(c.name):{label:'Без категории'};var p=e.v/total*100;
      return '<div class="lrow" data-act="scat" data-val="'+e.id+'"><span class="dot" style="background:'+colorOf(e.id)+'"></span><span class="ln">'+(s.icon?s.icon+' ':'')+esc(s.label)+'</span><span class="lp">'+(p<1?'<1':Math.round(p))+'%</span><span class="lv">'+fmt(e.v)+'</span></div>'}).join('')+'</div>';
  }
  h+='</div>';
  if(type==='exp'&&UI.sp==='month')h+=cardPace(rg);
  if(UI.sp!=='week')h+=cardIncExp(rg);
  if(type==='exp'&&UI.sp==='month')h+=cardTrends(rg);
  if(type==='exp'&&UI.sp==='month')h+=cardHeat(rg);
  if(type==='exp'&&UI.sp!=='week')h+=cardWeekday(rg);
  if(type==='exp'&&UI.sp!=='year'&&D.limit)h+=cardDiscipline(rg);
  if(type==='exp'&&list.length){h+=cardNotes(list);h+=cardBig(list)}
  return wrap(h);
}
function cardPace(rg){
  var t=today(),mk=rg.mk,r=mRange(mk);if(r.from>t)return '';
  var N=diff(r.from,r.to)+1,lastIdx=t<=r.to?diff(r.from,t):N-1,pm=mRange(addMonths(mk,-1)),Np=diff(pm.from,pm.to)+1;
  var cur=[],prev=[],a=0,b=0,labels=[],tips=[];
  for(var i=0;i<N;i++){var d=addDays(r.from,i);if(i<=lastIdx){a+=dayExp(d);cur.push(a)}else cur.push(null);
    if(i<Np){b+=dayExp(addDays(pm.from,i))}prev.push(b);labels.push(String(i+1));
    tips.push((i+1)+' '+MONG[+mk.slice(5)-1]+(i<=lastIdx?'\nСейчас: '+fmt(cur[i]):'')+'\nПрошлый месяц: '+fmt(prev[i]))}
  var nowV=cur[lastIdx]||0,prevV=prev[lastIdx]||0,dlt=nowV-prevV,noPrev=!prev[prev.length-1];
  var txt=noPrev?'Потрачено <b>'+fmt(nowV)+'</b>. В прошлом месяце операций не было — сравнивать не с чем.':t<=r.to?'К '+(lastIdx+1)+'-му числу потрачено <b>'+fmt(nowV)+'</b> — на '+fmt(Math.abs(dlt))+' '+(dlt>0?'больше':'меньше')+', чем к этому дню прошлого месяца.':'Итог месяца: '+fmt(nowV)+', прошлый месяц: '+fmt(prev[N-1]);
  var fc='';if(t<=r.to&&lastIdx>=4){var proj=nowV/(lastIdx+1)*N;fc='<p class="small">Прогноз на весь месяц при таком темпе: <b style="color:var(--text)">≈ '+fmt(proj)+'</b></p>'}
  return '<div class="card"><h3>Темп трат</h3><p class="small" style="margin-top:4px">'+txt+'</p><div class="mt">'+lineChart({labels:labels,series:(noPrev?[]:[{vals:prev,color:'var(--other)',dash:true}]).concat([{vals:cur,color:'var(--exp)',marker:true}]),tips:tips})+'</div>'+
    (noPrev?'':legend([{name:'Этот месяц',color:'var(--exp)',cls:'line'},{name:'Прошлый месяц',color:'var(--other)',cls:'dash'}]))+fc+'</div>';
}
function dayExp(d){var s=0;(C.byDate[d]||[]).forEach(function(t){if(t.type==='exp')s+=t.amount});return s}
function cardIncExp(rg){
  var mks=[],hi=-1;
  if(UI.sp==='year'){var y=rg.from.slice(0,4);for(var m=1;m<=12;m++)mks.push(y+'-'+pad(m))}
  else{for(var k=11;k>=0;k--)mks.push(addMonths(rg.mk,-k));hi=11}
  var inc=[],exp=[],tips=[],labels=[];
  mks.forEach(function(mk){var r=mRange(mk),a=sumIn(r.from,r.to,'inc'),b=sumIn(r.from,r.to,'exp');inc.push(a);exp.push(b);labels.push(MONS[+mk.slice(5)-1]);tips.push(mTitle(mk)+'\nДоход: '+fmt(a)+'\nРасход: '+fmt(b)+'\nИтого: '+fmtS(a-b))});
  var ti,te;if(UI.sp==='year'){ti=inc.reduce(function(a,b){return a+b},0);te=exp.reduce(function(a,b){return a+b},0)}else{ti=inc[11];te=exp[11]}
  var net=ti-te,rate=ti>0?Math.round(net/ti*100):null;
  return '<div class="card"><h3>Доходы и расходы</h3><div class="bigstat"><div><b class="'+cls(net)+'">'+fmtS(net)+'</b><span>итого за '+(UI.sp==='year'?'год':'месяц')+'</span></div>'+(rate!=null?'<div><b>'+rate+'%</b><span>дохода сохранено</span></div>':'')+'</div>'+
    '<div class="mt">'+barChart({labels:labels,series:[{vals:inc,color:'var(--inc)'},{vals:exp,color:'var(--exp)'}],tips:tips,hi:hi})+'</div>'+legend([{name:'Доход',color:'var(--inc)'},{name:'Расход',color:'var(--exp)'}])+'</div>';
}
function cardTrends(rg){
  var mk=rg.mk,hist=[],k=1;
  while(hist.length<3&&k<=24){var r=mRange(addMonths(mk,-k));if(txIn(r.from,r.to,'exp').length>=10)hist.push(r);k++}
  if(!hist.length)return '';
  var cur=byTop(txIn(rg.from,rg.to,'exp')),avg={};
  hist.forEach(function(r){var m=byTop(txIn(r.from,r.to,'exp'));Object.keys(m).forEach(function(id){avg[id]=(avg[id]||0)+m[id]/hist.length})});
  var ids={};Object.keys(cur).concat(Object.keys(avg)).forEach(function(i){ids[i]=1});
  var rows=Object.keys(ids).map(function(id){var c=cur[id]||0,a=avg[id]||0;return{id:id,c:c,a:a,d:c-a}}).filter(function(x){return Math.max(x.c,x.a)>0}).sort(function(a,b){return Math.abs(b.d)-Math.abs(a.d)}).slice(0,6);
  var isCur=rg.to>=today();
  return '<div class="card"><h3>Что растёт, что падает</h3><p class="small" style="margin-top:4px">'+(isCur?'Этот месяц (пока неполный)':'Этот месяц')+' против среднего за '+hist.length+' '+plural(hist.length,'прошлый месяц','прошлых месяца','прошлых месяцев')+', где внесено 10+ расходов: '+hist.map(function(r){return MONS[+r.from.slice(5,7)-1]+' '+r.from.slice(2,4)}).join(', ')+'.</p><div class="mt">'+
    rows.map(function(x){var c=C.cat[x.id],s=c?splitName(c.name):{label:'Без категории'},pct=x.a>0?Math.round(x.d/x.a*100):null;
      return '<div class="trow" data-act="scat" data-val="'+x.id+'"><div class="tn"><b>'+(s.icon?s.icon+' ':'')+esc(s.label)+'</b><span>среднее '+fmt(x.a)+'</span></div><div class="tv">'+fmt(x.c)+'<span class="'+(x.d>0?'neg':x.d<0?'pos':'muted')+'">'+(x.d>0?'▲ ':'▼ ')+(pct==null?'новое':x.a>0&&x.c/x.a>=3?'×'+(x.c/x.a).toFixed(x.c/x.a<10?1:0).replace('.',','):(pct>0?'+':'−')+Math.abs(pct)+'%')+'</span></div></div>'}).join('')+'</div></div>';
}
function cardHeat(rg){
  var t=today(),n=diff(rg.from,rg.to)+1,vals=[],max=0;
  for(var i=0;i<n;i++){var d=addDays(rg.from,i),v=d<=t?dayExp(d):null;vals.push(v);if(v>max)max=v}
  if(!max)return '';
  var steps=[max*.15,max*.35,max*.55,max*.78],lvl=function(v){if(!v)return 0;for(var k=0;k<4;k++)if(v<=steps[k])return k+1;return 5};
  var g=WD.map(function(w){return '<span>'+w+'</span>'}).join(''),off=wdi(rg.from);for(var j=0;j<off;j++)g+='<i class="out"></i>';
  vals.forEach(function(v,i){var d=addDays(rg.from,i),L=v==null?-1:lvl(v);g+='<i style="background:var(--h'+(L<0?0:L)+')'+(L<0?';opacity:.4':'')+'" class="'+(L>=4?'dk':'')+'" data-tip="'+esc(longDate(d)+'\n'+(v==null?'ещё не наступил':v?fmt(v)+' сум':'без расходов'))+'">'+(i+1)+'</i>'});
  return '<div class="card"><h3>Карта трат по дням</h3><p class="small" style="margin-top:4px">Чем темнее день, тем больше потрачено. Нажми на день, чтобы увидеть сумму.</p><div class="hm">'+g+'</div><div class="hscale">меньше <i style="background:var(--h1)"></i><i style="background:var(--h2)"></i><i style="background:var(--h3)"></i><i style="background:var(--h4)"></i><i style="background:var(--h5)"></i> больше</div></div>';
}
function cardWeekday(rg){
  var t=today(),to=rg.to<t?rg.to:t,first=D.tx.reduce(function(a,x){return !a||x.date<a?x.date:a},null),from=first&&first>rg.from?first:rg.from;if(to<from)return '';
  var sum=[0,0,0,0,0,0,0],cnt=[0,0,0,0,0,0,0],n=diff(from,to)+1;
  for(var i=0;i<n;i++){var d=addDays(from,i),w=wdi(d);cnt[w]++;sum[w]+=dayExp(d)}
  var avg=sum.map(function(s,i){return cnt[i]?s/cnt[i]:0});if(!avg.some(function(v){return v>0}))return '';
  var mx=0,mi=0;avg.forEach(function(v,i){if(v>mx){mx=v;mi=i}});
  var names=['понедельник','вторник','среду','четверг','пятницу','субботу','воскресенье'];
  return '<div class="card"><h3>По дням недели</h3><p class="small" style="margin-top:4px">Больше всего в среднем тратишь в <b style="color:var(--text)">'+names[mi]+'</b>: ≈ '+fmt(mx)+' за день.</p><div class="mt">'+
    barChart({labels:WD,series:[{vals:avg,color:'var(--exp)'}],tips:avg.map(function(v,i){return WD[i]+': в среднем '+fmt(v)+' за день ('+cnt[i]+' '+plural(cnt[i],'день','дня','дней')+')'}),hi:mi})+'</div></div>';
}
function cardDiscipline(rg){
  var all=compute(),t=today(),days=[];
  all.forEach(function(p){p.rows.forEach(function(r){if(r.date>=rg.from&&r.date<=rg.to&&r.date<=t)days.push(r)})});
  if(!days.length)return '';
  var ok=0,over=0,na=0;days.forEach(function(r){if(r.spent===null)na++;else if(r.spent<=r.lim)ok++;else over++});
  var flat=[];all.forEach(function(p){p.rows.forEach(function(r){if(r.date<=t)flat.push(r)})});
  var streak=0;for(var i=flat.length-1;i>=0;i--){var r=flat[i];if(r.date===t&&r.spent===null)continue;if(r.spent!==null&&r.spent<=r.lim)streak++;else break}
  return '<div class="card"><h3>Дисциплина лимита</h3><div class="bigstat"><div><b class="pos">'+ok+'</b><span>в лимите</span></div><div><b class="neg">'+over+'</b><span>перерасход</span></div><div><b>'+streak+'</b><span>'+plural(streak,'день','дня','дней')+' подряд</span></div></div>'+
    '<div class="dots">'+days.map(function(r){var c=r.spent===null?'na':r.spent<=r.lim?'ok':'ov';return '<i class="'+c+'" data-tip="'+esc(shortDate(r.date)+'\n'+(r.spent===null?'не внесено':'потрачено '+fmt(r.spent)+' из '+fmt(r.lim)))+'">'+(c==='ok'?'✓':c==='ov'?'!':'')+'</i>'}).join('')+'</div>'+
    '<p class="small">Сравнение с лимитом дня без учёта остатков'+(na?' · серым — не внесённые дни':'')+'.</p></div>';
}
function cardNotes(list){
  var m={};list.forEach(function(t){var k=(t.note||'').trim().toLowerCase();if(!k)return;if(!m[k])m[k]={name:t.note.trim(),s:0,n:0};m[k].s+=t.amount;m[k].n++});
  var rows=Object.keys(m).map(function(k){return m[k]}).sort(function(a,b){return b.s-a.s}).slice(0,8);if(!rows.length)return '';
  var mx=rows[0].s;
  return '<div class="card"><h3>Топ по заметкам</h3><div class="mt">'+rows.map(function(r){return '<div class="trow"><div class="tn"><b>'+esc(r.name)+'</b><div class="hbar"><i style="width:'+(r.s/mx*100).toFixed(1)+'%;background:var(--exp)"></i></div></div><div class="tv">'+fmt(r.s)+'<span class="muted">'+r.n+' '+plural(r.n,'раз','раза','раз')+'</span></div></div>'}).join('')+'</div></div>';
}
function cardBig(list){
  var rows=list.slice().sort(function(a,b){return b.amount-a.amount}).slice(0,5);
  return '<div class="card"><h3>Крупные траты</h3><div class="mt">'+rows.map(function(t){return '<div class="trow" data-act="edit-tx" data-id="'+t.id+'" style="cursor:pointer"><div class="tn"><b>'+esc(t.note||catLabel(t.cat))+'</b><span>'+shortDate(t.date)+' · '+esc(catLabel(t.cat))+'</span></div><div class="tv">'+fmt(t.amount)+'</div></div>'}).join('')+'</div></div>';
}
function viewStatCat(){
  var id=UI.sCat,c=C.cat[id],type=c?c.type:UI.sType,rg=sRange(),s=c?splitName(c.name):{label:'Без категории'};
  var endMk=UI.sp==='year'?(rg.to.slice(0,4)+'-12'):mkOf(rg.to);if(endMk>mkOf(today()))endMk=mkOf(today());
  var mks=[];for(var k=11;k>=0;k--)mks.push(addMonths(endMk,-k));
  var vals=mks.map(function(mk){var r=mRange(mk);return txIn(r.from,r.to,type).filter(function(t){return topId(t.cat)===id}).reduce(function(a,t){return a+t.amount},0)});
  var withData=vals.filter(function(v){return v>0}),avg=withData.length?withData.reduce(function(a,b){return a+b},0)/withData.length:0;
  var h='<div class="topbar" style="justify-content:flex-start"><button class="icon solid" data-act="scat-back" aria-label="Назад">'+I.back+'</button><h1 style="margin-top:4px;font-size:26px">'+(s.icon?s.icon+' ':'')+esc(s.label)+'</h1></div>';
  h+='<div class="card"><h3>По месяцам</h3><p class="small" style="margin-top:4px">В среднем '+fmt(avg)+' в месяц (по месяцам, где были операции)</p><div class="mt">'+
    lineChart({labels:mks.map(function(mk){return MONS[+mk.slice(5)-1]}),series:[{vals:vals,color:colorOf(id),dots:true,marker:true}],tips:mks.map(function(mk,i){return mTitle(mk)+'\n'+fmt(vals[i])+' сум'})})+'</div></div>';
  var list=txIn(rg.from,rg.to,type).filter(function(t){return topId(t.cat)===id}),tot=list.reduce(function(a,t){return a+t.amount},0);
  h+='<div class="navp"><button class="icon" data-act="snav" data-val="-1" aria-label="Назад">'+I.l+'</button><div class="ttl"><b>'+rg.title+'</b><span>'+fmt(tot)+' сум</span></div><button class="icon" data-act="snav" data-val="1" aria-label="Вперёд">'+I.r+'</button></div>';
  var bySub={};list.forEach(function(t){var k=t.cat;bySub[k]=(bySub[k]||0)+t.amount});
  var sk=Object.keys(bySub).sort(function(a,b){return bySub[b]-bySub[a]});
  if(sk.length>1||(sk.length===1&&sk[0]!==id)){
    h+='<div class="card"><h3>Подкатегории</h3><div class="mt">'+sk.map(function(k){var nm=k===id?'Без подкатегории':(C.cat[k]?C.cat[k].name:'—');return '<div class="trow"><div class="tn"><b>'+esc(nm)+'</b><div class="hbar"><i style="width:'+(bySub[k]/tot*100).toFixed(1)+'%;background:'+colorOf(id)+'"></i></div></div><div class="tv">'+fmt(bySub[k])+'<span class="muted">'+Math.round(bySub[k]/tot*100)+'%</span></div></div>'}).join('')+'</div></div>';
  }
  if(!list.length)h+='<div class="empty">Нет операций за этот период</div>';
  var by={};list.forEach(function(t){(by[t.date]||(by[t.date]=[])).push(t)});
  Object.keys(by).sort().reverse().forEach(function(d){h+=dayGroup(d,by[d])});
  return wrap(h);
}

/* ================= settings ================= */
function viewSettings(){
  if(UI.setView==='cats')return viewCats();
  var h='<h1>Настройки</h1><p class="sub">&nbsp;</p>';
  if(UI.upd){var rel=(UI.upd.releases||[]).filter(function(r){return r.v>APP_VERSION});
    h+='<div class="card upd"><h3>Доступно обновление · версия '+UI.upd.version+'</h3><p class="small">Сейчас установлена версия '+APP_VERSION+'.</p>'+
      rel.map(function(r){return '<div class="label mt">Версия '+r.v+(r.date?' · '+shortDate(r.date):'')+'</div><ul class="notes">'+(r.notes||[]).map(function(n){return '<li>'+esc(n)+'</li>'}).join('')+'</ul>'}).join('')+
      '<button class="btn block mt" data-act="do-update"'+(UI.updating?' disabled':'')+'>'+(UI.updating?'Обновляю…':'Обновить')+'</button><p class="small">Данные не пропадут.</p></div>';
  }
  if(D.limit){
    var st=D.limit,all=compute(),loc=locate(all,today()),p=loc.cur||loc.ended||all[all.length-1],sign=draft('set-sign',(+st.initialCarry||0)<0?'-':'+');
    h+='<div class="card"><h3>Лимит</h3><div class="label mt">Текущий период · '+range(p)+'</div>'+
      '<div class="row"><span>Сумма на период</span><input class="in" data-k="set-limit" data-money inputmode="numeric" value="'+money('set-limit',p.limit)+'"></div>'+
      (st.mode==='custom'?'<div class="row"><span>Конец периода</span><input class="in" type="date" data-k="set-end" value="'+draft('set-end',p.end)+'"></div>':'')+
      '<button class="btn block mt" data-act="save-period">Сохранить</button><p class="small">Лимит на день и остатки пересчитаются за весь период.</p>'+
      '<div class="label mt2">Как считать период</div><div class="seg mt">'+seg('lmode','month','Месяц',st.mode)+seg('lmode','custom','Свои даты',st.mode)+'</div>'+
      (st.mode==='month'?'<div class="row"><span>Месяц начинается с числа</span><div class="carry"><input class="in xs" data-k="set-day" inputmode="numeric" value="'+esc(draft('set-day',String(st.startDay||12)))+'"><button class="btn sm ghost" data-act="save-day">OK</button></div></div>':'')+
      '<div class="row"><span>Перенос до первого периода</span><div class="carry"><div class="seg mini">'+seg('dseg','+','+',sign,' data-key="set-sign"')+seg('dseg','-','−',sign,' data-key="set-sign"')+'</div><input class="in" style="width:100px" data-k="set-carry" data-money inputmode="numeric" value="'+money('set-carry',Math.abs(+st.initialCarry||0))+'"><button class="btn sm ghost" data-act="save-carry">OK</button></div></div></div>';
  }
  var ap=D.ap,st2=!apBase()?'Не подключено':ap.err?'<span class="neg">'+esc(ap.err)+'</span>':ap.last?'<span class="pos">Подключено</span> · проверено '+(localDay(ap.last)===today()?'сегодня':shortDate(localDay(ap.last)))+' в '+hm(ap.last):'Ещё не проверено';
  h+='<div class="card"><h3>Apple Pay</h3><p class="small">Оплаты телефоном сами попадают в расходы: команда iPhone отправляет их на твой сервер Cloudflare, приложение забирает при открытии. Знакомый магазин записывается в свою последнюю категорию, новый — ждёт выбора на вкладке «Операции».</p>'+
    '<p class="small">Статус: '+st2+'</p>'+
    '<div class="label mt">Адрес сервера</div><input class="in wide mt" data-k="ap-url" value="'+esc(draft('ap-url',ap.url||''))+'" placeholder="https://budget-pay.имя.workers.dev" autocomplete="off" autocapitalize="off" spellcheck="false">'+
    '<div class="btnrow mt"><button class="btn sm" data-act="ap-save">Сохранить</button>'+(apBase()?'<button class="btn sm ghost" data-act="ap-sync">Проверить</button>':'')+'</div>'+
    '<div class="label mt2">Ключ доступа</div><div class="row" style="border:0"><code class="key">'+esc(ap.key)+'</code></div>'+
    '<div class="btnrow"><button class="btn sm ghost" data-act="ap-copy">Скопировать</button><button class="btn sm ghost'+(UI.apKeyArm?' danger':'')+'" data-act="ap-newkey">'+(UI.apKeyArm?'Точно заменить?':'Новый ключ')+'</button></div>'+
    '<p class="small">Ключ нужен в двух местах: в настройках сервера (секрет KEY) и в команде (заголовок X-Key). Никому его не показывай.</p></div>';
  var ex=tops('exp'),inL=ex.filter(function(c){return !c.nl}).length;
  h+='<div class="card"><h3>Категории</h3><p class="small">Расходов: '+ex.length+', доходов: '+tops('inc').length+'. В дневном лимите учитываются '+inL+' из '+ex.length+' категорий расходов.</p><button class="btn ghost block mt" data-act="open-cats">Категории и лимит →</button></div>';
  h+='<div class="card"><h3>Импорт из «Умного счёта»</h3><p class="small">Выбери свежий файл резервной копии (.mmbak). Операции и категории заменятся данными из файла, настройки лимита останутся.'+(D.importedAt?' Последний импорт: '+shortDate(D.importedAt)+'.':'')+'</p><label class="btn ghost block mt filebtn">Выбрать файл .mmbak<input type="file" data-file="mm" hidden></label>'+(UI.pendingKind==='mm'?pendingBox():'')+'</div>';
  h+='<div class="card"><h3>Резервная копия</h3><p class="small">Данные хранятся только на этом телефоне. Если удалить иконку приложения, они пропадут — сохраняй копию в «Файлы» или iCloud Drive.</p><p class="small">'+(D.lastBackup?'Последняя копия: '+longDate(D.lastBackup):'Копию ещё не сохраняли.')+'</p>'+
    '<button class="btn block mt" data-act="export">Сохранить копию</button><label class="btn ghost block mt filebtn">Восстановить из файла<input type="file" accept="application/json,.json,text/plain" data-file="backup" hidden></label>'+(UI.pendingKind==='backup'?pendingBox():'')+'</div>';
  if(!isStandalone())h+='<div class="card"><h3>Установка на iPhone</h3><p class="small">Открой страницу в Safari → «Поделиться» → «На экран „Домой“». Дальше запускай с иконки — работает без интернета.</p></div>';
  h+='<button class="btn ghost block danger" data-act="reset">'+(UI.resetArm?'Точно удалить всё? Нажми ещё раз':'Удалить все данные')+'</button>';
  h+='<p class="small" style="text-align:center;margin-top:16px">Версия '+APP_VERSION+'</p>';
  return wrap(h);
}
function viewCats(){
  var type=UI.catType,h='<div class="topbar" style="justify-content:flex-start"><button class="icon solid" data-act="cats-back" aria-label="Назад">'+I.back+'</button><h1 style="margin-top:4px;font-size:26px">Категории</h1></div>';
  h+='<div class="seg">'+seg('ctype','exp','Расходы',type)+seg('ctype','inc','Доходы',type)+'</div>';
  if(type==='exp')h+='<p class="small" style="margin:12px 4px">Переключатель справа — учитывать ли категорию в дневном лимите. Например, аренду или крупные покупки можно выключить: они останутся в учёте, но не съедят лимит.</p>';
  else h+='<div class="mt"></div>';
  function row(c,isSub){var s=splitName(c.name),par=isSub&&C.cat[c.parent];var parentOff=par&&par.nl;
    return '<div class="crow'+(isSub?' sub':'')+'" data-act="cat-edit" data-id="'+c.id+'"><div class="cic">'+(s.icon?esc(s.icon):esc(s.label.charAt(0).toUpperCase()))+'</div><div class="cnm">'+esc(s.label)+'</div>'+
      (type==='exp'?'<button class="sw'+(!c.nl&&!parentOff?' on':'')+(parentOff?' dis':'')+'" data-act="cat-limit" data-id="'+c.id+'" aria-label="Учитывать в лимите"></button>':'')+'</div>'}
  h+='<div class="card" style="padding:6px 16px">'+(type==='exp'?'<div class="lhint" style="padding-top:8px">в лимите</div>':'')+tops(type).map(function(c){return row(c)+subs(c.id).map(function(s){return row(s,true)}).join('')}).join('')+'</div>';
  h+='<button class="btn block" data-act="cat-new">+ Новая категория</button>';
  return wrap(h);
}
function viewCatEdit(){
  var e=UI.catEdit,c=e.id?C.cat[e.id]:null,isNew=!c,type=c?c.type:e.type,parent=c?c.parent:e.parent;
  var n=c?D.tx.filter(function(t){return t.cat===c.id}).length:0,kids=c?subs(c.id,true).length:0;
  var h='<div class="sheet-bg" data-act="cat-close"></div><div class="sheet"><div class="grab"></div><div class="between"><h2>'+(isNew?(parent?'Новая подкатегория':'Новая категория'):'Категория')+'</h2><button class="icon" data-act="cat-close" aria-label="Закрыть">'+I.x+'</button></div>';
  if(parent&&isNew)h+='<p class="small">В разделе «'+esc(C.cat[parent]?C.cat[parent].name:'')+'»</p>';
  h+='<div class="label mt2">Название (можно начать с эмодзи)</div><input class="in wide mt" data-k="cname" value="'+esc(draft('cname',c?c.name:''))+'" placeholder="Например, 🍜 Еда" autocomplete="off">';
  h+='<button class="btn block mt" data-act="cat-save">'+(isNew?'Создать':'Сохранить название')+'</button>';
  if(c){
    if(type==='exp')h+='<div class="row mt2"><span>Учитывать в дневном лимите</span><button class="sw'+(c.nl?'':' on')+'" data-act="cat-limit" data-id="'+c.id+'"></button></div>';
    h+='<div class="row"><span>Порядок</span><div class="btnrow"><button class="btn sm ghost" data-act="cat-move" data-val="-1">↑ Выше</button><button class="btn sm ghost" data-act="cat-move" data-val="1">↓ Ниже</button></div></div>';
    if(!c.parent&&!c.archived)h+='<button class="btn ghost block mt" data-act="cat-sub">+ Добавить подкатегорию</button>';
    h+='<button class="btn ghost block mt" data-act="cat-arch">'+(c.archived?'Показать снова':'Скрыть из выбора')+'</button>';
    if(!n&&!kids)h+='<button class="btn ghost block mt danger" data-act="cat-del">'+(e.delArm?'Точно удалить?':'Удалить')+'</button>';
    else h+='<p class="small">'+(n?n+' '+plural(n,'операция','операции','операций')+' в этой категории':'Есть подкатегории')+' — удалить нельзя, можно только скрыть.</p>';
  }
  return h+'</div>';
}

/* ================= import / backup ================= */
function pendingBox(){
  var pd=UI.pending;if(!pd)return '';
  var h='<div class="confirm"><b>'+(UI.pendingKind==='mm'?'Найдено в файле':'Резервная копия')+'</b><p class="small">'+pd.summary+'</p>';
  if(D.tx.length||D.cats.length)h+='<p class="small"><b style="color:var(--warn)">Текущие операции и категории будут заменены.</b>'+(pd.keepsLimit?' Настройки лимита сохранятся.':'')+'</p>';
  return h+'<div class="btnrow mt"><button class="btn ghost" data-act="imp-cancel">Отмена</button><button class="btn" data-act="imp-ok">'+(UI.pendingKind==='mm'?'Импортировать':'Восстановить')+'</button></div></div>';
}
var sqlP=null;
function loadSql(){
  if(sqlP)return sqlP;
  sqlP=new Promise(function(res,rej){var s=document.createElement('script');s.src='sql-wasm.js';s.onload=function(){window.initSqlJs({locateFile:function(f){return f}}).then(res,rej)};s.onerror=function(){sqlP=null;rej(new Error('load'))};document.head.appendChild(s)});
  return sqlP;
}
function parseMM(SQL,buf){
  var db=new SQL.Database(new Uint8Array(buf));
  function q(s){var r=db.exec(s);if(!r.length)return[];var cols=r[0].columns;return r[0].values.map(function(v){var o={};cols.forEach(function(c,i){o[c]=v[i]});return o})}
  var cr=q('select ZUID,ZNAME,ZDOTYPE,ZPUID,ZISDEL,ZORDER from ZCATEGORY');
  var tr=q("select ZUID,ZDO_TYPE,ZTXDATESTR,ZDATE,ZAMOUNT,ZCATEGORYUID,ZCONTENT,ZMEMO from ZINOUTCOME where ZISDEL=0 and ZDO_TYPE in (0,1,'0','1')");
  db.close();
  var cats=[],ids={};
  cr.forEach(function(r){var tp=String(r.ZDOTYPE);if(tp!=='0'&&tp!=='1')return;var id='mm:'+r.ZUID;ids[r.ZUID]=1;cats.push({id:id,name:String(r.ZNAME||'').trim()||'Без названия',type:tp==='1'?'exp':'inc',parent:(r.ZPUID&&r.ZPUID!=='0')?'mm:'+r.ZPUID:null,order:+r.ZORDER||0,archived:+r.ZISDEL===1,nl:false})});
  var byId={};cats.forEach(function(c){byId[c.id]=c});
  cats.forEach(function(c){var p=c.parent&&byId[c.parent];if(!p||p.type!==c.type||p.parent)c.parent=null});
  var tx=[],fallback={};
  tr.forEach(function(r){var tp=String(r.ZDO_TYPE)==='1'?'exp':'inc',ts=r.ZDATE!=null?(+r.ZDATE+978307200)*1000:Date.now();
    var date=isDate(r.ZTXDATESTR)?r.ZTXDATESTR:localDay(ts),amt=Math.round(+r.ZAMOUNT||0);if(!(amt>0))return;
    var cat='mm:'+r.ZCATEGORYUID;if(!byId[cat]||byId[cat].type!==tp){cat='nocat-'+tp;fallback[tp]=1}
    tx.push({id:'mm:'+r.ZUID,type:tp,date:date,amount:amt,cat:cat,note:String(r.ZCONTENT||'').trim(),memo:String(r.ZMEMO||'').trim(),t:ts})});
  Object.keys(fallback).forEach(function(tp){cats.push({id:'nocat-'+tp,name:'Без категории',type:tp,parent:null,order:999,archived:true,nl:false})});
  return{cats:cats,tx:tx};
}
function summarize(cats,tx){
  var e=tx.filter(function(t){return t.type==='exp'}).length,i=tx.length-e,dates=tx.map(function(t){return t.date}).sort();
  return tx.length+' '+plural(tx.length,'операция','операции','операций')+' ('+e+' расх., '+i+' дох.), '+cats.length+' '+plural(cats.length,'категория','категории','категорий')+(dates.length?', с '+shortDate(dates[0])+' '+dates[0].slice(0,4)+' по '+shortDate(dates[dates.length-1])+' '+dates[dates.length-1].slice(0,4):'')+'.';
}
function handleFile(kind,file){
  if(kind==='mm'){
    toast('Читаю файл…');
    Promise.all([loadSql(),file.arrayBuffer()]).then(function(r){
      var res;try{res=parseMM(r[0],r[1])}catch(e){toast('Не похоже на файл «Умного счёта»');return}
      if(!res.tx.length&&!res.cats.length){toast('В файле нет операций');return}
      UI.pending={cats:res.cats,tx:res.tx,summary:summarize(res.cats,res.tx),keepsLimit:true};UI.pendingKind='mm';render();
    }).catch(function(){toast('Не удалось прочитать файл. Нужен интернет при первом импорте.')});
  }else{
    var fr=new FileReader();fr.onload=function(){var v=parseBackup(fr.result);if(!v){toast('Файл не похож на копию бюджета');return}UI.pending=v;UI.pendingKind='backup';render()};fr.onerror=function(){toast('Не удалось прочитать файл')};fr.readAsText(file);
  }
}
function parseBackup(txt){
  var v;try{v=JSON.parse(String(txt).trim())}catch(e){return null}
  if(v&&v.app==='budget'&&v.v===2&&v.data){var d=normalize(v.data);return{data:d,summary:summarize(d.cats,d.tx)+(d.limit?' Есть настройки лимита.':''),full:true}}
  if(v&&v.settings&&Array.isArray(v.settings.periods)&&v.settings.periods.length){ /* old Budget backup: limit settings only */
    return{limitOnly:clone(v.settings),summary:'Копия старой версии: перенесутся настройки лимита (суммы и периоды). Траты берутся из операций.'};
  }
  return null;
}
function applyPending(){
  var pd=UI.pending,k=UI.pendingKind;if(!pd)return;
  if(k==='mm'){
    var oldNl={};D.cats.forEach(function(c){if(c.nl)oldNl[c.id]=1});
    pd.cats.forEach(function(c){if(oldNl[c.id])c.nl=true});
    D.cats=pd.cats;D.tx=pd.tx;D.importedAt=today();
    toast('Импортировано: '+pd.tx.length+' '+plural(pd.tx.length,'операция','операции','операций'));
  }else if(pd.full){D=pd.data;toast('Данные восстановлены')}
  else if(pd.limitOnly){D.limit=pd.limitOnly;toast('Настройки лимита перенесены')}
  UI.pending=null;UI.pendingKind=null;UI.hist=null;rebuild();reconcile();persist();
}
function exportBackup(){
  var t=today(),txt=JSON.stringify({app:'budget',v:2,exported:new Date().toISOString(),data:D}),name='budget-'+t+'.json';
  var mark=function(){D.lastBackup=t;persist();render()};
  var file=null;try{file=new File([txt],name,{type:'application/json'})}catch(e){}
  if(file&&navigator.canShare&&navigator.canShare({files:[file]})){navigator.share({files:[file],title:'Мой бюджет — копия'}).then(function(){mark();toast('Копия сохранена')},function(e){if(e&&e.name!=='AbortError')dl()})}
  else dl();
  function dl(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);mark()}
}
function defaultCats(){
  var e=['🍜 Еда','🚖 Транспорт','🏠 Дом','🧥 Одежда','🧘🏼 Здоровье','💆‍♂️ Развлечения','🎁 Подарки','📦 Другое'],i=['💰 Зарплата','🏅 Бонус','🎁 Подарок','📦 Другое'];
  return e.map(function(n,k){return{id:newId(),name:n,type:'exp',parent:null,order:k+1,archived:false,nl:false}}).concat(i.map(function(n,k){return{id:newId(),name:n,type:'inc',parent:null,order:k+1,archived:false,nl:false}}));
}
function isStandalone(){return window.navigator.standalone===true||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)}

/* ================= render ================= */
function render(){
  var ae=document.activeElement,k=UI.focusK||(ae&&app.contains(ae)&&ae.dataset?ae.dataset.k:null);UI.focusK=null;UI.lastDay=today();
  var html;
  if(!UI.loaded)html=wrap('<div class="loading"><div class="spin"></div></div>');
  else if(!D.cats.length)html=viewWelcome();
  else{
    html=UI.tab==='ops'?viewOps():UI.tab==='stats'?viewStats():UI.tab==='limit'?viewLimit():viewSettings();
    if(UI.tab==='ops'&&UI.search===null)html+='<button class="fab" data-act="add" aria-label="Добавить операцию">+</button>';
    html+=tabbar();
  }
  app.innerHTML=html;renderOv();
  if(k){var el=app.querySelector('[data-k="'+k+'"]');if(el){try{el.focus({preventScroll:true});var n=el.value.length;el.setSelectionRange(n,n)}catch(e){}}}
}
function renderOv(){
  var ae=document.activeElement,k=ae&&ov.contains(ae)&&ae.dataset?(ae.dataset.k||ae.dataset.e):null;
  var key=UI.editor?'ed':UI.catEdit?'cat':UI.sheet?'sheet':'';
  ov.className=key&&key!==UI.ovKey?'anim':'';UI.ovKey=key;
  ov.innerHTML=UI.editor?viewEditor():UI.catEdit?viewCatEdit():UI.sheet?viewDaySheet():'';
  document.body.style.overflow=UI.editor||UI.catEdit||UI.sheet?'hidden':'';
  if(k){var el=ov.querySelector('[data-k="'+k+'"],[data-e="'+k+'"]');if(el&&el.type!=='date'){try{el.focus({preventScroll:true})}catch(e){}}}
}
var tt;function toast(m){toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(tt);tt=setTimeout(function(){toastEl.classList.remove('show')},2200)}
/* updates: version.json is never cached; the button appears only when a newer version is published */
var updT=0;
function checkUpdate(){
  if(location.protocol==='file:'||Date.now()-updT<120000)return;updT=Date.now();
  fetch('version.json?'+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(v){
    var nu=v&&+v.version>APP_VERSION?v:null;if(!!nu!==!!UI.upd||(nu&&UI.upd&&nu.version!==UI.upd.version)){UI.upd=nu;if(!UI.editor)render()}
  }).catch(function(){});
}
function wait(ms){return new Promise(function(r){setTimeout(r,ms)})}
async function doUpdate(){
  try{
    if(saveT)flush();
    var reg=navigator.serviceWorker&&await navigator.serviceWorker.getRegistration();
    if(reg){await reg.update();var w=reg.installing||reg.waiting;
      if(w)await Promise.race([new Promise(function(r){w.addEventListener('statechange',function(){if(w.state==='activated'||w.state==='redundant')r()})}),wait(5000)])}
    if(window.caches){var ks=await caches.keys();await Promise.all(ks.map(function(k){return caches.delete(k)}))}
  }catch(e){}
  await wait(300);location.reload();
}
function tick(){checkUpdate();apSync();if(UI.lastDay&&today()!==UI.lastDay){if(D&&reconcile()){}if(!UI.editor)render()}}

/* ================= actions ================= */
var A={
  tab:function(el){UI.tab=el.dataset.val;UI.sheet=null;UI.resetArm=false;UI.setView=null;UI.search=null;window.scrollTo(0,0)},
  ov:function(el){UI.ov=el.dataset.val},
  month:function(el){UI.month=addMonths(UI.month,+el.dataset.val);UI.calSel=null},
  year:function(el){UI.year+=+el.dataset.val},
  'open-month':function(el){UI.month=el.dataset.val;UI.ov='days';window.scrollTo(0,0)},
  'cal-day':function(el){UI.calSel=el.dataset.date},
  search:function(){UI.search='';UI.focusK='search'},
  'search-close':function(){UI.search=null},
  add:function(el){var d=el.dataset.date||(UI.tab==='ops'&&UI.ov==='cal'&&UI.calSel?UI.calSel:today());openEditor({date:d});UI.sheet=null;return 'ov'},
  'edit-tx':function(el){openEditor({id:el.dataset.id});return 'ov'},
  'inbox-open':function(el){openEditor({inbox:el.dataset.id});return 'ov'},
  'ap-save':function(){var u=String(draft('ap-url',D.ap.url||'')).trim();if(u&&!/^https:\/\/[^\s/]+/.test(u)){toast('Адрес должен начинаться с https://');return}D.ap.url=u;D.ap.err=null;D.ap.last=null;delete UI.d['ap-url'];persist();if(u){toast('Проверяю…');apSync(true)}else toast('Отключено')},
  'ap-sync':function(){toast('Проверяю…');apSync(true)},
  'ap-copy':function(){var k=D.ap.key;try{navigator.clipboard.writeText(k).then(function(){toast('Ключ скопирован')},function(){toast(k)})}catch(e){toast(k)}},
  'ap-newkey':function(){if(!UI.apKeyArm){UI.apKeyArm=true;setTimeout(function(){UI.apKeyArm=false;render()},5000);return}UI.apKeyArm=false;
    var nk=randKey();if(!apBase()){D.ap.key=nk;persist();toast('Новый ключ создан');return}
    fetch(apBase()+'/rekey',{method:'POST',headers:{'X-Key':D.ap.key,'Content-Type':'application/json'},body:JSON.stringify({key:nk})}).then(function(r){
      if(!r.ok)throw 0;D.ap.key=nk;D.ap.err=null;flush();render();toast('Ключ заменён — обнови его в команде iPhone');
    }).catch(function(){toast('Не удалось сменить ключ: нет связи с сервером')})},
  'ed-close':function(){UI.editor=null},
  'ed-type':function(el){var E=UI.editor;if(E.type!==el.dataset.val){E.type=el.dataset.val;if(E.cat&&C.cat[E.cat]&&C.cat[E.cat].type!==E.type)E.cat=null;E.catParent=null;if(E.panel==='cat')E.panel='cat'}return 'ov'},
  'ed-panel':function(el){var E=UI.editor,p=el.dataset.val;E.panel=E.panel===p?null:p;if(p==='cat')E.catParent=null;return 'ov'},
  key:function(el){
    var E=UI.editor,k=el.dataset.val,x=E.expr,isOp=/[+\-×÷]$/.test(x);
    if(/^\d$/.test(k)){var last=(x.match(/\d+$/)||[''])[0];if(last.length>=12)return 'ov';if(last==='0')x=x.slice(0,-1);x+=k}
    else if(k==='000'){if(x&&!isOp&&(x.match(/\d+$/)||[''])[0].length<=9&&!/(^|[+\-×÷])0$/.test(x))x+='000'}
    else if(k==='⌫')x=x.slice(0,-1);
    else if(k==='C')x='';
    else if(k==='='){x=x?String(Math.max(0,calcEval(x))):''}
    else if(k==='next'){x=x?String(Math.max(0,calcEval(x))):'';E.expr=x==='0'?'':x;E.panel=E.cat?null:'cat';E.catParent=null;return 'ov'}
    else{var op=k==='−'?'-':k;if(!x)return 'ov';if(isOp)x=x.slice(0,-1);x+=op}
    E.expr=x;return 'ov';
  },
  'pick-cat':function(el){var E=UI.editor,id=el.dataset.id;
    if(!E.catParent&&subs(id).length){E.catParent=id;return 'ov'}
    E.cat=id;E.catParent=null;E.panel=calcEval(E.expr)>0?null:'calc';return 'ov'},
  'cat-back':function(){UI.editor.catParent=null;return 'ov'},
  'ed-save':function(el){var ok=edSave(el.dataset.val==='more');return ok&&el.dataset.val!=='more'?undefined:(ok?undefined:'ov')},
  'ed-del':function(){UI.editor.del=true;return 'ov'},
  'ed-del-no':function(){UI.editor.del=false;return 'ov'},
  'ed-del-yes':function(){var id=UI.editor.id,ib=UI.editor.inbox;if(ib){D.inbox=D.inbox.filter(function(x){return x.id!==ib});UI.editor=null;persist();toast('Удалено');return}D.tx=D.tx.filter(function(t){return t.id!==id});UI.editor=null;rebuild();persist();toast('Удалено')},
  zero:function(el){var d=el.dataset.date;if(!entered(d)){D.zero[d]=1;rebuild();persist()}},
  lv:function(el){UI.lv=el.dataset.val},
  hist:function(el){UI.hist=Math.max(0,(UI.hist||0)+(+el.dataset.val))},
  'open-day':function(el){UI.sheet=el.dataset.date;return 'ov'},
  'close-sheet':function(){UI.sheet=null;return 'ov'},
  dismiss:function(el){UI.dismiss[el.dataset.val]=1},
  dseg:function(el){UI.d[el.dataset.key]=el.dataset.val},
  'limit-start':function(){
    var L=+digits(UI.d['ob-limit']);if(!L){toast('Введи сумму на период');return}
    var mode=draft('ob-mode','month'),t=today(),sd=12,per;
    if(mode==='month'){sd=Math.min(31,Math.max(1,parseInt(digits(draft('ob-day','12')),10)||12));per=monthPeriodFor(t,sd)}
    else{var s=draft('ob-start',t),e=draft('ob-end',addDays(t,29));if(!isDate(s)||!isDate(e)||e<s){toast('Проверь даты');return}per={start:s,end:e}}
    var carry=(+digits(UI.d['ob-carry'])||0)*(draft('ob-sign','+')==='-'?-1:1);
    D.limit={mode:mode,startDay:sd,initialCarry:carry,periods:[{start:per.start,end:per.end,limit:L}]};UI.d={};persist();
  },
  'np-start':function(){
    var st=D.limit,last=st.periods[st.periods.length-1],start=addDays(last.end,1),all=compute(),lp=all[all.length-1],defEnd=addDays(start,lp.N-1);if(defEnd<today())defEnd=today();
    var e=draft('np-end',defEnd),L=+digits(draft('np-limit',String(last.limit)));
    if(!isDate(e)||e<start){toast('Проверь дату окончания');return}if(!L){toast('Введи сумму');return}
    st.periods.push({start:start,end:e,limit:L});delete UI.d['np-end'];delete UI.d['np-limit'];persist();toast('Новый период начат');
  },
  'save-period':function(){
    var st=D.limit,all=compute(),loc=locate(all,today()),p=loc.cur||loc.ended||all[all.length-1],sp=st.periods[p.idx];
    var L=+digits(draft('set-limit',String(sp.limit)));if(!L){toast('Введи сумму');return}
    if(st.mode==='custom'){var e=draft('set-end',sp.end),nx=st.periods[p.idx+1];if(!isDate(e)||e<sp.start||(nx&&e>=nx.start)){toast('Проверь дату окончания');return}sp.end=e}
    sp.limit=L;delete UI.d['set-limit'];delete UI.d['set-end'];persist();toast('Сохранено');
  },
  lmode:function(el){var st=D.limit;if(st.mode===el.dataset.val)return;st.mode=el.dataset.val;if(!st.startDay)st.startDay=12;delete UI.d['set-end'];
    if(st.mode==='month'){var p=realign();toast('Период: '+range(p))}else toast('Дату окончания можно менять');persist()},
  'save-day':function(){var n=parseInt(digits(UI.d['set-day']),10);if(!(n>=1&&n<=31)){toast('Число от 1 до 31');return}D.limit.startDay=n;delete UI.d['set-day'];var p=realign();persist();toast(p?'Период: '+range(p):'Сохранено')},
  'save-carry':function(){var v=+digits(draft('set-carry',String(Math.abs(+D.limit.initialCarry||0))))||0,sg=draft('set-sign',(+D.limit.initialCarry||0)<0?'-':'+');D.limit.initialCarry=sg==='-'?-v:v;delete UI.d['set-carry'];delete UI.d['set-sign'];persist();toast('Сохранено')},
  sp:function(el){UI.sp=el.dataset.val},
  snav:function(el){var n=+el.dataset.val,a=UI.sAnchor;UI.sAnchor=UI.sp==='week'?addDays(a,7*n):UI.sp==='year'?((+a.slice(0,4)+n)+'-01-01'):(addMonths(mkOf(a),n)+'-01')},
  stype:function(el){UI.sType=el.dataset.val;UI.sCat=null},
  scat:function(el){UI.sCat=el.dataset.val;window.scrollTo(0,0)},
  'scat-back':function(){UI.sCat=null},
  'open-cats':function(){UI.setView='cats';window.scrollTo(0,0)},
  'cats-back':function(){UI.setView=null},
  ctype:function(el){UI.catType=el.dataset.val},
  'cat-limit':function(el){var c=C.cat[el.dataset.id];if(!c)return;var p=c.parent&&C.cat[c.parent];if(p&&p.nl){toast('Сначала включи «'+splitName(p.name).label+'»');return}c.nl=!c.nl;rebuild();persist();return UI.catEdit?'both':undefined},
  'cat-edit':function(el){UI.catEdit={id:el.dataset.id};delete UI.d.cname;return 'ov'},
  'cat-new':function(){UI.catEdit={id:null,type:UI.catType,parent:null};UI.d.cname='';return 'ov'},
  'cat-sub':function(){var c=C.cat[UI.catEdit.id];UI.catEdit={id:null,type:c.type,parent:c.id};UI.d.cname='';return 'ov'},
  'cat-close':function(){UI.catEdit=null;delete UI.d.cname},
  'cat-save':function(){
    var e=UI.catEdit,name=String(draft('cname',e.id&&C.cat[e.id]?C.cat[e.id].name:'')).trim();if(!name){toast('Введи название');return 'ov'}
    if(e.id){C.cat[e.id].name=name;toast('Сохранено')}
    else{var sib=D.cats.filter(function(c){return c.type===e.type&&c.parent===(e.parent||null)}),mx=sib.reduce(function(a,c){return Math.max(a,c.order)},0);
      D.cats.push({id:newId(),name:name,type:e.type,parent:e.parent||null,order:mx+1,archived:false,nl:false});toast('Категория добавлена')}
    UI.catEdit=null;delete UI.d.cname;rebuild();persist();
  },
  'cat-move':function(el){
    var c=C.cat[UI.catEdit.id],sib=D.cats.filter(function(x){return x.type===c.type&&(x.parent||null)===(c.parent||null)&&x.archived===c.archived}).sort(function(a,b){return a.order-b.order});
    var i=sib.indexOf(c),j=i+(+el.dataset.val);if(j<0||j>=sib.length)return 'ov';var tmp=sib[i];sib[i]=sib[j];sib[j]=tmp;sib.forEach(function(x,k){x.order=k+1});rebuild();persist();return 'both';
  },
  'cat-arch':function(){var c=C.cat[UI.catEdit.id];c.archived=!c.archived;rebuild();persist();toast(c.archived?'Скрыта':'Снова в выборе');UI.catEdit=null},
  'cat-del':function(){var e=UI.catEdit;if(!e.delArm){e.delArm=true;return 'ov'}D.cats=D.cats.filter(function(c){return c.id!==e.id});UI.catEdit=null;rebuild();persist();toast('Удалено')},
  'start-empty':function(){D.cats=defaultCats();rebuild();persist()},
  'imp-cancel':function(){UI.pending=null;UI.pendingKind=null},
  'imp-ok':function(){applyPending();window.scrollTo(0,0)},
  'export':function(){exportBackup()},
  'do-update':function(){if(UI.updating)return;UI.updating=true;doUpdate()},
  reset:function(){if(UI.resetArm){D=emptyData();UI.resetArm=false;UI.tab='ops';rebuild();persist();toast('Все данные удалены');return}UI.resetArm=true;setTimeout(function(){if(UI.resetArm){UI.resetArm=false;render()}},5000)}
};
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-act]');
  if(!el){var tp=e.target.closest('[data-tip]');if(tp)showTip(tp,e);else hideTip();return}
  hideTip();
  if(el.disabled)return;var f=A[el.dataset.act];if(!f)return;
  if(el.dataset.act!=='reset')UI.resetArm=false;
  var r=f(el);
  if(r==='ov')renderOv();else render();
});
function showTip(el,e){tipEl.textContent=el.getAttribute('data-tip');tipEl.classList.add('show');var w=tipEl.offsetWidth,h=tipEl.offsetHeight,x=Math.min(window.innerWidth-w-8,Math.max(8,e.clientX-w/2)),y=e.clientY-h-14;if(y<8)y=e.clientY+18;tipEl.style.left=x+'px';tipEl.style.top=y+'px'}
function hideTip(){tipEl.classList.remove('show')}
window.addEventListener('scroll',hideTip,{passive:true});
document.addEventListener('input',function(e){
  var el=e.target;
  if(el.dataset&&el.dataset.e&&UI.editor){UI.editor[el.dataset.e]=el.value;return}
  var k=el.dataset&&el.dataset.k;if(!k)return;
  if(k==='search'){UI.search=el.value;render();return}
  if(el.hasAttribute('data-money')){var d=digits(el.value).slice(0,12);UI.d[k]=d;var f=d===''?'':nf.format(+d);if(el.value!==f)el.value=f}else UI.d[k]=el.value;
});
document.addEventListener('change',function(e){
  var el=e.target;
  if(el.dataset&&el.dataset.e==='date'&&UI.editor){UI.editor.date=el.value||today();return}
  if(el.dataset&&el.dataset.file&&el.files&&el.files[0]){handleFile(el.dataset.file,el.files[0]);el.value=''}
});
document.addEventListener('focusin',function(e){var ed=document.getElementById('ed');if(ed&&e.target.matches&&e.target.matches('[data-e="note"],[data-e="memo"]'))ed.classList.add('typing')});
document.addEventListener('focusout',function(e){var ed=document.getElementById('ed');if(ed&&e.target.matches&&e.target.matches('[data-e="note"],[data-e="memo"]'))setTimeout(function(){var a=document.activeElement;if(!(a&&a.matches&&a.matches('[data-e="note"],[data-e="memo"]')))ed.classList.remove('typing')},50)});
document.addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target.matches&&e.target.matches('[data-e]')){e.target.blur()}});

/* iOS ignores user-scalable=no: block pinch-zoom by hand */
['gesturestart','gesturechange','gestureend'].forEach(function(n){document.addEventListener(n,function(e){e.preventDefault()},{passive:false})});
document.addEventListener('touchmove',function(e){if(e.scale!==undefined&&e.scale!==1)e.preventDefault()},{passive:false});

/* ================= init ================= */
async function init(){
  render();
  idb=await idbOpen();
  var d=idb?await idbGet('state'):null;
  if(!d){try{d=JSON.parse(localStorage.getItem('budget-app-v2')||'null')}catch(e){}}
  var fresh=!d;
  D=normalize(d);
  if(fresh){try{var old=JSON.parse(localStorage.getItem('budget-tracker-v1')||'null');if(old&&old.settings&&Array.isArray(old.settings.periods)&&old.settings.periods.length){D.limit=old.settings;persist()}}catch(e){}}
  rebuild();reconcile();UI.loaded=true;render();
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(function(){});
  setInterval(tick,30000);checkUpdate();apSync(true);
}
window.__budget={get D(){return D},UI:UI,render:render};
init();
})();
