import { NAV, TABS, resolveRoute, validRoute } from './navigation.js';
import { ESAN } from '../institutions/esan/config.js';
import { loadCurriculum } from '../institutions/registry.js';
import { FOCUS_PRESETS, enrolledFocusCourses, focusRemaining, focusDuration, focusMotivation, focusError, todayLima } from '../features/focus/focusModel.js';
import { getSupabaseClient } from '../shared/lib/getSupabaseClient.js';
import { createWebSessionGuard, webAuthStorageKey } from '../shared/lib/webSession.js';
import { CARRERAS } from '../institutions/esan/carreras.js';
import { CAREER_KEYS, careerLabel } from '../institutions/esan/careerOptions.js';
import { LOGROS } from '../features/home/logros.js';
import { buildMalla, validPlan } from '../core/academic/curriculumGraph.js';
import { createWebNavigation } from '../shared/lib/webNavigation.js';
import { mountHomeEnhancements, mountSemesterGrades } from '../features/home/homeEnhancements.js';
import { homeCompanion, mountHomeCompanion } from '../features/home/homeCompanion.js';
import { lyraLogo } from '../shared/lib/lyraBrand.js';
import './SidebarMotion.css';

const I={
home:'<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
inbox:'<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
minus:'<path d="M5 12h14"/>',
spark:'<path d="M12 2c.6 5.2 4.8 9.4 10 10-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10z" fill="currentColor"/>',
cap:'<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
cal:'<path d="M8 2v4M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
sparkles:'<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>',
help:'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
trend:'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
phone:'<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
teach:'<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
landmark:'<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
gamepad:'<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z"/>',
logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
railc:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
x:'<path d="M18 6 6 18M6 6l12 12"/>',
chevl:'<path d="m15 18-6-6 6-6"/>',
chevr:'<path d="m9 18 6-6-6-6"/>',
tick:'<path d="M20 6 9 17l-5-5"/>',
listc:'<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
arrow:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
unlock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
send:'<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
copy:'<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
trash:'<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
compass:'<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
library:'<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'};
const svg=(n,s=24,dot)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}${dot?'<circle cx="18" cy="5" r="3.4" fill="currentColor" stroke="var(--cut)" stroke-width="2"/>':''}</svg>`;

const $=id=>document.getElementById(id),app=$('app'),root=document.documentElement;
const ic=n=>`<span class="ic">${svg(n,20)}</span>`;
let cur='Inicio',kid=null;const ex={};const mqM=matchMedia('(max-width:860px)');

/* Inicio reúne Mi panel. Usa las mismas tablas privadas y los mismos ids de cursos. */
const HOME_TABS=[['graficos','trend','Gráficos'],['ponderado','cap','Ponderados'],['stats','listc','Estadísticas'],['logros','sparkles','Logros'],['historia','clock','Historia']];
const HOME_PASS=ESAN.gradeScale.passing;
const homeEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const homeNum=(n,d=0)=>Number.isFinite(n)?n.toLocaleString('es-PE',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const homeDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleDateString('es-PE',{day:'numeric',month:'short',year:'numeric',timeZone:'America/Lima'})};
const HOME={tab:'graficos',cycle:'all',mode:'loading',user:null,career:'ia',careerDraft:'',done:new Set(),plan:new Set(),grades:{},drafts:{},feedback:{},statuses:{},achievements:{},profile:null,error:'',saving:new Set(),revision:0};
const HOME_WIDGETS={calendar_events:[],calendar_tasks:[],focus:[],calendarLoading:false,focusLoading:false,calendarError:false,focusError:false};
const SEMESTER={tab:'calendar'};
const SETUP={record:null,error:'',unmount:null,opening:false,owner:null,deferred:false,focus:null,background:[]};
let homeClient=null;
try{
 homeClient=getSupabaseClient();
}catch{ /* La vista visitante sigue disponible sin configuración. */ }
function homeCareer(){return HOME.catalog||CARRERAS[HOME.career]||CARRERAS.ia}
function homeCounts(courses=homeCareer().cursos){
 const items=courses.filter(c=>Number.isFinite(HOME.grades[c.id])&&(HOME.done.has(c.id)||HOME.statuses[c.id]?.status==='desaprobado'));
 const weighted=items.filter(c=>c.cr>0),credits=weighted.reduce((s,c)=>s+c.cr,0);
 return {items,credits,weighted:credits?weighted.reduce((s,c)=>s+c.cr*HOME.grades[c.id],0)/credits:null};
}
function homeModel(){
 const career=homeCareer(),courses=career.cursos,all=homeCounts(),done=courses.filter(c=>HOME.done.has(c.id));
 const total=courses.reduce((s,c)=>s+c.cr,0),approvedCredits=done.reduce((s,c)=>s+c.cr,0);
 const cycles=Object.keys(career.ciclos).map(Number).sort((a,b)=>a-b);
 const perCycle=cycles.filter(n=>n!==0).map(n=>({num:n,...homeCounts(courses.filter(c=>c.c===n))})).filter(p=>p.items.length);
 const active=enrolledFocusCourses(courses,HOME.statuses,HOME.done);
 const grades=all.items.map(c=>HOME.grades[c.id]).sort((a,b)=>a-b);
 const median=grades.length?(grades.length%2?grades[Math.floor(grades.length/2)]:(grades[grades.length/2-1]+grades[grades.length/2])/2):null;
 const simple=grades.length?grades.reduce((a,b)=>a+b,0)/grades.length:null;
 const passed=grades.filter(g=>g>=HOME_PASS).length;
 const selected=courses.filter(c=>HOME.cycle==='all'||c.c===Number(HOME.cycle));
 const eligible=selected.filter(c=>HOME.done.has(c.id)||HOME.statuses[c.id]?.status==='desaprobado');
 return {career,courses,total,approvedCredits,done,cycles,perCycle,active,...all,grades,median,simple,passed,eligible,selected:homeCounts(selected)};
}
function homeReset(mode='guest',clearFocus=true){
 setupClose(false);SETUP.record=null;SETUP.error='';SETUP.owner=null;
 if(clearFocus)SETUP.deferred=false;
 HOME.revision++;HOME.mode=mode;HOME.user=null;HOME.career='ia';HOME.catalog=null;HOME.careerDraft='';HOME.profile=null;
 HOME.cycle='all';HOME.done=new Set();HOME.plan=new Set();HOME.grades={};HOME.drafts={};HOME.feedback={};HOME.statuses={};HOME.achievements={};HOME.error='';HOME.saving=new Set();
 HOME_WIDGETS.calendar_events=[];HOME_WIDGETS.calendar_tasks=[];HOME_WIDGETS.focus=[];
 HOME_WIDGETS.calendarLoading=mode==='loading';HOME_WIDGETS.focusLoading=mode==='loading';HOME_WIDGETS.calendarError=false;HOME_WIDGETS.focusError=false;
 if(clearFocus)kReset();
}
function homeRender(){if(['Inicio','Mi carrera','Mi semestre','Grupos de estudio','Mod Focus','Planificar','Asistente','Recursos','Mi IA'].includes(cur))renderPage()}
async function homeLoad(user){
 homeReset('loading',HOME.user?.id!==user.id);HOME.user=user;renderProfile();
 const revision=HOME.revision;
 homeRender();
 try{
  const results=await Promise.all([
   homeClient.from('profiles').select('*').eq('id',user.id).maybeSingle(),
   homeClient.from('progress').select('done, plan').eq('student_id',user.id).maybeSingle(),
   homeClient.from('grades').select('course_id, grade').eq('student_id',user.id),
   homeClient.from('course_status').select('course_id, status, times_taken, passed_at').eq('student_id',user.id),
   homeClient.from('logros').select('logro, earned_at').eq('student_id',user.id)
  ]);
  if(revision!==HOME.revision)return;
  if(results.some(r=>r.error))throw new Error('read_failed');
  const [profile,progress,grades,statuses,achievements]=results.map(r=>r.data);
  if(!profile||!CARRERAS[profile.carrera]){
   HOME.mode=profile?.carrera?'unsupported':'profile';HOME.profile=profile;homeRender();return;
  }
  const catalog=await loadCurriculum(profile.carrera,profile.curriculum_version);
  if(revision!==HOME.revision)return;
  HOME.catalog=catalog;HOME.profile=profile;HOME.career=profile.carrera;HOME.done=new Set(progress?.done||[]);HOME.plan=new Set(progress?.plan||[]);
  for(const row of grades||[]){const value=Number(row.grade);if(row.grade!==null&&Number.isFinite(value)&&value>=0&&value<=20)HOME.grades[row.course_id]=value}
  HOME.statuses=Object.fromEntries((statuses||[]).map(r=>[r.course_id,r]));
  HOME.plan=validPlan(buildMalla(homeCareer()),HOME.plan,HOME.done,HOME.statuses);
  HOME.achievements=Object.fromEntries((achievements||[]).map(r=>[r.logro,r.earned_at]));
  HOME.cycle='all';
  HOME.mode='live';homeRender();
  void homeWidgetLoad(user,revision);
  await setupLoad(user,revision);
 }catch{
  if(revision!==HOME.revision)return;
  HOME.mode='error';HOME.error='No pudimos cargar tu información académica. Reintenta para consultar tus datos.';homeRender();
 }
}
const HOME_EVENT_FIELDS='id,student_id,title,date,start_date,end_date,event_type,start_time,end_time,location,repeat_rule,repeat_until,course_id';
const HOME_TASK_FIELDS='id,student_id,title,due_date,completed';
async function homeWidgetRows(user,table,fields,orderBy,cutoff=''){
 const rows=[];
 for(let offset=0;;offset+=500){
  let query=homeClient.from(table).select(fields).eq('student_id',user.id);
  if(cutoff)query=query.gte(orderBy,cutoff);
  const result=await query.order(orderBy).order('id').range(offset,offset+499);
  if(result.error)return {data:rows,error:result.error};
  rows.push(...(result.data||[]));
  if((result.data||[]).length<500)return {data:rows,error:null};
 }
}
async function homeWidgetLoad(user,revision){
 if(!homeClient||!user)return;
 HOME_WIDGETS.calendarLoading=true;HOME_WIDGETS.focusLoading=true;HOME_WIDGETS.calendarError=false;HOME_WIDGETS.focusError=false;
 if(cur==='Inicio')homeRender();
 try{
  const cutoff=new Date(Date.now()-190*86400000).toISOString();
  const [events,tasks,focus]=await Promise.all([
   homeWidgetRows(user,'calendar_events',HOME_EVENT_FIELDS,'created_at'),
   homeWidgetRows(user,'calendar_tasks',HOME_TASK_FIELDS,'created_at'),
   homeWidgetRows(user,'focus_study_sessions','id,student_id,finished_at,elapsed_seconds','finished_at',cutoff)
  ]);
  if(revision!==HOME.revision||HOME.user?.id!==user.id)return;
  HOME_WIDGETS.calendar_events=events.data||[];HOME_WIDGETS.calendar_tasks=tasks.data||[];
  HOME_WIDGETS.focus=(focus.data||[]).filter(row=>row.finished_at&&Number(row.elapsed_seconds)>0).map(row=>({ended_at:row.finished_at,studied_seconds:Number(row.elapsed_seconds)}));
  HOME_WIDGETS.calendarError=!!events.error||!!tasks.error;HOME_WIDGETS.focusError=!!focus.error;
 }catch{
  if(revision!==HOME.revision||HOME.user?.id!==user.id)return;
  HOME_WIDGETS.calendarError=true;HOME_WIDGETS.focusError=true;
 }finally{
  if(revision===HOME.revision&&HOME.user?.id===user.id){
   HOME_WIDGETS.calendarLoading=false;HOME_WIDGETS.focusLoading=false;if(cur==='Inicio')homeRender();
  }
 }
}

async function setupLoad(user,revision=HOME.revision){
 try{
  const result=await homeClient.from('student_setup').select('draft,preferences,completed_at').eq('student_id',user.id).maybeSingle();
  if(revision!==HOME.revision)return;
  if(result.error)throw result.error;
  SETUP.record=result.data;SETUP.error='';SETUP.owner=user.id;
  if(result.data?.completed_at)setupApply(result.data.preferences);
  if(result.data?.preferences?.semester)HOME.cycle=String(result.data.preferences.semester);
  homeRender();renderProfile();
  if(!result.data?.completed_at&&!SETUP.deferred)setupOpen();
 }catch{if(revision===HOME.revision){SETUP.error='No pudimos cargar la configuración inicial. Reintenta para continuar.';homeRender()}}
}
function setupApply(p={}){
 if(['light','dark'].includes(p.theme)){setTheme(p.theme==='dark');root.dataset.theme=p.theme;syncTg()}
 if(fx.st==='setup'&&!fx.session){if(PN[p.companion])fx.pet=p.companion;if(['p25','p45','p90'].includes(p.method))fx.pre=p.method;if(STY.some(x=>x[0]===p.clockStyle))fx.style=p.clockStyle}
}
function setupClose(restore=true){
 SETUP.unmount?.();SETUP.unmount=null;SETUP.opening=false;
 $('setup-root')?.remove();SETUP.background.forEach(({el,inert})=>el.inert=inert);SETUP.background=[];document.body.style.overflow='';
 if(restore&&SETUP.focus?.isConnected)SETUP.focus.focus({preventScroll:true});
}
async function setupOpen(){
 if(SETUP.opening||SETUP.unmount||HOME.mode!=='live'||HOME.saving.size)return;
 if(SETUP.error||SETUP.owner!==HOME.user.id){await setupLoad(HOME.user);if(!SETUP.error&&!SETUP.record?.completed_at&&SETUP.deferred)setupOpen();return}
 if(SETUP.record?.completed_at)return;
 SETUP.opening=true;const revision=HOME.revision;SETUP.focus=document.activeElement;setMenu(false);
 const container=document.createElement('div');container.id='setup-root';document.body.append(container);
 try{
  const {mountInitialSetup}=await import('../features/onboarding/InitialSetup.jsx');
  if(revision!==HOME.revision||!container.isConnected)return;
  SETUP.background=['page','side','top','mobile-dock','bmod','toast','scrim','arc'].map(id=>$(id)).filter(Boolean).map(el=>({el,inert:el.inert}));SETUP.background.forEach(({el})=>el.inert=true);document.body.style.overflow='hidden';
  SETUP.unmount=mountInitialSetup(container,{client:homeClient,user:HOME.user,career:homeCareer(),saved:SETUP.record,renderPet:key=>pet(key,'idle'),
   onBusy:value=>{if(revision===HOME.revision){if(value)HOME.saving.add('setup');else HOME.saving.delete('setup')}},
   onClose:()=>{SETUP.deferred=true;setupClose();homeRender();setupLoad(HOME.user)},
   onComplete:async preferences=>{HOME.saving.delete('setup');SETUP.deferred=true;setupClose(false);setupApply(preferences);go('Inicio');await homeLoad(HOME.user);$('h-tab-graficos')?.focus({preventScroll:true})}
  });
 }catch{setupClose();SETUP.error='No se pudo abrir la configuración. Reintenta.';homeRender()}
 finally{SETUP.opening=false}
}
async function homeInit(){
 if(!homeClient){homeReset();homeRender();return}
 const revision=HOME.revision;
 try{
  const {data,error}=await homeClient.auth.getSession();
  if(revision!==HOME.revision)return;
  if(error)throw error;
  if(!data.session){homeReset();homeRender();return}
  if(!webSession.restore(data.session))return;
  const verified=await homeClient.auth.getUser();
  if(revision!==HOME.revision)return;
  if(verified.error||!verified.data.user)throw new Error('session_failed');
  if(!webSession.check())return;
  await homeLoad(verified.data.user);
 }catch{
  if(revision!==HOME.revision)return;
  homeReset('error');HOME.error='No pudimos comprobar tu sesión. Reintenta o vuelve a iniciar sesión.';homeRender();
 }
}
async function homeSignOut(){
 if(HOME.saving.size){toast('Espera a que termine el guardado');return}
 if(!await kBeforeSignOut())return;
 if(homeClient){const {error}=await homeClient.auth.signOut();if(error){toast('No se pudo cerrar la sesión. Reintenta.');return}}
 homeReset();setMenu(false);location.replace(new URL('./login.html',location.href).href);
}
function homeEmpty(title,message,action=true){return `<div class="h-state"><h3>${homeEsc(title)}</h3><p>${homeEsc(message)}</p>${action?`<div class="h-state-actions"><a class="h-btn primary" href="./login.html">Iniciar sesión</a></div>`:''}</div>`}
function unsupportedProfile(){return '<section class="blk"><h2 class="bt">Lyra está centrada en ESAN</h2><p>La carrera de esta cuenta ya no forma parte del catálogo activo. Tu registro académico se conserva y puedes descargarlo. Tu cuenta no se ha reasignado a otra carrera.</p><button class="h-btn primary" data-a="hexport">Exportar registro académico</button><p class="h-muted" role="status" id="export-status"></p></section>'}
async function exportAcademicRecord(){
 if(!HOME.user||HOME.saving.has('export'))return;
 const userId=HOME.user.id,revision=HOME.revision;HOME.saving.add('export');
 const status=$('export-status');if(status)status.textContent='Preparando tu registro…';
 try{
  const {readAcademicRecord,downloadAcademicRecord}=await import('../features/account/exportAcademicRecord.js');
  const record=await readAcademicRecord(homeClient,userId);
  const profile=record.profiles?.[0];let catalog=null;
  if(profile&&CARRERAS[profile.carrera]){try{catalog=await loadCurriculum(profile.carrera,profile.curriculum_version)}catch{/* El informe conserva los ids si la versión de la malla no está disponible. */}}
  if(revision!==HOME.revision||HOME.user?.id!==userId)return;
  downloadAcademicRecord(record,catalog);if(status)status.textContent='Informe descargado. Ábrelo en tu navegador para leerlo o guardarlo como PDF.';toast('Informe académico descargado · abre el archivo para verlo');
 }catch{if(revision===HOME.revision){if(status)status.textContent='No se pudo preparar el archivo. Reintenta; tus datos se conservan.';toast('No se pudo exportar. Reintenta.')}}
 finally{if(revision===HOME.revision)HOME.saving.delete('export')}
}
function homeReady(m){
 if(HOME.mode==='loading')return `<div class="h-state" role="status"><h3>Cargando tu avance…</h3><p>Estamos consultando tus notas y tu progreso académico.</p></div>`;
 if(HOME.mode==='error')return homeEmpty('Tu información no está disponible','Tus notas y tu progreso se conservan. Reintenta la carga para verlos.',false);
 if(HOME.mode==='profile')return homeEmpty('Completa tu perfil','Elige tu carrera en tu cuenta para consultar la malla y las estadísticas que te corresponden.',false)+(HOME.profile&&HOME.profile.carrera==null?`<div class="h-state-actions"><label class="h-cycle" for="h-career">Carrera<select id="h-career"${HOME.saving.size?' disabled':''}><option value="">Elige tu carrera</option>${CAREER_KEYS.map(key=>`<option value="${key}"${HOME.careerDraft===key?' selected':''}>${homeEsc(careerLabel(key))}</option>`).join('')}</select></label><button class="h-btn primary" data-a="hcareer"${HOME.saving.size?' disabled':''}>${HOME.saving.size?'Guardando…':'Guardar carrera'}</button></div>`:`<p class="h-muted">No pudimos identificar la carrera de tu perfil. Contacta al soporte para revisarla.</p>`);
 if(HOME.mode==='guest')return homeEmpty('Tu recorrido empieza aquí','Inicia sesión para reunir tus notas, ponderados y logros en Inicio.');
 return null;
}
function homeCyclePicker(m){return `<label class="h-cycle" for="h-cycle">Ver<select id="h-cycle"><option value="all"${HOME.cycle==='all'?' selected':''}>Todos los ciclos</option>${m.cycles.map(n=>`<option value="${n}"${HOME.cycle===String(n)?' selected':''}>${n===0?'Pre-formación':`Ciclo ${n}`}</option>`).join('')}</select></label>`}
function homeBins(items){const bins=[{label:'0–10,49',min:0,max:10.5},{label:'10,5–12,99',min:10.5,max:13},{label:'13–15,99',min:13,max:16},{label:'16–17,99',min:16,max:18},{label:'18–20',min:18,max:21}];return bins.map(b=>({...b,count:items.filter(c=>HOME.grades[c.id]>=b.min&&HOME.grades[c.id]<b.max).length}))}
function homeGraphs(m){
 const items=m.selected.items,visible=items.slice(0,8),bins=homeBins(items),max=Math.max(1,...bins.map(b=>b.count));
 const bars=items.length?`<div class="h-bars" role="img" aria-label="Notas por curso, escala de cero a veinte">${visible.map(c=>`<div class="h-bar-row${HOME.grades[c.id]<HOME_PASS?' fail':''}"><span>${homeEsc(c.n)}</span><strong>${homeNum(HOME.grades[c.id],1)}</strong><div class="bar2"><i style="width:${HOME.grades[c.id]/20*100}%"></i></div></div>`).join('')}</div><div class="h-chart-note"><i></i>Aprobado · desde 10,5<i class="h-fail-dot"></i>Desaprobado</div>${items.length>8?`<p class="h-foot">Se muestran 8 de ${items.length} cursos. La tabla incluye todos.</p>`:''}`:homeEmpty('Aún no hay notas','Registra las notas de tus cursos llevados o desaprobados en la tabla inferior.',false);
 const distribution=items.length?`<div class="h-distribution" role="img" aria-label="Distribución de notas: ${bins.map(b=>`${b.label}: ${b.count} cursos`).join('; ')}">${bins.map(b=>`<div class="h-bin"><b>${b.count}</b><i style="height:${b.count/max*115}px"></i><span>${b.label}</span></div>`).join('')}</div><p class="h-foot">${items.length} ${items.length===1?'nota registrada':'notas registradas'} · escala 0–20</p>`:homeEmpty('Cada nota cuenta','La distribución aparecerá cuando registres tus primeras notas.',false);
 const editing=HOME.mode==='live';
 const rows=m.eligible.map(c=>{const has=Number.isFinite(HOME.grades[c.id]),busy=HOME.saving.has(c.id),formId=`h-form-${c.id}`;
  return `<tr><td>${homeEsc(c.n)}<small>${homeNum(c.cr,2).replace(/,00$/,'')} créditos · ${HOME.statuses[c.id]?.status==='desaprobado'?'Desaprobado':HOME.statuses[c.id]?.status==='convalidado'?'Convalidado':'Llevado'}</small><small id="h-feedback-${c.id}" role="status">${homeEsc(HOME.feedback[c.id]||'')}</small></td><td class="h-numeric">${c.c===0?'Pre':`C${c.c}`}</td><td><form class="h-grade" id="${formId}" data-home-grade="${c.id}"><input id="h-grade-${c.id}" name="grade" type="text" inputmode="decimal" maxlength="16" autocomplete="off" aria-label="Nota de ${homeEsc(c.n)}" aria-describedby="h-feedback-${c.id}" placeholder="—" value="${homeEsc(HOME.drafts[c.id]??(has?HOME.grades[c.id]:''))}"${!editing||busy?' disabled':''}><button class="h-save" type="submit" aria-label="Guardar nota de ${homeEsc(c.n)}" title="Guardar nota"${!editing||busy?' disabled':''}>${svg('tick',16)}</button></form></td></tr>`}).join('');
 return `<div class="h-grid"><section class="blk"><div class="h-section-head"><div><h3 class="bt">${svg('trend',18)}Notas por curso</h3><p class="h-muted">Tu rendimiento, curso a curso.</p></div>${homeCyclePicker(m)}</div>${bars}</section><section class="blk"><h3 class="bt">${svg('listc',18)}Distribución de notas</h3><p class="h-muted">Cómo se reparten tus resultados.</p>${distribution}</section><section class="blk h-wide"><h3 class="bt">${svg('cap',18)}Mis notas</h3><p class="h-muted">Guarda con el botón de cada curso. Deja el campo vacío para eliminar una nota.</p>${rows?`<div class="h-table-wrap"><table class="h-table"><caption class="h-muted" style="text-align:left;margin-bottom:8px">${HOME.cycle==='all'?'Todos los ciclos':HOME.cycle==='0'?'Pre-formación':`Ciclo ${HOME.cycle}`} · ${m.eligible.length} cursos llevados o desaprobados</caption><thead><tr><th scope="col">Curso</th><th scope="col">Ciclo</th><th scope="col">Nota / 20</th></tr></thead><tbody>${rows}</tbody></table></div>`:homeEmpty('Sin cursos registrados en este ciclo','Marca tus cursos como llevados en tu malla o registra su estado académico en la ficha del curso. Después podrás ingresar sus notas aquí.',false)}</section></div>`;
}
function homeLine(points){
 if(!points.length)return homeEmpty('Tu evolución aparecerá aquí','Registra notas en tus ciclos para comparar los ponderados.',false);
 const w=620,h=245,left=40,right=24,top=24,bottom=32;
 const x=i=>points.length===1?(w+left-right)/2:left+i/(points.length-1)*(w-left-right),y=v=>top+(20-v)/20*(h-top-bottom);
 const coords=points.map((p,i)=>`${x(i)},${y(p.weighted)}`).join(' ');
 return `<svg class="h-line" viewBox="0 0 ${w} ${h}" role="img" aria-label="Ponderado por ciclo: ${points.map(p=>`ciclo ${p.num}, ${homeNum(p.weighted,2)}`).join('; ')}"><title>Evolución del ponderado por ciclo</title>${[0,5,10,15,20].map(n=>`<line class="grid" x1="${left}" x2="${w-right}" y1="${y(n)}" y2="${y(n)}"/><text x="${left-9}" y="${y(n)+4}" text-anchor="end">${n}</text>`).join('')}<line class="pass" x1="${left}" x2="${w-right}" y1="${y(HOME_PASS)}" y2="${y(HOME_PASS)}"/><polyline class="curve" points="${coords}"/>${points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.weighted)}" r="4"><title>Ciclo ${p.num}: ${homeNum(p.weighted,2)}</title></circle><text x="${x(i)}" y="${h-7}" text-anchor="middle">C${p.num}</text>`).join('')}</svg><p class="h-foot">La línea discontinua indica la nota aprobatoria: 10,5.</p>`;
}
function homeWeighted(m){
 const points=m.perCycle.filter(p=>p.weighted!==null);
 return `<div class="h-grid"><section class="blk"><h3 class="bt">${svg('trend',18)}Evolución por ciclo</h3><p class="h-muted">Cada ciclo cuenta su propia historia.</p>${homeLine(points)}</section><section class="blk"><h3 class="bt">${svg('cap',18)}Ponderado general</h3><p class="h-muted">Tus notas, ponderadas por créditos.</p><div class="h-number">${homeNum(m.weighted,2)}<small>/ 20</small></div><dl class="h-kvs"><div><dt>Créditos con nota</dt><dd>${homeNum(m.credits,2)}</dd></div><div><dt>Cursos con nota</dt><dd>${m.items.filter(c=>c.cr>0).length}</dd></div></dl><p class="h-foot">Suma de nota × créditos, dividida entre los créditos con nota. Incluye desaprobados; excluye retiros y cursos sin nota o sin créditos.</p></section><section class="blk h-wide"><h3 class="bt">${svg('cal',18)}Ponderados por ciclo</h3><p class="h-muted">Compara tus resultados sin perder el contexto.</p>${points.length?`<div class="h-table-wrap"><table class="h-table"><thead><tr><th scope="col">Ciclo</th><th scope="col">Cursos con nota</th><th scope="col">Créditos</th><th scope="col">Ponderado</th></tr></thead><tbody>${points.map(p=>`<tr><td>Ciclo ${p.num}</td><td>${p.items.filter(c=>c.cr>0).length}</td><td class="h-numeric">${homeNum(p.credits,2)}</td><td class="h-numeric"><strong>${homeNum(p.weighted,2)}</strong></td></tr>`).join('')}</tbody></table></div>`:homeEmpty('Todavía no hay ponderados','Añade las notas de tus cursos en Gráficos para calcularlos.',false)}</section></div>`;
}
function homeStats(m){
 const ranked=[...m.items].sort((a,b)=>HOME.grades[b.id]-HOME.grades[a.id]),points=m.perCycle.filter(p=>p.weighted!==null);
 const bestCycle=[...points].sort((a,b)=>b.weighted-a.weighted)[0],worstCycle=[...points].sort((a,b)=>a.weighted-b.weighted)[0];
 const tiles=[['Promedio simple',homeNum(m.simple,2),'Cada nota tiene el mismo peso.'],['Mediana',homeNum(m.median,2),'El centro de tus notas ordenadas.'],['Tasa de aprobación',m.grades.length?homeNum(m.passed/m.grades.length*100)+'%':'—','Sobre los cursos con nota registrada.'],['Cursos aprobados',m.passed,'Con nota desde 10,5.'],['Cursos desaprobados',m.grades.length-m.passed,'Con nota menor a 10,5.'],['Créditos completados',homeNum(m.approvedCredits,2),`De ${homeNum(m.total)} créditos de tu malla.`]];
 const courseLine=c=>c?`${homeEsc(c.n)} · ${homeNum(HOME.grades[c.id],2)}`:'—';
 return `<div class="h-stats">${tiles.map(([label,value,note])=>`<section class="blk"><h3>${label}</h3><div class="h-number">${value}</div><p class="h-muted">${note}</p></section>`).join('')}</div><div class="h-grid" style="margin-top:14px"><section class="blk"><h3 class="bt">${svg('trend',18)}Resultados destacados</h3><dl class="h-kvs"><div><dt>Mejor nota</dt><dd>${courseLine(ranked[0])}</dd></div><div><dt>Menor nota</dt><dd>${courseLine(ranked.at(-1))}</dd></div><div><dt>Mejor ciclo</dt><dd>${bestCycle?`Ciclo ${bestCycle.num} · ${homeNum(bestCycle.weighted,2)}`:'—'}</dd></div><div><dt>Menor ponderado</dt><dd>${worstCycle?`Ciclo ${worstCycle.num} · ${homeNum(worstCycle.weighted,2)}`:'—'}</dd></div></dl></section><section class="blk"><h3 class="bt">${svg('cap',18)}Avance académico</h3><p class="h-muted">El progreso también se mide en lo que ya completaste.</p><div class="h-number">${homeNum(m.total?m.approvedCredits/m.total*100:0)}<small>%</small></div><div class="bar2"><i style="width:${Math.min(100,m.total?m.approvedCredits/m.total*100:0)}%"></i></div><dl class="h-kvs"><div><dt>Cursos llevados</dt><dd>${m.done.length} / ${m.courses.length}</dd></div><div><dt>Cursos matriculados</dt><dd>${m.active.length}</dd></div><div><dt>Créditos pendientes</dt><dd>${homeNum(Math.max(0,m.total-m.approvedCredits),2)}</dd></div></dl><p class="h-foot">El avance usa los cursos marcados como llevados, incluidos los convalidados. Las estadísticas de notas usan solo cursos con nota vigente.</p></section></div>`;
}
function homeAchievements(){
 const keys=Object.keys(LOGROS),earned=keys.filter(k=>Object.hasOwn(HOME.achievements,k));
 return `<section class="blk"><div class="h-section-head"><div><h3 class="bt">${svg('sparkles',18)}Logros</h3><p class="h-muted">Pequeños pasos que cuentan una gran historia.</p></div><div class="h-ach-progress"><div class="h-number">${earned.length}<small>/ ${keys.length}</small></div><div class="bar2"><i style="width:${earned.length/keys.length*100}%"></i></div></div></div><p class="h-muted">Tus logros son privados. Se desbloquean al cumplir las condiciones de tu cuenta.</p><ul class="h-achievements">${keys.map(k=>{const logro=LOGROS[k],unlocked=Object.hasOwn(HOME.achievements,k);return `<li class="h-achievement${unlocked?' earned':''}"><span class="h-ach-icon">${svg(unlocked?'sparkles':'lock',18)}</span><div><h3>${homeEsc(logro.name)}</h3><p>${homeEsc(logro.desc)}</p><small>${unlocked?`Desbloqueado${homeDate(HOME.achievements[k])?' · '+homeDate(HOME.achievements[k]):''}`:'Por desbloquear'}</small></div></li>`}).join('')}</ul></section>`;
}
function homeHistory(m){
 let cumulative=0,milestone=0;const milestones=[25,50,75,100],events=[];
 for(const cycle of m.cycles){
  const done=m.done.filter(c=>c.c===cycle);if(!done.length)continue;
  const credits=done.reduce((s,c)=>s+c.cr,0);cumulative+=credits;
  const average=m.perCycle.find(p=>p.num===cycle)?.weighted;
  events.push({icon:'cap',title:`${cycle===0?'Pre-formación':`Ciclo ${cycle}`} · ${done.length} ${done.length===1?'curso llevado':'cursos llevados'}`,detail:`${homeNum(credits,2)} créditos${average!=null?' · ponderado '+homeNum(average,2):''}`});
  while(milestone<milestones.length&&m.total>0&&cumulative/m.total*100>=milestones[milestone]){
   events.push({icon:'target',title:`${milestones[milestone]}% de tu malla completada`,detail:`${homeNum(cumulative,2)} de ${homeNum(m.total)} créditos`});milestone++;
  }
 }
 const achievements=Object.entries(HOME.achievements).filter(([k])=>LOGROS[k]).sort((a,b)=>new Date(b[1])-new Date(a[1]));
 const timeline=items=>`<ol class="h-timeline">${items.map(e=>`<li class="h-event"><span class="h-event-icon">${svg(e.icon,16)}</span><div><h3>${homeEsc(e.title)}</h3><p>${homeEsc(e.detail)}</p>${e.date&&homeDate(e.date)?`<time datetime="${homeEsc(e.date)}">${homeDate(e.date)}</time>`:''}</div></li>`).join('')}</ol>`;
 return `<div class="h-grid"><section class="blk"><h3 class="bt">${svg('clock',18)}Tu historia académica</h3><p class="h-muted">Un recorrido por los ciclos y los hitos de tu malla.</p>${events.length?timeline(events):homeEmpty('Tu historia está por escribirse','Tus ciclos aparecerán cuando marques tus primeros cursos como llevados.',false)}<p class="h-foot">Ordenado por ciclo de la malla; no representa fechas de matrícula o aprobación.</p></section><section class="blk"><h3 class="bt">${svg('sparkles',18)}Momentos desbloqueados</h3><p class="h-muted">Tus logros, del más reciente al primero.</p>${achievements.length?timeline(achievements.map(([k,date])=>({icon:'sparkles',title:LOGROS[k].name,detail:LOGROS[k].desc,date}))):homeEmpty('Los primeros pasos también cuentan','Aquí aparecerán tus logros con la fecha en que los desbloqueaste.',false)}</section></div>`;
}
function homeEnrollment(m){
 const semester=SETUP.record?.preferences?.semester;
 return `<section class="blk h-enrollment"><h3 class="bt">${svg('cap',18)}Cursos del semestre actual${semester?' · semestre '+homeEsc(semester):''}</h3><p class="h-muted">${m.active.length} cursos · ${homeNum(m.active.reduce((sum,c)=>sum+c.cr,0),2)} créditos matriculados.</p>${m.active.length?`<ul class="h-enrollment-list">${m.active.map(c=>`<li><span>${homeEsc(c.n)}</span><small>${homeNum(c.cr)} créditos · ciclo ${c.c}</small></li>`).join('')}</ul>`:'<p>No tienes cursos matriculados. Actualiza el estado en Ficha del curso.</p>'}<button class="h-btn" data-a="hmalla">Actualizar matrícula</button></section>`;
}
function homeGreeting(){
 const hour=Number(new Intl.DateTimeFormat('en-US',{hour:'numeric',hour12:false,timeZone:'America/Lima'}).format(new Date()))%24;
 return hour<12?'Buenos días':hour<19?'Buenas tardes':'Buenas noches';
}
function homeHero(m,active,pct){
 const alias=typeof HOME.profile?.alias==='string'?HOME.profile.alias.trim():'';
 const title=alias?'Tu avance, '+homeEsc(alias)+'.':'Tu avance';
 const message=active?(pct>=100?'Completaste tu malla. ¡Increíble trayectoria!':pct>=50?'Ya pasaste la mitad del camino. ¡Sigue así!':pct>0?'Llevas '+homeNum(pct)+'% de tu malla. ¡Buen ritmo!':'Tu ruta empieza hoy: registra tus cursos y notas.'):(HOME.mode==='guest'?'Tus notas, tus logros y todo lo que vas construyendo.':HOME.mode==='profile'?'Completa tu perfil para consultar tu avance.':HOME.mode==='error'?'Reintenta la carga para consultar tus datos.':'Estamos preparando tu espacio académico.');
 const actions=HOME.mode==='live'?'<button class="h-btn primary" data-a="hmalla">'+svg('cap',16)+'Ver mi malla</button><button class="h-btn" data-a="hreload"'+(HOME.saving.size?' disabled':'')+'>'+svg('trend',16)+'Actualizar</button>':HOME.mode==='guest'?'<a class="h-btn primary" href="./login.html">Iniciar sesión</a>':'';
 return `<section class="h-hero pal-hero" id="h-pal" data-s="idle" data-offscreen="false" aria-labelledby="home-hero-title"><div class="h-hero-body"><p class="h-hello">${homeGreeting()}</p><h2 id="home-hero-title">${title}</h2><p class="h-muted">${active?homeEsc(m.career.nombre):message}</p><div class="h-head-actions">${actions}</div></div>${homeCompanion(message)}</section>`;
}
function dash(){
 const m=homeModel(),active=HOME.mode==='live',empty=homeReady(m),pct=m.total?m.approvedCredits/m.total*100:0;
 const metrics=[[active?homeNum(pct)+'%':'—','Avance de la malla',active?`${m.done.length} de ${m.courses.length} cursos llevados`:'Tus cursos completados'],[active?homeNum(m.approvedCredits,Number.isInteger(m.approvedCredits)?0:2):'—','Créditos completados',`De ${homeNum(m.total)} créditos de tu malla`],[active?homeNum(m.weighted,2):'—','Ponderado general','Notas ponderadas por créditos'],[active?String(m.active.length):'—','Cursos matriculados','Según tu registro académico']];
 const content=empty||({graficos:homeGraphs,ponderado:homeWeighted,stats:homeStats,logros:homeAchievements,historia:homeHistory}[HOME.tab])(m);
 return `<div class="h-home">${homeHero(m,active,pct)}${HOME.mode==='live'&&(SETUP.error||(!SETUP.record?.completed_at&&SETUP.deferred))?`<div class="h-notice" role="status"><p>${homeEsc(SETUP.error||'Termina la configuración inicial para preparar tu malla y tu horario.')}</p><button class="h-btn" data-a="hsetup">${SETUP.error?'Reintentar':'Retomar configuración'}</button></div>`:''}${HOME.error?`<div class="h-error" role="alert"><p>${homeEsc(HOME.error)}</p><button class="h-btn" data-a="hretry">Reintentar</button></div>`:''}<div class="bento h-summary">${metrics.map((s,i)=>`<div class="blk st${i?'':' hl'}"><div class="sv">${s[0]}</div><div class="sl">${s[1]}</div>${i===0?`<div class="bar2"><i style="width:${Math.min(100,pct)}%"></i></div>`:''}<div class="h-sum-foot">${s[2]}</div></div>`).join('')}</div>${active?homeEnrollment(m):''}<div class="h-tabs" role="tablist" aria-label="Mi panel en Inicio">${HOME_TABS.map(([id,icon,label])=>`<button id="h-tab-${id}" role="tab" aria-selected="${HOME.tab===id}" aria-controls="h-panel" tabindex="${HOME.tab===id?0:-1}" data-a="htab" data-tab="${id}">${svg(icon,16)}${label}</button>`).join('')}</div><div id="h-panel" role="tabpanel" aria-labelledby="h-tab-${HOME.tab}" tabindex="0"${HOME.mode==='loading'?' aria-busy="true"':''}>${empty?`<section class="blk">${content}</section>`:content}</div><p class="h-foot">${HOME.mode==='live'?'Solo tú puedes ver tus notas, tus logros y tu historia académica.':'Inicia sesión con tu cuenta para consultar tu información académica.'}</p></div>`;
}
let webNavigation=null;
function homeTab(id){
 if(!HOME_TABS.some(t=>t[0]===id))return;
 if(HOME.tab===id)return;
 webNavigation?.push({page:cur,kid,tab:id,scroll:$('page').scrollTop});
 HOME.tab=id;
 const panel=$('h-panel');
 if(cur==='Inicio'&&panel){
  const m=homeModel(),empty=homeReady(m);
  const content=empty||({graficos:homeGraphs,ponderado:homeWeighted,stats:homeStats,logros:homeAchievements,historia:homeHistory}[id])(m);
  panel.innerHTML=empty?`<section class="blk">${content}</section>`:content;
  panel.setAttribute('aria-labelledby','h-tab-'+id);
  document.querySelectorAll('.h-tabs [role="tab"]').forEach(tab=>{
   const selected=tab.dataset.tab===id;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
  });
 }else homeRender();
 $('h-tab-'+id)?.focus({preventScroll:true});
}
function homeAction(button){
 if(button.dataset.a==='hsemester'){
  if(HOME.saving.size){toast('Espera a que termine el guardado');return}
  if(!['calendar','grades','courses'].includes(button.dataset.tab))return;
  SEMESTER.tab=button.dataset.tab;renderPage();$('semester-tab-'+SEMESTER.tab)?.focus({preventScroll:true});return;
 }
 if(button.dataset.a==='hexport'){void exportAcademicRecord();return}
 if(button.dataset.a==='hmalla'){go('Mi carrera');return}
 const action=button.dataset.a;
 if(action==='htab')homeTab(button.dataset.tab);
 else if(action==='hsetup')setupOpen();
 else if(action==='hreload'&&HOME.user){if(!HOME.saving.size)homeLoad(HOME.user)}
 else if(action==='hretry'){HOME.error='';HOME.mode='loading';homeRender();homeInit()}
 else if(action==='hcareer')homeSaveCareer();
}
async function homeSaveCareer(){
 const career=$('h-career')?.value;
 if(HOME.mode!=='profile'||!HOME.user||!homeClient||HOME.saving.size)return;
 if(!Object.hasOwn(CARRERAS,career)){toast('Elige tu carrera');$('h-career')?.focus();return}
 const user=HOME.user,revision=HOME.revision;
 HOME.careerDraft=career;HOME.saving.add('career');HOME.error='';homeRender();
 try{
  const verified=await homeClient.auth.getUser();if(verified.error||verified.data.user?.id!==user.id)throw new Error('session');
  const result=await homeClient.from('profiles').update({carrera:career}).eq('id',user.id).is('carrera',null).select('carrera').maybeSingle();
  if(result.error||result.data?.carrera!==career)throw new Error('career');
  if(revision===HOME.revision){HOME.saving.delete('career');await homeLoad(user)}
 }catch{if(revision===HOME.revision){HOME.saving.delete('career');HOME.error='No pudimos guardar tu carrera. Reintenta; si persiste, contacta al soporte.';homeRender()}}
}
async function homeSaveGrade(form){
 const id=form.dataset.homeGrade,input=form.elements.grade;
 if(HOME.saving.has(id))return;
 const course=homeCareer().cursos.find(c=>c.id===id);
 if(!course||(!HOME.done.has(id)&&HOME.statuses[id]?.status!=='desaprobado'))return;
 const text=input.value.trim().replace(',','.'),value=text===''?null:Number(text);
 const feedback=$('h-feedback-'+id);
 HOME.drafts[id]=input.value;
 if(text!==''&&(!/^\d{1,2}(\.\d{1,2})?$/.test(text)||!Number.isFinite(value)||value<0||value>20)){
  input.setAttribute('aria-invalid','true');feedback.textContent='Ingresa una nota entre 0 y 20, con hasta dos decimales.';input.focus();return;
 }
 input.removeAttribute('aria-invalid');
 if(HOME.mode!=='live'||!HOME.user||!homeClient){feedback.textContent='Inicia sesión para guardar tu nota.';return}
 if(value===null&&!Object.hasOwn(HOME.grades,id)){feedback.textContent='No hay una nota que eliminar.';return}
 const revision=HOME.revision,user=HOME.user,mode=HOME.mode;
 HOME.saving.add(id);input.disabled=true;form.querySelector('button').disabled=true;
 feedback.textContent='Guardando…';
 try{
  if(mode==='live'){
   const verified=await homeClient.auth.getUser();if(verified.error||verified.data.user?.id!==user.id)throw new Error('session');
   const result=value===null?await homeClient.from('grades').delete().match({student_id:user.id,course_id:id}):await homeClient.from('grades').upsert({student_id:user.id,course_id:id,grade:value,updated_at:new Date().toISOString()},{onConflict:'student_id,course_id'});
   if(result.error)throw result.error;
  }
  if(revision!==HOME.revision)return;
  if(value===null)delete HOME.grades[id];else HOME.grades[id]=value;
  delete HOME.drafts[id];HOME.error='';HOME.saving.delete(id);homeRender();
  const message=value===null?'Nota eliminada':'Nota guardada';
  HOME.feedback[id]=message;const status=$('h-feedback-'+id);if(status)status.textContent=message;
  $('h-grade-'+id)?.focus({preventScroll:true});toast(message);
 }catch{
  if(revision!==HOME.revision)return;
  HOME.saving.delete(id);
  // Conservar el borrador y los datos anteriores cuando la escritura falla.
  HOME.feedback[id]='No se pudo guardar. Tu nota anterior se conserva; reintenta.';
  if(form.isConnected){input.disabled=false;form.querySelector('button').disabled=false;feedback.textContent=HOME.feedback[id];input.focus()}
  else{HOME.error=HOME.feedback[id];homeRender()}
 }
}

