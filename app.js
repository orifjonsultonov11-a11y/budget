/* Мой бюджет — учёт доходов/расходов + дневной лимит. Данные хранятся только на этом устройстве. */
(function(){
'use strict';
var APP_VERSION=10; /* = version in version.json and CACHE in sw.js */
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
function catLabel(id){var c=C.cat[id];if(!c)return 'Без категории';var p=c.parent&&C.cat[c.parent];return p?splitName(p.name).label+' · '+splitName(c.name).label:splitName(c.name).label}
/* category icons: Lucide v0.460.0 (lucide.dev), ISC License, © Lucide Contributors — see LICENSES.md */
var ICONS={"shopping-cart":"<svg class=\"lucide lucide-shopping-cart\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <circle cx=\"8\" cy=\"21\" r=\"1\"/> <circle cx=\"19\" cy=\"21\" r=\"1\"/> <path d=\"M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12\"/>","shopping-basket":"<svg class=\"lucide lucide-shopping-basket\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"m15 11-1 9\"/> <path d=\"m19 11-4-7\"/> <path d=\"M2 11h20\"/> <path d=\"m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4\"/> <path d=\"M4.5 15.5h15\"/> <path d=\"m5 11 4-7\"/> <path d=\"m9 11 1 9\"/>","utensils":"<svg class=\"lucide lucide-utensils\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2\"/> <path d=\"M7 2v20\"/> <path d=\"M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7\"/>","coffee":"<svg class=\"lucide lucide-coffee\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M10 2v2\"/> <path d=\"M14 2v2\"/> <path d=\"M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1\"/> <path d=\"M6 2v2\"/>","pizza":"<svg class=\"lucide lucide-pizza\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"m12 14-1 1\"/> <path d=\"m13.75 18.25-1.25 1.42\"/> <path d=\"M17.775 5.654a15.68 15.68 0 0 0-12.121 12.12\"/> <path d=\"M18.8 9.3a1 1 0 0 0 2.1 7.7\"/> <path d=\"M21.964 20.732a1 1 0 0 1-1.232 1.232l-18-5a1 1 0 0 1-.695-1.232A19.68 19.68 0 0 1 15.732 2.037a1 1 0 0 1 1.232.695z\"/>","car-taxi-front":"<svg class=\"lucide lucide-car-taxi-front\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M10 2h4\"/> <path d=\"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8\"/> <path d=\"M7 14h.01\"/> <path d=\"M17 14h.01\"/> <rect width=\"18\" height=\"8\" x=\"3\" y=\"10\" rx=\"2\"/> <path d=\"M5 18v2\"/> <path d=\"M19 18v2\"/>","bus":"<svg class=\"lucide lucide-bus\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M8 6v6\"/> <path d=\"M15 6v6\"/> <path d=\"M2 12h19.6\"/> <path d=\"M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3\"/> <circle cx=\"7\" cy=\"18\" r=\"2\"/> <path d=\"M9 18h5\"/> <circle cx=\"16\" cy=\"18\" r=\"2\"/>","car":"<svg class=\"lucide lucide-car\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2\"/> <circle cx=\"7\" cy=\"17\" r=\"2\"/> <path d=\"M9 17h6\"/> <circle cx=\"17\" cy=\"17\" r=\"2\"/>","fuel":"<svg class=\"lucide lucide-fuel\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <line x1=\"3\" x2=\"15\" y1=\"22\" y2=\"22\"/> <line x1=\"4\" x2=\"14\" y1=\"9\" y2=\"9\"/> <path d=\"M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18\"/> <path d=\"M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5\"/>","train-front":"<svg class=\"lucide lucide-train-front\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M8 3.1V7a4 4 0 0 0 8 0V3.1\"/> <path d=\"m9 15-1-1\"/> <path d=\"m15 15 1-1\"/> <path d=\"M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z\"/> <path d=\"m8 19-2 3\"/> <path d=\"m16 19 2 3\"/>","house":"<svg class=\"lucide lucide-house\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/> <path d=\"M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>","zap":"<svg class=\"lucide lucide-zap\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z\"/>","droplet":"<svg class=\"lucide lucide-droplet\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z\"/>","flame":"<svg class=\"lucide lucide-flame\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z\"/>","smartphone":"<svg class=\"lucide lucide-smartphone\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <rect width=\"14\" height=\"20\" x=\"5\" y=\"2\" rx=\"2\" ry=\"2\"/> <path d=\"M12 18h.01\"/>","wifi":"<svg class=\"lucide lucide-wifi\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M12 20h.01\"/> <path d=\"M2 8.82a15 15 0 0 1 20 0\"/> <path d=\"M5 12.859a10 10 0 0 1 14 0\"/> <path d=\"M8.5 16.429a5 5 0 0 1 7 0\"/>","shirt":"<svg class=\"lucide lucide-shirt\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z\"/>","pill":"<svg class=\"lucide lucide-pill\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z\"/> <path d=\"m8.5 8.5 7 7\"/>","stethoscope":"<svg class=\"lucide lucide-stethoscope\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M11 2v2\"/> <path d=\"M5 2v2\"/> <path d=\"M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1\"/> <path d=\"M8 15a6 6 0 0 0 12 0v-3\"/> <circle cx=\"20\" cy=\"10\" r=\"2\"/>","heart-pulse":"<svg class=\"lucide lucide-heart-pulse\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z\"/> <path d=\"M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27\"/>","dumbbell":"<svg class=\"lucide lucide-dumbbell\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M14.4 14.4 9.6 9.6\"/> <path d=\"M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z\"/> <path d=\"m21.5 21.5-1.4-1.4\"/> <path d=\"M3.9 3.9 2.5 2.5\"/> <path d=\"M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z\"/>","sparkles":"<svg class=\"lucide lucide-sparkles\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\"/> <path d=\"M20 3v4\"/> <path d=\"M22 5h-4\"/> <path d=\"M4 17v2\"/> <path d=\"M5 18H3\"/>","scissors":"<svg class=\"lucide lucide-scissors\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <circle cx=\"6\" cy=\"6\" r=\"3\"/> <path d=\"M8.12 8.12 12 12\"/> <path d=\"M20 4 8.12 15.88\"/> <circle cx=\"6\" cy=\"18\" r=\"3\"/> <path d=\"M14.8 14.8 20 20\"/>","clapperboard":"<svg class=\"lucide lucide-clapperboard\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z\"/> <path d=\"m6.2 5.3 3.1 3.9\"/> <path d=\"m12.4 3.4 3.1 4\"/> <path d=\"M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z\"/>","gamepad-2":"<svg class=\"lucide lucide-gamepad-2\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <line x1=\"6\" x2=\"10\" y1=\"11\" y2=\"11\"/> <line x1=\"8\" x2=\"8\" y1=\"9\" y2=\"13\"/> <line x1=\"15\" x2=\"15.01\" y1=\"12\" y2=\"12\"/> <line x1=\"18\" x2=\"18.01\" y1=\"10\" y2=\"10\"/> <path d=\"M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z\"/>","music":"<svg class=\"lucide lucide-music\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M9 18V5l12-2v13\"/> <circle cx=\"6\" cy=\"18\" r=\"3\"/> <circle cx=\"18\" cy=\"16\" r=\"3\"/>","gift":"<svg class=\"lucide lucide-gift\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <rect x=\"3\" y=\"8\" width=\"18\" height=\"4\" rx=\"1\"/> <path d=\"M12 8v13\"/> <path d=\"M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7\"/> <path d=\"M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5\"/>","baby":"<svg class=\"lucide lucide-baby\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M9 12h.01\"/> <path d=\"M15 12h.01\"/> <path d=\"M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5\"/> <path d=\"M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1\"/>","graduation-cap":"<svg class=\"lucide lucide-graduation-cap\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z\"/> <path d=\"M22 10v6\"/> <path d=\"M6 12.5V16a6 3 0 0 0 12 0v-3.5\"/>","book-open":"<svg class=\"lucide lucide-book-open\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M12 7v14\"/> <path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>","plane":"<svg class=\"lucide lucide-plane\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z\"/>","bed":"<svg class=\"lucide lucide-bed\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M2 4v16\"/> <path d=\"M2 8h18a2 2 0 0 1 2 2v10\"/> <path d=\"M2 17h20\"/> <path d=\"M6 8v9\"/>","repeat":"<svg class=\"lucide lucide-repeat\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"m17 2 4 4-4 4\"/> <path d=\"M3 11v-1a4 4 0 0 1 4-4h14\"/> <path d=\"m7 22-4-4 4-4\"/> <path d=\"M21 13v1a4 4 0 0 1-4 4H3\"/>","laptop":"<svg class=\"lucide lucide-laptop\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16\"/>","paw-print":"<svg class=\"lucide lucide-paw-print\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <circle cx=\"11\" cy=\"4\" r=\"2\"/> <circle cx=\"18\" cy=\"8\" r=\"2\"/> <circle cx=\"20\" cy=\"16\" r=\"2\"/> <path d=\"M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z\"/>","landmark":"<svg class=\"lucide lucide-landmark\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <line x1=\"3\" x2=\"21\" y1=\"22\" y2=\"22\"/> <line x1=\"6\" x2=\"6\" y1=\"18\" y2=\"11\"/> <line x1=\"10\" x2=\"10\" y1=\"18\" y2=\"11\"/> <line x1=\"14\" x2=\"14\" y1=\"18\" y2=\"11\"/> <line x1=\"18\" x2=\"18\" y1=\"18\" y2=\"11\"/> <polygon points=\"12 2 20 7 4 7\"/>","receipt":"<svg class=\"lucide lucide-receipt\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z\"/> <path d=\"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8\"/> <path d=\"M12 17.5v-11\"/>","hand-heart":"<svg class=\"lucide lucide-hand-heart\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M11 14h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16\"/> <path d=\"m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9\"/> <path d=\"m2 15 6 6\"/> <path d=\"M19.5 8.5c.7-.7 1.5-1.6 1.5-2.7A2.73 2.73 0 0 0 16 4a2.78 2.78 0 0 0-5 1.8c0 1.2.8 2 1.5 2.8L16 12Z\"/>","users":"<svg class=\"lucide lucide-users\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/> <circle cx=\"9\" cy=\"7\" r=\"4\"/> <path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/> <path d=\"M16 3.13a4 4 0 0 1 0 7.75\"/>","beer":"<svg class=\"lucide lucide-beer\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M17 11h1a3 3 0 0 1 0 6h-1\"/> <path d=\"M9 12v6\"/> <path d=\"M13 12v6\"/> <path d=\"M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z\"/> <path d=\"M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8\"/>","cigarette":"<svg class=\"lucide lucide-cigarette\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M17 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h14\"/> <path d=\"M18 8c0-2.5-2-2.5-2-5\"/> <path d=\"M21 16a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1\"/> <path d=\"M22 8c0-2.5-2-2.5-2-5\"/> <path d=\"M7 12v4\"/>","sofa":"<svg class=\"lucide lucide-sofa\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3\"/> <path d=\"M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z\"/> <path d=\"M4 18v2\"/> <path d=\"M20 18v2\"/> <path d=\"M12 4v9\"/>","wrench":"<svg class=\"lucide lucide-wrench\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z\"/>","briefcase":"<svg class=\"lucide lucide-briefcase\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16\"/> <rect width=\"20\" height=\"14\" x=\"2\" y=\"6\" rx=\"2\"/>","wallet":"<svg class=\"lucide lucide-wallet\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1\"/> <path d=\"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4\"/>","banknote":"<svg class=\"lucide lucide-banknote\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <rect width=\"20\" height=\"12\" x=\"2\" y=\"6\" rx=\"2\"/> <circle cx=\"12\" cy=\"12\" r=\"2\"/> <path d=\"M6 12h.01M18 12h.01\"/>","trending-up":"<svg class=\"lucide lucide-trending-up\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <polyline points=\"22 7 13.5 15.5 8.5 10.5 2 17\"/> <polyline points=\"16 7 22 7 22 13\"/>","percent":"<svg class=\"lucide lucide-percent\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <line x1=\"19\" x2=\"5\" y1=\"5\" y2=\"19\"/> <circle cx=\"6.5\" cy=\"6.5\" r=\"2.5\"/> <circle cx=\"17.5\" cy=\"17.5\" r=\"2.5\"/>","tag":"<svg class=\"lucide lucide-tag\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\"/> <circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>","piggy-bank":"<svg class=\"lucide lucide-piggy-bank\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z\"/> <path d=\"M2 9v1c0 1.1.9 2 2 2h1\"/> <path d=\"M16 11h.01\"/>","coins":"<svg class=\"lucide lucide-coins\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <circle cx=\"8\" cy=\"8\" r=\"6\"/> <path d=\"M18.09 10.37A6 6 0 1 1 10.34 18\"/> <path d=\"M7 6h1v4\"/> <path d=\"m16.71 13.88.7.71-2.82 2.82\"/>","package":"<svg class=\"lucide lucide-package\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z\"/> <path d=\"M12 22V12\"/> <path d=\"m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7\"/> <path d=\"m7.5 4.27 9 5.15\"/>","circle-ellipsis":"<svg class=\"lucide lucide-circle-ellipsis\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"M17 12h.01\"/> <path d=\"M12 12h.01\"/> <path d=\"M7 12h.01\"/>","store":"<svg class=\"lucide lucide-store\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7\"/> <path d=\"M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8\"/> <path d=\"M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4\"/> <path d=\"M2 7h20\"/> <path d=\"M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7\"/>","ticket":"<svg class=\"lucide lucide-ticket\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z\"/> <path d=\"M13 5v2\"/> <path d=\"M13 17v2\"/> <path d=\"M13 11v2\"/>","palette":"<svg class=\"lucide lucide-palette\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/> <circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/> <circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/> <circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/> <path d=\"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z\"/>","glasses":"<svg class=\"lucide lucide-glasses\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <circle cx=\"6\" cy=\"15\" r=\"4\"/> <circle cx=\"18\" cy=\"15\" r=\"4\"/> <path d=\"M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2\"/> <path d=\"M2.5 13 5 7c.7-1.3 1.4-2 3-2\"/> <path d=\"M21.5 13 19 7c-.7-1.3-1.5-2-3-2\"/>","cake":"<svg class=\"lucide lucide-cake\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8\"/> <path d=\"M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1\"/> <path d=\"M2 21h20\"/> <path d=\"M7 8v3\"/> <path d=\"M12 8v3\"/> <path d=\"M17 8v3\"/> <path d=\"M7 4h.01\"/> <path d=\"M12 4h.01\"/> <path d=\"M17 4h.01\"/>","dog":"<svg class=\"lucide lucide-dog\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M11.25 16.25h1.5L12 17z\"/> <path d=\"M16 14v.5\"/> <path d=\"M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309\"/> <path d=\"M8 14v.5\"/> <path d=\"M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5\"/>","tree-palm":"<svg class=\"lucide lucide-tree-palm\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4\"/> <path d=\"M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3\"/> <path d=\"M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35\"/> <path d=\"M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14\"/>","smile":"<svg class=\"lucide lucide-smile\" xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <circle cx=\"12\" cy=\"12\" r=\"10\"/> <path d=\"M8 14s1.5 2 4 2 4-2 4-2\"/> <line x1=\"9\" x2=\"9.01\" y1=\"9\" y2=\"9\"/> <line x1=\"15\" x2=\"15.01\" y1=\"9\" y2=\"9\"/>"};
var ICON_RULES=[
  [/кофе|чай\b|кофейн/,'coffee'],[/пицц/,'pizza'],[/кафе|ресторан|обед|ужин|фастфуд|еда|питани|столов/,'utensils'],
  [/продукт|супермаркет|бакале/,'shopping-cart'],[/такси/,'car-taxi-front'],[/поезд|жд\b|электрич/,'train-front'],
  [/транспорт|автобус|метро|проезд/,'bus'],[/бензин|топлив|заправ/,'fuel'],[/авто|машин|парковк/,'car'],
  [/товары для дома|мебел|хозтовар|быт/,'sofa'],[/ремонт|инструмент/,'wrench'],[/дом|квартир|аренд|жиль|ипотек/,'house'],
  [/коммунал|свет\b|электр/,'zap'],[/вода/,'droplet'],[/газ\b/,'flame'],[/интернет/,'wifi'],[/телефон|связь|мобил/,'smartphone'],
  [/одежд|обув/,'shirt'],[/аптек|лекарств/,'pill'],[/здоров|врач|медиц|больниц|стомат|клиник/,'heart-pulse'],
  [/спорт|зал\b|фитнес/,'dumbbell'],[/стрижк|парикмах|барбер/,'scissors'],[/красот|салон|космет|уход/,'sparkles'],
  [/кино|театр|культур|развлеч/,'clapperboard'],[/игр/,'gamepad-2'],[/музык/,'music'],[/праздн|торт|день рожд/,'cake'],[/подар/,'gift'],
  [/дет|ребен|ребён/,'baby'],[/образован|учеб|курс|школ|универ/,'graduation-cap'],[/книг/,'book-open'],
  [/путешеств|отпуск|авиа|перелет|перелёт/,'plane'],[/отел|гостиниц/,'bed'],[/мероприят|концерт|билет/,'ticket'],[/подписк/,'repeat'],
  [/техник|электрон|гаджет|компьют/,'laptop'],[/собак/,'dog'],[/питом|животн|кошк|кот\b/,'paw-print'],
  [/налог|штраф|пошлин|счет|счёт/,'receipt'],[/кредит|долг|банк|займ/,'landmark'],[/благотвор|помощ|пожертв|садака|закят/,'hand-heart'],
  [/социальн|друз|семь|родител/,'users'],[/алкогол|пиво|бар\b/,'beer'],[/сигарет|табак|кальян/,'cigarette'],
  [/зарплат|аванс|оклад/,'wallet'],[/премия|бонус/,'banknote'],[/инвест|дивиденд|вклад|процент/,'trending-up'],
  [/кэшбэк|кешбэк|кешбек|скидк/,'percent'],[/продаж/,'tag'],[/сбереж|копил/,'piggy-bank'],[/карманн|наличн/,'coins'],
  [/работ|бизнес|подработ|фриланс/,'briefcase'],[/посылк|почт|доставк/,'package'],[/магазин|покупк|маркет/,'store'],
  [/хобби|творч/,'palette'],[/оптик|очки/,'glasses'],[/отдых|пляж|море/,'tree-palm'],[/прочее|другое|разное|остальн/,'circle-ellipsis']];
function autoIcon(c){var n=splitName(c.name).label.toLowerCase().replace(/ё/g,'е');for(var i=0;i<ICON_RULES.length;i++)if(ICON_RULES[i][0].test(n))return ICON_RULES[i][1];return null}
function iconKey(c){if(!c)return 'circle-ellipsis';if(c.icon&&ICONS[c.icon])return c.icon;var k=autoIcon(c);if(k)return k;var p=c.parent&&C.cat[c.parent];return p?iconKey(p):'tag'}
function svgI(k){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[k]||ICONS.tag)+'</svg>'}
function catBadge(c){return '<div class="cic" style="--cc:'+colorOf(c?topId(c.id):'')+'">'+svgI(iconKey(c))+'</div>'}
function catIcon(id){return catBadge(C.cat[id]||null)}
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
document.addEventListener('visibilitychange',function(){
  if(document.hidden){UI.hiddenAt=Date.now();if(saveT)flush();return}
  if(SEC.pin&&UI.hiddenAt&&Date.now()-UI.hiddenAt>LOCK_MS&&!(UI.lock&&UI.lock.mode==='unlock'))lockNow();
  UI.hiddenAt=0;tick();
});
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
    if((added||wait)&&!UI.lock)toast('Apple Pay: '+(added?'добавлено '+added:'')+(added&&wait?', ':'')+(wait?'ждут категорию '+wait:''));
    if(!UI.editor)render();
    if(ids.length)return fetch(base+'/ack',{method:'POST',headers:{'X-Key':key,'Content-Type':'application/json'},body:JSON.stringify({ids:ids})}).catch(function(){});
  }).catch(function(e){D.ap.err=(e&&e.message&&/ключ|сервер/.test(e.message))?e.message:'Нет связи с сервером';if(force&&!UI.editor)render()})
  .then(function(){apBusy=false});
}

