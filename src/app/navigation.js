export const NAV = [
  { n: 'Inicio', i: 'home' },
  { n: 'Mi carrera', i: 'cap' },
  { n: 'Mi semestre', i: 'cal' },
  { n: 'Planificar', i: 'compass' },
  { n: 'Asistente', i: 'sparkles' },
  { n: 'Grupos de estudio', i: 'users', secondary: true },
  { n: 'Mod Focus', i: 'target', secondary: true },
  { n: 'Recursos', i: 'library', secondary: true },
  { n: 'Buzón de sugerencias', i: 'inbox', secondary: true, kids: [['Aplicativo', 'phone'], ['Docente', 'teach'], ['Universidad', 'landmark']] }
]
export const TABS = [['Carrera', 'cap', 'Mi carrera'], ['Inicio', 'home', 'Inicio'], ['Semestre', 'cal', 'Mi semestre']]
const ALIASES = { 'Malla Curricular': 'Mi carrera', 'Calendario/Horarios': 'Mi semestre', 'Asesor IA': 'Asistente', 'Brújula IA': 'Planificar', 'What-if': 'Planificar', 'Proyección': 'Planificar' }
export function resolveRoute(name, parent) {
  if (parent === 'Herramientas') return { page: ALIASES[name] || name, kid: null }
  if (name === 'Herramientas' && !parent) return { page: 'Planificar', kid: null }
  return { page: ALIASES[parent || name] || parent || name, kid: parent ? name : null }
}
export function validRoute(snapshot) {
  if (!snapshot || typeof snapshot.page !== 'string') return false
  const route = resolveRoute(snapshot.kid || snapshot.page, snapshot.kid ? snapshot.page : undefined)
  return route.page === 'Mi IA' || NAV.some(n => n.n === route.page && (!route.kid || n.kids?.some(k => k[0] === route.kid)))
}