let curriculumUnmount=null,curriculumRender=0;
function renderPage(){
 curriculumRender++;curriculumUnmount?.();curriculumUnmount=null;
 const y=$('page').scrollTop;
 const html=HOME.mode==='unsupported'&&!['Buzón de sugerencias'].includes(cur)?unsupportedProfile():cur==='Inicio'?dash():cur==='Mi carrera'?malla():cur==='Mi semestre'?cal2():cur==='Grupos de estudio'?salas():cur==='Mod Focus'?focus():['Planificar','Asistente','Recursos'].includes(cur)?toolSurface(cur==='Planificar'?'Brújula IA':cur==='Asistente'?'Asesor IA':'Recursos'):cur==='Mi IA'?personalAiSurface():cur==='Buzón de sugerencias'?buzon(kid):'';
 $('page').innerHTML='<div class="view-surface">'+html+'</div>';$('page').scrollTop=y;
 if($('wh'))kWheels();
 if($('official-curriculum'))mountCurriculum();
 if($('official-calendar'))mountCalendar();
 if($('semester-grades'))mountSemesterGrades($('semester-grades'));
 if($('official-tool'))mountTool();
 if($('personal-ai-settings'))mountPersonalAi();
 if($('official-mailbox'))mountMailbox();
 if($('official-study-groups'))mountStudyGroups();
 if(cur==='Mod Focus'){if(fx.st==='run')kPaint(fx.left);kLoad()}
}
const esc=value=>homeEsc(value);
function cal2(){
 if(HOME.mode==='loading')return '<section class="blk" role="status"><h2 class="bt">Comprobando tu sesión…</h2></section>';
 if(!HOME.user)return '<section class="blk">'+homeEmpty('Tu calendario personal','Inicia sesión para guardar tus clases, eventos y tareas.')+'</section>';
 if(HOME.mode!=='live')return '<section class="blk">'+homeReady(homeModel())+'</section>';
 const tabs='<div class="h-tabs semester-tabs" role="tablist" aria-label="Mi semestre">'+[['calendar','Calendario y tareas'],['grades','Notas y objetivos'],['courses','Cursos actuales']].map(([id,label])=>'<button id="semester-tab-'+id+'" role="tab" aria-selected="'+(SEMESTER.tab===id)+'" aria-controls="semester-panel" tabindex="'+(SEMESTER.tab===id?'0':'-1')+'" data-a="hsemester" data-tab="'+id+'">'+label+'</button>').join('')+'</div>';
 const content=SEMESTER.tab==='calendar'?'<div id="official-calendar" aria-busy="true"><p class="h-muted" role="status">Preparando tu calendario…</p></div>':SEMESTER.tab==='grades'?'<section class="blk" id="semester-grades"></section>':homeEnrollment(homeModel());
 return tabs+'<div id="semester-panel" role="tabpanel" aria-labelledby="semester-tab-'+SEMESTER.tab+'">'+content+'</div>';
}
async function mountCalendar(){
 const container=$('official-calendar'),render=curriculumRender,revision=HOME.revision;
 try{
  const {mountOfficialCalendar}=await import('../features/semester/OfficialCalendar.jsx');
  if(render!==curriculumRender||revision!==HOME.revision||!container.isConnected)return;
  curriculumUnmount=mountOfficialCalendar(container,{client:homeClient,user:HOME.user,courses:HOME.profile?.carrera?homeCareer().cursos.filter(c=>HOME.statuses[c.id]?.status==='matriculado'):[],onBusy:value=>{if(revision===HOME.revision){if(value)HOME.saving.add('calendar');else HOME.saving.delete('calendar')}}});
  container.removeAttribute('aria-busy');
 }catch{if(render===curriculumRender&&container.isConnected)container.innerHTML=homeEmpty('No se pudo abrir el calendario','Reintenta para consultar tu información.',false)+'<button class="h-btn" data-a="hretry">Reintentar</button>'}
}
/* Mod Focus (reloj + compañero) */
const PRE=FOCUS_PRESETS;
const HINT={p25:'Ideal para arrancar o cuando cuesta concentrarse.',p45:'Buen equilibrio para lecturas y ejercicios largos.',p90:'Trabajo profundo: proyectos, casos o repaso de parcial.',custom:'Elige horas y minutos. Duración mínima: 5 minutos.'};
const STY=[['digital','Digital'],['ring','Anillo'],['arc','Arco'],['dots','Puntos']];
const PN={cat:['Gato','Miso'],rabbit:['Conejo','Nube'],owl:['Búho','Sabio']};
const MI={digital:'<span class="k-mi">25:00</span>',
ring:'<svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="1.2 1.76"/></svg>',
arc:'<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity=".25"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>',
dots:'<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">'+[5,12,19].flatMap(x=>[5,12,19].map(y=>`<circle cx="${x}" cy="${y}" r="2.2"/>`)).join('')+'</svg>'};
const fx={st:'setup',pre:'p45',h:0,m:30,style:'ring',pet:'cat',course:'',total:0,left:0,end:0,paused:false,cq:false,iv:0,session:null,busy:false,error:'',save:'idle',load:'idle',owner:null,generation:0,nonce:null,day:todayLima(),history:null,historyState:'idle',historyError:'',historyRead:0,syncing:false,lastSync:0,mutation:0};
function kReset(){clearInterval(fx.iv);Object.assign(fx,{st:'setup',course:'',session:null,busy:false,error:'',save:'idle',load:'idle',owner:null,paused:false,cq:false,nonce:null,day:todayLima(),history:null,historyState:'idle',historyError:'',historyRead:fx.historyRead+1,generation:fx.generation+1})}
function kRender(){if(cur==='Mod Focus')renderPage()}
const kCourseName=id=>homeCareer().cursos.find(c=>c.id===id)?.n||'Estudio general';
async function kRpc(name,args){const result=await homeClient.rpc(name,args);if(result.error)throw result.error;return result.data}
function kApply(session){
 clearInterval(fx.iv);fx.session=session;fx.course=session.course_id||'';fx.pre=session.method;fx.style=session.clock_style;fx.pet=session.companion;fx.total=session.planned_seconds;fx.left=session.remaining_seconds;fx.end=Date.now()+fx.left*1000;fx.paused=session.status==='paused';fx.cq=false;
 fx.h=Math.floor(fx.total/3600);fx.m=Math.floor((fx.total%3600)/300)*5;
 fx.st=['completed','interrupted'].includes(session.status)||!fx.left?'done':'run';fx.save=session.status==='completed'?'saved':session.status==='interrupted'?'interrupted':'pending';
 if(fx.st==='run')fx.iv=setInterval(kTick,250);
}
async function kMutate(action){
 if(fx.busy)return false;
 const user=HOME.user,gen=fx.generation;fx.mutation++;fx.busy=true;fx.error='';HOME.saving.add('focus');kRender();
 try{
  if(user){const verified=await homeClient.auth.getUser();if(verified.error||verified.data.user?.id!==user.id||HOME.user?.id!==user.id)throw {message:'NO_AUTH'}}
  const result=await action();if(gen!==fx.generation||HOME.user?.id!==user?.id)return false;
  if(!result?.id)throw {message:'FOCUS_UNAVAILABLE'};kApply(result);return true;
 }catch(e){if(gen===fx.generation)fx.error=focusError(e);return false}
 finally{if(gen===fx.generation){fx.busy=false;HOME.saving.delete('focus');kRender()}}
}
async function kLoadHistory(){
 if(HOME.mode!=='live')return;
 const day=fx.day,user=HOME.user.id,gen=fx.generation,read=++fx.historyRead;
 fx.historyState='loading';fx.historyError='';kRender();
 try{const data=await kRpc('focus_daily_summary',{day});if(gen!==fx.generation||read!==fx.historyRead||user!==HOME.user?.id)return;fx.history=data;fx.historyState='ready'}
 catch(e){if(gen===fx.generation&&read===fx.historyRead){fx.historyState='error';fx.historyError=focusError(e)}}
 if(gen===fx.generation&&read===fx.historyRead)kRender();
}
async function kLoad(){
 if(HOME.mode!=='live'||fx.load!=='idle')return;
 const gen=fx.generation,user=HOME.user.id;fx.owner=user;fx.load='loading';kRender();
 try{const session=await kRpc('focus_active_session');if(gen!==fx.generation||user!==HOME.user?.id)return;if(session)kApply(session);fx.load='ready';kRender();kLoadHistory();if(fx.st==='done'&&fx.save==='pending')kComplete()}
 catch(e){if(gen===fx.generation){fx.load='error';fx.error=focusError(e);kRender()}}
}
async function kSync(){
 if(fx.syncing||fx.busy||!fx.session||HOME.mode!=='live')return;
 const gen=fx.generation,sid=fx.session.id,confirming=fx.cq,mutation=fx.mutation;fx.syncing=true;fx.lastSync=Date.now();
 try{const row=await kRpc('focus_session_snapshot',{sid});if(gen!==fx.generation||mutation!==fx.mutation||fx.busy||fx.session?.id!==sid)return;if(row.status==='interrupted'){kBack();kLoadHistory();kRender();return}kApply(row);if(fx.st==='run')fx.cq=confirming;fx.error='';kRender();if(fx.st==='done'&&fx.save==='pending')kComplete()}
 catch(e){if(gen===fx.generation){fx.error=focusError(e);kRender()}}
 finally{if(gen===fx.generation)fx.syncing=false}
}
async function kStart(){
 if(fx.busy||fx.st!=='setup'||HOME.mode==='loading'||(HOME.user&&fx.load!=='ready'))return;
 if(fx.course&&!focusCourses().some(c=>c.id===fx.course)){fx.error=focusError({message:'COURSE_NOT_ENROLLED'});kRender();return}
 const args={cid:fx.course||null,seconds:kSecs(),chosen_method:fx.pre,chosen_style:fx.style,chosen_pet:fx.pet};
 if(!HOME.user){fx.total=fx.left=args.seconds;fx.end=Date.now()+fx.total*1000;fx.st='run';fx.paused=false;fx.cq=false;fx.save='guest';clearInterval(fx.iv);fx.iv=setInterval(kTick,250);kRender();$('k-focus-label')?.focus({preventScroll:true});return}
 const key=JSON.stringify(args);if(fx.nonce?.key!==key)fx.nonce={key,id:crypto.randomUUID()};
 const ok=await kMutate(()=>kRpc('start_focus_session',{...args,request_id:fx.nonce.id}));
 if(ok){fx.nonce=null;fx.lastSync=Date.now();$('k-focus-label')?.focus({preventScroll:true});if(fx.st==='done'&&fx.save==='pending')kComplete()}
}
async function kComplete(){
 if(fx.busy||fx.save==='saved')return false;
 if(!fx.session){fx.save='guest';kRender();return true}
 const ok=await kMutate(()=>kRpc('update_focus_session',{sid:fx.session.id,action:'finish'}));
 if(ok){if(fx.save==='interrupted')kBack();kLoadHistory();if(cur!=='Mod Focus')toast('Sesión de enfoque guardada.')}
 else if(fx.error.includes('Aún queda tiempo'))kSync();
 return ok;
}
async function kChange(action){
 if(fx.busy)return false;
 if(!fx.session){if(action==='pause'){fx.left=focusRemaining(fx.end);fx.paused=true}else if(action==='resume'){fx.end=Date.now()+fx.left*1000;fx.paused=false}else if(action==='interrupt')kBack();kRender();return true}
 const ok=await kMutate(()=>kRpc('update_focus_session',{sid:fx.session.id,action}));
 if(ok&&action==='interrupt'){kBack();kLoadHistory();toast('Tiempo de estudio registrado.')}
 else if(ok&&fx.st==='done'&&fx.save==='pending')kComplete();
 return ok;
}
async function kBeforeSignOut(){
 if(!fx.session)return true;
 if(fx.st==='run'&&!fx.paused)return kChange('pause');
 if(fx.st==='done'&&fx.save==='pending')return kComplete();
 return true;
}
function kBack(){clearInterval(fx.iv);fx.st='setup';fx.session=null;fx.save='idle';fx.error='';fx.cq=false;fx.paused=false}
function kFeedback(){return `${fx.error?`<p class="k-error" role="alert">${esc(fx.error)}</p>`:''}<p class="k-hint" role="status">${fx.busy?'Guardando…':''}</p>`}
function kHistory(){
 const head=`<div class="k-history-head"><h2 class="bt">${svg('cal',18)}Tu estudio, día a día</h2><label>Fecha<input type="date" id="k-day" aria-label="Fecha del historial" value="${fx.day}" max="${todayLima()}"></label></div>`;
 let body='';
 if(!HOME.user)body='<p>Inicia sesión para guardar tus sesiones y consultar tu historial.</p><a class="h-btn" href="./login.html">Iniciar sesión</a>';
 else if(fx.historyState==='error')body=`<p class="k-error" role="alert">${esc(fx.historyError)}</p><button class="h-btn" data-a="khistory">Reintentar historial</button>`;
 else if(fx.historyState!=='ready')body='<p class="k-hint" role="status">Consultando tu tiempo de estudio…</p>';
 else{
  const summary=fx.history;
  body=`<p class="k-encourage">${esc(focusMotivation(summary,fx.day))}</p><p class="k-hint">${summary.completed_count} ${summary.completed_count===1?'sesión completada':'sesiones completadas'}${summary.interrupted_count?` · ${summary.interrupted_count} ${summary.interrupted_count===1?'sesión terminada antes':'sesiones terminadas antes'}`:''}. Se agrupan por la fecha de término en Lima.</p>`;
  if(summary.sessions?.length)body+=`<ul class="k-history-list">${summary.sessions.map(s=>`<li><div><b>${esc(kCourseName(s.course_id))}</b><small>${s.status==='completed'?'Completada':'Terminada antes'} · ${new Date(s.finished_at).toLocaleTimeString('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit'})}</small></div><span>${focusDuration(s.seconds)}</span></li>`).join('')}</ul>${summary.completed_count+summary.interrupted_count>30?'<p class="k-hint">Se muestran las últimas 30 sesiones; el resumen incluye todas.</p>':''}`;
 }
 return `<section class="blk k-history">${head}${body}</section>`;
}
async function kAction(a,D,b){
 if(fx.busy)return;
 if(a==='kgo'){await kStart();return}
 if(a==='kp'){await kChange(fx.paused?'resume':'pause');return}
 if(a==='kqy'){await kChange('interrupt');return}
 if(a==='ksave'){await kComplete();return}
 if(a==='kretry'){fx.load='idle';fx.error='';kLoad();return}
 if(a==='khistory'){kLoadHistory();return}
 if(a==='kf'){if(fx.save==='pending'){if(!await kComplete())return}kBack();kRender();return}
 if(a==='kpre'&&PRE.some(x=>x[0]===D.v))fx.pre=D.v;
 else if(a==='kst'&&STY.some(x=>x[0]===D.v))fx.style=D.v;
 else if(a==='kpt'&&PN[D.v])fx.pet=D.v;
 else if(a==='kq')fx.cq=true;
 else if(a==='kqn')fx.cq=false;
 kRender();$('page').querySelector(selQ(b))?.focus({preventScroll:true});
}
const kSecs=()=>fx.pre==='custom'?Math.max(300,fx.h*3600+fx.m*60):PRE.find(p=>p[0]===fx.pre)[2];
const fmt=t=>{const h=t/3600|0,m=(t%3600)/60|0,s=t%60,p=n=>String(n).padStart(2,'0');return (h?h+':':'')+p(m)+':'+p(s)};
function pet(k,m){
  const ears=k==='cat'?'<path d="M55 40 59 14 79 29Z"/><path d="M105 40 101 14 81 29Z"/>':k==='rabbit'?'<ellipse cx="66" cy="16" rx="8" ry="22"/><ellipse cx="94" cy="16" rx="8" ry="22"/>':'<path d="M54 38 52 14 76 27Z"/><path d="M106 38 108 14 84 27Z"/>';
  const tail=k==='cat'?'<path class="tl" d="M120 108c24 2 32-24 16-42" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>':k==='rabbit'?'<circle class="tl" cx="124" cy="110" r="10"/>':'<path class="tl" d="M118 112l22 8-20 6z"/>';
  const r=k==='owl'?10:8;
  return `<svg class="pet ${m}" viewBox="0 0 170 150" aria-hidden="true"><ellipse cx="80" cy="144" rx="46" ry="5" opacity=".15"/><g class="all">${tail}<ellipse cx="80" cy="104" rx="42" ry="34"/><g class="hd">${ears}<circle cx="80" cy="54" r="30"/><g class="eyes"><circle class="ew" cx="67" cy="52" r="${r}"/><circle class="ew" cx="93" cy="52" r="${r}"/><circle class="pp" cx="69" cy="52" r="3.6"/><circle class="pp" cx="95" cy="52" r="3.6"/></g><g class="hp"><path d="M58 54q9-11 18 0M84 54q9-11 18 0"/></g>${k==='owl'?'<path class="bk" d="M76 62h8l-4 9z"/>':'<path class="mo" d="M74 66q6 6 12 0"/>'}</g><g class="bo"><rect x="52" y="108" width="56" height="28" rx="5"/><path d="M80 108v28"/><path class="pgf" d="M80 108h28v28H80z"/></g><circle cx="64" cy="112" r="7"/><circle cx="96" cy="112" r="7"/></g></svg>`}
