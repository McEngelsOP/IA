import data from './game-data.json' with { type: 'json' }
import world from '../../../public/juegos/geoduelo/world.json' with { type: 'json' }
import { MODES, DEFAULT_SETTINGS } from '../../../src/lib/geoduelo-modes.js'
import { decodeTopology, distance, contains } from '../../../public/juegos/geoduelo/online-geo.js'
export const ROUNDS = 10
export const QUESTION_MS = 25000
export const REVEAL_MS = 3500
const features = new Map(decodeTopology(world).map(f => [f.id, f]))
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const capBy = new Map(data.capitals.map(c => [norm(c.country), c]))
function randomIndex(length) {
  const ceiling=Math.floor(4294967296/length)*length
  let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=ceiling)
  return n%length
}
const pick = a => a[randomIndex(a.length)]
const format = (n,decimals=0) => n.toLocaleString('es-PE',{maximumFractionDigits:decimals})
export function shuffle(items) {
  const a = [...items]
  const random=crypto.getRandomValues(new Uint32Array(a.length))
  for (let i = a.length - 1; i > 0; i--) {
    const ceiling = Math.floor(4294967296 / (i + 1)) * (i + 1)
    let n=random[i]; while(n>=ceiling)n=crypto.getRandomValues(new Uint32Array(1))[0]
    const j = n % (i + 1); [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
export function validSettings(s) { return !!s && MODES.some(m => m.id === s.mode) && ['facil','medio','dificil'].includes(s.level) }
function options(correct, wrong) {
  const values = shuffle([correct, ...shuffle([...new Set(wrong)].filter(v => v !== correct)).slice(0, 3)])
  if (values.length < 3) throw new Error('Insufficient distinct alternatives')
  return { options: values, correct: values.indexOf(correct), solution: correct }
}
function clock(min) { const day = Math.floor(min / 1440), m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}${day === 1 ? ' (día siguiente)' : day === -1 ? ' (día anterior)' : ''}` }
const timeFormats=new Map()
function offset(tz, date) {
  if(!timeFormats.has(tz))timeFormats.set(tz,new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric' }))
  const parts=Object.fromEntries(timeFormats.get(tz).formatToParts(date).map(p=>[p.type,p.value]))
  return Math.round((Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour % 24,+parts.minute,+parts.second) - Math.floor(+date / 1000) * 1000) / 60000)
}
function makeQuestion(mode, level, index, used) {
  const difficulty = {facil:1,medio:2,dificil:3}[level], tolerance = {facil:450,medio:260,dificil:130}[level]
  const countries = data.countries.slice(0,{facil:50,medio:110,dificil:999}[level])
  const choose = (list, key) => { const fresh = list.filter(x => !used.has(`${mode}:${key(x)}`)); const x = pick(fresh.length ? fresh : list); used.add(`${mode}:${key(x)}`); return x }
  let c, q = { kind: mode, ui:'opts' }
  if (['country','who','cap4','cur','lang','falso'].includes(mode)) {
    const pool = countries.filter(c => (['cap4','falso'].includes(mode) ? capBy.has(norm(c.name)) && c.name !== 'Bolivia' && c.name !== 'Sudáfrica' && c.name !== 'Sri Lanka' : true)
      && (['cur','lang','falso'].includes(mode) ? c.cur && c.lang : true))
    c = choose(pool, c => c.id)
  }
  if (mode === 'country') return {...q, ui:'globe', prompt:`Encuentra ${c.name}`, targetCountry:c.id, tolerance:c.tolerance, target:c.center, solution:c.name, map:{ interactive:true, center:[-25,10] }}
  if (mode === 'who') return {...q, prompt:'¿Qué país está resaltado?', ...options(c.name,countries.map(c=>c.name)), map:{highlight:c.id,center:c.center}}
  if (mode === 'cap' || mode === 'place') {
    const list = (mode === 'cap' ? data.capitals : data.places).filter(x => x.d <= difficulty)
    const x = choose(list, x=>x.name), point=[x.lon,x.lat]
    return {...q, ui:'globe',prompt:`Ubica ${x.name}${mode==='cap' ? `, capital de ${x.country}` : ''}`,target:point,tolerance:Math.max(tolerance,x.r||0),solution:`${x.name} · ${x.lat.toFixed(2)}°, ${x.lon.toFixed(2)}°`,map:{interactive:true,center:[-25,10]}}
  }
  if (mode === 'cap4') return {...q, country:c.name,prompt:`¿Cuál es la capital de ${c.name}?`,...options(capBy.get(norm(c.name)).name,data.capitals.map(c=>c.name))}
  if (mode === 'cur') return {...q,prompt:`¿Cuál es la moneda de ${c.name}?`,...options(c.cur,data.countries.map(c=>c.cur).filter(Boolean))}
  if (mode === 'lang') return {...q,prompt:`¿Cuál es un idioma oficial de ${c.name}?`,...options(pick(c.lang),data.countries.flatMap(c=>c.lang||[]).filter(l=>!c.lang.includes(l)))}
  if (mode === 'falso') {
    const capital=capBy.get(norm(c.name)).name, lie = index % 3
    const fact = [capital,c.cur,pick(c.lang)], wrong = [data.capitals.map(x=>x.name),data.countries.map(x=>x.cur).filter(Boolean),data.countries.flatMap(x=>x.lang||[]).filter(l=>!c.lang.includes(l))]
    fact[lie] = pick(wrong[lie].filter(v => v !== fact[lie]))
    const opts = shuffle([{text:`Su capital es ${fact[0]}.`,i:0},{text:`Su moneda es ${fact[1]}.`,i:1},{text:`Se habla ${fact[2]}.`,i:2}])
    return {...q,prompt:`¿Qué afirmación sobre ${c.name} es falsa?`,options:opts.map(o=>o.text),correct:opts.findIndex(o=>o.i===lie),solution:opts.find(o=>o.i===lie).text}
  }
  if (mode === 'dist' || mode === 'tz') {
    const cities=shuffle(data.cities.filter(c=>c.d<=difficulty)), a=cities[0]
    const date=new Date(), b=cities.find(b=>b.name!==a.name && (mode==='dist' ? distance(a.pt,b.pt)>250 : offset(a.tz,date)!==offset(b.tz,date)))
    if(!b) throw new Error('No city pair')
    const map={markers:[{point:a.pt,label:a.name},{point:b.pt,label:b.name}],center:a.pt}
    if(mode==='dist') { const km=distance(a.pt,b.pt); return {...q,ui:'distance',prompt:`¿Qué distancia hay entre ${a.name} y ${b.name}?`,km,tolerance:Math.max(km*{facil:.20,medio:.12,dificil:.06}[level],150),solution:`${format(km)} km en línea recta`,map} }
    const min=8*60+index*17, answer=clock(min+offset(b.tz,date)-offset(a.tz,date))
    return {...q,prompt:`Si en ${a.name} son las ${clock(min)}, ¿qué hora es en ${b.name}?`,...options(answer,[60,-60,120,-120,30,-30].map(d=>clock(min+offset(b.tz,date)-offset(a.tz,date)+d))),map}
  }
  const metric = index % 2 ? 'pop' : 'area', list = shuffle(countries.filter(c=>c.cur&&c[metric]>0)), selected=[]
  const ratio={facil:2,medio:1.4,dificil:1.15}[level]
  for(const c of list) { if(selected.every(x=>Math.max(c[metric],x[metric])/Math.min(c[metric],x[metric])>=ratio))selected.push(c); if(selected.length===5)break }
  if(selected.length<5) {
    selected.length=0
    for(const c of data.countries.filter(c=>c.cur&&c[metric]>0).sort((a,b)=>a[metric]-b[metric])) {
      if(selected.every(x=>Math.max(c[metric],x[metric])/Math.min(c[metric],x[metric])>=ratio))selected.push(c)
      if(selected.length===5)break
    }
  }
  if(selected.length<5)throw new Error('Insufficient ranking separation')
  const shown=shuffle(selected), truth=[...selected].sort((a,b)=>b[metric]-a[metric])
  return {...q,ui:'order',prompt:`Ordena los países de mayor a menor ${metric==='pop'?'población':'superficie'}`,options:shown.map(c=>c.name),order:truth.map(c=>shown.indexOf(c)),solution:truth.map(c=>`${c.name} (${format(c[metric]*(metric==='area'?1000:1),metric==='pop'?1:0)} ${metric==='area'?'km²':'M hab.'})`).join(' → ')}
}
export function questions(settings = DEFAULT_SETTINGS) {
  if (!validSettings(settings)) throw new Error('Invalid settings')
  const kinds=shuffle(MODES.filter(m=>m.id!=='mixto').map(m=>m.id)), used=new Set()
  return Array.from({length:ROUNDS},(_,i)=>makeQuestion(settings.mode==='mixto'?kinds[i%kinds.length]:settings.mode,settings.level,i,used))
}
// Generate one question per phase, bounding CPU work for Workers Free.
export function appendQuestion(state) {
  if(state.questions?.[state.round])return
  const settings=state.settings||DEFAULT_SETTINGS
  state.questions ||= []
  state.deck ||= shuffle(MODES.filter(m=>m.id!=='mixto').map(m=>m.id))
  const used=new Set(state.used||[])
  state.questions[state.round]=makeQuestion(settings.mode==='mixto'?state.deck[state.round%state.deck.length]:settings.mode,settings.level,state.round,used)
  state.used=[...used]
}
export function answer(state, seat, message, now) {
  if (state.phase !== 'question' || now >= state.deadline || message.round !== state.round || state.answers[seat] !== null) return false
  const q=state.questions[state.round], ui=q.ui||'opts'
  let correct=false, choice=null, value=null
  if(ui==='opts') { if(!Number.isInteger(message.choice)||message.choice<0||message.choice>=q.options.length)return false; choice=message.choice; correct=choice===q.correct }
  else if(ui==='globe') {
    const point=message.point
    if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>90)return false
    value=point
    correct=q.targetCountry ? contains(features.get(q.targetCountry),point) || distance(point,q.target)<=q.tolerance : distance(point,q.target)<=q.tolerance
  } else if(ui==='distance') {
    if(!Number.isFinite(message.km)||message.km<0||message.km>20040)return false
    value=message.km;correct=Math.abs(message.km-q.km)<=q.tolerance
  } else if(ui==='order') {
    if(!Array.isArray(message.order)||message.order.length!==q.options.length||new Set(message.order).size!==q.options.length||!message.order.every(i=>Number.isInteger(i)&&i>=0&&i<q.options.length))return false
    value=message.order;correct=value.every((v,i)=>v===q.order[i])
  } else return false
  const points = correct ? 100 + Math.floor(50 * Math.max(0, Math.min(QUESTION_MS, state.deadline - now)) / QUESTION_MS) : 0
  state.answers[seat] = { choice, value, points }; state.scores[seat] += points
  return true
}
export function view(state, seat, now = Date.now()) {
  const q = state.questions?.[state.round], revealed=state.phase==='reveal'||state.phase==='finished'
  const question=q && {kind:q.kind||'cap4',ui:q.ui||'opts',prompt:q.prompt||`¿Cuál es la capital de ${q.country}?`,country:q.country,options:q.options,map:q.map}
  return {protocol:2,room:state.id,code:state.code,phase:state.phase,seat,host:state.host===null?null:state.host??0,settings:state.settings||DEFAULT_SETTINGS,revision:state.revision||0,players:state.players.map(p=>({name:p.name,ready:!!p.ready})),
    scores:state.scores,round:state.round,rounds:ROUNDS,deadline:state.deadline,serverTime:now,
    answered:state.answers.map(a=>a!==null),ownChoice:state.answers[seat]?.choice??null,ownAnswer:state.answers[seat]?.value??null,question,
    ...(revealed?{correct:q?.correct,answers:state.answers,solution:q?.solution||q?.options?.[q?.correct],target:q?.target,targetCountry:q?.targetCountry,order:q?.order}:{}),reason:state.reason,saved:state.saved,winner:state.winner}
}