/* ================= password & Face ID ================= */
/* stored apart from D (key 'sec'): not in backups, survives «Удалить все данные» */
var SEC={},LOCK_MS=4*60*1000;
function b64(buf){var u=new Uint8Array(buf),s='';for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)}
function unb64(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
function rnd(n){var u=new Uint8Array(n);crypto.getRandomValues(u);return u}
async function kdf(secret,salt){var k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unb64(salt),iterations:150000,hash:'SHA-256'},k,256))}
async function mkHash(secret){var salt=b64(rnd(16));return{salt:salt,hash:await kdf(secret,salt)}}
async function checkHash(secret,h){return !!h&&(await kdf(secret,h.salt))===h.hash}
function secSave(){try{localStorage.setItem('budget-sec',JSON.stringify(SEC))}catch(e){}if(idb)idbPut('sec',clone(SEC)).catch(function(){})}
function lockNow(){if(!SEC.pin)return;UI.lock={mode:'unlock',buf:''};render();if(SEC.fid)setTimeout(function(){fidUnlock(true)},350)}
function confirmPin(title,fn){if(!SEC.pin){fn();return}UI.lock={mode:'confirm',title:title,then:fn,buf:''}}
function waitLeft(r){return Math.max(0,Math.ceil((((r?SEC.runtil:SEC.until)||0)-Date.now())/1000))}
function failed(L,msg,r){var f=r?'rfails':'fails',u=r?'runtil':'until';SEC[f]=(SEC[f]||0)+1;if(SEC[f]%5===0){SEC[u]=Date.now()+30000;setTimeout(render,30100)}secSave();L.err=msg;L.buf='';L.shake=true}
function pinKey(k){
  var L=UI.lock;if(!L||L.busy)return;L.shake=false;
  if(k==='del'){L.buf=L.buf.slice(0,-1);return}
  if((L.mode==='unlock'||L.mode==='confirm')&&waitLeft())return;
  if(L.buf.length>=4)return;L.buf+=k;L.err=null;
  if(L.buf.length<4)return;
  var v=L.buf;
  if(L.mode==='new'){
    if(L.step===1){L.first=v;L.step=2;L.buf='';return}
    if(v!==L.first){L.step=1;L.buf='';L.first=null;L.err='Пароли не совпали, введи заново';L.shake=true;return}
    if(L.setup){UI.lock={mode:'recset',setup:true,pinTmp:v};return}
    L.busy=true;mkHash(v).then(function(h){SEC.pin=h;SEC.fails=0;SEC.until=0;secSave();var rec=L.afterRecover;UI.lock=null;toast(rec?'Новый пароль сохранён':'Пароль изменён');render()});
    return;
  }
  L.busy=true;
  checkHash(v,SEC.pin).then(function(ok){
    L.busy=false;
    if(ok){SEC.fails=0;SEC.until=0;secSave();var fn=L.mode==='confirm'?L.then:null;UI.lock=null;if(fn)fn();}
    else failed(L,'Неверный пароль');
    render();
  });
}
async function recCheck(){
  var L=UI.lock,v=String(UI.d['rec-in']||'');if(!L||L.busy)return;
  if(waitLeft(1)){render();return}
  if(!v){L.err='Введи пароль восстановления';render();return}
  L.busy=true;render();var ok=await checkHash(v,SEC.rec);L.busy=false;delete UI.d['rec-in'];
  if(ok){SEC.fails=0;SEC.until=0;SEC.rfails=0;SEC.runtil=0;secSave();UI.lock={mode:'new',step:1,buf:'',forced:true,afterRecover:true}}
  else failed(L,'Неверный пароль восстановления',1);
  render();
}
async function recSave(){
  var L=UI.lock,a=String(UI.d.rec1||''),b=String(UI.d.rec2||'');if(!L||L.busy)return;
  if(a.length<6){L.err='Не короче 6 символов';render();return}
  if(a!==b){L.err='Пароли не совпали';render();return}
  L.busy=true;render();
  var rec=await mkHash(a);
  if(L.setup){SEC={pin:await mkHash(L.pinTmp),rec:rec,fails:0,until:0}}else SEC.rec=rec;
  secSave();delete UI.d.rec1;delete UI.d.rec2;UI.lock=null;
  toast(L.setup?'Пароль включён':'Пароль восстановления изменён');render();
}
function fidAvail(){return !!(window.PublicKeyCredential&&navigator.credentials&&window.isSecureContext&&window.crypto&&crypto.subtle)}
async function fidEnable(){
  try{
    var c=await navigator.credentials.create({publicKey:{challenge:rnd(32),rp:{name:'Мой бюджет'},user:{id:rnd(16),name:'Мой бюджет',displayName:'Мой бюджет'},
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'preferred'},timeout:60000,attestation:'none'}});
    SEC.fid=b64(c.rawId);secSave();toast('Face ID включён');
  }catch(e){toast('Face ID не включён'+(e&&e.name==='NotAllowedError'?': отменено':''))}
  render();
}
async function fidUnlock(auto){
  var L=UI.lock;if(!SEC.fid||!L||L.mode!=='unlock'||L.fidBusy)return;
  L.fidBusy=true;
  try{
    var a=await navigator.credentials.get({publicKey:{challenge:rnd(32),allowCredentials:[{type:'public-key',id:unb64(SEC.fid),transports:['internal','hybrid']}],userVerification:'required',timeout:60000}});
    if(!(new Uint8Array(a.response.authenticatorData)[32]&4))throw new Error('uv');
    if(UI.lock===L){SEC.fails=0;SEC.until=0;secSave();UI.lock=null}
  }catch(e){if(!auto&&UI.lock===L)L.err='Face ID не сработал — введи пароль'}
  L.fidBusy=false;render();
}
function viewLock(){
  var L=UI.lock,h='<div class="lockin">',w=waitLeft(L.mode==='recover');
  if(L.mode==='recover'||L.mode==='recset'){
    if(L.mode==='recover')h+='<h2>Пароль восстановления</h2><p class="small">Введи пароль восстановления, затем задашь новый пароль из 4 цифр.</p><input class="in wide mt2" type="password" data-k="rec-in" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">';
    else h+='<h2>'+(L.setup?'Пароль восстановления':'Новый пароль восстановления')+'</h2><p class="small">Нужен, если забудешь пароль из 4 цифр. Других способов войти нет — запиши его в надёжном месте.</p>'+
      '<input class="in wide mt2" type="password" data-k="rec1" placeholder="Не короче 6 символов" autocomplete="off" autocapitalize="off" spellcheck="false"><input class="in wide mt" type="password" data-k="rec2" placeholder="Повтори" autocomplete="off" autocapitalize="off" spellcheck="false">';
    h+='<div class="lerr">'+(w?'Слишком много попыток. Подожди '+w+' с':esc(L.err||''))+'</div>';
    h+='<button class="btn block" data-act="'+(L.mode==='recover'?'rec-check':'rec-save')+'"'+(L.busy?' disabled':'')+'>'+(L.busy?'Проверяю…':L.mode==='recover'?'Войти':'Сохранить')+'</button>';
    h+='<button class="link" data-act="'+(L.mode==='recover'?'pin-back':'pin-cancel')+'">'+(L.mode==='recover'?'Назад':'Отмена')+'</button>';
    return h+'</div>';
  }
  var title=L.mode==='unlock'?'Введи пароль':L.mode==='confirm'?(L.title||'Подтверди паролем'):L.step===1?(L.afterRecover?'Придумай новый пароль':'Придумай пароль из 4 цифр'):'Повтори пароль';
  h+='<div class="lico">'+I.lock+'</div><h2>'+esc(title)+'</h2><div class="pindots'+(L.shake?' shake':'')+'">';
  for(var i=0;i<4;i++)h+='<i class="'+(i<L.buf.length?'on':'')+'"></i>';
  h+='</div><div class="lerr">'+(w&&(L.mode==='unlock'||L.mode==='confirm')?'Слишком много попыток. Подожди '+w+' с':esc(L.err||''))+'</div><div class="pinpad">';
  function k(v,l,c){return '<button class="'+(c||'')+'" data-act="pin-key" data-val="'+v+'">'+(l||v)+'</button>'}
  for(var d=1;d<=9;d++)h+=k(String(d));
  h+=(L.mode==='unlock'&&SEC.fid?'<button class="fn" data-act="fid-go" aria-label="Face ID">'+I.face+'</button>':'<span></span>')+k('0')+k('del',I.del,'fn');
  h+='</div>';
  if(L.mode==='unlock'&&(SEC.fails||0)>=5)h+='<button class="link" data-act="pin-forgot">Забыли пароль?</button>';
  if(L.mode!=='unlock'&&!L.forced)h+='<button class="link" data-act="pin-cancel">Отмена</button>';
  return h+'</div>';
}
function renderLock(){
  var el=document.getElementById('lock');if(!el){el=document.createElement('div');el.id='lock';document.body.appendChild(el)}
  if(!UI.lock){if(el.innerHTML){el.innerHTML='';el.className=''}document.documentElement.classList.remove('locked');return}
  var ae=document.activeElement,k=ae&&el.contains(ae)&&ae.dataset?ae.dataset.k:null;
  el.className='on';el.innerHTML=viewLock();document.documentElement.classList.add('locked');
  if(k){var f=el.querySelector('[data-k="'+k+'"]');if(f)try{f.focus({preventScroll:true})}catch(e){}}
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
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  face:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 16a3.5 3.5 0 0 0 5 0"/></svg>',
  del:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/></svg>',
  down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>',
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
    return '<div class="tx" data-act="inbox-open" data-id="'+esc(x.id)+'"><div class="cic">'+svgI('store')+'</div><div class="tmid"><b>'+esc(x.mer||'Без названия')+'</b><span>'+shortDate(x.date)+', '+hm(x.t)+'</span></div><div class="tamt">'+fmt(x.amount)+'</div></div>'}).join('')+'</div>';
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
      tiles+=tile(E.catParent,'Вся категория',E.cat===E.catParent);
      subs(E.catParent).forEach(function(s){tiles+=tile(s.id,s.name,E.cat===s.id)});
    }else tops(E.type).forEach(function(c){tiles+=tile(c.id,c.name,E.cat===c.id||topId(E.cat)===c.id)});
    h+='<div class="panel">'+head+'<div class="cgrid2">'+tiles+'</div></div>';
  }
  return h+'</div></div>';
  function tile(id,name,on){var c=C.cat[id];return '<button class="ctile'+(on?' on':'')+'" data-act="pick-cat" data-id="'+id+'" style="--cc:'+colorOf(topId(id))+'"><span class="ci">'+svgI(iconKey(c))+'</span><span class="cn">'+esc(splitName(name).label)+'</span></button>'}
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
      return '<div class="lrow" data-act="scat" data-val="'+e.id+'"><span class="dot" style="background:'+colorOf(e.id)+'"></span><span class="ln">'+esc(s.label)+'</span><span class="lp">'+(p<1?'<1':Math.round(p))+'%</span><span class="lv">'+fmt(e.v)+'</span></div>'}).join('')+'</div>';
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
      return '<div class="trow" data-act="scat" data-val="'+x.id+'"><div class="tn"><b>'+esc(s.label)+'</b><span>среднее '+fmt(x.a)+'</span></div><div class="tv">'+fmt(x.c)+'<span class="'+(x.d>0?'neg':x.d<0?'pos':'muted')+'">'+(x.d>0?'▲ ':'▼ ')+(pct==null?'новое':x.a>0&&x.c/x.a>=3?'×'+(x.c/x.a).toFixed(x.c/x.a<10?1:0).replace('.',','):(pct>0?'+':'−')+Math.abs(pct)+'%')+'</span></div></div>'}).join('')+'</div></div>';
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
  var h='<div class="topbar" style="justify-content:flex-start"><button class="icon solid" data-act="scat-back" aria-label="Назад">'+I.back+'</button><h1 style="margin-top:4px;font-size:26px">'+esc(s.label)+'</h1></div>';
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
function navRow(act,title,sub){return '<button class="card navrow" data-act="'+act+'"><span><b>'+title+'</b><span class="small">'+sub+'</span></span>'+I.r+'</button>'}
function subTop(title){return '<div class="topbar" style="justify-content:flex-start"><button class="icon solid" data-act="set-back" aria-label="Назад">'+I.back+'</button><h1 style="margin-top:4px;font-size:26px">'+title+'</h1></div>'}
function apStatus(){var ap=D.ap;return !apBase()?'Не подключено':ap.err?'<span class="neg">Ошибка: '+esc(ap.err)+'</span>':ap.last?'<span class="pos">Подключено</span> · проверено '+(localDay(ap.last)===today()?'сегодня':shortDate(localDay(ap.last)))+' в '+hm(ap.last):'Ещё не проверено'}
function limitCard(){
  var st=D.limit,all=compute(),loc=locate(all,today()),p=loc.cur||loc.ended||all[all.length-1],mode=draft('lim-mode',st.mode);
  var tail=st.mode==='month'?'следующий начнётся '+shortDate(addDays(p.end,1)):'после '+shortDate(p.end)+' новый период задашь на вкладке «Лимит»';
  function opt(m,inner){return '<div class="opt'+(mode===m?' on':'')+'" data-opt="'+m+'"><button class="radio" data-act="lim-mode" data-val="'+m+'" aria-label="Выбрать"><i></i></button><div class="optb">'+inner+'</div></div>'}
  return '<div class="card"><h3>Лимит</h3>'+
    '<div class="limhead"><b>'+range(p)+'</b> · '+p.N+' '+plural(p.N,'день','дня','дней')+'<span class="small">≈ '+fmt(p.limit/p.N)+' сум в день · '+tail+'</span></div>'+
    '<div class="row"><span>Сумма на период</span><input class="in" data-k="lim-sum" data-money inputmode="numeric" value="'+money('lim-sum',p.limit)+'"></div>'+
    '<div class="label mt2">Период</div>'+
    opt('month','<span data-act="lim-mode" data-val="month">Каждый месяц с</span><input class="in xs" data-mode="month" data-k="lim-day" inputmode="numeric" maxlength="2" value="'+esc(draft('lim-day',String(st.startDay||12)))+'"><span data-act="lim-mode" data-val="month">числа</span>')+
    opt('custom','<span data-act="lim-mode" data-val="custom">Свои даты</span><span class="dates"><label>с <input class="in dt" type="date" data-mode="custom" data-k="lim-start" value="'+draft('lim-start',p.start)+'"></label><label>по <input class="in dt" type="date" data-mode="custom" data-k="lim-end" value="'+draft('lim-end',p.end)+'"></label></span>')+
    '<button class="btn block mt2" data-act="lim-save">Сохранить</button><p class="small">Лимит на день и остатки пересчитаются за весь текущий период.</p></div>';
}
function viewAp(){
  var ap=D.ap,h=subTop('Apple Pay');
  h+='<div class="card"><p class="small" style="margin-top:0">Оплаты телефоном сами попадают в расходы: команда iPhone отправляет их на твой сервер Cloudflare, приложение забирает при открытии. Знакомый магазин записывается в свою последнюю категорию, новый — ждёт выбора вверху вкладки «Операции».</p>'+
    '<p class="small">Статус: '+apStatus()+'</p>'+
    '<div class="label mt">Адрес сервера</div><input class="in wide mt" data-k="ap-url" value="'+esc(draft('ap-url',ap.url||''))+'" placeholder="https://budget-pay.имя.workers.dev" autocomplete="off" autocapitalize="off" spellcheck="false">'+
    '<div class="btnrow mt"><button class="btn sm" data-act="ap-save">Сохранить</button>'+(apBase()?'<button class="btn sm ghost" data-act="ap-sync">Проверить</button>':'')+'</div>'+
    '<div class="label mt2">Ключ доступа</div><div class="row" style="border:0"><code class="key">'+esc(ap.key)+'</code></div>'+
    '<div class="btnrow"><button class="btn sm ghost" data-act="ap-copy">Скопировать</button><button class="btn sm ghost'+(UI.apKeyArm?' danger':'')+'" data-act="ap-newkey">'+(UI.apKeyArm?'Точно заменить?':'Новый ключ')+'</button></div>'+
    '<p class="small">Ключ вставляется в команду iPhone (заголовок X-Key). Никому его не показывай.</p></div>';
  h+=apGuide();
  return wrap(h);
}
function apGuide(){
  var open=UI.apHelp!=null?UI.apHelp:!apBase()||!D.ap.last,url=apBase(),add=url?url+'/add':'адрес сервера + /add';
  var h='<div class="card guide"><button class="navrow gtoggle" data-act="ap-help"><span><b>Как подключить</b><span class="small">Сервер Cloudflare и команда iPhone (iOS 26) · ~15 минут</span></span>'+(open?I.down:I.r)+'</button>';
  if(!open)return h+'</div>';
  function st(t,body){return '<li><b>'+t+'</b>'+(body?'<div>'+body+'</div>':'')+'</li>'}
  h+='<p class="small">Нужно один раз. Сервер бесплатный: он принимает оплаты от iPhone и хранит их, пока приложение их не заберёт.</p>';
  h+='<div class="label mt2">Шаг 1. Сервер Cloudflare</div><ol class="steps">'+
    st('Зарегистрируйся','<a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">dash.cloudflare.com</a> — бесплатный тариф, нужна только почта. Удобнее делать с компьютера, но в Safari тоже работает.')+
    st('Создай хранилище','Слева «Storage &amp; Databases» → «Workers KV» → «Create». Имя: <code>budget-queue</code>.')+
    st('Создай сервер','«Workers &amp; Pages» → «Create» → «Start with Hello World» → имя, например <code>budget-pay</code> → «Deploy».')+
    st('Вставь код сервера','<button class="btn sm ghost mt" data-act="ap-code">Скопировать код сервера</button><div class="mt">Затем «Edit code» → удали всё, что там есть → вставь → «Deploy».</div>')+
    st('Подключи хранилище к серверу','Открой сервер → «Settings» → «Bindings» → «Add» → «KV namespace». Variable name: <code>QUEUE</code>, namespace: <code>budget-queue</code> → «Add binding» / «Deploy».')+
    st('Скопируй адрес сервера','Он на странице сервера, вида <code>https://budget-pay.имя.workers.dev</code>.')+
    st('Вставь адрес выше и нажми «Сохранить»','Сделай это сразу: сервер запоминает ключ первого подключившегося приложения и дальше принимает только его. Статус станет «Подключено».')+
    '</ol>';
  h+='<div class="label mt2">Шаг 2. Команда на iPhone (iOS 26)</div><ol class="steps">'+
    st('Открой «Команды» → «Автоматизация» → «+»','Выбери «Транзакция».')+
    st('Настрой триггер','«Когда я касаюсь» — отметь свою карту. «Категории» и «Продавец» оставь «Любой». Включи «Запускать сразу», «Уведомлять при запуске» — выключи. → «Далее» → «Новая пустая автоматизация».')+
    st('Добавь действие «Получить содержимое URL»','«Добавить действие» → в поиске «URL». Нажми на синее «URL» и вставь:<div class="copyrow"><code>'+esc(add)+'</code>'+(url?'<button class="btn sm ghost" data-act="ap-copyurl">Скопировать</button>':'')+'</div>')+
    st('Раскрой параметры стрелкой «›»','«Метод» → <b>POST</b>.')+
    st('Заголовки','«Добавить новый заголовок»: ключ <code>X-Key</code>, текст — ключ доступа выше (кнопка «Скопировать»).')+
    st('Тело запроса → JSON','«Добавить новое поле» → «Текст»: ключ <code>amount</code>, значение — переменная «Ввод команды» → свойство «Сумма».<br>Ещё одно поле «Текст»: ключ <code>merchant</code>, значение — «Ввод команды» → «Продавец».')+
    st('«Готово»','Проверь: <code>amount</code>, <code>merchant</code>, <code>X-Key</code> — латиницей; в полях цветные плашки-переменные, а не обычный текст.')+
    '</ol>';
  h+='<div class="label mt2">Шаг 3. Проверка</div><p class="small">Оплати что-нибудь телефоном и открой приложение: платёж появится вверху вкладки «Операции». Выбери категорию — следующие оплаты в этом магазине запишутся сами.</p>'+
    '<p class="small">Не пришло? «Команды» → «Автоматизация» → твоя автоматизация: там видно, запускалась ли она. Статус «Нет связи с сервером» — проверь интернет или VPN: некоторые сети блокируют адреса workers.dev.</p>';
  return h+'</div>';
}
function viewPinSet(){
  var h=subTop('Пароль');
  if(!SEC.pin){
    h+='<div class="card"><p class="small" style="margin-top:0">Пароль из 4 цифр закрывает приложение при запуске и после того, как оно было свёрнуто дольше 4 минут. Им же подтверждается удаление всех данных, восстановление из копии и импорт.</p>'+
      '<p class="small">Понадобится и пароль восстановления: он нужен, если забудешь основной. Других способов войти нет.</p><button class="btn block mt2" data-act="pin-on">Включить пароль</button></div>';
    return wrap(h);
  }
  h+='<div class="card"><div class="row" style="border:0;padding-top:0"><span>Пароль</span><b class="pos">Включён</b></div>'+
    '<button class="btn ghost block mt" data-act="pin-change">Изменить пароль</button>'+
    '<button class="btn ghost block mt" data-act="rec-change">Изменить пароль восстановления</button></div>';
  if(fidAvail())h+='<div class="card"><div class="row" style="border:0;padding:0"><span>Вход по Face ID<br><small>Пароль из 4 цифр останется запасным</small></span><button class="sw'+(SEC.fid?' on':'')+'" data-act="fid-toggle" aria-label="Face ID"></button></div></div>';
  h+='<button class="btn ghost block danger" data-act="pin-off">Выключить пароль</button>';
  return wrap(h);
}
function viewImp(){var h=subTop('Импорт');
  h+='<div class="card"><p class="small">Выбери свежий файл резервной копии (.mmbak). Операции и категории заменятся данными из файла, настройки лимита останутся.'+(D.importedAt?' Последний импорт: '+shortDate(D.importedAt)+'.':'')+'</p><label class="btn ghost block mt filebtn">Выбрать файл .mmbak<input type="file" data-file="mm" hidden></label>'+(UI.pendingKind==='mm'?pendingBox():'')+'</div>';
  return wrap(h);
}
function viewBak(){var h=subTop('Резервная копия');
  h+='<div class="card"><p class="small">Данные хранятся только на этом телефоне. Если удалить иконку приложения, они пропадут — сохраняй копию в «Файлы» или iCloud Drive.</p><p class="small">'+(D.lastBackup?'Последняя копия: '+longDate(D.lastBackup):'Копию ещё не сохраняли.')+'</p>'+
    '<button class="btn block mt" data-act="export">Сохранить копию</button><label class="btn ghost block mt filebtn">Восстановить из файла<input type="file" accept="application/json,.json,text/plain" data-file="backup" hidden></label>'+(UI.pendingKind==='backup'?pendingBox():'')+'</div>';
  return wrap(h);
}
function viewLim(){var h=subTop('Лимит');
  h+=D.limit?limitCard():'<p class="sub">Задай сумму на период — приложение посчитает лимит на каждый день.</p>'+viewLimitSetup();
  return wrap(h);
}
function viewSettings(){
  if(UI.setView==='cats')return viewCats();
  if(UI.setView==='lim')return viewLim();
  if(UI.setView==='stats')return viewStatsAdmin();
  if(UI.setView==='imp')return viewImp();
  if(UI.setView==='bak')return viewBak();
  if(UI.setView==='ap')return viewAp();
  if(UI.setView==='pin')return viewPinSet();
  var h='<h1>Настройки</h1><p class="sub">&nbsp;</p>';
  if(UI.upd){var rel=(UI.upd.releases||[]).filter(function(r){return r.v>APP_VERSION});
    h+='<div class="card upd"><h3>Доступно обновление · версия '+UI.upd.version+'</h3><p class="small">Сейчас установлена версия '+APP_VERSION+'.</p>'+
      rel.map(function(r){return '<div class="label mt">Версия '+r.v+(r.date?' · '+shortDate(r.date):'')+'</div><ul class="notes">'+(r.notes||[]).map(function(n){return '<li>'+esc(n)+'</li>'}).join('')+'</ul>'}).join('')+
      '<button class="btn block mt" data-act="do-update"'+(UI.updating?' disabled':'')+'>'+(UI.updating?'Обновляю…':'Обновить')+'</button><p class="small">Данные не пропадут.</p></div>';
  }
  var ex=tops('exp'),inL=ex.filter(function(c){return !c.nl}).length,lp=null;
  if(D.limit){var la=compute(),ll=locate(la,today());lp=ll.cur||ll.ended||la[la.length-1]}
  h+=navRow('open-lim','Лимит',lp?range(lp)+' · '+fmt(lp.limit)+' сум':'Не настроен');
  h+=navRow('open-cats','Категории','В лимите '+inL+' из '+ex.length+' категорий расходов');
  h+=navRow('open-ap','Apple Pay',apStatus());
  h+=navRow('open-pin','Пароль',SEC.pin?'<span class="pos">Включён</span>'+(SEC.fid?' · Face ID':''):'Выключен');
  if(!isStandalone())h+='<div class="card"><h3>Установка на iPhone</h3><p class="small">Открой страницу в Safari → «Поделиться» → «На экран „Домой“». Дальше запускай с иконки — работает без интернета.</p></div>';
  h+=navRow('open-imp','Импорт из «Умного счёта»',D.importedAt?'Последний импорт: '+shortDate(D.importedAt):'Перенести операции из файла .mmbak');
  h+=navRow('open-bak','Резервная копия',D.lastBackup?'Последняя копия: '+shortDate(D.lastBackup):'<span class="neg">Копию ещё не сохраняли</span>');
  h+='<button class="btn ghost block danger" data-act="reset">'+(UI.resetArm?'Точно удалить всё? Нажми ещё раз':'Удалить все данные')+'</button>';
  h+='<p class="small vline" data-act="ver-tap">Версия '+APP_VERSION+'</p><p class="small vline" style="margin-top:2px">Приложение анонимно считает число установок — без ваших данных.</p>';
  return wrap(h);
}
function viewCats(){
  var type=UI.catType,h='<div class="topbar" style="justify-content:flex-start"><button class="icon solid" data-act="cats-back" aria-label="Назад">'+I.back+'</button><h1 style="margin-top:4px;font-size:26px">Категории</h1></div>';
  h+='<div class="seg">'+seg('ctype','exp','Расходы',type)+seg('ctype','inc','Доходы',type)+'</div>';
  if(type==='exp')h+='<p class="small" style="margin:12px 4px">Переключатель справа — учитывать ли категорию в дневном лимите. Например, аренду или крупные покупки можно выключить: они останутся в учёте, но не съедят лимит.</p>';
  else h+='<div class="mt"></div>';
  function row(c,isSub){var s=splitName(c.name),par=isSub&&C.cat[c.parent];var parentOff=par&&par.nl;
    return '<div class="crow'+(isSub?' sub':'')+'" data-act="cat-edit" data-id="'+c.id+'">'+catBadge(c)+'<div class="cnm">'+esc(s.label)+'</div>'+
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
  h+='<div class="label mt2">Название</div><input class="in wide mt" data-k="cname" value="'+esc(draft('cname',c?splitName(c.name).label:''))+'" placeholder="'+(parent?'Например, Кафе':'Например, Продукты')+'" autocomplete="off">';
  if(!isNew)h+='<button class="btn block mt" data-act="cat-save">Сохранить название</button>';
  var ck=c?iconKey(c):(e.icon||autoIcon({name:String(draft('cname',''))})||(parent&&C.cat[parent]?iconKey(C.cat[parent]):'tag'));
  h+='<div class="label mt2">Иконка'+(isNew&&!e.icon?' <span class="muted">· подобрана по названию, можно выбрать другую</span>':'')+'</div><div class="igrid" style="--cc:'+colorOf(parent?topId(parent):c?topId(c.id):'')+'">'+Object.keys(ICONS).map(function(k){return '<button class="ig'+(k===ck?' on':'')+'" data-act="cat-icon" data-val="'+k+'" aria-label="'+k+'">'+svgI(k)+'</button>'}).join('')+'</div>';
  if(isNew)h+='<button class="btn block mt2" data-act="cat-save">Создать</button>';
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
  app.innerHTML=html;renderOv();renderLock();
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
/* anonymous install counter (worker/stats.js): once a day — random install id + app version, nothing else */
var STATS_URL='https://budget-stats.ob-0849d5d2.workers.dev';
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function statsPing(){
  if(!navigator.onLine||location.protocol==='file:'||(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)&&!window.__statsTest))return;
  var id=lsGet('budget-iid');if(!id){id=randKey();lsSet('budget-iid',id)}
  var mark=today()+'|'+APP_VERSION;if(lsGet('budget-ping')===mark)return;
  fetch(STATS_URL+'/ping',{method:'POST',body:JSON.stringify({id:id,v:APP_VERSION}),keepalive:true}).then(function(r){if(r.ok)lsSet('budget-ping',mark)}).catch(function(){});
}
/* the screen opens only for the owner: other devices get no reaction (401 → silence) */
function statsLoad(open){
  var k=lsGet('budget-admin');if(!k){k=randKey()+randKey();lsSet('budget-admin',k)}
  if(UI.statsBusy)return;UI.statsBusy=true;if(!open){UI.stats={busy:true};render()}
  fetch(STATS_URL+'/stats',{headers:{'X-Key':k},cache:'no-store'}).then(function(r){if(r.status===401)throw new Error('key');if(!r.ok)throw new Error('http');return r.json()})
    .then(function(j){UI.stats={data:j};if(open){UI.setView='stats';window.scrollTo(0,0)}})
    .catch(function(e){if(open||(e&&e.message==='key')){if(UI.setView==='stats')UI.setView=null;return}UI.stats={err:'Нет связи с сервером статистики.'}})
    .then(function(){UI.statsBusy=false;if(UI.tab==='settings'&&!UI.editor)render()});
}
function viewStatsAdmin(){
  var h=subTop('Статистика'),st=UI.stats||{};
  if(st.busy)return wrap(h+'<div class="loading"><div class="spin"></div></div>');
  if(st.err)return wrap(h+'<div class="card"><p class="small" style="margin-top:0">'+esc(st.err)+'</p><button class="btn ghost block mt" data-act="stats-reload">Повторить</button></div>');
  var d=st.data;if(!d)return wrap(h);
  var vs=Object.keys(d.versions||{}).sort(function(a,b){return b-a});
  h+='<div class="card"><div class="limhead" style="margin-top:0"><b>'+d.total+'</b> '+plural(d.total,'установка','установки','установок')+' всего</div>'+
    kv('Пользовались сегодня',String(d.active1))+kv('За 7 дней',String(d.active7))+kv('За 30 дней',String(d.active30))+kv('Новых за 7 дней',String(d.new7))+'</div>';
  if(vs.length)h+='<div class="card"><h3>Версии</h3><p class="small">У кого какая версия — среди пользовавшихся за 30 дней.</p><div class="mt">'+vs.map(function(v){return kv('Версия '+v+(+v===APP_VERSION?' (текущая)':''),String(d.versions[v]))}).join('')+'</div></div>';
  h+='<p class="small" style="margin:0 4px">Считаются установки, которые открывались с интернетом; ваша тоже в счёте. Номер установки случайный, данных пользователей сервер не получает.</p>'+
    '<button class="btn ghost block mt2" data-act="stats-reload">Обновить</button>';
  return wrap(h);
}
function tick(){checkUpdate();apSync();statsPing();if(UI.lastDay&&today()!==UI.lastDay){if(D&&reconcile()){}if(!UI.editor)render()}}

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
  'ap-help':function(){UI.apHelp=!(UI.apHelp!=null?UI.apHelp:!apBase()||!D.ap.last)},
  'ap-copyurl':function(){var u=apBase()+'/add';try{navigator.clipboard.writeText(u).then(function(){toast('Адрес скопирован')},function(){toast(u)})}catch(e){toast(u)}},
  'ap-code':function(){
    var src=new URL('worker/worker.js',location.href).href,p=fetch(src,{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.text()});
    function fail(){toast('Не скопировалось — открываю код');setTimeout(function(){window.open('https://github.com/orifjonsultonov11-a11y/budget/blob/main/worker/worker.js','_blank')},800)}
    try{
      if(window.ClipboardItem&&navigator.clipboard.write){navigator.clipboard.write([new ClipboardItem({'text/plain':p.then(function(t){return new Blob([t],{type:'text/plain'})})})]).then(function(){toast('Код сервера скопирован')},fail);return}
      p.then(function(t){return navigator.clipboard.writeText(t)}).then(function(){toast('Код сервера скопирован')},fail);
    }catch(e){fail()}
  },
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
  'lim-mode':function(el){UI.d['lim-mode']=el.dataset.val},
  'lim-save':function(){
    var st=D.limit,all=compute(),loc=locate(all,today()),p=loc.cur||loc.ended||all[all.length-1],ps=st.periods,i=p.idx,sp=ps[i],mode=draft('lim-mode',st.mode);
    var L=+digits(draft('lim-sum',String(sp.limit)));if(!L){toast('Введи сумму на период');return}
    if(mode==='month'){
      var n=parseInt(digits(draft('lim-day',String(st.startDay||12))),10);if(!(n>=1&&n<=31)){toast('Число месяца — от 1 до 31');return}
      var cur=sp;if(st.mode!=='month'||st.startDay!==n){st.mode='month';st.startDay=n;cur=realign()}
      cur.limit=L;
    }else{
      var a=draft('lim-start',sp.start),b=draft('lim-end',sp.end),prev=ps[i-1],next=ps[i+1];
      if(!isDate(a)||!isDate(b)||b<a){toast('Проверь даты: конец не раньше начала');return}
      if(next&&b>=next.start){toast('Конец должен быть раньше '+shortDate(next.start));return}
      if(prev&&a<=prev.start){toast('Начало должно быть позже '+shortDate(prev.start));return}
      if(prev)prev.end=addDays(a,-1);
      st.mode='custom';sp.start=a;sp.end=b;sp.limit=L;
    }
    ['lim-mode','lim-sum','lim-day','lim-start','lim-end'].forEach(function(k){delete UI.d[k]});
    persist();var np=compute(),nl=locate(np,today()),q=nl.cur||nl.ended||np[np.length-1];toast('Сохранено: '+range(q));
  },
  'set-back':function(){UI.setView=null;window.scrollTo(0,0)},
  'open-ap':function(){UI.setView='ap';window.scrollTo(0,0)},
  'open-pin':function(){UI.setView='pin';window.scrollTo(0,0)},
  'ver-tap':function(){var n=Date.now();UI.vt=(UI.vt||[]).filter(function(t){return n-t<3000});UI.vt.push(n);if(UI.vt.length>=5){UI.vt=[];statsLoad(true)}return 'ov'},
  'stats-reload':function(){statsLoad(false)},
  'open-lim':function(){UI.setView='lim';window.scrollTo(0,0)},
  'open-imp':function(){UI.setView='imp';window.scrollTo(0,0)},
  'open-bak':function(){UI.setView='bak';window.scrollTo(0,0)},
  sp:function(el){UI.sp=el.dataset.val},
  snav:function(el){var n=+el.dataset.val,a=UI.sAnchor;UI.sAnchor=UI.sp==='week'?addDays(a,7*n):UI.sp==='year'?((+a.slice(0,4)+n)+'-01-01'):(addMonths(mkOf(a),n)+'-01')},
  stype:function(el){UI.sType=el.dataset.val;UI.sCat=null},
  scat:function(el){UI.sCat=el.dataset.val;window.scrollTo(0,0)},
  'scat-back':function(){UI.sCat=null},
  'open-cats':function(){UI.setView='cats';window.scrollTo(0,0)},
  'cats-back':function(){UI.setView=null},
  'pin-on':function(){UI.lock={mode:'new',step:1,setup:true,buf:''}},
  'pin-change':function(){confirmPin('Введи текущий пароль',function(){UI.lock={mode:'new',step:1,buf:''}})},
  'rec-change':function(){confirmPin('Введи текущий пароль',function(){UI.lock={mode:'recset'}})},
  'pin-off':function(){confirmPin('Введи пароль, чтобы выключить',function(){SEC={};secSave();toast('Пароль выключен')})},
  'fid-toggle':function(){if(SEC.fid){SEC.fid=null;secSave();toast('Face ID выключен');return}fidEnable()},
  'pin-key':function(el){return pinKey(el.dataset.val)},
  'pin-cancel':function(){var L=UI.lock;if(L&&L.mode!=='unlock'&&!L.forced){UI.lock=null;['rec1','rec2','rec-in'].forEach(function(k){delete UI.d[k]})}},
  'pin-forgot':function(){UI.lock={mode:'recover'};delete UI.d['rec-in']},
  'pin-back':function(){UI.lock={mode:'unlock',buf:''}},
  'rec-check':function(){recCheck()},
  'rec-save':function(){recSave()},
  'fid-go':function(){fidUnlock(false)},
  ctype:function(el){UI.catType=el.dataset.val},
  'cat-limit':function(el){var c=C.cat[el.dataset.id];if(!c)return;var p=c.parent&&C.cat[c.parent];if(p&&p.nl){toast('Сначала включи «'+splitName(p.name).label+'»');return}c.nl=!c.nl;rebuild();persist();return UI.catEdit?'both':undefined},
  'cat-icon':function(el){var e=UI.catEdit,c=e.id&&C.cat[e.id];if(!c){e.icon=el.dataset.val;return 'ov'}c.icon=el.dataset.val;rebuild();persist()},
  'cat-edit':function(el){UI.catEdit={id:el.dataset.id};delete UI.d.cname;return 'ov'},
  'cat-new':function(){UI.catEdit={id:null,type:UI.catType,parent:null};UI.d.cname='';return 'ov'},
  'cat-sub':function(){var c=C.cat[UI.catEdit.id];UI.catEdit={id:null,type:c.type,parent:c.id};UI.d.cname='';return 'ov'},
  'cat-close':function(){UI.catEdit=null;delete UI.d.cname},
  'cat-save':function(){
    var e=UI.catEdit,name=String(draft('cname',e.id&&C.cat[e.id]?C.cat[e.id].name:'')).trim();if(!name){toast('Введи название');return 'ov'}
    if(e.id){var oc=C.cat[e.id],os=splitName(oc.name);if(name!==os.label)oc.name=name;toast('Сохранено')}
    else{var sib=D.cats.filter(function(c){return c.type===e.type&&c.parent===(e.parent||null)}),mx=sib.reduce(function(a,c){return Math.max(a,c.order)},0);
      var nc={id:newId(),name:name,type:e.type,parent:e.parent||null,order:mx+1,archived:false,nl:false};if(e.icon)nc.icon=e.icon;D.cats.push(nc);toast('Категория добавлена')}
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
  'imp-ok':function(){confirmPin('Подтверди замену данных',function(){applyPending();window.scrollTo(0,0)})},
  'export':function(){exportBackup()},
  'do-update':function(){if(UI.updating)return;UI.updating=true;doUpdate()},
  reset:function(){
    function wipe(){D=normalize(emptyData());UI.resetArm=false;UI.tab='ops';UI.setView=null;rebuild();persist();toast('Все данные удалены')}
    if(SEC.pin){confirmPin('Подтверди удаление всех данных',wipe);return}
    if(UI.resetArm){wipe();return}UI.resetArm=true;setTimeout(function(){if(UI.resetArm){UI.resetArm=false;render()}},5000)}
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
document.addEventListener('focusin',function(e){var m=e.target.dataset&&e.target.dataset.mode;if(m){UI.d['lim-mode']=m;document.querySelectorAll('.opt').forEach(function(o){o.classList.toggle('on',o.dataset.opt===m)})}});
document.addEventListener('keydown',function(e){if(e.key==='Enter'&&UI.lock){if(e.target.dataset.k==='rec-in')recCheck();else if(e.target.dataset.k==='rec2')recSave()}});
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
  var sc=idb?await idbGet('sec'):null;if(!sc){try{sc=JSON.parse(localStorage.getItem('budget-sec')||'null')}catch(e){}}SEC=sc||{};
  if(SEC.pin)UI.lock={mode:'unlock',buf:''};
  rebuild();reconcile();UI.loaded=true;render();
  if(SEC.pin&&SEC.fid)setTimeout(function(){fidUnlock(true)},350);
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(function(){});
  setInterval(tick,30000);checkUpdate();apSync(true);statsPing();
}
window.__budget={get D(){return D},UI:UI,render:render};
init();
})();
