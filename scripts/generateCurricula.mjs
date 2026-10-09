import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { curriculumSources } from './curriculumSources.mjs'
import { CURSOS } from '../src/data/cursos.js'
import { CURSOS_INDUSTRIAL } from '../src/data/cursosIndustrial.js'
import { CURSOS_MARKETING } from '../src/data/cursosMarketing.js'
import { CURSOS_PUCP, TOTAL_CRED_PUCP } from '../src/data/cursosPucp.js'

const root = new URL('../', import.meta.url)
const legacy = { ia: CURSOS, industrial: CURSOS_INDUSTRIAL, marketing: CURSOS_MARKETING }
export const normalizeCourse = text => text.replace(/\\?\*/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// Variaciones de escritura presentes en los Markdown; no agregan requisitos nuevos.
const aliases = {
  comuncaciones: 'comunicaciones',
  'global supply chain managemnet': 'global supply chain management',
  entreprenurship: 'entrepreneurship',
  'tecnologia de informacion para finanzas': 'tecnologias de informacion para finanzas',
  'comunicaciones de marketing': 'comunicaciones del marketing',
  'fundamentos del marketing': 'fundamentos de marketing',
  'metodos de optimizacion dinamica': 'metodos de optimizacion dinamico',
  'matematicas para economistas': 'matematica para economistas',
  'economia ambiental y recursos naturales': 'economia ambiental y de recursos naturales'
}
for (const numeral of ['i', 'ii', 'iii', 'iv', 'v']) for (const type of ['personales', 'profesionales']) {
  aliases[`taller desarrollo de competencias ${type} ${numeral}`] = `taller comp ${type} ${numeral}`
}
const normalized = text => aliases[normalizeCourse(text)] || normalizeCourse(text)
const signature = course => `${normalized(course.n)}:${course.cr}`
const shared = new Map()
for (const courses of Object.values(legacy)) for (const course of courses) {
  if (!/^Electivo/i.test(course.n)) shared.set(signature(course), course.id)
}
const cycles = ['introductorio', 'primer', 'segundo', 'tercer', 'cuarto', 'quinto', 'sexto', 'septimo', 'octavo', 'noveno', 'decimo']

function areaFor(name) {
  const n = normalized(name)
  if (/electivo/.test(n)) return 'ele'
  if (/taller.*comp |practica preprofesional/.test(n)) return 'tall'
  if (/tesis|proyecto|investigacion juridica|metodologia de la investigacion/.test(n)) return 'proy'
  if (/estadistic|probabilidad|datos|data |econometria|multivariado/.test(n)) return 'est'
  if (/machine learning|inteligencia artificial|deep learning/.test(n)) return 'ia'
  if (/matematic|calculo|algebra|optimizacion|ecuaciones|numerico/.test(n)) return 'mat'
  if (/software|programacion|algoritmo|comput|sistema.*operativo|base de datos|redes|digitales|ciber|devops|iot|ux ui|apis|web|movil/.test(n)) return 'prog'
  if (/fisica|quimica|biolog|ecolog|ambiental|hidrolog|suelo|termodinamica|climat|energia|neurociencia/.test(n)) return 'cie'
  if (/marketing|mercad|comunicacion corporativa|publicidad|consumidor|marca|periodismo/.test(n)) return 'mark'
  if (/audiovisual|diseno|arte|video|fotografia/.test(n)) return 'crea'
  if (/ingenieria|operativ|produccion|industrial|logistica|robotica|manufactura/.test(n)) return 'ind'
  if (/administr|econom|finanz|contab|banca|negocio|gerencia|empresa|organiz|estrateg|comerc|costos|auditor|tribut|emprend|entrepreneur|management/.test(n)) return 'gest'
  return 'hum'
}

export function parseCurriculum(markdown, key) {
  const nombre = markdown.match(/^# (.+)$/m)?.[1]
  const total = Number(markdown.match(/\*\*Total(?: de créditos en la especialidad)?:\*\*\s*([\d.,]+)/)?.[1]?.replace(',', '.'))
  if (!nombre || !Number.isFinite(total)) throw new Error(`Plan inválido: ${key}`)
  let cycle = null
  const rows = []
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      const heading = normalizeCourse(line)
      cycle = heading.includes('cero') ? 0 : cycles.findIndex(word => heading.includes(word))
      if (cycle < 0) throw new Error(`Ciclo desconocido: ${key}: ${line}`)
    }
    if (!line.startsWith('|') || cycle === null) continue
    const columns = line.split('|').slice(1, -1).map(text => text.trim())
    if (!/^\d+(?:[.,]\d+)?$/.test(columns[1] || '')) continue
    const n = columns[0].replace(/\\?\*/g, '').trim(), cr = Number(columns[1].replace(',', '.'))
    const generic = /^Electivo/i.test(n)
    const id = (!generic && shared.get(signature({ n, cr }))) || `${generic ? key : 'esan'}-${normalized(n).replaceAll(' ', '-')}-${String(cr).replace('.', '_')}`
    rows.push({ id, n, c: cycle, cr, r: [], a: areaFor(n), requirement: columns.at(-1) })
  }
  const names = new Map(rows.map(course => [normalized(course.n), course.id]))
  const issues = []
  for (const course of rows) {
    const requirement = course.requirement
    const creditMatches = [...requirement.matchAll(/(\d+)\s+cr[eé]ditos\s+aprobados/gi)]
    if (creditMatches.length) course.rc = Math.max(...creditMatches.map(match => Number(match[1])))
    const rest = requirement.replace(/\d+\s+cr[eé]ditos\s+aprobados/gi, '').trim()
    // Primero nombres completos: algunos cursos contienen comas en su título.
    let pending = normalizeCourse(rest)
    const candidates = [...names, ...Object.entries(aliases).filter(([, target]) => names.has(target)).map(([name, target]) => [name, names.get(target)])].sort(([a], [b]) => b.length - a.length)
    if (/^(no tiene|segun electivo|ninguno|)$/.test(pending)) pending = ''
    while (pending) {
      const match = candidates.find(([name]) => pending === name || pending.startsWith(name + ' '))
      if (match) { course.r.push(match[1]); pending = pending.slice(match[0].length).trim(); continue }
      issues.push({ key, course: course.n, missing: pending }); break
    }
    if (/seg[uú]n electivo/i.test(requirement)) course.requirementNote = requirement
    delete course.requirement
  }
  const ids = new Set(rows.map(course => course.id))
  if (ids.size !== rows.length) throw new Error(`Identificadores duplicados en ${key}`)
  const sum = rows.reduce((value, course) => value + course.cr, 0)
  if (sum !== total) issues.push({ key, credits: { declared: total, sum } })
  const ciclos = Object.fromEntries([...new Set(rows.map(course => course.c))].map(c => [c, {
    t: c === 0 ? 'Pre-form.' : `Ciclo ${String(c).padStart(2, '0')}`,
    s: c === 0 ? 'convalidable' : `${rows.filter(course => course.c === c).reduce((value, course) => value + course.cr, 0)} créditos`
  }]))
  return { nombre, total, cursos: rows, ciclos, issues }
}

