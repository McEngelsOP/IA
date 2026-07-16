// Índice de carreras: cada una trae su malla completa y los textos
// que la interfaz muestra según la carrera del alumno.
// La PUCP es un sistema separado: sus ids llevan prefijo 'pucp-' para que
// profesores, votos y reseñas nunca se crucen con los cursos de ESAN.
import { CURSOS, CICLOS, TOTAL_CRED } from './cursos'
import { CURSOS_INDUSTRIAL, CICLOS_INDUSTRIAL, TOTAL_CRED_INDUSTRIAL } from './cursosIndustrial'
import { CURSOS_MARKETING, CICLOS_MARKETING, TOTAL_CRED_MARKETING } from './cursosMarketing'
import { CURSOS_PUCP, CICLOS_PUCP, TOTAL_CRED_PUCP, ELECTIVOS_PUCP } from './cursosPucp'

export const CARRERAS = {
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
    foot: 'PLAN 2025 (ACUERDO 208-09/2024) · TRABAJO DE TESIS I REQUIERE 140 CRÉDITOS APROBADOS · ELECTIVOS SEGÚN ESPECIALIDAD · PRE-FORMACIÓN CONVALIDABLE POR EXAMEN'
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
  },
  'pucp-mecatronica': {
    key: 'pucp-mecatronica',
    uni: 'PUCP',
    nombre: 'Ingeniería Mecatrónica',
    cursos: CURSOS_PUCP,
    ciclos: CICLOS_PUCP,
    total: TOTAL_CRED_PUCP,
    ciclosLabel: '10 ciclos (EE.GG. Ciencias + Facultad)',
    electivos: ELECTIVOS_PUCP,
    hint: ['Cálculo Diferencial', 'Física 1'],
    foot: 'PLAN 2020-2 (EE.GG. CIENCIAS) / 2025-1 (FACULTAD) · CO-REQUISITOS TRATADOS COMO REQUISITOS · CATÁLOGO DE ELECTIVOS EN EL DESPLEGABLE'
  }
}

export const CARRERA_KEYS = Object.keys(CARRERAS)
