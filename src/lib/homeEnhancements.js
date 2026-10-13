import '../styles/HomeEnhancements.css';

export function mountHomeEnhancements(api){
 if(window.__homeEnhancementsMounted)return;
 window.__homeEnhancementsMounted=true;
 (function(){
var K="esan-brillo-v1",R=document.documentElement,st={on:true,lv:100};
try{var q=JSON.parse(localStorage.getItem(K));if(q){st.on=q.on!==false;var n=Math.round(+q.lv);if(n>=10&&n<=100)st.lv=n}}catch(e){}
function apply(){R.dataset.glow=st.on?"on":"off";R.style.setProperty("--glow-o",st.on?(st.lv/100).toFixed(2):"0");R.style.setProperty("--glow-bm",st.on?st.lv+"%":"0%")}
function save(){try{localStorage.setItem(K,JSON.stringify(st))}catch(e){}}
apply();
var raf=0,ex=0,ey=0,blk=null;
addEventListener("pointermove",function(e){if(!st.on)return;var b=e.target.closest&&e.target.closest(".page .blk");if(!b)return;blk=b;ex=e.clientX;ey=e.clientY;if(raf)return;raf=requestAnimationFrame(function(){raf=0;if(!blk||!blk.isConnected)return;var r=blk.getBoundingClientRect();blk.style.setProperty("--mx",ex-r.left+"px");blk.style.setProperty("--my",ey-r.top+"px")})},{passive:true});
function ctl(){
var d=document.createElement("div");d.className="gl";d.setAttribute("role","group");d.setAttribute("aria-label","Iluminación al pasar el cursor");
d.innerHTML='<button type="button" class="gl-sw" role="switch" aria-checked="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg><span class="l">Brillo al pasar</span><span class="gl-t" aria-hidden="true"></span></button>'
+'<label class="gl-rng"><span>Intensidad</span><output>100%</output><input type="range" min="10" max="100" step="5" aria-label="Intensidad del brillo"></label>'
+'<button type="button" class="gl-rs"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/></svg><span class="l">Restablecer orden de Inicio</span></button>';
var sw=d.querySelector(".gl-sw"),rg=d.querySelector("input"),out=d.querySelector("output"),rs=d.querySelector(".gl-rs"),lb=rs.querySelector(".l"),tm;
function sync(){sw.setAttribute("aria-checked",st.on);rg.value=st.lv;out.textContent=st.lv+"%";rg.setAttribute("aria-valuetext",st.on?st.lv+"%":"Apagado");if(st.on)d.removeAttribute("data-off");else d.setAttribute("data-off","")}
sw.addEventListener("click",function(){st.on=!st.on;apply();save();sync()});
rg.addEventListener("input",function(){st.lv=Math.max(10,Math.min(100,Math.round(+rg.value)||100));st.on=true;apply();save();sync()});
rs.addEventListener("click",function(){var a=window.__esanInicio;if(a&&a.reset)a.reset(true);clearTimeout(tm);lb.textContent="Orden restablecido";tm=setTimeout(function(){lb.textContent="Restablecer orden de Inicio"},1800)});
sync();return d}
function ensure(){var m=document.getElementById("menu");if(!m||m.querySelector(".gl"))return;var c=ctl(),tg=m.querySelector(".tg");if(tg)tg.insertAdjacentElement("afterend",c);else m.insertBefore(c,m.firstChild)}
function boot(){var m=document.getElementById("menu");if(!m)return;ensure();new MutationObserver(ensure).observe(m,{childList:true})}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
window.__esanBrillo={get:function(){return{on:st.on,lv:st.lv}},set:function(o){if(o&&"on"in o)st.on=!!o.on;if(o&&+o.lv>=10&&+o.lv<=100)st.lv=Math.round(+o.lv);apply();save();var g=document.querySelector("#menu .gl");if(g){g.remove();ensure()}}}
})()
 })();
 (function(){
var OK="esan-inicio-orden-v1",BLK=["hero","hoy","stats","notas","racha","semestre","panel"],DK="esan-diagnostico-v1",MIN=10.5,nv="notas",DEF=[["Evaluación continua",30],["Examen parcial",30],["Examen final",40]],MES=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"],intro=true,pal,sel=0,list=[],prev;
var E=function(){return api},$=function(s,r){return(r||document).querySelector(s)},scoped=function(k){var a=E();return k+":"+(a&&a.x&&a.x.user&&a.x.user.id||"guest")};
var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};
var norm=function(s){return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()};
var lima=function(d){return new Date(d||Date.now()).toLocaleDateString("en-CA",{timeZone:"America/Lima"})};
var limaT=function(){return new Date().toLocaleTimeString("en-GB",{timeZone:"America/Lima",hour:"2-digit",minute:"2-digit",hour12:false})};
var addD=function(k,n){var d=new Date(k+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
var diff=function(a,b){return Math.round((new Date(a+"T12:00:00Z")-new Date(b+"T12:00:00Z"))/864e5)};
var fm=function(v){v=Math.round(v);return v>=60?Math.floor(v/60)+" h"+(v%60?" "+v%60+" min":""):v+" min"};
var ago=function(n){return n<=0?"hoy":n===1?"ayer":"hace "+n+" días"};
var occ=function(ev,k){var a=ev.date||ev.start_date,b=ev.end_date||a;if(!a||k<a)return false;if(ev.repeat_rule==="weekly")return(!ev.repeat_until||k<=ev.repeat_until)&&diff(k,a)%7===0;return k<=b};
var S=function(){var e=E();return(e&&e.st)||{}};
var RM=function(){return matchMedia("(prefers-reduced-motion:reduce)").matches};
var live$;function say(t){if(!live$||!live$.isConnected){live$=document.createElement("div");live$.className="hw-live";live$.setAttribute("role","status");live$.setAttribute("aria-live","polite");document.body.appendChild(live$)}live$.textContent="";setTimeout(function(){live$.textContent=t},30)}
function pos(w){var a=[].filter.call(w.parentNode.children,function(c){return c.classList.contains("hw")});return"Bloque «"+(w.dataset.n||w.dataset.w)+"» en posición "+(a.indexOf(w)+1)+" de "+a.length}
function stored(){var a=[];try{a=JSON.parse(localStorage.getItem(scoped(OK)))}catch(x){}return Array.isArray(a)?a.filter(function(i,k){return BLK.indexOf(i)>=0&&a.indexOf(i)===k}):[]}
function resetOrder(inPlace){try{localStorage.removeItem(scoped(OK))}catch(x){}var h=$(".h-home");if(h&&h.dataset.hw){var foot=$(":scope>.h-foot",h);BLK.forEach(function(i){var w=$(':scope>.hw[data-w="'+i+'"]',h);if(w)h.insertBefore(w,foot||null)});say("Orden de Inicio restablecido");return true}if(!inPlace){var e=E();e&&e.nav("Inicio")}return false}
window.__esanInicio={reset:resetOrder};
function mins(){var m={};(S().focus||[]).forEach(function(f){if(f.ended_at&&f.studied_seconds>0){var k=lima(f.ended_at);m[k]=(m[k]||0)+f.studied_seconds/60}});return m}
function face(m){var p=m==="h"?"M8 14c1 1.6 2.4 2.4 4 2.4s3-.8 4-2.4":m==="w"?"M8 16.5c1-1.5 2.4-2 4-2s3 .5 4 2":"M8.5 15.5h7";return'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="'+p+'"/><circle cx="9" cy="10" r=".6"/><circle cx="15" cy="10" r=".6"/></svg>'}

function hoyHTML(){
var e=E(),s=S(),t=lima(),now=limaT(),m=mins(),ev=s.calendar_events||[],tk=s.calendar_tasks||[];
if(s.calendarLoading)return '<div><h3 class="cap">Hoy</h3><div class="big">Consultando tu calendario…</div></div><div><h3>Pendientes de la semana</h3><small>Un momento.</small></div><div><h3>Repasa hoy</h3><small>Preparando tu actividad.</small></div>';if(s.calendarError)return '<div><h3 class="cap">Hoy</h3><div class="big">Calendario no disponible</div><small><button class="lnk" data-cx="go" data-go="Calendario/Horarios">Revisar calendario</button></small></div><div><h3>Pendientes de la semana</h3><small>No pudimos consultar tus tareas.</small></div><div><h3>Repasa hoy</h3><small>Inténtalo de nuevo desde Calendario/Horarios.</small></div>';
var td=ev.filter(function(x){return occ(x,t)}).sort(function(a,b){return(a.start_time||"99").localeCompare(b.start_time||"99")});
var cur=td.filter(function(x){return x.start_time&&x.start_time<=now&&(!x.end_time||x.end_time>now)})[0];
var nx=cur||td.filter(function(x){return x.start_time&&x.start_time>now})[0]||td.filter(function(x){return!x.start_time})[0];
var dl=new Date().toLocaleDateString("es-PE",{weekday:"long",day:"numeric",month:"long",timeZone:"America/Lima"});
var A=nx?'<div class="big">'+esc(nx.title)+'</div><small>'+(cur?"En curso · hasta "+esc(nx.end_time||"el final del día"):nx.start_time?"Hoy · "+esc(nx.start_time)+(nx.end_time?" – "+esc(nx.end_time):""):"Hoy · todo el día")+(nx.location?" · "+esc(nx.location):"")+'</small>':'<div class="big">Sin clases pendientes hoy</div><small>Buen momento para adelantar un curso.</small>';
var due=[];tk.forEach(function(k){if(!k.completed&&k.due_date&&diff(k.due_date,t)<=7)due.push({n:k.title,d:diff(k.due_date,t)})});
for(var i=0;i<=7;i++){(function(k,i){ev.forEach(function(x){if(/examen|entrega/.test(x.event_type||"")&&occ(x,k))due.push({n:x.title,d:i})})})(addD(t,i),i)}
due.sort(function(a,b){return a.d-b.d});
var B=due.length?'<ul>'+due.slice(0,4).map(function(x){return'<li><span class="dd'+(x.d<=1?" u":"")+'">'+(x.d<0?"Atrasada":x.d===0?"Hoy":x.d===1?"Mañana":x.d+" d")+'</span><span>'+esc(x.n)+'</span></li>'}).join("")+'</ul>':'<div class="big">Todo al día</div><small>Sin entregas ni exámenes en los próximos 7 días.</small>';
var act=[];try{act=e.data().active||[]}catch(x){}
var last={};(s.focus||[]).forEach(function(f){if(f.course_id&&f.ended_at){var d=lima(f.ended_at);if(!last[f.course_id]||d>last[f.course_id])last[f.course_id]=d}});
var pick=act.slice().sort(function(a,b){return(last[a.id]||"0")<(last[b.id]||"0")?-1:1})[0];
var done=m[t]||0,over=due.filter(function(x){return x.d<0}).length,mood=done>=1?"h":over?"w":"n";
var msg=done>=1?"Hoy ya sumaste "+fm(done)+". ¡Buen ritmo!":over?"Tienes "+over+(over>1?" tareas atrasadas":" tarea atrasada")+". Un bloque corto ayuda.":"Un bloque corto hoy mantiene tu racha.";
var C=(pick?'<div class="big">'+esc(pick.n)+'</div><small>'+(last[pick.id]?"Última sesión: "+ago(diff(t,last[pick.id])):"Aún sin sesiones de estudio")+'</small>':'<div class="big">Elige tus cursos</div><small>Marca tus cursos matriculados en la malla para recibir sugerencias.</small>')+'<div class="mood">'+face(mood)+'<span>'+esc(msg)+'</span></div><div class="hoy-a"><button class="h-btn primary" data-cx="go" data-go="Mod Focus">Iniciar Focus</button><button class="h-btn" data-cx="ev">Nuevo evento</button></div>';
return'<div><h3 class="cap">Hoy · '+esc(dl)+'</h3>'+A+'</div><div><h3>Pendientes de la semana</h3>'+B+'</div><div><h3>Repasa hoy</h3>'+C+'</div>'}

function heatHTML(){
if(S().focusLoading)return '<div class="rh"><h3 class="bt">Constancia</h3></div><p class="h-muted">Consultando tu historial de estudio…</p>';
var m={},t=lima(),W=26,any=false;
m=mins();any=Object.keys(m).length>0
var mon=addD(t,-((new Date(t+"T12:00:00Z").getUTCDay()+6)%7)),start=addD(mon,-(W-1)*7),cells="",labs="",best=0,wk=0;
for(var w=0;w<W;w++){var d0=addD(start,w*7);if(+d0.slice(8)<=7)labs+='<span style="grid-column:'+(w+1)+'">'+MES[+d0.slice(5,7)-1]+'</span>';
for(var d=0;d<7;d++){var k=addD(d0,d);if(k>t){cells+='<i class="e"></i>';continue}var v=Math.round(m[k]||0),lv=v<1?0:v<25?1:v<50?2:v<90?3:4;if(v>best)best=v;if(k>=mon)wk+=v;
cells+='<i class="l'+lv+(k===t?" t":"")+'" style="--w:'+w+'" title="'+(+k.slice(8))+" "+MES[+k.slice(5,7)-1]+" · "+(v?fm(v):"sin estudio")+'"></i>'}}
var sk=0,q=t;if(!(m[q]>=1))q=addD(q,-1);while(m[q]>=1){sk++;q=addD(q,-1)}
var note=S().focusError?'No pudimos consultar el historial de Mod Focus.':!any?'Cada sesión registrada en Mod Focus enciende un cuadro.':'Los minutos se suman por día de estudio.';
var flame='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.200 1 2 2 2 0-3-.5-5 1-8z"/></svg>';
return'<div class="rh"><h3 class="bt">'+flame+'Constancia <small>últimos 6 meses</small></h3><div class="rch"><span>Racha <b>'+sk+(sk===1?" día":" días")+'</b></span><span>Esta semana <b>'+fm(wk)+'</b></span><span>Mejor día <b>'+fm(best)+'</b></span></div></div><div class="hm"><div class="hmm">'+labs+'</div><div class="hmg">'+cells+'</div></div><div class="hml"><span>'+note+'</span><span class="lg">Menos<i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>Más</span></div>'}

function save(h){try{var cur=[].map.call(h.querySelectorAll(":scope>.hw"),function(w){return w.dataset.w}),old=stored(),all=old.concat(BLK.filter(function(i){return old.indexOf(i)<0})),slots=[];
all.forEach(function(i,k){if(cur.indexOf(i)>=0)slots.push(k)});cur.forEach(function(id,n){all[slots[n]]=id});localStorage.setItem(scoped(OK),JSON.stringify(all))}catch(e){}}
function shift(w,fn){var sb=[].filter.call(w.parentNode.children,function(c){return c!==w&&c.classList.contains("hw")}),b=sb.map(function(s){return s.getBoundingClientRect().top}),wt=w.getBoundingClientRect().top;fn();var dr=w.getBoundingClientRect().top-wt;sb.forEach(function(s,i){var d=b[i]-s.getBoundingClientRect().top;if(d&&!RM())s.animate([{transform:"translateY("+d+"px)"},{transform:"none"}],{duration:320,easing:"cubic-bezier(.34,1.4,.64,1)"})});return dr}
function enhance(){
var h=$(".h-home");if(!h||h.dataset.hw)return;h.dataset.hw=1;var e=E(),f=document.activeElement,live=e&&e.x&&e.x.mode==="live",foot=$(":scope>.h-foot",h),it={},q=function(s){return $(s,h)};
function wrap(id,name,nodes){nodes=nodes.filter(Boolean);if(!nodes.length)return;var w=document.createElement("div");w.className="hw";w.dataset.w=id;w.dataset.n=name;
w.innerHTML='<button class="w-grip" type="button" aria-label="Mover bloque «'+name+'». Arrastra, o usa las flechas arriba y abajo." title="Arrastra para reordenar"><svg width="18" height="8" viewBox="0 0 18 8" fill="currentColor"><circle cx="3" cy="2" r="1.3"/><circle cx="9" cy="2" r="1.3"/><circle cx="15" cy="2" r="1.3"/><circle cx="3" cy="6" r="1.3"/><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/></svg></button>';nodes.forEach(function(n){w.appendChild(n)});it[id]=w}
var mk=function(c,html){var d=document.createElement("section");d.className=c;d.innerHTML=html;return d};
var hoy,rac,nts;if(live){try{var hh=hoyHTML();hoy=mk("blk hoy",hh);hoy.__h=hh}catch(x){}try{rac=mk("blk racha"+(intro?" in":""),heatHTML())}catch(x){}try{nts=mk("blk notas"+(intro?" in":""),notasHTML())}catch(x){}}
wrap("hero","Bienvenida",[q(".h-hero")]);wrap("hoy","Hoy",[hoy]);wrap("stats","Resumen",[q(".h-summary")]);wrap("notas","Calificaciones",[nts]);wrap("racha","Constancia",[rac]);wrap("semestre","Semestre actual",[q(".h-enrollment")]);wrap("panel","Mi panel",[q(".h-tabs"),q("#h-panel")]);
var def=BLK,sv=stored();
sv.filter(function(i){return it[i]}).concat(def.filter(function(i){return it[i]&&sv.indexOf(i)<0})).forEach(function(i){h.insertBefore(it[i],foot||null)});
if(f&&f!==document.body&&h.contains(f)&&document.activeElement!==f)f.focus({preventScroll:true});
if(intro)setTimeout(function(){intro=false},1800)}
new MutationObserver(function(){if(!$(".h-home"))intro=true;enhance()}).observe($("#page"),{childList:true});enhance();

document.addEventListener("pointerdown",function(ev){var g=ev.target.closest&&ev.target.closest(".w-grip");if(!g||ev.button>0||ev.isPrimary===false||g.__drag)return;ev.preventDefault();
var w=g.parentNode,h=w.parentNode,pg=$("#page"),y0=ev.clientY,ly=ev.clientY,s0=pg.scrollTop,pid=ev.pointerId,raf=0,done=false,moved=false,tr=function(){return"translateY("+(ly-y0+pg.scrollTop-s0)+"px) scale(1.01)"};
w.classList.add("drag");g.__drag=1;try{g.setPointerCapture(pid)}catch(x){}
function tick(){raf=0;if(done)return;if(!w.isConnected||!g.isConnected){stop(true);return}
var pr=pg.getBoundingClientRect(),z=70,sp=0;if(ly<pr.top+z)sp=-Math.ceil((pr.top+z-ly)/z*16);else if(ly>pr.bottom-z)sp=Math.ceil((ly-(pr.bottom-z))/z*16);if(sp){var t0=pg.scrollTop;pg.scrollTop+=sp;if(pg.scrollTop!==t0)moved=true}
w.style.transform=tr();
var r=w.getBoundingClientRect(),c=r.top+r.height/2,n=w.nextElementSibling,p=w.previousElementSibling;
if(n&&n.classList.contains("hw")&&c>n.getBoundingClientRect().top+n.offsetHeight/2){y0+=shift(w,function(){h.insertBefore(w,n.nextSibling)});moved=true;w.style.transform=tr()}
else if(p&&p.classList.contains("hw")&&c<p.getBoundingClientRect().top+p.offsetHeight/2){y0+=shift(w,function(){h.insertBefore(w,p)});moved=true;w.style.transform=tr()}
raf=requestAnimationFrame(tick)}
function mv(e){if(e.pointerId!==pid)return;ly=e.clientY;if(!raf)raf=requestAnimationFrame(tick)}
function stop(lost){if(done)return;done=true;cancelAnimationFrame(raf);g.__drag=0;g.removeEventListener("pointermove",mv);g.removeEventListener("pointerup",up);g.removeEventListener("pointercancel",up);g.removeEventListener("lostpointercapture",up);removeEventListener("keydown",esc,true);try{g.releasePointerCapture(pid)}catch(x){}
var c=w.style.transform;w.style.transform="";w.classList.remove("drag");if(c&&!lost&&!RM())w.animate([{transform:c},{transform:"none"}],{duration:380,easing:"cubic-bezier(.34,1.4,.64,1)"});
if(w.isConnected){save(h);if(moved)say(pos(w))}}
function up(e){if(e&&e.pointerId!==undefined&&e.pointerId!==pid)return;stop(false)}
function esc(e){if(e.key==="Escape"){e.preventDefault();e.stopPropagation();stop(false)}}
g.addEventListener("pointermove",mv);g.addEventListener("pointerup",up);g.addEventListener("pointercancel",up);g.addEventListener("lostpointercapture",up);addEventListener("keydown",esc,true);raf=requestAnimationFrame(tick)});
document.addEventListener("keydown",function(ev){var g=ev.target.closest&&ev.target.closest(".w-grip");if(!g||ev.altKey||ev.ctrlKey||ev.metaKey||ev.shiftKey||(ev.key!=="ArrowUp"&&ev.key!=="ArrowDown"))return;ev.preventDefault();var w=g.parentNode,h=w.parentNode,p=w.previousElementSibling,n=w.nextElementSibling;
if(ev.key==="ArrowUp"&&p&&p.classList.contains("hw"))shift(w,function(){h.insertBefore(w,p)});else if(ev.key==="ArrowDown"&&n&&n.classList.contains("hw"))shift(w,function(){h.insertBefore(w,n.nextSibling)});else{say(pos(w)+(ev.key==="ArrowUp"?". Ya está al inicio.":". Ya está al final."));return}
g.focus({preventScroll:true});w.scrollIntoView({block:"nearest"});save(h);say(pos(w))});

function cmds(){var e=E(),a=[];if(!e)return a;
(e.nav_items||[]).forEach(function(it){a.push({l:it.n,h:"Sección",i:it.i,f:function(){e.nav(it.n)}});(it.kids||[]).forEach(function(k){a.push({l:k[0],h:it.n,i:k[1],f:function(){e.nav(k[0],it.n)}})})});
[["graficos","Gráficos","trend"],["ponderado","Ponderados","cap"],["stats","Estadísticas","listc"],["logros","Logros","sparkles"],["historia","Historia","clock"]].forEach(function(t){a.push({l:"Ver "+t[1].toLowerCase(),h:"Inicio",i:t[2],f:function(){e.nav("Inicio");var b=document.getElementById("h-tab-"+t[0]);b&&b.click()}})});
a.push({l:"Ver mis calificaciones",h:"Inicio",i:"cap",f:function(){goN("notas")}},{l:"Diagnóstico: ¿qué nota necesito para aprobar?",h:"Inicio",i:"target",f:function(){goN("diag")}},{l:"Nuevo evento en el calendario",h:"Acción",i:"plus",f:newEv},{l:"Iniciar sesión de estudio",h:"Mod Focus",i:"target",f:function(){e.nav("Mod Focus")}},{l:"Cambiar tema claro u oscuro",h:"Acción",i:"sparkles",f:function(){var b=$('#menu .tgb[aria-checked="false"]');b&&b.click()}},{l:"Restablecer el orden de Inicio",h:"Acción",i:"home",f:function(){resetOrder(false)}});
try{e.courses().forEach(function(c){a.push({c:1,l:c.n,h:"Curso · ciclo "+c.c,i:"library",f:function(){e.nav("Malla Curricular")}})})}catch(x){}return a}
function newEv(){E().nav("Calendario/Horarios");var n=0,t=setInterval(function(){var b=$(".mk");if(b||++n>25){clearInterval(t);b&&b.click()}},120)}
function paint(){var ul=$("ul",pal);ul.innerHTML=list.length?list.map(function(c,i){return'<li role="option" id="cmdk-o'+i+'" data-i="'+i+'"'+(i===sel?' class="on" aria-selected="true"':"")+'><span class="ci">'+E().icon(c.i||"sparkles",18)+'</span><span>'+esc(c.l)+'</span><small>'+esc(c.h)+'</small></li>'}).join(""):'<li class="no">Sin resultados</li>';var on=$("li.on",ul),ip=$("input",pal);on&&on.scrollIntoView({block:"nearest"});if(ip){if(on)ip.setAttribute("aria-activedescendant",on.id);else ip.removeAttribute("aria-activedescendant")}}
function filt(q){var t=norm(q).split(/\s+/).filter(Boolean);list=cmds().filter(function(c){return!c.c||t.length}).map(function(c){var hs=norm(c.l+" "+c.h),sc=0;for(var i=0;i<t.length;i++){var p=hs.indexOf(t[i]);if(p<0)return null;sc+=p}return{c:c,s:sc}}).filter(Boolean).sort(function(a,b){return a.s-b.s}).slice(0,40).map(function(x){return x.c});sel=0;paint()}
function close(){if(!pal)return;pal.remove();pal=null;prev&&prev.focus&&prev.focus()}
function run(i){var c=list[i];if(!c)return;close();setTimeout(c.f,0)}
function open(){if(pal)return close();if(!E())return;prev=document.activeElement;pal=document.createElement("div");pal.className="cmdk";
pal.innerHTML='<div role="dialog" aria-modal="true" aria-label="Buscador de comandos"><input type="text" role="combobox" aria-expanded="true" aria-controls="cmdk-l" aria-autocomplete="list" placeholder="Busca una sección, un curso o una acción…" aria-label="Buscar" autocomplete="off" spellcheck="false"><ul role="listbox" id="cmdk-l"></ul><footer><span>↑↓ navegar</span><span>↵ abrir</span><span>esc cerrar</span></footer></div>';document.body.appendChild(pal);
var inp=$("input",pal);inp.addEventListener("input",function(){filt(inp.value)});
inp.addEventListener("keydown",function(e){if(e.isComposing)return;if(e.key==="Tab"){e.preventDefault();return}if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(list.length){sel=(sel+(e.key==="ArrowDown"?1:-1)+list.length)%list.length;paint()}}else if(e.key==="Enter"){e.preventDefault();run(sel)}else if(e.key==="Escape"){e.preventDefault();close()}});
pal.addEventListener("pointerdown",function(e){if(e.target===pal)close()});$("ul",pal).addEventListener("click",function(e){var l=e.target.closest("li[data-i]");l&&run(+l.dataset.i)});
$("ul",pal).addEventListener("pointermove",function(e){var l=e.target.closest("li[data-i]");if(l&&+l.dataset.i!==sel){sel=+l.dataset.i;[].forEach.call($("ul",pal).children,function(x){x.classList.toggle("on",x===l);if(x===l)x.setAttribute("aria-selected","true");else x.removeAttribute("aria-selected")});$("input",pal).setAttribute("aria-activedescendant",l.id)}});filt("");inp.focus()}
addEventListener("keydown",function(e){if(e.key==="Escape"&&pal){e.preventDefault();e.stopPropagation();close();return}if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key&&e.key.toLowerCase()==="k"){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)open()}},true);
var pf=$("#top .pf");if(pf){var b=document.createElement("button");b.className="cmdk-btn";b.type="button";b.setAttribute("aria-label","Abrir buscador de comandos");b.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><span>Buscar</span><kbd>'+(/Mac|iPhone|iPad/.test(navigator.platform)?"⌘K":"Ctrl K")+'</kbd>';b.addEventListener("click",open);pf.parentNode.insertBefore(b,pf)}
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-cx]");if(!b)return;var k=b.dataset.cx;if(k==="go")E().nav(b.dataset.go);else if(k==="ev")newEv();});
function nf(v){return String(Math.round(v*100)/100).replace(".",",")}
function dget(){try{return JSON.parse(localStorage.getItem(scoped(DK)))||{}}catch(e){return{}}}
function dset(d){try{localStorage.setItem(scoped(DK),JSON.stringify(d))}catch(e){}}
function plan(D,id){return(D.p&&D.p[id])||DEF.map(function(r){return{n:r[0],w:r[1],s:null}})}
function rowsOf(c){return[].map.call(c.querySelectorAll(".dr"),function(r){var s=r.querySelector(".ds").value;return{n:r.querySelector(".dn").value,w:Math.max(0,+r.querySelector(".dw").value||0),s:s===""||!isFinite(s)?null:Math.min(20,Math.max(0,+s))}})}
function calc(rows,T){var W=0,Wd=0,A=0,n=0;rows.forEach(function(r){var w=+r.w||0;W+=w;if(r.s!=null&&isFinite(r.s)){Wd+=w;A+=w*r.s}else n++});var Wr=W-Wd,o={W:W,Wr:Wr,n:n};
if(!W){o.k="empty";return o}if(Wr<=0){o.k="final";o.f=A/W;return o}
var need=(T*W-A)/Wr;o.mx=(A+20*Wr)/W;o.need=need;o.nd=Math.ceil(need*10-1e-9)/10;o.k=need<=0?"safe":need>20?"lost":"need";return o}
function resHTML(rows,T){var o=calc(rows,T),t=nf(T),wn=o.W&&Math.abs(o.W-100)>.01?'<small class="wn">Los pesos suman '+nf(o.W)+'%; deberían sumar 100%. Se calcula en proporción.</small>':"";
if(o.k==="empty")return"Agrega al menos una evaluación con su peso.";
if(o.k==="final")return'Nota final: <b>'+nf(o.f)+'</b> · '+(o.f>=T?"cumples tu objetivo de "+t:"no llegas a "+t)+wn;
if(o.k==="safe")return'<b>Mínimo asegurado.</b> Aun con 0 en lo que falta ya llegas a '+t+'.'+wn;
if(o.k==="lost")return'<b>Fuera de alcance.</b> Con 20 en todo lo que falta llegarías a '+nf(o.mx)+', menos de '+t+'.'+wn;
var lv=o.nd<=12?"Alcanzable":o.nd<=15?"Exigente":"Muy exigente";
return'Necesitas promediar <b>'+nf(o.nd)+'</b> en el '+Math.round(o.Wr/o.W*100)+'% restante'+(o.n===1?" (la evaluación que te falta)":"")+'. <span class="h-muted">'+lv+'</span><div class="bar"><i style="width:'+Math.min(100,o.nd/20*100)+'%"></i></div>'+wn}
function rowsHTML(rows){return rows.map(function(r){return'<div class="dr"><input class="dn" value="'+esc(r.n)+'" aria-label="Nombre de la evaluación"><label><span>Peso %</span><input class="dw" type="number" min="0" max="100" step="5" value="'+r.w+'"></label><label><span>Nota</span><input class="ds" type="number" min="0" max="20" step="0.1" placeholder="—" value="'+(r.s==null?"":r.s)+'"></label><button type="button" class="dx" data-cx="delev" aria-label="Quitar evaluación">×</button></div>'}).join("")}
function diagHTML(d,T){var D=dget();if(!d.active.length)return'<p class="h-muted">Aún no tienes cursos matriculados. Márcalos en la <button class="lnk" data-cx="go" data-go="Malla Curricular">Malla Curricular</button> para diagnosticarlos.</p>';
return'<div class="dgt"><label>Nota que buscas <input id="dg-t" type="number" min="0" max="20" step="0.5" value="'+T+'"></label><span class="h-muted">Se calcula en tu navegador y se guarda solo en este equipo.</span></div><div class="dgl">'+d.active.map(function(c){var rows=plan(D,c.id);return'<article class="dg" data-id="'+esc(c.id)+'"><header><b>'+esc(c.n)+'</b><small>'+nf(c.cr)+' créditos</small></header><div class="dgr">'+rowsHTML(rows)+'</div><button type="button" class="lnk" data-cx="addev">+ Agregar evaluación</button><div class="dres" aria-live="polite">'+resHTML(rows,T)+'</div></article>'}).join("")+'</div>'}
function misNotas(d,X,T){var g=X.grades||{},by={},D=dget();
d.courses.forEach(function(c){var gr=g[c.id],st=(X.statuses[c.id]||{}).status,has=Number.isFinite(gr)&&(X.done.has(c.id)||st==="desaprobado"),act=d.active.some(function(a){return a.id===c.id});if(has||act)(by[c.c]=by[c.c]||[]).push({c:c,g:has?gr:null,a:act&&!has})});
var ch=function(l,v){return'<span>'+l+' <b>'+v+'</b></span>'},cs=Object.keys(by).map(Number).sort(function(a,b){return b-a});
var sum='<div class="rch ns">'+ch("Ponderado",d.weighted==null?"—":nf(d.weighted))+ch("Promedio",d.simple==null?"—":nf(d.simple))+ch("Mejor nota",d.grades.length?nf(Math.max.apply(null,d.grades)):"—")+ch("Aprobados",d.passed+"/"+d.grades.length)+ch("Créditos",nf(d.approvedCredits)+"/"+d.total)+'</div>';
if(!cs.length)return sum+'<p class="h-muted">Aún no hay notas registradas. Agrégalas desde «Editar notas».</p>';
return sum+cs.map(function(c,i){var L=by[c],gs=L.filter(function(r){return r.g!=null}).map(function(r){return r.g}),av=gs.length?nf(gs.reduce(function(a,b){return a+b},0)/gs.length):"";
return'<details class="cy"'+(i===0?" open":"")+'><summary><span>Ciclo '+c+'</span><small>'+(av?"promedio "+av:"en curso")+'</small></summary>'+L.map(function(r){var right,bar="";
if(r.g!=null){var no=r.g<MIN;bar='<i class="'+(no?"no":"")+'" style="width:'+r.g/20*100+'%"></i>';right='<span class="nv'+(no?" no":"")+'">'+nf(r.g)+'</span>'}
else{var rw=D.p&&D.p[r.c.id],o=rw&&calc(rw,D.t||MIN);right=o?'<span class="nv"><small>'+(o.k==="final"?"Final "+nf(o.f):o.k==="safe"?"Aprobado asegurado":o.k==="lost"?"Fuera de alcance":o.k==="need"?"Necesitas "+nf(o.nd):"En curso")+'</small></span>':'<button type="button" class="lnk" data-cx="todiag">Diagnosticar</button>'}
return'<div class="nr"><div><b>'+esc(r.c.n)+'</b><small>'+nf(r.c.cr)+' créditos'+(r.a?" · en curso":"")+'</small></div><div class="nbar">'+bar+'</div>'+right+'</div>'}).join("")+'</details>'}).join("")}
function notasHTML(){var e=E(),T=dget().t||MIN,d=e.data();
return'<div class="rh"><h3 class="bt">'+e.icon("cap",18)+'Calificaciones</h3><div class="seg2"><button type="button" class="'+(nv==="notas"?"on":"")+'" data-cx="nv" data-v="notas">Mis notas</button><button type="button" class="'+(nv==="diag"?"on":"")+'" data-cx="nv" data-v="diag">Diagnóstico</button></div>'+(nv==="notas"?'<button type="button" class="lnk" data-cx="tab" data-t="ponderado">Editar notas</button>':"")+'</div>'+(nv==="diag"?diagHTML(d,T):misNotas(d,e.x,T))}
function goN(v){nv=v;E().nav("Inicio");setTimeout(function(){var w=$('.hw[data-w="notas"]');w&&w.scrollIntoView({behavior:"smooth",block:"start"})},90)}
document.addEventListener("click",function(ev){var b=ev.target.closest&&ev.target.closest("[data-cx]");if(!b)return;var k=b.dataset.cx,r=$(".notas");
if(k==="nv"||k==="todiag"){nv=k==="nv"?b.dataset.v:"diag";if(r){r.innerHTML=notasHTML();var nb=$('[data-cx="nv"][data-v="'+nv+'"]',r);nb&&nb.focus({preventScroll:true})}}
else if(k==="tab"){var t=document.getElementById("h-tab-"+b.dataset.t);t&&t.click()}
else if(k==="addev"||k==="delev"){var c=b.closest(".dg"),rows=rowsOf(c);if(k==="addev")rows.push({n:"Evaluación",w:0,s:null});else rows.splice([].indexOf.call(c.querySelectorAll(".dr"),b.closest(".dr")),1);var d=dget();d.p=d.p||{};d.p[c.dataset.id]=rows;dset(d);c.querySelector(".dgr").innerHTML=rowsHTML(rows);c.querySelector(".dres").innerHTML=resHTML(rows,d.t||MIN)}});
document.addEventListener("input",function(e){var c=e.target.closest&&e.target.closest(".dg"),isT=e.target.id==="dg-t";if(!c&&!isT)return;var d=dget();
if(isT){var v=parseFloat(String(e.target.value).replace(",","."));d.t=isFinite(v)?Math.min(20,Math.max(0,v)):MIN;dset(d);[].forEach.call(document.querySelectorAll(".dg"),function(k){k.querySelector(".dres").innerHTML=resHTML(rowsOf(k),d.t)});return}
var rows=rowsOf(c);d.p=d.p||{};d.p[c.dataset.id]=rows;dset(d);c.querySelector(".dres").innerHTML=resHTML(rows,d.t||MIN)});
setInterval(function(){var d=$(".hoy");if(!d||document.hidden||d.contains(document.activeElement)||$(".hw.drag"))return;try{var n=hoyHTML();if(d.__h!==n){d.__h=n;d.innerHTML=n}}catch(x){}},60000)

 })();
}