function clockHTML(st,t){return webClock(st,t,fx.st==='setup')}
function kPaint(L){webPaint(L)}
function kTick(){if(fx.st!=='run'||fx.paused)return;fx.left=focusRemaining(fx.end);if(cur==='Mod Focus')kPaint(fx.left);if(!fx.left){fx.st='done';clearInterval(fx.iv);kRender();if(!fx.busy)kComplete()}else if(fx.session&&Date.now()-fx.lastSync>30000&&!document.hidden)kSync()}
const wheel=(id,vals,sel,lb)=>`<div class="k-w"><div class="k-wh" id="${id}" role="spinbutton" tabindex="0" aria-label="${lb}" aria-valuemin="0" aria-valuemax="${id==='wh'?3:55}" aria-valuenow="${sel}">${vals.map(v=>`<div class="k-wi${v===sel?' on':''}" aria-hidden="true" data-a="wi" data-v="${v}">${String(v).padStart(2,'0')}</div>`).join('')}</div><small>${lb.toLowerCase()}</small></div>`;
function kWheels(){$('wh').scrollTop=fx.h*40;$('wm').scrollTop=fx.m/5*40}
function prevHTML(){const p=PN[fx.pet];return `${webClock(fx.style,kSecs(),true)}<p class="k-hint">${p[1]} te acompañará${fx.course?' mientras estudias '+esc(kCourseName(fx.course)):''}.</p>`}
function kPrev(){const p=$('kprev');if(p)p.innerHTML=prevHTML()}
function kSetup(){
  if(fx.course&&!focusCourses().some(c=>c.id===fx.course))fx.course='';
  const disabled=fx.busy||(HOME.user&&fx.load!=='ready');
  return `<div class="k-grid"><section class="blk"><h2 class="bt">${svg('target',18)}Vista previa</h2><div class="k-prev" id="kprev">${prevHTML()}</div><p class="k-stat">${HOME.user?'Tu tiempo de estudio se guarda en tu cuenta.':'Puedes usar el reloj sin cuenta; el historial requiere iniciar sesión.'}</p></section>
  <section class="blk"><fieldset class="k-settings"${fx.busy?' disabled':''}><div class="k-sec"><h3>Método</h3><div class="k-row">${PRE.map(p=>`<button class="k-chip${fx.pre===p[0]?' on':''}" aria-pressed="${fx.pre===p[0]}" data-a="kpre" data-v="${p[0]}">${p[1]}${p[0]==='p45'?'<em>Sugerido</em>':''}</button>`).join('')}</div><p class="k-hint">${HINT[fx.pre]}</p>${fx.pre==='custom'?`${mqM.matches?`<div class="k-duration"><label>Horas<select id="k-hours">${[0,1,2,3].map(n=>`<option value="${n}"${fx.h===n?' selected':''}>${n}</option>`).join('')}</select></label><label>Minutos<select id="k-minutes">${Array.from({length:12},(_,i)=>i*5).map(n=>`<option value="${n}"${fx.m===n?' selected':''}>${n}</option>`).join('')}</select></label></div>`:`<div class="k-ws">${wheel('wh',[0,1,2,3],fx.h,'Horas')}${wheel('wm',Array.from({length:12},(_,i)=>i*5),fx.m,'Minutos')}</div>`}`:''}</div>
  <div class="k-sec"><h3>Estilo de reloj</h3><div class="k-row">${STY.map(x=>`<button class="k-opt${fx.style===x[0]?' on':''}" aria-pressed="${fx.style===x[0]}" data-a="kst" data-v="${x[0]}">${MI[x[0]]}${x[1]}</button>`).join('')}</div></div>
  <div class="k-sec"><h3>Tu compañero</h3><div class="k-row">${Object.keys(PN).map(k=>`<button class="k-opt${fx.pet===k?' on':''}" aria-pressed="${fx.pet===k}" data-a="kpt" data-v="${k}">${pet(k,'idle')}${PN[k][0]}</button>`).join('')}</div></div>
  <div class="k-sec"><label for="kcs" class="k-course-label">Curso (opcional)</label><select class="k-sel" id="kcs" aria-describedby="k-course-help"><option value="">Sin curso</option>${focusCourses().map(c=>`<option value="${esc(c.id)}"${fx.course===c.id?' selected':''}>${esc(c.n)}</option>`).join('')}</select><p class="k-hint" id="k-course-help">${focusCourses().length?'Solo los cursos marcados como Matriculado en tu carrera, en orden alfabético.':HOME.user?'Aún no tienes cursos marcados como Matriculado. Actualízalos en la ficha del curso; mientras tanto puedes estudiar sin elegir uno.':'Inicia sesión para elegir tus cursos matriculados.'}</p></div>
  ${kFeedback()}${fx.load==='error'?'<button class="h-btn" data-a="kretry">Reintentar carga</button>':''}<button class="k-go" data-a="kgo"${disabled?' disabled':''}>${fx.busy?'Guardando…':fx.load==='loading'?'Recuperando tu sesión…':'Comenzar'}</button></fieldset></section></div>${kHistory()}`}
