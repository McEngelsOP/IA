import { CURSOS, CICLOS, TOTAL_CRED } from './cursos.js'
import { CURSOS_INDUSTRIAL, CICLOS_INDUSTRIAL, TOTAL_CRED_INDUSTRIAL } from './cursosIndustrial.js'
import { CURSOS_MARKETING, CICLOS_MARKETING, TOTAL_CRED_MARKETING } from './cursosMarketing.js'
import { CURRICULA_ESAN } from './curriculaEsan.js'
import { CAREER_KEYS, CAREER_OPTIONS } from './careerOptions.js'

const catalogs = {
  ...CURRICULA_ESAN,
  ia: {
    key: 'ia',
    uni: 'Universidad ESAN',
    nombre: 'Ingeniería en Inteligencia Artificial',
    cursos: CURSOS,
    ciclos: CICLOS,
    total: TOTAL_CRED,
    ciclosLabel: '10 ciclos + pre-formación',
    // cursos sugeridos en la barra de estado cuando no hay nada seleccionado
    hint: ['Cálculo I', 'Fundamentos de Machine Learning'],
    foot: 'PLAN DE ESTUDIOS OFICIAL · TRABAJO DE TESIS I REQUIERE 140 CRÉDITOS APROBADOS · ELECTIVOS SEGÚN ESPECIALIDAD · PRE-FORMACIÓN CONVALIDABLE POR EXAMEN'
  },
  industrial: {
    key: 'industrial',
    uni: 'Universidad ESAN',
    nombre: 'Ingeniería Industrial y Comercial',
    cursos: CURSOS_INDUSTRIAL,
    ciclos: CICLOS_INDUSTRIAL,
    total: TOTAL_CRED_INDUSTRIAL,
    ciclosLabel: '10 ciclos + pre-formación',
    hint: ['Cálculo I', 'Investigación Operativa I'],
    foot: 'TRABAJO DE TESIS I REQUIERE 140 CRÉDITOS APROBADOS · ELECTIVOS SEGÚN ESPECIALIDAD · CURSOS DE PRE-FORMACIÓN CONVALIDABLES POR EXAMEN'
  },
  marketing: {
    key: 'marketing',
    uni: 'Universidad ESAN',
    nombre: 'Comunicación Empresarial y Marketing Digital',
    cursos: CURSOS_MARKETING,
    ciclos: CICLOS_MARKETING,
    total: TOTAL_CRED_MARKETING,
    ciclosLabel: '10 ciclos + pre-formación',
    hint: ['Administración General', 'Fundamentos de Marketing'],
    foot: 'METODOLOGÍA DE LA INVESTIGACIÓN REQUIERE 85 CRÉDITOS · DIRECCIÓN DE COMUNICACIÓN CORPORATIVA 175 · ELECTIVOS SEGÚN ESPECIALIDAD · PRE-FORMACIÓN CONVALIDABLE POR EXAMEN'
  }
}

export const CARRERAS = Object.fromEntries(Object.entries(catalogs).map(([key, career]) => [key, {
  ...career,
  ...CAREER_OPTIONS[key],
  cursos: career.cursos.map(course => /^Electivo/i.test(course.n) ? { ...course, requirementNote: course.requirementNote || 'Según electivo. Requisitos pendientes de verificar.' } : course)
}]))

export const CARRERA_KEYS = CAREER_KEYS