export function generateCurricula({ check = false } = {}) {
  const plans = {}, metadata = {}, issues = []
  for (const [key, source, existing] of curriculumSources) {
    const plan = parseCurriculum(readFileSync(new URL(`Mallas curriculares/${source}`, root), 'utf8'), key)
    metadata[key] = { key, uni: 'Universidad ESAN', nombre: plan.nombre, total: plan.total, source }
    if (!existing) {
      issues.push(...plan.issues)
      const { nombre, total, cursos, ciclos } = plan
      plans[key] = { key, uni: 'Universidad ESAN', nombre, total, cursos, ciclos, ciclosLabel: '10 ciclos + pre-formación', hint: cursos.filter(course => course.c === 1).slice(0, 2).map(course => course.n), foot: 'PLAN DE ESTUDIOS · UNIVERSIDAD ESAN · PRE-FORMACIÓN CONVALIDABLE POR EXAMEN' }
    }
  }
  metadata['pucp-mecatronica'] = { key: 'pucp-mecatronica', uni: 'PUCP', nombre: 'Ingeniería Mecatrónica', total: TOTAL_CRED_PUCP }
  if (issues.length) throw new Error(JSON.stringify(issues, null, 2))
  const values = Object.keys(metadata).map(key => `'${key}'`).join(', ')
  const counts = Object.entries({ ...plans, ...Object.fromEntries(Object.entries(legacy).map(([key, cursos]) => [key, { cursos }])), 'pucp-mecatronica': { cursos: CURSOS_PUCP } }).map(([key, plan]) => `    when '${key}' then ${plan.cursos.length}`).join('\n')
  const focusSource = readFileSync(new URL('supabase/focus_sessions.sql', root), 'utf8').replace(/career_name not in \([^)]*\)/, `career_name not in (${values})`)
  const logrosSource = readFileSync(new URL('supabase/logros.sql', root), 'utf8').replace(/total_malla := case car[\s\S]*?\n  end;/, `total_malla := case car\n${counts}\n    else null\n  end;`)
  const focusFunction = focusSource.match(/create or replace function public\.start_focus_session\([\s\S]*?end;\$\$;/)?.[0]
  const logrosFunction = logrosSource.match(/create or replace function public\.reclamar_logros\([\s\S]*?\n\$\$;/)?.[0]
  if (!focusFunction || !logrosFunction) throw new Error('No se encontraron las funciones existentes de Focus/Logros')
  const migration = `-- Generado por scripts/generateCurricula.mjs. Ejecutar una vez en SQL Editor.
-- Es repetible: conserva perfiles, avances, notas, RLS y el candado de carrera.
-- Focus y Logros se actualizan solo si ya están instalados.
begin;
do $constraints$
declare item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'carrera')]::smallint[]
  loop
    execute format('alter table public.profiles drop constraint %I', item.conname);
  end loop;
end;
$constraints$;
alter table public.profiles add constraint profiles_carrera_check
  check (carrera in (${values}));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  code text := upper(trim(coalesce(new.raw_user_meta_data->>'student_code', '')));
  career text := new.raw_user_meta_data->>'carrera';
begin
  if career is null or career not in (${values}) then raise exception 'INVALID_CAREER'; end if;
  if career = 'pucp-mecatronica' then
    if code !~ '^20[0-9]{6}$' then raise exception 'invalid student code'; end if;
  else
    if code !~ '^[0-9]{8}$' then raise exception 'invalid student code'; end if;
    if left(code, 2)::int < 25 or left(code, 2)::int > extract(year from now() at time zone 'America/Lima')::int % 100 then raise exception 'invalid student code'; end if;
  end if;
  insert into public.profiles(id, student_code, email, carrera) values(new.id, code, new.email, career);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

do $upgrade$
begin
  if to_regprocedure('public.start_focus_session(uuid,text,integer,text,text,text)') is not null then
    execute $focus$
${focusFunction}
    $focus$;
  end if;
  if to_regprocedure('public.reclamar_logros()') is not null then
    execute $achievements$
${logrosFunction}
    $achievements$;
  end if;
end;
$upgrade$;
commit;
notify pgrst, 'reload schema';
`
  const files = [
    ['src/data/careerOptions.js', `// Generado por scripts/generateCurricula.mjs. El acceso no carga los grafos.\nexport const CAREER_OPTIONS = ${JSON.stringify(metadata, null, 2)}\nexport const CAREER_KEYS = Object.keys(CAREER_OPTIONS).sort((a, b) => Number(CAREER_OPTIONS[a].uni === 'PUCP') - Number(CAREER_OPTIONS[b].uni === 'PUCP') || CAREER_OPTIONS[a].nombre.localeCompare(CAREER_OPTIONS[b].nombre, 'es'))\nexport const careerLabel = key => CAREER_OPTIONS[key] ? CAREER_OPTIONS[key].nombre + ' (' + (CAREER_OPTIONS[key].uni === 'PUCP' ? 'PUCP' : 'ESAN') + ')' : 'Sin elegir'\n`],
    ['src/data/curriculaEsan.js', `// Generado desde Mallas curriculares; no se procesa Markdown en el navegador.\nexport const CURRICULA_ESAN = {\n${Object.entries(plans).map(([key, plan]) => `  "${key}": {\n${Object.entries(plan).map(([field, value]) => `    "${field}": ${field === 'cursos' ? `[\n${value.map(course => '      ' + JSON.stringify(course)).join(',\n')}\n    ]` : JSON.stringify(value)}`).join(',\n')}\n  }`).join(',\n')}\n}\n`],
    ['supabase/focus_sessions.sql', focusSource],
    ['supabase/logros.sql', logrosSource],
    ['supabase/careers_catalog.sql', migration]
  ]
  for (const [path, content] of files) {
    const url = new URL(path, root)
    if (check) { if (readFileSync(url, 'utf8') !== content) throw new Error(`Regenerar ${path}`) }
    else writeFileSync(url, content)
  }
  return { careers: Object.keys(metadata).length, added: Object.keys(plans).length }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(generateCurricula({ check: process.argv.includes('--check') }))