function webSetup(){
  if(fx.course&&!focusCourses().some(c=>c.id===fx.course))fx.course='';
  const disabled=fx.busy||(HOME.user&&fx.load!=='ready');
  return `<div class="k-grid kf"><section class="blk k-pv"><h2 class="bt">${svg('target',18)}Vista previa</h2><div class="k-prev" id="kprev">${prevHTML()}</div><p class="k-stat">${HOME.user?'Tu tiempo de estudio se guarda en tu cuenta.':'Puedes usar el reloj sin cuenta; el historial requiere iniciar sesión.'}</p></section>
  <section class="blk"><fieldset class="k-settings"${fx.busy?' disabled':''}><div class="k-sec"><h3>Método</h3><div class="k-row">${PRE.map(p=>`<button class="k-chip${fx.pre===p[0]?' on':''}" aria-pressed="${fx.pre===p[0]}" data-a="kpre" data-v="${p[0]}">${p[1]}${p[0]==='p45'?'<em>Sugerido</em>':''}</button>`).join('')}</div><p class="k-hint">${HINT[fx.pre]}</p>${fx.pre==='custom'?`${mqM.matches?`<div class="k-duration"><label>Horas<select id="k-hours">${[0,1,2,3].map(n=>`<option value="${n}"${fx.h===n?' selected':''}>${n}</option>`).join('')}</select></label><label>Minutos<select id="k-minutes">${Array.from({length:12},(_,i)=>i*5).map(n=>`<option value="${n}"${fx.m===n?' selected':''}>${n}</option>`).join('')}</select></label></div>`:`<div class="k-ws">${wheel('wh',[0,1,2,3],fx.h,'Horas')}${wheel('wm',Array.from({length:12},(_,i)=>i*5),fx.m,'Minutos')}</div>`}`:''}</div>
  <div class="k-sec"><h3>Estilo de reloj</h3><div class="k-sty">${STY.map(x=>`<button class="k-opt${fx.style===x[0]?' on':''}" aria-pressed="${fx.style===x[0]}" data-a="kst" data-v="${x[0]}"><span class="k-th">${MI[x[0]]}</span>${x[1]}</button>`).join('')}</div></div>
  <div class="k-sec"><h3>Tu compañero</h3><div class="k-pets">${Object.keys(PN).map(k=>`<button class="k-opt k-po${fx.pet===k?' on':''}" aria-pressed="${fx.pet===k}" data-a="kpt" data-v="${k}"><span class="k-pt">${webPet(k,'idle')}</span><b>${PN[k][0]}</b><small>${PN[k][1]}</small></button>`).join('')}</div></div>
  <div class="k-sec"><label for="kcs" class="k-course-label">Curso (opcional)</label><select class="k-sel" id="kcs" aria-describedby="k-course-help"><option value="">Sin curso</option>${focusCourses().map(c=>`<option value="${esc(c.id)}"${fx.course===c.id?' selected':''}>${esc(c.n)}</option>`).join('')}</select><p class="k-hint" id="k-course-help">${focusCourses().length?'Solo los cursos marcados como Matriculado en tu carrera, en orden alfabético.':HOME.user?'Aún no tienes cursos marcados como Matriculado. Actualízalos en la ficha del curso; mientras tanto puedes estudiar sin elegir uno.':'Inicia sesión para elegir tus cursos matriculados.'}</p></div>
  ${kFeedback()}${fx.load==='error'?'<button class="h-btn" data-a="kretry">Reintentar carga</button>':''}<button class="k-go" data-a="kgo"${disabled?' disabled':''}>${fx.busy?'Guardando…':fx.load==='loading'?'Recuperando tu sesión…':svg('arrow',18)+'Comenzar'}</button></fieldset></section></div>${kHistory()}`}
const PL=(r0,rows)=>{const a=Array(16).fill('................');rows.forEach((s,i)=>{a[r0+i]=s});return a};
const PXB=PL(11,['...oooo##oooo...','...osso##osso...','...oooo##oooo...']);
const PX={
cat:{
 hd:PL(1,['..#..........#..','..##........##..','..#s#......#s#..','..############..','..############..','..############..','..############..','..#####nn#####..','...##########...']),
 bd:PL(10,['...##########...','..####ssss####..','..####ssss####..','..####ssss####..','..####....####..','..####....####..']),
 ta:PL(9,['..............##','..............#.','..............#.','..............#.','..............#.']),
 tb:PL(10,['..............#.','..............#.','..............#.','..............##']),
 eo:PL(6,['....oo....oo....','....oo....oo....']),
 ec:PL(7,['....oo....oo....']),
 eh:PL(6,['....o......o....','...o.o....o.o...']),
 ed:PL(7,['....oo....oo....','....oo....oo....'])},
rabbit:{
 hd:PL(0,['....##....##....','...#ss#..#ss#...','...#ss#..#ss#...','...#ss#..#ss#...','...#ss#..#ss#...','...####..####...','..############..','..############..','..############..','..#####nn#####..','...##########...']),
 bd:PL(11,['..############..','..####ssss####..','..####ssss####..','..####....####..','..####....####..']),
 ta:PL(13,['..............ss','..............ss']),
 tb:PL(12,['..............ss','..............ss']),
 eo:PL(7,['....oo....oo....','....oo....oo....']),
 ec:PL(8,['....oo....oo....']),
 eh:PL(7,['....o......o....','...o.o....o.o...']),
 ed:PL(8,['....oo....oo....','....oo....oo....'])},
owl:{
 hd:PL(1,['..#..........#..','..##........##..','..############..','.##ooo####ooo##.','.#ooooo##ooooo#.','.#ooooo##ooooo#.','.#ooooo##ooooo#.','.##ooo#nn#ooo##.','.##############.']),
 bd:PL(10,['..##ssssssss##..','..##s#ss#sss##..','..##ssssssss##..','..##ss#ss#ss##..','...##########...','....nn....nn....']),
 ta:PL(11,['.#............#.','.#............#.']),
 tb:PL(10,['.#............#.','.#............#.']),
 eo:PL(6,['....##....##....','....##....##....']),
 ec:PL(4,['...###....###...','..#####..#####..','..#####..#####..','..#####..#####..']),
 eh:PL(4,['...###....###...','..#####..#####..','..##o##..##o##..','..#o#o#..#o#o#..','...###....###...']),
 ed:PL(7,['....##....##....','....##....##....'])}};
const SPC={},PC={};
function spr(rows,dot){
  const m={},R=.46;
  rows.forEach((r,y)=>{let x=0;while(x<r.length){const c=r[x];if(c==='.'){x++;continue}
    if(dot){(m[c]||(m[c]=[])).push(`M${x+.5-R} ${y+.5}a${R} ${R} 0 1 0 ${2*R} 0a${R} ${R} 0 1 0 ${-2*R} 0`);x++;continue}
    let e=x;while(r[e+1]===c)e++;(m[c]||(m[c]=[])).push(`M${x} ${y}h${e-x+1}v1h${-(e-x+1)}z`);x=e+1}});
  return Object.keys(m).map(c=>`<path class="c${c==='#'?'p':c}" d="${m[c].join('')}"/>`).join('')}
function webPet(k,st,dot){
  const key=k+st+(dot?1:0);if(PC[key])return PC[key];
  const P=PX[k],L=a=>spr(a,dot);
  return PC[key]=`<svg class="pet ${k} ${st}${dot?' dot':''}" viewBox="0 0 20 17" aria-hidden="true"><path class="sh" d="M5 16h10v1H5z"/><g transform="translate(2 0)"><g class="all"><g class="tl ta">${L(P.ta)}</g><g class="tl tb">${L(P.tb)}</g><g class="bd">${L(P.bd)}</g><g class="hd">${L(P.hd)}<g class="ey eo">${L(P.eo)}</g><g class="ey ec">${L(P.ec)}</g><g class="ey eh">${L(P.eh)}</g><g class="ey ed">${L(P.ed)}</g></g><g class="bk">${L(PXB)}</g></g></g><g class="zz"><path class="z1" d="M16 5h4v1h-4zM18 6h1v1h-1zM17 7h1v1h-1zM16 8h4v1h-4z"/><path class="z2" d="M16 0h4v1h-4zM18 1h1v1h-1zM17 2h1v1h-1zM16 3h4v1h-4z"/></g></svg>`}

