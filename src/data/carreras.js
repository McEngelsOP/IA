// Índice de carreras: cada una trae su malla completa y los textos
// que la interfaz muestra según la carrera del alumno.
import { CURSOS, CICLOS, TOTAL_CRED } from './cursos'
import { CURSOS_INDUSTRIAL, CICLOS_INDUSTRIAL, TOTAL_CRED_INDUSTRIAL } from './cursosIndustrial'

export const CARRERAS = {
  ia: {
    key: 'ia',
    nombre: 'Ingeniería en Inteligencia Artificial',
    cursos: CURSOS,
    ciclos: CICLOS,
    total: TOTAL_CRED,
    // cursos sugeridos en la barra de estado cuando no hay nada seleccionado
    hint: ['Cálculo I', 'Álgebra Lineal'],
    foot: 'TESIS I REQUIERE 140 CRÉDITOS APROBADOS · ELECTIVOS SEGÚN ESPECIALIDAD · CURSOS DE PRE-FORMACIÓN CONVALIDABLES POR EXAMEN'
  },
  industrial: {
    key: 'industrial',
    nombre: 'Ingeniería Industrial y Comercial',
    cursos: CURSOS_INDUSTRIAL,
    ciclos: CICLOS_INDUSTRIAL,
    total: TOTAL_CRED_INDUSTRIAL,
    hint: ['Cálculo I', 'Investigación Operativa I'],
    foot: 'TRABAJO DE TESIS I REQUIERE 140 CRÉDITOS APROBADOS · ELECTIVOS SEGÚN ESPECIALIDAD · CURSOS DE PRE-FORMACIÓN CONVALIDABLES POR EXAMEN'
  }
}

export const CARRERA_KEYS = Object.keys(CARRERAS)