const FLAG='<svg viewBox="0 0 8 10" aria-hidden="true"><path d="M1 0h1v10H1zM2 1h5v1H2zM2 2h5v3H2z"/></svg>';
function webClockHTML(o){
  const s=o.style,t=o.total,L=o.L,H=t>=3600,f=o.f!=null?o.f:(t?1-L/t:0),P=webPet(o.pet,o.ps),sub=esc(o.course||'Enfoque'),lg=H?' long':'';
  if(s==='ring'||s==='arc'){
    let g;
    if(s==='ring'){const n=Math.round(f*60);let l='';for(let i=0;i<60;i++){const M=i%5===0;l+=`<line class="${i<n?'e':''}${i===n-1?' cu':''}" x1="100" y1="${M?5:7}" x2="100" y2="${M?21:16}" transform="rotate(${i*6} 100 100)"/>`}g=`<circle class="dsk" cx="100" cy="100" r="74"/>${l}`}
    else g=`<circle class="dsk" cx="100" cy="100" r="72"/><circle class="dts" cx="100" cy="100" r="96"/><circle class="tr" cx="100" cy="100" r="86"/><circle class="pg" id="karc" cx="100" cy="100" r="86" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="${100*(1-f)}" transform="rotate(-90 100 100)"/><g class="kn" id="kkn" style="transform:rotate(${f*360}deg)"><circle cx="100" cy="14" r="9.5"/><circle class="kh" cx="100" cy="14" r="3.6"/></g>`;
    return `<div class="kc ${s==="arc"?"kca":s}${lg}"><svg class="rg" viewBox="0 0 200 200" aria-hidden="true">${g}</svg><div class="kc-in">${P}<div class="k-time" id="kt" role="timer" aria-live="off" aria-label="Tiempo restante">${fmt(L,H)}</div><div class="kc-sub">${sub}</div></div></div>`}
  if(s==='dots'){const n=Math.floor(f*96);const d=Array.from({length:96},(_,i)=>`<i class="${i<n?'x':i===n?'cu':''}"></i>`).join('');
    return `<div class="kdw${lg}"><div class="kdp">${P}</div><div class="k-time" id="kt" role="timer" aria-live="off" aria-label="Tiempo restante">${fmt(L,H)}</div><div class="dgp"><div class="dg" id="kdg">${d}</div></div><div class="kc-sub">${sub}</div></div>`}
  if(s==='digital')return `<div class="km${lg}" id="kmm" style="--f:${f}"><div class="k-time" id="kt" role="timer" aria-live="off" aria-label="Tiempo restante">${fmt(L,H)}</div><div class="kmt"><i class="kmf"></i><b class="kmg" aria-hidden="true">${FLAG}</b><div class="kmp">${P}</div></div><div class="kc-sub">${sub}</div></div>`;

}
function webClock(st,t,preview=false){return webClockHTML({style:st,total:preview?t:fx.total,L:t,f:preview?.4:undefined,pet:fx.pet,ps:preview?'idle':fx.paused?'sleep':'study',course:fx.course?kCourseName(fx.course):'Enfoque'})}
function webPaint(L){
 const f=fx.total?1-L/fx.total:0,t=$('kt');if(t)t.textContent=fmt(L);
 if(fx.style==='ring')document.querySelectorAll('.focus-web .kc.ring line').forEach((el,i)=>{el.classList.toggle('e',i<Math.round(f*60));el.classList.toggle('cu',i===Math.round(f*60)-1)});
 else if(fx.style==='arc'){const a=$('karc');if(a)a.style.strokeDashoffset=100*(1-f);const k=$('kkn');if(k)k.style.transform=`rotate(${f*360}deg)`}
 else if(fx.style==='dots')document.querySelectorAll('.focus-web #kdg i').forEach((el,i)=>{el.classList.toggle('x',i<Math.floor(f*96));el.classList.toggle('cu',i===Math.floor(f*96))});
 else if(fx.style==='digital')$('kmm')?.style.setProperty('--f',f);
}
function kStage(){
 const P=PN[fx.pet],disabled=fx.busy?' disabled':'',lbl=`<div class="k-lbl" id="k-focus-label" tabindex="-1">${fx.course?esc(kCourseName(fx.course)):'Sesión de enfoque'} · ${fmt(fx.total)}</div>`;
 if(fx.st==='done')return `<div class="blk k-stage">${lbl}<div class="k-bub">${P[1]}: ¡Buen trabajo! Un paso más en tu estudio.</div>${webPet(fx.pet,'joy')}<p class="k-msg"><b>Sesión terminada · ${fmt(fx.total)}</b><br>Descansa unos minutos antes de volver.</p>${kFeedback()}<p class="k-msg" role="status">${fx.save==='saved'?'Sesión guardada en tu historial.':fx.save==='guest'?'Inicia sesión para guardar tu próximo momento de estudio.':fx.busy?'Guardando la sesión…':'El guardado está pendiente. Puedes reintentarlo.'}</p><div class="k-act">${fx.save==='pending'&&!fx.busy?'<button class="k-btn d" data-a="ksave">Reintentar guardado</button>':''}<button class="k-btn" data-a="kf"${disabled}>Volver a Mod Focus</button></div></div>`;
 const q=fx.cq?`<p class="k-msg">¿Terminar antes? ${fx.session?'Se guardará el tiempo de estudio transcurrido.':'El historial requiere iniciar sesión.'}</p><div class="k-act"><button class="k-btn d" data-a="kqy"${disabled}>Terminar ahora</button><button class="k-btn" data-a="kqn"${disabled}>Continuar</button></div>`:`<p class="k-msg">${fx.paused?'En pausa. El descanso no suma tiempo de estudio.':P[1]+' está estudiando contigo. Una sesión a la vez.'}</p><div class="k-act"><button class="k-btn d" data-a="kp"${disabled}>${fx.paused?'Reanudar':'Pausa'}</button><button class="k-btn" data-a="kq"${disabled}>Terminar antes</button></div>`;
 return `<div class="blk k-stage${fx.paused?' pz':''}">${lbl}<div class="k-clock-stage">${clockHTML(fx.style,fx.left)}</div>${q}${kFeedback()}</div>`;
}
function focus(){if(HOME.mode==='loading')return '<section class="blk" role="status">Comprobando tu sesión…</section>';if(HOME.user&&HOME.mode!=='live')return '<section class="blk">'+homeEmpty('Mod Focus','Carga tu perfil para consultar los cursos matriculados y el historial.',false)+'<button class="h-btn" data-a="hretry">Reintentar</button></section>';return '<div class="focus-web">'+(fx.st==='setup'?webSetup():kStage())+'</div>'}
$('page').addEventListener('scroll',e=>{const t=e.target;if(!t.classList||!t.classList.contains('k-wh'))return;
  if(fx.busy)return;const i=Math.max(0,Math.round(t.scrollTop/40));if(t.id==='wh')fx.h=Math.min(3,i);else fx.m=Math.min(11,i)*5;
  t.setAttribute('aria-valuenow',t.id==='wh'?fx.h:fx.m);[...t.children].forEach((c,j)=>c.classList.toggle('on',j===i));kPrev()},true);
$('page').onchange=e=>{if(fx.busy)return;if(e.target.id==='kcs'){fx.course=e.target.value;kPrev()}else if(e.target.id==='k-day'&&/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)&&e.target.value<=todayLima()){fx.day=e.target.value;kLoadHistory()}};
$('page').addEventListener('keydown',e=>{const w=e.target.closest('.k-wh');if(!w||fx.busy)return;const keys=['ArrowUp','ArrowDown','Home','End'];if(!keys.includes(e.key))return;e.preventDefault();const step=w.id==='wh'?1:5,max=w.id==='wh'?3:55,current=w.id==='wh'?fx.h:fx.m;const value=e.key==='Home'?0:e.key==='End'?max:Math.max(0,Math.min(max,current+(e.key==='ArrowUp'?step:-step)));w.scrollTop=value/step*40;if(w.id==='wh')fx.h=value;else fx.m=value;w.setAttribute('aria-valuenow',value);kPrev()});
window.addEventListener('focus',()=>{if(fx.session&&!fx.busy)kSync()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&fx.session&&!fx.busy){kTick();kSync()}});

const selQ=b=>'[data-a="'+b.dataset.a+'"]'+['k','i','d','g','v'].filter(x=>b.dataset[x]!=null).map(x=>`[data-${x}="${b.dataset[x]}"]`).join('');
const focusCourses=()=>HOME.mode==='live'?enrolledFocusCourses(homeCareer().cursos,HOME.statuses,HOME.done):[];
function salas(){
 if(HOME.mode==='loading')return '<section class="blk" role="status"><h2 class="bt">Comprobando tu sesión…</h2></section>';
 if(HOME.mode!=='live')return '<section class="blk">'+homeEmpty('Grupos de estudio',HOME.user?'Reintenta la carga de tu perfil para consultar las salas de tus cursos.':'Inicia sesión para crear una sala o estudiar con tus compañeros.')+(HOME.user?'<button class="h-btn" data-a="hretry">Reintentar</button>':'')+'</section>';
 return '<div id="official-study-groups" aria-busy="true"><p class="h-muted" role="status">Preparando las salas de estudio…</p></div>';
}
async function mountStudyGroups(){
 const container=$('official-study-groups'),render=curriculumRender,revision=HOME.revision;
 try{
  const {mountOfficialStudyGroups}=await import('../features/groups/OfficialStudyGroups.jsx');
  if(render!==curriculumRender||revision!==HOME.revision||!container.isConnected)return;
  curriculumUnmount=mountOfficialStudyGroups(container,{client:homeClient,user:HOME.user,courses:homeCareer().cursos,onBusy:value=>{if(revision===HOME.revision){if(value)HOME.saving.add('groups');else HOME.saving.delete('groups')}}});container.removeAttribute('aria-busy');
 }catch{if(render===curriculumRender&&container.isConnected)container.innerHTML=homeEmpty('No se pudo abrir Grupos de estudio','Reintenta para consultar las salas.',false)+'<button class="h-btn" data-a="hretry">Reintentar</button>'}
}
function buzon(category){return '<div id="official-mailbox" aria-busy="true"><p role="status">Preparando el buzón…</p></div>'}
async function mountMailbox(){
 const container=$('official-mailbox'),render=curriculumRender;
 try{
  const {mountOfficialMailbox}=await import('../features/support/OfficialMailbox.jsx');
  if(render!==curriculumRender||!container.isConnected)return;
  curriculumUnmount=mountOfficialMailbox(container,{draftKey:HOME.user?.id||'guest',category:kid||'Aplicativo',career:HOME.career,courses:HOME.mode==='live'?homeCareer().cursos:[],onCategory:name=>go(name,'Buzón de sugerencias')});container.removeAttribute('aria-busy');
 }catch{if(render===curriculumRender&&container.isConnected)container.innerHTML=homeEmpty('No se pudo abrir el buzón','Reintenta para volver a abrirlo.',false)+'<button class="h-btn" data-a="hretry">Reintentar</button>'}
}
function personalAiSurface(){
 if(HOME.mode!=='live')return '<section class="blk">'+homeEmpty('Mi IA','Inicia sesión para configurar tus claves personales.')+'</section>';
 return '<div id="personal-ai-settings" aria-busy="true">Cargando tu configuración de IA…</div>';
}
async function mountPersonalAi(){
 const container=$('personal-ai-settings'),render=curriculumRender,revision=HOME.revision;
 try{
  const {mountPersonalAISettings}=await import('../features/assistant/PersonalAISettings.jsx');
  if(render!==curriculumRender||revision!==HOME.revision||!container.isConnected)return;
  curriculumUnmount=mountPersonalAISettings(container,{client:homeClient,user:HOME.user,onClose:()=>go('Inicio'),onBusy:value=>{if(revision===HOME.revision){if(value)HOME.saving.add('personal-ai');else HOME.saving.delete('personal-ai')}}});container.removeAttribute('aria-busy');
 }catch{if(render===curriculumRender&&container.isConnected)container.innerHTML=homeEmpty('Configuración no disponible','Reintenta para consultar tus claves.',false)+'<button class="h-btn" data-a="hretry">Reintentar</button>'}
}
function toolSurface(tool){
 if(!['Asesor IA','Brújula IA','Recursos'].includes(tool))return '';
 if(HOME.mode==='loading')return '<section class="blk" role="status">Cargando tus datos…</section>';
 if(HOME.mode!=='live')return '<section class="blk">'+homeEmpty(tool,HOME.user?'Reintenta la carga de tu perfil para abrir esta herramienta.':'Inicia sesión para consultar esta herramienta.')+'</section>';
 return '<div id="official-tool" aria-busy="true">Cargando '+homeEsc(tool)+'…</div>';
}
async function mountTool(){
 const container=$('official-tool'),render=curriculumRender,revision=HOME.revision;
 try{
  const {mountAcademicWorkspace}=await import('./AcademicWorkspace.jsx');
  if(render!==curriculumRender||revision!==HOME.revision||!container.isConnected)return;
  curriculumUnmount=mountAcademicWorkspace(container,{tool:cur==='Planificar'?'Brújula IA':cur==='Asistente'?'Asesor IA':'Recursos',client:homeClient,user:HOME.user,career:homeCareer(),preferences:SETUP.record?.preferences||{},statuses:HOME.statuses,done:[...HOME.done],plan:[...HOME.plan],onClose:destination=>go(destination||'Inicio'),onPlan:plan=>{if(revision===HOME.revision)HOME.plan=new Set(plan)},onBusy:value=>{if(revision===HOME.revision){if(value)HOME.saving.add('tool');else HOME.saving.delete('tool')}}});container.removeAttribute('aria-busy');
 }catch{if(render===curriculumRender&&container.isConnected)container.innerHTML=homeEmpty('Herramienta no disponible','Reintenta para abrirla.',false)+'<button class="h-btn" data-a="hretry">Reintentar</button>'}
}

$('page').onclick=e=>{const b=e.target.closest('[data-a]');if(!b)return;if(b.dataset.a.startsWith('h')){homeAction(b);return}const a=b.dataset.a,D=b.dataset;if(a==='wi'){if(fx.busy)return;const p=b.parentElement;p.scrollTo({top:[...p.children].indexOf(b)*40,behavior:'smooth'});return}if(a.startsWith('k'))kAction(a,D,b)};
function malla(){
 if(HOME.mode==='loading')return `<section class="blk" role="status"><h2 class="bt">Cargando tu malla…</h2><p class="h-muted">Estamos consultando tu carrera y tu avance.</p></section>`;
 if(HOME.mode==='error')return `<section class="blk">${homeEmpty('Tu malla no está disponible',HOME.error||'No pudimos cargar tu avance. Reintenta sin modificar tus datos.',false)}<div class="h-state-actions"><button class="h-btn primary" data-a="hretry">Reintentar</button><a class="h-btn" href="./login.html">Iniciar sesión</a></div></section>`;
 if(HOME.mode==='profile')return `<section class="blk">${homeReady(homeModel())}</section>`;
 return `<div id="official-curriculum" aria-busy="true"><p class="h-muted" role="status">Preparando el grafo de cursos…</p></div>`;
}
async function mountCurriculum(){
 const container=$('official-curriculum'),render=curriculumRender,revision=HOME.revision;
 try{
  const {mountOfficialCurriculum}=await import('../features/career/OfficialCurriculum.jsx');
  if(render!==curriculumRender||revision!==HOME.revision||!container.isConnected)return;
  const current=()=>revision===HOME.revision;
  curriculumUnmount=mountOfficialCurriculum(container,{
   career:HOME.career,catalog:homeCareer(),user:HOME.user,client:homeClient,sessionMode:HOME.mode,
   initialDone:HOME.done,initialPlan:HOME.plan,statuses:HOME.statuses,initialGrades:HOME.grades,currentSemester:SETUP.record?.preferences?.semester,
   onSemesterChange:semester=>{if(current()){SETUP.record={...(SETUP.record||{}),preferences:{...(SETUP.record?.preferences||{}),semester}};HOME.cycle=String(semester)}},
   onProgressChange:(done,plan)=>{if(current()){HOME.done=new Set(done);HOME.plan=new Set(plan)}},
   onStatusChange:(id,row)=>{if(current()){if(row)HOME.statuses[id]=row;else delete HOME.statuses[id]}},
   onGradeChange:(id,value)=>{if(current()){if(value===null)delete HOME.grades[id];else HOME.grades[id]=value}},
   onBusy:value=>{if(current()){if(value)HOME.saving.add('curriculum');else HOME.saving.delete('curriculum')}}
  });
  container.removeAttribute('aria-busy');
 }catch{
  if(render!==curriculumRender||!container.isConnected)return;
  container.innerHTML=homeEmpty('No se pudo abrir el grafo','Reintenta la carga para consultar tu malla.',false)+`<button class="h-btn" data-a="hretry">Reintentar</button>`;
 }
}
/* PC: barra completa/compacta; móvil: menú desplegable. */
let mode='full';
function go(name,parent,options={}){
 const route=resolveRoute(name,parent);name=route.kid||route.page;parent=route.kid?route.page:undefined;
 if(options.history!==false&&HOME.saving.size){toast('Espera a que termine el guardado');return}
 const changed=cur!==(parent||name)||kid!==(parent?name:null);
 if(changed&&options.history!==false)webNavigation?.push({page:parent||name,kid:parent?name:null,tab:HOME.tab,scroll:0});
 cur=parent||name;kid=parent?name:null;if(parent)ex[parent]=true;
 $('title').textContent=name;renderMobileDock();renderNav();$('page').scrollTop=0;renderPage();if(cur==='Inicio'&&HOME.mode==='live'&&HOME.user)void homeWidgetLoad(HOME.user,HOME.revision);navViewEnter(changed);
 if(Number.isFinite(options.scroll))requestAnimationFrame(()=>{$('page').scrollTop=options.scroll});
}
function renderNav(){const item=x=>{
  const open=!!ex[x.n];
  let h=`<button class="it${cur===x.n?' cur':''}" data-n="${x.n}" title="${x.n}"${x.kids?` aria-expanded="${open}"`:''}>${ic(x.i)}<span class="l">${x.n}</span>${x.kids?svg(open?'minus':'plus',16):''}</button>`;
  if(x.kids)h+=`<div class="sub${open?' ex':''}"><div>${x.kids.map(k=>`<button class="it${kid===k[0]&&cur===x.n?' sel':''}" data-k="${k[0]}" data-p="${x.n}">${ic(k[1])}<span class="l">${k[0]}</span></button>`).join('')}</div></div>`;
  return h};$('nav').innerHTML=NAV.filter(x=>!x.secondary).map(item).join('')+'<div class="nav-secondary" role="group" aria-label="Más herramientas"><p class="nav-secondary-label">Más herramientas</p>'+NAV.filter(x=>x.secondary).map(item).join('')+'</div>';navFlowPaint()}
$('dh').innerHTML=`<button class="brand" id="brand" title="Lyra">${lyraLogo('full','lyra-logo-full')}${lyraLogo('symbol','lyra-logo-symbol')}</button><span class="lyra-brand-spacer" aria-hidden="true"></span><button class="hb" id="bRail" aria-label="Contraer barra lateral" title="Contraer barra lateral">${svg('railc',18)}</button><button class="hb" id="bHide" aria-label="Ocultar menú" title="Ocultar menú">${svg('x',18)}</button>`;
$('trig').innerHTML=lyraLogo('symbol','lyra-logo-trigger');
$('uni').innerHTML=`<div class="um">${svg('landmark',20)}</div><div><b>Universidad ESAN</b><span>Tu espacio académico en Lyra</span></div>`;
function syncSide(){
 const hidden=app.dataset.side==='hidden',drawer=app.classList.contains('dopen');
 $('side').inert=hidden&&!drawer;$('side').setAttribute('aria-hidden',String($('side').inert));
 const blocking=mqM.matches&&drawer;
 $('page').inert=blocking;$('mobile-dock').inert=blocking;
 $('mobile-dock').setAttribute('aria-hidden',String(blocking));
}
function applySide(){
  const s=mqM.matches?'hidden':mode==='rail'?'rail':'full';
  app.dataset.side=s;app.classList.toggle('mob',mqM.matches);
  if(s!=='hidden')app.classList.remove('dopen');
  $('trig').setAttribute('aria-expanded',app.classList.contains('dopen'));
  $('brand').setAttribute('aria-label',s==='rail'?'Expandir barra lateral':'Lyra');$('brand').tabIndex=s==='rail'?0:-1;
  syncSide();renderMobileDock();
}
function setDrawer(o,restore){
  if(o&&app.dataset.side!=='hidden')return;
  app.classList.toggle('dopen',o);renderMobileDock();
  $('trig').setAttribute('aria-expanded',o);
  $('trig').setAttribute('aria-label',o?'Cerrar menú':'Abrir menú');
  syncSide();
  if(o){setMenu(false);setTimeout(()=>$('nav').querySelector('.it').focus({preventScroll:true}),60)}
  else if(restore)$('trig').focus({preventScroll:true});
}
const closeOverlay=()=>{if(app.dataset.side==='hidden')setDrawer(false,true)};
$('dh').onclick=e=>{const b=e.target.closest('button');if(!b)return;
  if(b.id==='bRail'){mode='rail';applySide();$('brand').focus()}
  else if(b.id==='bHide'){if(app.dataset.side==='hidden')setDrawer(false,true);else{mode='rail';applySide();$('brand').focus()}}
  else if(app.dataset.side==='rail'){mode='full';applySide()}};
$('nav').onclick=e=>{const b=e.target.closest('.it');if(!b)return;
  if(b.dataset.k){go(b.dataset.k,b.dataset.p);closeOverlay()}
  else{const x=NAV.find(y=>y.n===b.dataset.n);
    if(x.kids){if(app.dataset.side==='rail'){mode='full';applySide();ex[x.n]=true}else ex[x.n]=!ex[x.n];
      syncNavGroup(x.n)}
    else{go(x.n);closeOverlay()}}};
$('trig').onclick=()=>setDrawer(!app.classList.contains('dopen'),true);
mqM.addEventListener('change',applySide);


$('act').innerHTML=svg('user',23);
let tt;
const toast=m=>{const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),1400)};
const mq=matchMedia('(prefers-color-scheme: dark)');let ttm;
const isDark=()=>root.dataset.theme?root.dataset.theme==='dark':mq.matches;
/* Selector de tema: el indicador se estira hacia la opción elegida (el borde que avanza va primero) */
function renderProfile(){const d=isDark();
  $('menu').innerHTML=`<div class="tg" data-s="${d?'dark':'light'}" role="radiogroup" aria-label="Tema"><span class="thm" aria-hidden="true"></span>${[['dark','moon','Oscuro'],['light','sun','Claro']].map(t=>`<button class="tgb ${t[0]}" role="radio" aria-checked="${(t[0]==='dark')===d}" data-t="${t[0]}">${svg(t[1],16)}<span>${t[2]}</span></button>`).join('')}</div>`
  +[...(HOME.mode==='live'?[['personal-ai','sparkles','Mi IA · claves personales']]:[]),['arcade','gamepad','ARCADE'],...(HOME.mode==='live'&&SETUP.owner===HOME.user?.id&&!SETUP.record?.completed_at?[['setup','wrench','Configuración inicial']]:[]),...(HOME.user?[['export','copy','Exportar registro académico']]:[]),['out','logout','Cerrar sesión']].map(r=>`<button class="it" role="menuitem" data-a="${r[0]}">${ic(r[1])}<span class="l">${r[2]}</span></button>`).join('')}
function syncTg(){const g=$('menu').querySelector('.tg');if(!g)return;const d=isDark();g.dataset.s=d?'dark':'light';g.querySelectorAll('.tgb').forEach(b=>b.setAttribute('aria-checked',(b.dataset.t==='dark')===d))}
function setTheme(dark){if(dark===isDark())return;root.classList.add('tt');root.dataset.theme=dark?'dark':'light';syncTg();clearTimeout(ttm);ttm=setTimeout(()=>root.classList.remove('tt'),900)}
$('menu').onclick=e=>{const t=e.target.closest('.tgb');if(t){setTheme(t.dataset.t==='dark');return}
  const b=e.target.closest('.it');if(!b)return;const a=b.dataset.a;
  if(a==='personal-ai'){setMenu(false);go('Mi IA');return}
  if(a==='arcade'){setMenu(false);arcOpen();return}
  if(a==='setup'){setMenu(false);setupOpen();return}
  if(a==='export'){setMenu(false);void exportAcademicRecord();return}
  homeSignOut();};
$('menu').addEventListener('keydown',e=>{const t=e.target.closest&&e.target.closest('.tgb');if(!t||(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'))return;
  e.preventDefault();const dk=e.key==='ArrowLeft';setTheme(dk);$('menu').querySelector(dk?'.tgb.dark':'.tgb.light').focus({preventScroll:true})});
mq.addEventListener('change',renderProfile);
let profileCloseTimer=0;
function setMenu(o,restoreFocus){
  const menu=$('menu');clearTimeout(profileCloseTimer);
  if(o)setDrawer(false);
  menu.inert=!o;menu.setAttribute('aria-hidden',!o);
  $('act').setAttribute('aria-expanded',o);
  $('act').setAttribute('aria-label',o?'Cerrar perfil':'Abrir perfil');
  if(o){
    menu.hidden=false;app.classList.add('open');renderMobileDock();
    if(menu.animate)menu.animate(navReduced()?[{opacity:.75},{opacity:1}]:[
      {opacity:0,transform:'translateY(-6px) scale(.96)'},
      {opacity:1,transform:'none'}
    ],{duration:navReduced()?140:480,easing:'cubic-bezier(.22,.7,.25,1)'});
    setTimeout(()=>{if(app.classList.contains('open'))menu.querySelector('.tgb[aria-checked="true"],.it')?.focus({preventScroll:true})},60);
  }else{
    app.classList.remove('open');renderMobileDock();
    profileCloseTimer=setTimeout(()=>{if(!app.classList.contains('open'))menu.hidden=true},navReduced()?0:240);
    if(restoreFocus)$('act').focus({preventScroll:true});
  }
}

$('act').onclick=()=>setMenu(!app.classList.contains('open'),true);
$('scrim').onclick=()=>{setMenu(false);setDrawer(false)};
document.addEventListener('keydown',e=>{if(e.key!=='Escape'||ARC.open)return;if(app.classList.contains('open'))setMenu(false,true);else if(app.classList.contains('dopen'))setDrawer(false,true)});
/* Calm navigation feedback; each new selection interrupts the previous motion. */
const NAV_MOTION={ready:false,mark:null,view:null,feedback:[],ease:'cubic-bezier(.22,.7,.25,1)'};
const navReduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
function navMark(){const b=$('nav').querySelector('.it.cur');return b?{top:b.offsetTop,left:b.offsetLeft,width:b.offsetWidth,height:b.offsetHeight}:null;}
function navFlowPaint(){
 const next=navMark(),prev=NAV_MOTION.mark;NAV_MOTION.mark=next;
 if(!next||!prev||!NAV_MOTION.ready||navReduced()||Math.abs(prev.top-next.top)<1)return;
 const el=document.createElement('span');el.className='nav-flow';el.setAttribute('aria-hidden','true');
 Object.assign(el.style,{top:next.top+'px',left:next.left+'px',width:next.width+'px',height:next.height+'px'});$('nav').prepend(el);
 const motion=el.animate([
  {transform:`translateY(${prev.top-next.top}px) scaleX(${prev.width/next.width})`,opacity:.85},
  {transform:`translateY(${(prev.top-next.top)*.16}px) scaleY(1.09)`,opacity:1,offset:.52},
  {transform:'none',opacity:0}
 ],{duration:620,easing:NAV_MOTION.ease});
 motion.finished.then(()=>el.remove(),()=>el.remove());
}
function navViewEnter(changed){
 if(!changed||!NAV_MOTION.ready)return;
 NAV_MOTION.view?.cancel();const el=$('page').querySelector('.view-surface');if(!el||!el.animate)return;
 const reduced=navReduced(),mobile=mqM.matches;
 NAV_MOTION.view=el.animate(reduced?[{opacity:.92},{opacity:1}]:[
  {opacity:.86,transform:mobile?'translateY(3px)':'translateX(6px)'},
  {opacity:1,transform:'none'}
 ],{duration:reduced?100:mobile?180:280,easing:NAV_MOTION.ease});
}
function syncNavGroup(name){
 const button=[...$('nav').querySelectorAll('[data-n]')].find(b=>b.dataset.n===name);if(!button)return;
 const expanded=!!ex[name];button.setAttribute('aria-expanded',expanded);
 const arrow=button.querySelector(':scope > svg');if(arrow)arrow.outerHTML=svg(expanded?'minus':'plus',16);
 button.nextElementSibling?.classList.toggle('ex',expanded);
 button.focus({preventScroll:true});
}
$('nav').addEventListener('click',()=>{NAV_MOTION.mark=navMark()},true);
$('nav').addEventListener('click',e=>{
 const old=e.target.closest('.it');if(!old)return;
 const current=[...$('nav').querySelectorAll('.it')].find(b=>b.dataset.n===old.dataset.n&&b.dataset.k===old.dataset.k&&b.dataset.p===old.dataset.p);
 if(!current?.animate)return;NAV_MOTION.feedback.forEach(a=>a.cancel());NAV_MOTION.feedback=[];
 if(navReduced()){NAV_MOTION.feedback.push(current.animate([{opacity:.88},{opacity:1}],{duration:140}));return}
 NAV_MOTION.feedback.push(current.animate([{transform:'scale(.975)'},{transform:'none'}],{duration:580,easing:NAV_MOTION.ease}));
 const icon=current.querySelector('.ic');if(icon)NAV_MOTION.feedback.push(icon.animate([
  {transform:'scale(.92) rotate(-5deg)'},
  {transform:'scale(1.04) rotate(2deg)',offset:.45},
  {transform:'none'}
 ],{duration:620,easing:NAV_MOTION.ease}));
});
/* General button feedback complements the sidebar selection motion. */
const WEB_PRESS=new WeakMap();
function webButtonFeedback(b,keyboard=false){
  if(!b?.isConnected||b.disabled||b.closest('#nav, #mobile-dock')||b.classList.contains('gm-card')||!b.animate)return;
  WEB_PRESS.get(b)?.cancel();
  const reduced=navReduced();
  const a=b.animate(reduced?[{opacity:.82},{opacity:1}]:[
    {scale:keyboard?'.985':'.97'},
    {scale:'1'}
  ],{duration:reduced?140:480,easing:NAV_MOTION.ease});WEB_PRESS.set(b,a);
}
document.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;webButtonFeedback(e.target.closest('button'));
},true);
document.addEventListener('click',e=>{
  if(e.detail===0)webButtonFeedback(e.target.closest('button'),true);
},true);

const GAME_BACKGROUND=['page','side','top','bmod','toast','scrim'];
/* Original, quiet console-style chimes. Audio begins only after an action. */
const GM_SOUND={enabled:true,context:null,master:null,voices:[]};
try{GM_SOUND.enabled=localStorage.getItem('esan.arcade.sound')!=='off'}catch{}
function gmSoundIcon(on){return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/>${on?'<path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>':'<path d="m16 9 5 6m0-6-5 6"/>'}</svg>`}
function gmSoundSync(){
 const b=$('arc').querySelector('[data-gm="sound"]');if(!b)return;
 const supported=!!(window.AudioContext||window.webkitAudioContext);
 b.disabled=!supported;b.setAttribute('aria-pressed',GM_SOUND.enabled&&supported);
 b.setAttribute('aria-label',supported?(GM_SOUND.enabled?'Silenciar sonidos':'Activar sonidos'):'Sonido no disponible');
 b.title=b.getAttribute('aria-label');b.innerHTML=gmSoundIcon(GM_SOUND.enabled&&supported);
}
function gmSoundContext(){
 if(GM_SOUND.context)return GM_SOUND.context;
 const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return null;
 try{
  const c=new Audio({latencyHint:'interactive'}),master=c.createGain();
  master.gain.value=.13;master.connect(c.destination);
  const delay=c.createDelay(.2),echo=c.createGain(),feedback=c.createGain();
  delay.delayTime.value=.075;echo.gain.value=.18;feedback.gain.value=.1;
  master.connect(delay);delay.connect(echo);echo.connect(c.destination);delay.connect(feedback);feedback.connect(delay);
  GM_SOUND.context=c;GM_SOUND.master=master;return c;
 }catch{return null}
}
function gmSoundStop(){
 const c=GM_SOUND.context;if(!c)return;
 const t=c.currentTime;
 GM_SOUND.voices.forEach(v=>{
  if(v.ended)return;v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setTargetAtTime(0,t,.008);
  try{v.oscillator.stop(t+.035)}catch{}
 });GM_SOUND.voices=[];
}
function gmSoundSchedule(c,destination,kind,start=c.currentTime+.008){
 const voices=[];
 const note=(frequency,offset,duration,amplitude,glide=frequency)=>{
  [1,2.005].forEach((harmonic,i)=>{
   const oscillator=c.createOscillator(),gain=c.createGain(),t=start+offset;
   oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency*harmonic,t);
   oscillator.frequency.exponentialRampToValueAtTime(glide*harmonic,t+Math.min(.09,duration*.4));
   gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(amplitude*(i?.18:1),t+.008);
   gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
   oscillator.connect(gain);gain.connect(destination);
   const voice={oscillator,gain,ended:false};voices.push(voice);
   oscillator.onended=()=>{voice.ended=true;oscillator.disconnect();gain.disconnect()};
   oscillator.start(t);oscillator.stop(t+duration+.02);
  });
 };
 if(kind==='confirm'){
  note(523.25,0,.31,.5);note(659.25,.065,.31,.4);note(783.99,.13,.32,.44);
 }else{
  note(659.25,0,.19,.52,698.46);note(1046.5,.025,.16,.18);
 }
 return voices;
}
function gmSoundPlay(kind){
 if(!GM_SOUND.enabled||document.hidden)return;
 const c=gmSoundContext();if(!c)return;
 if(c.state==='suspended')c.resume().catch(()=>{});
 gmSoundStop();GM_SOUND.master.gain.cancelScheduledValues(c.currentTime);
 GM_SOUND.master.gain.setTargetAtTime(.13,c.currentTime,.01);
 GM_SOUND.voices=gmSoundSchedule(c,GM_SOUND.master,kind);
}
function gmSoundToggle(){
 GM_SOUND.enabled=!GM_SOUND.enabled;
 try{localStorage.setItem('esan.arcade.sound',GM_SOUND.enabled?'on':'off')}catch{}
 if(!GM_SOUND.enabled){gmSoundStop();if(GM_SOUND.master)GM_SOUND.master.gain.setTargetAtTime(0,GM_SOUND.context.currentTime,.01)}
 arcadeGameUnmount?.setSound?.(GM_SOUND.enabled);
 gmSoundSync();if(GM_SOUND.enabled)gmSoundPlay('move');
}
function gmSoundSuspend(){gmSoundStop();GM_SOUND.context?.suspend().catch(()=>{})}
/* Demonstration games and cover-flow shared by both standalone HTML files. */
const ARC={open:false,active:0,filter:'all',auto:0,game:null,timers:[],returnFocus:null,drag:null,closing:0,stage:null,raf:0,n:-1,sg:-1,transition:null};
let arcadeGameUnmount=null;
const GAMES=[
 {id:'memory',name:'Memoria',tag:'Encuentra las parejas',cat:'educational',time:'2–3 min',a:'#b93427',b:'#eeb82e',bg:'#b5372c',desc:'Cada carta tiene una pareja. Observa, recuerda y encuéntralas.',skill:'Atención y memoria'},
 {id:'geoduelo',name:'Geoduelo',tag:'Un globo, dos jugadores',cat:'educational',time:'10–20 min',a:'#b84d0d',b:'#216fb6',bg:'#e9eef2',desc:'Un globo y dos jugadores. Ubica países, arriesga tus puntos y roba lo que tu rival no se sepa.',skill:'Geografía y atención · 2 jugadores'},
 {id:'logic',name:'Reto lógico',tag:'Una idea lleva a otra',cat:'educational',time:'3 min',a:'#1635af',b:'#b484df',bg:'#2037ad',desc:'Descubre patrones y resuelve cinco retos a tu ritmo.',skill:'Razonamiento'},
 {id:'dino',name:'Dino Run+',tag:'Salta y supera tu récord',cat:'arcade',time:'Libre',a:'#276846',b:'#bbd482',bg:'#285c45',desc:'El dinosaurio vuelve con sus modos de juego y tu mejor puntaje por temporada.',skill:'Coordinación y reflejos'},
 {id:'galaxia',name:'Escuadrón Galáctico',tag:'Defiende tu escuadrón',cat:'arcade',time:'Libre',a:'#19468c',b:'#d38cc5',bg:'#15316a',desc:'Pilota tu nave, esquiva disparos y supera las oleadas.',skill:'Atención y coordinación'},
 {id:'quiz',name:'Quiz académico',tag:'Pon tus ideas a prueba',cat:'educational',time:'3 min',a:'#a33f92',b:'#fe8750',bg:'#86368c',desc:'Cinco preguntas de economía, estadística y gestión, con explicación.',skill:'Conocimientos'},
 {id:'reaction',name:'Reflejos',tag:'Espera. Mira. Reacciona.',cat:'arcade',time:'1 min',a:'#b8620e',b:'#eea933',bg:'#d99b24',desc:'Espera el verde y toca. Descubre tu tiempo de reacción.',skill:'Velocidad de respuesta'}
];
const gameList=()=>GAMES.filter(g=>ARC.filter==='all'||g.cat===ARC.filter);
const gmPlayIcon=()=>'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 4v16l13-8z"/></svg>';
const gmPauseIcon=()=>'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
function gmArt(id){
 if(id==='geoduelo')return '<img src="./juegos/geoduelo/cover.svg" width="280" height="292" alt="" loading="lazy" decoding="async">';
 let p='';
 if(id==='memory'){
  p='<rect width="280" height="292" fill="#ba3129"/><circle cx="230" cy="37" r="150" fill="#f7bb39" opacity=".5"/>';
  [[47,45,-12,'#ffe4a6'],[140,56,13,'#74211f'],[56,152,7,'#782221'],[153,159,-9,'#ffe4a6']].forEach(([x,y,r,c],i)=>p+=`<g transform="translate(${x} ${y}) rotate(${r} 40 52)"><rect width="80" height="104" rx="12" fill="${c}"/>${i===0||i===3?'<path d="m40 22 7 21 22 7-22 7-7 21-7-21-22-7 22-7z" fill="#b53525"/>':'<path d="M23 32h34v34H23z" fill="none" stroke="#f9c965" stroke-width="3"/><path d="m23 32 34 34M57 32 23 66" stroke="#f9c965" stroke-width="2"/>'}</g>`);
 }else if(id==='logic'){
  p='<rect width="280" height="292" fill="#202a86"/><circle cx="255" cy="75" r="175" fill="#3d56d7"/>';
  for(let y=0;y<3;y++)for(let x=0;x<3;x++){let n=y*3+x;p+=`<rect x="${39+x*69}" y="${51+y*69}" width="60" height="60" rx="13" fill="${['#ef9dce','#c3b6f7','#f6d1a8'][n%3]}"/><text x="${69+x*69}" y="${90+y*69}" font-family="system-ui,sans-serif" font-size="29" font-weight="600" text-anchor="middle" fill="#252780">${n===8?'?':n+1}</text>`;}
 }else if(id==='dino'){
  p='<rect width="280" height="292" fill="#285c45"/><path d="M0 235h280" stroke="#d3e9b1" stroke-width="4"/><path d="M95 175v-45h25v-35h60v40h-37v32h-24v24h-15v-16zM117 190v44m35-52v52" fill="#d3e9b1" stroke="#d3e9b1" stroke-width="12"/><rect x="158" y="108" width="6" height="6" fill="#285c45"/>';
 }else if(id==='galaxia'){
  p='<rect width="280" height="292" fill="#15316a"/><path d="m140 80 54 112-54-24-54 24z" fill="#d8e2fa"/><path d="m140 118 18 41h-36z" fill="#477bb0"/><path d="M127 189v34m26-34v34" stroke="#f3b878" stroke-width="6"/><circle cx="51" cy="54" r="3" fill="#f5f6fa"/><circle cx="225" cy="87" r="3" fill="#f5f6fa"/>';
 }else if(id==='quiz'){
  p='<rect width="280" height="292" fill="#79317d"/><circle cx="235" cy="40" r="170" fill="#b64985"/><g transform="rotate(-8 140 146)"><rect x="43" y="39" width="194" height="218" rx="18" fill="#ffe7d9"/><text x="65" y="81" fill="#7a3777" font-family="system-ui,sans-serif" font-size="21" font-weight="700">QUIZ</text><path d="M65 103h100M65 116h67" stroke="#af708d" stroke-width="5" stroke-linecap="round"/><rect x="62" y="138" width="157" height="30" rx="9" fill="#edbbbe"/><rect x="62" y="176" width="157" height="30" rx="9" fill="#7b4084"/><path d="m76 191 7 6 11-13" fill="none" stroke="#ffe7d9" stroke-width="3" stroke-linecap="round"/><rect x="62" y="214" width="157" height="23" rx="8" fill="#edbbbe"/></g>';
 }else{
  p='<rect width="280" height="292" fill="#d99827"/><circle cx="30" cy="277" r="180" fill="#bd531c"/><circle cx="145" cy="148" r="99" fill="none" stroke="#ffe2a5" stroke-width="1.5"/><circle cx="145" cy="148" r="76" fill="none" stroke="#ffe2a5" stroke-width="2"/><circle cx="145" cy="148" r="51" fill="#271e20"/><path d="m154 112-36 40h22l-8 33 38-43h-24z" fill="#ffd273"/><circle cx="145" cy="49" r="6" fill="#271e20"/><circle cx="244" cy="148" r="6" fill="#271e20"/><circle cx="145" cy="247" r="6" fill="#271e20"/>';
 }
 return `<svg viewBox="0 0 280 292" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${p}</svg>`;
}
function arcHTML(){return `<div class="gm-ambient" aria-hidden="true">${GAMES.map(g=>`<div class="gm-aura" data-glow="${g.id}" style="--a:${g.a};--b:${g.b}"></div>`).join('')}</div>
 <header class="gm-header"><div class="gm-brand">${svg('gamepad',23)}<span>ESAN<i></i><b>Arcade</b></span></div><div class="gm-top-controls"><button class="gm-icon gm-sound" data-gm="sound" aria-pressed="true" aria-label="Silenciar sonidos" title="Silenciar sonidos">${gmSoundIcon(true)}</button><button class="gm-icon gm-auto" data-gm="auto" aria-pressed="false" aria-label="Activar recorrido automático" title="Recorrido automático">${gmPlayIcon()}</button><button class="gm-icon gm-back" id="arx" data-gm="close" aria-label="Salir de Arcade">${svg('x',18)}<span>Salir</span></button></div></header>
 <div class="gm-content" id="gmgallery"><h2 class="gm-heading">Una pausa para jugar.</h2><p class="gm-intro">Encuentra tu próximo reto y cambia de ritmo.</p><div class="gm-filters" role="group" aria-label="Categoría de juegos">${[['all','Todos'],['arcade','Arcade'],['educational','Educativos']].map(([v,t])=>`<button class="gm-filter${ARC.filter===v?' on':''}" data-gm="filter" data-filter="${v}" aria-pressed="${ARC.filter===v}">${t}</button>`).join('')}</div>
 <section class="gm-shelf" id="gmshelf" aria-label="Elegir juego" aria-roledescription="carrusel" tabindex="0"></section>
 <div class="gm-selection" id="gmselection" aria-live="polite" aria-atomic="true"></div><div class="gm-dots" id="gmdots" role="group" aria-label="Seleccionar juego"></div>
 <div class="gm-dock"><button class="gm-icon" data-gm="prev" aria-label="Juego anterior">${svg('chevl',21)}</button><button class="gm-icon" data-gm="next" aria-label="Juego siguiente">${svg('chevr',21)}</button><div class="gm-dock-art" id="gmthumb" aria-hidden="true"></div><div class="gm-now" id="gmnow"></div><button class="gm-play-button" id="gmstart" data-gm="play">${gmPlayIcon()}Jugar</button></div>
 <p class="gm-footer"><span class="gm-touch">Desliza para explorar · </span><span class="gm-desktop-hint">Usa las flechas para explorar · </span>${gameList().length} juegos</p></div>
 <section class="gm-play" id="gmplay" aria-label="Juego activo" hidden></section>`;}
function gmCards(){const list=gameList();$('gmshelf').innerHTML=list.map((g,i)=>`<button class="gm-card" data-gm="select" data-index="${i}" tabindex="-1" aria-label="Seleccionar ${g.name}" aria-pressed="false"><span class="gm-art" style="--artbg:${g.bg}">${gmArt(g.id)}</span><span class="gm-card-copy"><strong>${g.name}</strong><small>${g.tag}</small></span></button>`).join('');$('gmdots').innerHTML=list.map((g,i)=>`<button class="gm-dot" data-gm="select" data-index="${i}" aria-label="Ver ${g.name}" aria-pressed="false"></button>`).join('');gmPaint();}
function gmPaint(){const list=gameList(),n=list.length,g=list[ARC.active];if(!g)return;
 [...$('gmshelf').children].forEach((el,i)=>{let d=i-ARC.active;if(d>n/2)d-=n;if(d<-n/2)d+=n;const a=Math.abs(d);el.style.cssText=`--shift:${d};--drop:${a*17};--turn:${-d*19};--lean:${d*3};--scale:${1-a*.11};--z:${10-a};--opacity:${a>2?0:1};--bright:${1-a*.13}`;el.classList.toggle('front',!d);el.setAttribute('aria-pressed',!d);el.setAttribute('aria-hidden',a>2);el.inert=a>2;});
 [...$('gmdots').children].forEach((b,i)=>{b.classList.toggle('on',i===ARC.active);b.setAttribute('aria-pressed',i===ARC.active)});
 $('arc').querySelectorAll('[data-glow]').forEach(el=>el.classList.toggle('on',el.dataset.glow===g.id));
 $('arc').querySelector('.gm-footer').lastChild.textContent=list.length+' juegos';
 $('gmselection').innerHTML=`<p class="gm-desc">${g.desc}</p><p class="gm-meta">${g.skill} · ${g.time}</p>`;$('gmnow').innerHTML=`<b>${g.name}</b><small>${g.cat==='arcade'?'Arcade':'Educativo'} · ${g.time}</small>`;$('gmthumb').innerHTML=gmArt(g.id);$('gmstart').setAttribute('aria-label','Jugar '+g.name);
}
function gmMove(d,audible=true){const list=gameList();ARC.active=(ARC.active+d+list.length)%list.length;gmPaint();if(audible)gmSoundPlay('move');}
function gmStopAuto(){clearInterval(ARC.auto);ARC.auto=0;$('arc').querySelectorAll('.gm-auto').forEach(b=>{b.setAttribute('aria-pressed',false);b.setAttribute('aria-label','Activar recorrido automático');b.innerHTML=gmPlayIcon()});}
function gmAuto(){if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;if(ARC.auto){gmStopAuto();return}ARC.auto=setInterval(()=>{if(!document.hidden&&!ARC.game&&!ARC.drag)gmMove(1)},4200);$('arc').querySelectorAll('.gm-auto').forEach(b=>{b.setAttribute('aria-pressed',true);b.setAttribute('aria-label','Pausar recorrido automático');b.innerHTML=gmPauseIcon()});}
function gmClearTimers(){ARC.timers.forEach(t=>{clearInterval(t);clearTimeout(t)});ARC.timers=[];}
function gmLater(fn,t){const id=setTimeout(()=>{if(ARC.open&&ARC.game)fn()},t);ARC.timers.push(id);return id;}
const ARF={A:['01110','10001','10001','11111','10001','10001','10001'],C:['01110','10001','10000','10000','10000','10001','01110'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],N:['10001','11001','10101','10101','10011','10001','10001'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110']};
const arMap=m=>{let s='';m.forEach((r,y)=>{let x=0;while(x<r.length){const c=r[x];if(c==='#'||c==='o'){let e=x;while(r[e+1]===c)e++;s+=`<rect x="${x}" y="${y}" width="${e-x+1}" height="1"${c==='o'?' class="eye"':''}/>`;x=e+1}else x++}});return s};
const arPix=(w,d0)=>{let x=0,g='';[...w].forEach((ch,i)=>{let p='';ARF[ch].forEach((row,y)=>{[...row].forEach((v,c)=>{if(v==='1')p+=`M${x+c} ${y}h1v1h-1z`})});g+=`<g class="gl" style="--d:${(d0+i*.09).toFixed(2)}s"><path d="${p}"/></g>`;x+=6});return`<svg viewBox="0 0 ${x-1} 7" aria-hidden="true"><g class="sh" transform="translate(.55 .55)">${g}</g><g>${g}</g></svg>`};
const arSun=()=>{const N=31,skip=new Set([17,19,21,22,24,25,27,28]);let s='';for(let y=0;y<N;y++){if(skip.has(y))continue;const dy=y+.5-15.5,w=Math.sqrt(15.5*15.5-dy*dy),x0=Math.round(15.5-w),x1=Math.round(15.5+w);s+=`<rect x="${x0}" y="${y}" width="${x1-x0}" height="1"/>`}return`<svg viewBox="0 0 ${N} ${N}" aria-hidden="true">${s}</svg>`};
const arCloud=(y,t,d,w)=>`<svg class="ar-cl" style="top:${y}%;--t:${t}s;--d:${d}s;width:${w}px" viewBox="0 0 15 5" aria-hidden="true">${[[5,8],[3,11],[1,13],[0,14],[1,13]].map((r,i)=>`<rect x="${r[0]}" y="${i}" width="${r[1]-r[0]+1}" height="1"/>`).join('')}</svg>`;
const arStar=(x,y,d)=>`<svg class="ar-st" style="left:${x}%;top:${y}%;animation-delay:${d}s" viewBox="0 0 3 3" aria-hidden="true"><path d="M1 0h1v1h1v1h-1v1h-1v-1h-1v-1h1z"/></svg>`;
const arHeart=()=>`<svg viewBox="0 0 7 6" aria-hidden="true">${arMap(['.##.##.','#######','#######','.#####.','..###..','...#...'])}</svg>`;
const arHero=()=>{const body=['.###########','###########.','...######...','..########..','..##o##o##..','..########..','...######...','.##########.','.##.####.##.','.##.####.##.','....####....'];
  const A=['...##..##...','..##....##..','.###....###.'],B=['....####....','....####....','...######...'];
  return`<svg viewBox="0 0 12 14" aria-hidden="true">${arMap(body)}<g class="fa">${arMap([...Array(11).fill(''),...A])}</g><g class="fb">${arMap([...Array(11).fill(''),...B])}</g></svg>`};
const arCoin=(h,d)=>`<div class="ar-coin" style="--h:${h}px;--d:${d}s"><svg viewBox="0 0 6 6" aria-hidden="true">${arMap(['.####.','######','##oo##','##oo##','######','.####.'])}</svg></div>`;
function arIntroHTML(){
  return`<div class="ar-hud"><div><small>1UP</small><b id="arsc">0000000</b></div><div class="ar-lives" role="img" aria-label="3 vidas">${arHeart()+arHeart()+arHeart()}</div><div class="r"><small>HI</small><b>0030000</b></div></div>
<div class="ar-scene">
<div class="ar-sky"><div class="ar-sun">${arSun()}</div>${arStar(9,8,0)+arStar(90,12,.5)+arStar(78,52,1.1)+arStar(16,58,.7)+arStar(48,3,.3)}${arCloud(30,46,-12,56)+arCloud(14,70,-40,40)+arCloud(44,58,-26,48)}</div>
<div class="ar-floor"><div class="ar-plane"></div></div>
<div class="ar-title">${arPix('ESAN',.35)}${arPix('ARCADE',.8)}<p class="ar-tag">JUEGA · APRENDE · GANA</p></div>
${arCoin(8,0)+arCoin(54,.35)+arCoin(8,.7)}
<div class="ar-hero">${arHero()}</div>
<div class="ar-gr"><i></i><i></i></div>
</div>
<div class="ar-ui">
<div class="ar-chips"><div class="ar-chip" id="arc1">${svg('gamepad',20)}<span><b>ARCADE</b><em>Juegos casuales</em></span></div><div class="ar-chip" id="arc2">${svg('cap',20)}<span><b>EDUCATIVOS</b><em>Aprende jugando</em></span></div></div>
<div class="ar-bar"><div class="ar-blk" id="arbk" role="progressbar" aria-label="Preparando Arcade" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${'<i></i>'.repeat(20)}</div><b class="ar-pc" id="arpc">0%</b></div>
<p class="ar-stx" id="arst" role="status" aria-live="polite"></p>
<div class="ar-btns"><button class="ar-b go" id="argo" disabled>Jugar</button><button class="ar-b" id="arx">Salir</button></div>
</div>`}
const ARP=[[0,0],[350,6],[800,20],[1150,23],[1800,56],[2150,60],[2800,91],[3250,100]];
const ARS=[[25,'Encendiendo la máquina'],[55,'Cargando juegos arcade'],[85,'Preparando retos educativos'],[100,'Casi listo']];
const arRM=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function arSet(p){
  const pc=Math.min(100,Math.floor(p));
  $('arpc').textContent=pc+'%';
  $('arsc').textContent=String(Math.round(p*300)).padStart(7,'0');
  const lit=Math.floor(p/5);
  if(lit!==ARC.n){ARC.n=lit;[...document.querySelectorAll('#arc .ar-blk i')].forEach((b,i)=>b.classList.toggle('on',i<lit));$('arbk').setAttribute('aria-valuenow',pc)}
  $('arc1').classList.toggle('on',p>=40);$('arc2').classList.toggle('on',p>=80);
  const s=ARS.findIndex(x=>p<x[0]);
  if(s!==ARC.sg&&s>=0){ARC.sg=s;$('arst').innerHTML=`${ARS[s][1]}<span class="d" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>`}
}
function arReady(){
  const el=$('arc');arSet(100);el.classList.add('rdy');
  $('arst').textContent='¡Listo para jugar!';
  $('arpc').textContent='100%';$('arbk').setAttribute('aria-valuenow',100);
  $('arc1').classList.add('on');$('arc2').classList.add('on');
  $('argo').disabled=false;$('argo').focus({preventScroll:true})}

function arcOpen(){
 if(ARC.open)return;
 clearTimeout(ARC.closing);ARC.open=true;ARC.stage='intro';ARC.n=-1;ARC.sg=-1;ARC.active=0;
 ARC.returnFocus=document.activeElement;const el=$('arc');
 el.classList.remove('out','rdy','gallery-ready');el.classList.add('arc-intro');
 el.innerHTML='<div class="ar-boot">'+arIntroHTML()+'</div>';
 el.hidden=false;el.setAttribute('aria-hidden','false');
 ARC.background=GAME_BACKGROUND.map(i=>$(i)).filter(Boolean).map(el=>({el,inert:el.inert}));
 ARC.background.forEach(({el})=>el.inert=true);$('arx').focus({preventScroll:true});
 arSet(0);
 if(arRM()){arReady();return}
 const t0=performance.now();
 const tick=now=>{
  if(!ARC.open||ARC.stage!=='intro')return;
  const t=now-t0;let p=100;
  for(let i=1;i<ARP.length;i++){if(t<ARP[i][0]){const a=ARP[i-1],b=ARP[i];p=a[1]+(b[1]-a[1])*(t-a[0])/(b[0]-a[0]);break}}
  if(p<100){arSet(p);ARC.raf=requestAnimationFrame(tick)}else arReady();
 };
 ARC.raf=requestAnimationFrame(tick);
}
function arGallery(){
 if(!ARC.open||ARC.stage!=='intro'||$('argo').disabled)return;
 cancelAnimationFrame(ARC.raf);gmSoundPlay('confirm');ARC.stage='transition';$('argo').disabled=true;
 const show=()=>{
  if(!ARC.open||ARC.stage!=='transition')return;
  const el=$('arc');ARC.transition=null;ARC.stage='gallery';
  el.classList.remove('arc-intro','rdy');el.classList.add('gallery-ready');
  el.innerHTML=arcHTML();gmCards();gmSoundSync();gmBindSwipe();$('gmstart').focus({preventScroll:true});
  const gallery=$('gmgallery');if(gallery.animate)gallery.animate(arRM()?[{opacity:.65},{opacity:1}]:[
   {opacity:.25,transform:'scale(.99)'},{opacity:1,transform:'none'}
  ],{duration:arRM()?140:520,easing:'cubic-bezier(.22,.7,.25,1)'});
 };
 if(arRM()){show();return}
 ARC.transition=$('arc').querySelector('.ar-boot').animate([{opacity:1},{opacity:0}],{duration:240,easing:'ease',fill:'forwards'});
 ARC.transition.finished.then(show,()=>{});
}
function arcClose(){
 if(!ARC.open)return;
 arcadeGameUnmount?.();arcadeGameUnmount=null;
 ARC.open=false;cancelAnimationFrame(ARC.raf);ARC.transition?.cancel();ARC.transition=null;
 gmStopAuto();gmClearTimers();gmSoundSuspend();ARC.game=null;ARC.drag=null;ARC.stage=null;
 const el=$('arc');el.classList.add('out');
 ARC.closing=setTimeout(()=>{
  if(ARC.open)return;
  el.hidden=true;el.innerHTML='';el.setAttribute('aria-hidden','true');
  el.classList.remove('arc-intro','rdy','gallery-ready');
  ARC.background.forEach(({el,inert})=>el.inert=inert);
  if(ARC.returnFocus?.isConnected&&!ARC.returnFocus.closest('[inert]'))ARC.returnFocus.focus({preventScroll:true});
  else $('act').focus({preventScroll:true});
 },arRM()?30:400);
}
function gmBindSwipe(){const el=$('gmshelf');el.onpointerdown=e=>{if(e.button!==0||ARC.game)return;gmStopAuto();ARC.drag={x:e.clientX,y:e.clientY,id:e.pointerId,moved:false};};el.onpointermove=e=>{const d=ARC.drag;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){d.moved=true;el.classList.add('dragging');$('arc').style.setProperty('--drag',Math.max(-100,Math.min(100,dx))+'px');}};
 const end=e=>{const d=ARC.drag;if(!d||d.id!==e.pointerId)return;el.classList.remove('dragging');$('arc').style.removeProperty('--drag');if(d.moved){ARC.suppressClick=true;if(e.type!=='pointercancel'&&Math.abs(e.clientX-d.x)>36)gmMove(e.clientX<d.x?1:-1);setTimeout(()=>ARC.suppressClick=false,50)}ARC.drag=null;};el.onpointerup=end;el.onpointercancel=end;el.onpointerleave=e=>{if(e.pointerType==='mouse')end(e)};}
function gmGameShell(g){return `<div class="gm-play-top"><div class="gm-play-label"><h2>${g.name}</h2><p class="gm-confirmed" role="status">${svg('tick',15)}Juego iniciado</p></div><button class="gm-small-button" data-gm="library">${svg('chevl',16)}Volver a juegos</button></div><div class="gm-game-body" id="gmbody"></div>`;}
function gmStart(){arcadeGameUnmount?.();arcadeGameUnmount=null;gmStopAuto();gmClearTimers();gmSoundPlay('confirm');const g=gameList()[ARC.active];ARC.game={id:g.id};$('arc').querySelectorAll('.gm-auto').forEach(b=>b.hidden=true);$('gmgallery').inert=true;$('gmgallery').setAttribute('aria-hidden','true');$('gmplay').innerHTML=gmGameShell(g);$('gmplay').hidden=false;$('gmplay').classList.toggle('gm-geoduelo',g.id==='geoduelo');
 if(g.id==='memory')gmMemory();else if(['dino','galaxia','geoduelo'].includes(g.id))gmMountRestored(g);else if(g.id==='reaction')gmReaction();else gmQuiz(g.id);
 $('gmplay').scrollTop=0;$('gmplay').querySelector('[data-gm="library"]').focus({preventScroll:true});}
async function gmMountRestored(g){
 const game=ARC.game,container=$('gmbody');container.innerHTML='<p role="status">Preparando '+g.name+'…</p>';
 try{const {mountOfficialArcadeGame}=await import('../features/arcade/OfficialArcadeGame.jsx');if(!container.isConnected||ARC.game!==game)return;container.innerHTML='';arcadeGameUnmount=mountOfficialArcadeGame(container,{game:g.id,client:homeClient,user:HOME.user,soundEnabled:GM_SOUND.enabled,playerName:HOME.profile?.alias,onExit:gmLibrary,onSoundChange:on=>{if(GM_SOUND.enabled!==on)gmSoundToggle()}})}
 catch{if(container.isConnected&&ARC.game===game)container.innerHTML='<p role="alert">No se pudo cargar el juego. Vuelve al listado y reintenta.</p>'}
}
function gmLibrary(){arcadeGameUnmount?.();arcadeGameUnmount=null;gmClearTimers();ARC.game=null;$('gmplay').hidden=true;$('gmplay').classList.remove('gm-geoduelo');$('gmplay').innerHTML='';$('arc').querySelectorAll('.gm-auto').forEach(b=>b.hidden=false);$('gmgallery').inert=false;$('gmgallery').removeAttribute('aria-hidden');$('gmstart').focus({preventScroll:true});}
function gmShuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a;}
function gmMemory(){const s=ARC.game;Object.assign(s,{deck:gmShuffle(['cap','clock','spark','target','compass','gamepad'].flatMap(x=>[x,x])),flipped:[],matched:[],moves:0,locked:false});$('gmbody').innerHTML=`<p class="gm-instructions">Voltea dos cartas y encuentra las seis parejas. Sin límite de tiempo.</p><div class="gm-score"><span>Parejas <b id="gmpairs">0 / 6</b></span><span>Intentos <b id="gmmoves">0</b></span></div><div class="gm-memory">${s.deck.map((x,i)=>`<button data-gm="flip" data-tile="${i}" aria-label="Carta ${i+1}, oculta"><span class="gm-hidden-symbol">${svg('spark',24)}</span></button>`).join('')}</div><p class="gm-result" id="gmresult" role="status"></p><button class="gm-play-button" data-gm="restart">Reiniciar</button>`;}
function gmFlip(i){const s=ARC.game;if(s.locked||s.flipped.includes(i)||s.matched.includes(i))return;const btns=[...$('gmplay').querySelectorAll('[data-tile]')],b=btns[i];s.flipped.push(i);b.classList.add('face');b.innerHTML=svg(s.deck[i],32);b.setAttribute('aria-label',`Carta ${i+1}, ${['cap','clock','spark','target','compass','gamepad'].indexOf(s.deck[i])+1}`);b.setAttribute('aria-pressed','true');
 if(s.flipped.length<2)return;s.moves++;$('gmmoves').textContent=s.moves;const [a,c]=s.flipped;if(s.deck[a]===s.deck[c]){s.matched.push(a,c);[a,c].forEach(k=>{btns[k].classList.add('matched');btns[k].disabled=true;btns[k].setAttribute('aria-label',`Carta ${k+1}, pareja encontrada`)});s.flipped=[];$('gmpairs').textContent=s.matched.length/2+' / 6';if(s.matched.length===12){$('gmresult').innerHTML=`¡Encontraste todas las parejas!<small>${s.moves} intentos. ¿Otra ronda?</small>`;$('gmplay').querySelector('[data-gm="restart"]').focus({preventScroll:true});}}
 else{s.locked=true;gmLater(()=>{[a,c].forEach(k=>{btns[k].classList.remove('face');btns[k].innerHTML=`<span class="gm-hidden-symbol">${svg('spark',24)}</span>`;btns[k].setAttribute('aria-label',`Carta ${k+1}, oculta`);btns[k].setAttribute('aria-pressed',false)});s.flipped=[];s.locked=false},850);}}
const GM_QUESTIONS={
 logic:[['¿Qué número continúa: 2, 4, 8, 16…?',['18','24','32','64'],2,'Cada número es el doble del anterior: 16 × 2 = 32.'],['Si todos los A son B y ningún B es C, entonces…',['Algunos A son C','Ningún A es C','Todos los C son A','No se puede concluir nada'],1,'Los A pertenecen al grupo B, y ese grupo no tiene elementos C.'],['Una libreta y un lápiz cuestan S/ 11. La libreta cuesta S/ 9 más que el lápiz. ¿Cuánto cuesta el lápiz?',['S/ 1','S/ 2','S/ 9','S/ 10'],0,'Si el lápiz cuesta x, la libreta cuesta x + 9. Entonces 2x + 9 = 11 y x = 1.'],['¿Cuál no sigue el patrón: 3, 6, 9, 13, 15?',['6','9','13','15'],2,'La secuencia aumenta de tres en tres. Debería aparecer 12 en lugar de 13.'],['Cinco máquinas hacen cinco piezas en cinco minutos. ¿Cuánto tardan 20 máquinas en hacer 20 piezas?',['5 minutos','10 minutos','20 minutos','100 minutos'],0,'Cada máquina hace una pieza en cinco minutos. Las 20 trabajan a la vez.']],
 quiz:[['Si un precio sube 10% y luego baja 10%, el precio final…',['Es igual al inicial','Es 1% menor','Es 1% mayor','Es 10% menor'],1,'Por ejemplo, S/ 100 × 1,10 × 0,90 = S/ 99. Los porcentajes se aplican sobre bases distintas.'],['¿Qué medida es menos sensible a valores extremos?',['La media','La mediana','El rango','La suma'],1,'La mediana usa la posición central de los datos y resiste mejor los valores extremos.'],['El costo de oportunidad representa…',['Solo el dinero pagado','El valor de la mejor alternativa descartada','Todas las alternativas juntas','El costo contable total'],1,'Elegir una opción implica renunciar al beneficio de la mejor alternativa disponible.'],['Una correlación entre dos variables demuestra…',['Que una causa a la otra','Que ambas son iguales','Una asociación, sin probar causalidad','Que no hay otra variable'],2,'La correlación mide asociación. Para establecer causalidad hace falta evidencia adicional.'],['En un proyecto, el alcance describe…',['Únicamente el presupuesto','El trabajo y los entregables incluidos','Solo la fecha de cierre','El organigrama de la empresa'],1,'El alcance define qué se entregará y el trabajo necesario para conseguirlo.']]
};
function gmQuiz(id){Object.assign(ARC.game,{qs:GM_QUESTIONS[id],q:0,points:0,answered:false});gmQuestion();}
function gmQuestion(){const s=ARC.game;if(s.q>=s.qs.length){$('gmbody').innerHTML=`<p class="gm-question">Reto completado.</p><p class="gm-result">${s.points} de ${s.qs.length} respuestas correctas.<small>Siempre puedes volver a practicar.</small></p><button class="gm-play-button" data-gm="restart">Jugar otra vez</button>`;return}const q=s.qs[s.q];s.answered=false;$('gmbody').innerHTML=`<div class="gm-score"><span>Pregunta <b>${s.q+1} / ${s.qs.length}</b></span><span>Aciertos <b>${s.points}</b></span></div><h3 class="gm-question">${q[0]}</h3><div class="gm-answers">${q[1].map((v,i)=>`<button class="gm-answer" data-gm="answer" data-answer="${i}">${v}</button>`).join('')}</div><p class="gm-feedback" id="gmfeedback" role="status"></p><button class="gm-play-button" id="gmnextquestion" data-gm="question" hidden>Siguiente ${svg('arrow',16)}</button>`;}
function gmAnswer(i){const s=ARC.game;if(s.answered)return;s.answered=true;const q=s.qs[s.q],ok=i===q[2];if(ok)s.points++;$('gmplay').querySelectorAll('[data-answer]').forEach((b,j)=>{b.disabled=true;if(j===q[2])b.classList.add('correct');else if(j===i)b.classList.add('wrong')});$('gmfeedback').textContent=(ok?'¡Correcto! ':'La respuesta correcta es: '+q[1][q[2]]+'. ')+q[3];$('gmnextquestion').hidden=false;$('gmnextquestion').focus({preventScroll:true});}
function gmReaction(){Object.assign(ARC.game,{phase:'idle',round:0,results:[]});$('gmbody').innerHTML=`<p class="gm-instructions">Toca para empezar, espera el verde y vuelve a tocar lo más rápido posible. Completa tres rondas.</p><div class="gm-score"><span>Ronda <b id="gmround">1 / 3</b></span><span>Mejor tiempo <b id="gmbest">—</b></span></div><button class="gm-reaction" data-gm="react" id="gmreact">${svg('target',52)}<b>¿Listo?</b><small>Toca para empezar</small></button><p class="gm-result" id="gmresult" role="status"></p>`;}
function gmReact(){const s=ARC.game,b=$('gmreact');if(s.phase==='waiting'){gmClearTimers();s.phase='idle';b.classList.remove('ready');b.innerHTML=`${svg('clock',52)}<b>Un poco antes…</b><small>Toca para volver a intentar</small>`;return}
 if(s.phase==='ready'){const ms=Math.round(performance.now()-s.start);s.results.push(ms);s.round++;s.phase='idle';b.classList.remove('ready');$('gmbest').textContent=Math.min(...s.results)+' ms';b.innerHTML=`${svg('tick',52)}<b>${ms} ms</b><small>${s.round<3?'Toca para la siguiente ronda':'Toca para jugar otra vez'}</small>`;if(s.round===3){s.phase='done';$('gmresult').innerHTML=`Promedio: ${Math.round(s.results.reduce((a,b)=>a+b,0)/3)} ms<small>Resultado de esta sesión en este dispositivo.</small>`}else $('gmround').textContent=s.round+1+' / 3';return}
 if(s.phase==='done'){gmReaction();return}s.phase='waiting';b.innerHTML=`${svg('clock',52)}<b>Espera…</b><small>Toca únicamente cuando cambie a verde</small>`;$('gmresult').textContent='';gmLater(()=>{s.phase='ready';s.start=performance.now();b.classList.add('ready');b.innerHTML=`${svg('target',52)}<b>¡Ahora!</b><small>Toca</small>`},1400+Math.random()*2000);}
$('arc').onclick=e=>{const boot=e.target.closest('.ar-b');if(boot){if(boot.disabled)return;if(boot.id==='arx')arcClose();else arGallery();return}const b=e.target.closest('[data-gm]');if(!b||b.disabled||ARC.suppressClick)return;const a=b.dataset.gm;
 if(a==='close')arcClose();else if(a==='filter'){const previous=gameList()[ARC.active]?.id;gmStopAuto();ARC.filter=b.dataset.filter;ARC.active=0;$('arc').querySelectorAll('.gm-filter').forEach(el=>{el.classList.toggle('on',el===b);el.setAttribute('aria-pressed',el===b)});gmCards();if(previous!==gameList()[ARC.active]?.id)gmSoundPlay('move');}
 else if(a==='sound')gmSoundToggle();else if(a==='auto')gmAuto();else if(a==='prev'||a==='next'){gmStopAuto();gmMove(a==='prev'?-1:1)}else if(a==='select'){gmStopAuto();const changed=ARC.active!==+b.dataset.index;ARC.active=+b.dataset.index;gmPaint();if(changed)gmSoundPlay('move')}else if(a==='play'||a==='restart')gmStart();else if(a==='library')gmLibrary();else if(a==='flip')gmFlip(+b.dataset.tile);else if(a==='answer')gmAnswer(+b.dataset.answer);else if(a==='question'){ARC.game.q++;gmQuestion();$('gmplay').querySelector('[data-answer], [data-gm="restart"]')?.focus({preventScroll:true})}else if(a==='react')gmReact();};
document.addEventListener('keydown',e=>{if(!ARC.open)return;const s=ARC.game;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(s)gmLibrary();else arcClose();return}
 if(e.key==='Tab'){const all=[...$('arc').querySelectorAll('button, input, select, textarea, a[href], iframe, [tabindex="0"]')].filter(x=>!x.disabled&&!x.closest('[inert]')&&x.getClientRects().length);const first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}return}
 if(ARC.stage!=='gallery')return;
 if(!s&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){e.preventDefault();gmStopAuto();gmMove(e.key==='ArrowRight'?1:-1)}
},true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden||!ARC.open)return;gmSoundSuspend();if(ARC.stage==='intro'){cancelAnimationFrame(ARC.raf);arReady();return}gmStopAuto();if(ARC.game?.id==='reaction'&&['waiting','ready'].includes(ARC.game.phase)){gmClearTimers();gmReaction();}});
$('page').addEventListener('change',e=>{
 if(fx.busy||fx.st!=='setup')return;
 if(e.target.id==='k-hours'){fx.h=Math.max(0,Math.min(3,Number(e.target.value)||0));kPrev()}
 if(e.target.id==='k-minutes'){fx.m=Math.max(0,Math.min(55,Math.round((Number(e.target.value)||0)/5)*5));kPrev()}
});
$('page').addEventListener('input',e=>{const form=e.target.closest('[data-home-grade]');if(form&&e.target.name==='grade')HOME.drafts[form.dataset.homeGrade]=e.target.value});
$('page').addEventListener('change',e=>{if(e.target.id==='h-cycle'){HOME.cycle=e.target.value;homeRender();$('h-cycle')?.focus({preventScroll:true})}});
$('page').addEventListener('submit',e=>{const form=e.target.closest('[data-home-grade]');if(form){e.preventDefault();homeSaveGrade(form)}});
$('page').addEventListener('keydown',e=>{
 const tab=e.target.closest('[role="tab"]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 if(tab.dataset.a==='hsemester'){
  e.preventDefault();const ids=['calendar','grades','courses'],index=ids.indexOf(SEMESTER.tab),next=e.key==='Home'?0:e.key==='End'?ids.length-1:(index+(e.key==='ArrowRight'?1:-1)+ids.length)%ids.length;
  homeAction({dataset:{a:'hsemester',tab:ids[next]}});return;
 }
 if(!tab.dataset.tab||tab.dataset.a!=='htab')return;
 e.preventDefault();const index=HOME_TABS.findIndex(t=>t[0]===HOME.tab),next=e.key==='Home'?0:e.key==='End'?HOME_TABS.length-1:(index+(e.key==='ArrowRight'?1:-1)+HOME_TABS.length)%HOME_TABS.length;
 homeTab(HOME_TABS[next][0]);
});
renderProfile();setMenu(false);applySide();go('Inicio');NAV_MOTION.ready=true;
webNavigation=createWebNavigation({
 scroller:$('page'),ready:()=>HOME.mode!=='loading',initial:{page:'Inicio',kid:null,tab:HOME.tab,scroll:0},
 valid:s=>validRoute(s)&&HOME_TABS.some(t=>t[0]===s.tab),
 restore:s=>{HOME.tab=s.tab;setMenu(false);setDrawer(false);go(s.kid||s.page,s.kid?s.page:undefined,{history:false,scroll:s.scroll})}
});
const webSession=homeClient?createWebSessionGuard(homeClient,{authKey:webAuthStorageKey(),
 onLock:()=>{document.body.style.visibility='hidden';homeReset();curriculumRender++;curriculumUnmount?.();curriculumUnmount=null},
 onSuspend:()=>{document.body.style.visibility='hidden'},
 onResume:()=>{document.body.style.visibility=''},
 onExpired:reason=>location.replace(new URL('./login.html?reason='+reason,location.href).href)
}):null;

/* La plataforma es informativa; el diseño responde al espacio y al tipo de entrada. */
function renderMobileDock(){
 const dock=$('mobile-dock'),tabs=$('mobile-tabs');if(!dock||!tabs)return;
 const profile=$('act').closest('.pf'),host=mqM.matches?dock:$('top');if(profile.parentElement!==host)host.append(profile);
 $('act').innerHTML=svg(mqM.matches?'plus':'user',mqM.matches?26:23);
 const names=TABS.map(t=>t[2]);
 if(!tabs.children.length)tabs.innerHTML=TABS.map(([label,icon,name])=>`<button type="button" data-mobile-page="${name}" aria-label="${name}" title="${name}">${svg(icon,24)}</button>`).join('');
 [...tabs.children].forEach(b=>{if(b.dataset.mobilePage===cur)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
 dock.style.setProperty('--mobile-index',Math.max(0,names.indexOf(cur)));
 dock.classList.toggle('has-current',names.includes(cur));tabs.inert=app.classList.contains('open');
}
$('mobile-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-mobile-page]');if(!b)return;setMenu(false);setDrawer(false);go(b.dataset.mobilePage)});

const ua=navigator.userAgent;
root.dataset.platform=/android/i.test(ua)?'android':/iPad|iPhone|iPod/.test(ua)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1?'ios':'desktop';
root.dataset.input=matchMedia('(pointer:coarse)').matches?'touch':'pointer';
function syncViewport(){const v=window.visualViewport;app.dataset.keyboard=String(!!v&&window.innerHeight-v.height>140&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName));}
window.visualViewport?.addEventListener('resize',syncViewport);
document.addEventListener('focusin',syncViewport);document.addEventListener('focusout',()=>requestAnimationFrame(syncViewport));
mqM.addEventListener('change',()=>{setMenu(false);renderMobileDock();renderProfile();if(!HOME.saving.size&&!SETUP.unmount)renderPage()});
renderMobileDock();

mountHomeEnhancements({nav_items:NAV,nav:go,icon:svg,courses:()=>homeCareer().cursos,data:homeModel,get st(){return HOME_WIDGETS},get x(){return HOME},get tab(){return HOME.tab}});
mountHomeCompanion($('page'));
homeInit();
window.addEventListener('focus',()=>{if(HOME.mode==='profile'&&HOME.user&&!HOME.saving.size)homeLoad(HOME.user)});
if(homeClient)homeClient.auth.onAuthStateChange((event,session)=>{
 if(event==='SIGNED_OUT'){homeReset();homeRender()}
 else if(event==='SIGNED_IN'&&session?.user&&session.user.id!==HOME.user?.id){setTimeout(()=>homeInit(),0)}
});
