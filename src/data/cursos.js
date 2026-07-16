// Malla curricular · Ingeniería en IA · ESAN
// Plan de estudios 2025 (Acuerdo N° 208-09/2024).
// id: identificador corto · n: nombre · c: ciclo (0 = pre-formación)
// cr: créditos · r: prerequisitos (ids) · rc: créditos aprobados requeridos
// a: área temática (ver data/areas.js) — colorea las líneas de la malla
//
// OJO: algunos ids se comparten con cursosIndustrial.js y cursosMarketing.js
// (cursos equivalentes entre carreras ESAN); ese id común hace que los
// profesores y sus votos se vean desde las tres mallas. No renombrar ids
// sin migrar la tabla `professors`. Al actualizar el plan se CONSERVARON
// los ids de los cursos que continúan (calc1, est1, fml, taml1, talleres,
// tesis1/2…) para no perder profesores, votos, notas ni avances.

export const TOTAL_CRED = 200

export const CURSOS = [
  { id: 'com0', n: 'Comunicaciones', c: 0, cr: 0, r: [], a: 'hum' },
  { id: 'mat0', n: 'Matemáticas', c: 0, cr: 0, r: [], a: 'mat' },
  // ---- Ciclo 1 ----
  { id: 'com1', n: 'Comunicación I', c: 1, cr: 4, r: ['com0'], a: 'hum' },
  { id: 'est1', n: 'Estadística I', c: 1, cr: 4, r: [], a: 'est' },
  { id: 'fia', n: 'Fundamentos de Inteligencia Artificial', c: 1, cr: 3, r: [], a: 'ia' },
  { id: 'fmu', n: 'Fund. de Matemática Universitaria', c: 1, cr: 4, r: ['mat0'], a: 'mat' },
  { id: 'prog1', n: 'Programación I', c: 1, cr: 4, r: [], a: 'prog' },
  { id: 'tdcpe1', n: 'Taller: Comp. Personales I', c: 1, cr: 1, r: [], a: 'tall' },
  // ---- Ciclo 2 ----
  { id: 'aed', n: 'Algoritmos y Estructura de Datos', c: 2, cr: 3, r: ['prog1'], a: 'prog' },
  { id: 'calc1', n: 'Cálculo I', c: 2, cr: 5, r: ['fmu'], a: 'mat' },
  { id: 'glob', n: 'Globalización y Realidad Nacional', c: 2, cr: 3, r: [], a: 'hum' },
  { id: 'iagen', n: 'Herramientas de IA Generativa', c: 2, cr: 3, r: ['fia'], a: 'ia' },
  { id: 'ingreq', n: 'Ingeniería de Requerimientos', c: 2, cr: 3, r: ['prog1'], a: 'prog' },
  { id: 'mdisc', n: 'Matemática Discreta', c: 2, cr: 3, r: ['fmu'], a: 'mat' },
  { id: 'tdcpro1', n: 'Taller: Comp. Profesionales I', c: 2, cr: 1, r: [], a: 'tall' },
  // ---- Ciclo 3 ----
  { id: 'alg', n: 'Álgebra Lineal', c: 3, cr: 3, r: ['calc1'], a: 'mat' },
  { id: 'calc2', n: 'Cálculo II', c: 3, cr: 5, r: ['calc1'], a: 'mat' },
  { id: 'est2', n: 'Estadística II', c: 3, cr: 4, r: ['est1', 'calc1'], a: 'est' },
  { id: 'fis1', n: 'Física I', c: 3, cr: 4, r: ['fmu'], a: 'cie' },
  { id: 'prog2', n: 'Programación II', c: 3, cr: 3, r: ['aed'], a: 'prog' },
  { id: 'tdcpe2', n: 'Taller: Comp. Personales II', c: 3, cr: 1, r: ['tdcpe1'], a: 'tall' },
  // ---- Ciclo 4 ----
  { id: 'bd1', n: 'Base de Datos I', c: 4, cr: 3, r: ['prog2'], a: 'prog' },
  { id: 'edo', n: 'Ecuaciones Diferenciales Ordinarias (EDOs)', c: 4, cr: 3, r: ['alg'], a: 'mat' },
  { id: 'estuni', n: 'Estadística Univariada', c: 4, cr: 3, r: ['est2'], a: 'est' },
  { id: 'fil', n: 'Filosofía y Ética', c: 4, cr: 3, r: [], rc: 60, a: 'hum' },
  { id: 'rob', n: 'Fundamentos de Robótica', c: 4, cr: 3, r: ['prog1'], a: 'ia' },
  { id: 'metnum', n: 'Métodos Numéricos', c: 4, cr: 3, r: ['alg'], a: 'mat' },
  { id: 'tdcpro2', n: 'Taller: Comp. Profesionales II', c: 4, cr: 1, r: ['tdcpro1'], a: 'tall' },
  // ---- Ciclo 5 ----
  { id: 'bdne', n: 'Base de Datos No Estructurada', c: 5, cr: 3, r: ['bd1'], a: 'prog' },
  { id: 'estmul', n: 'Estadística Multivariada', c: 5, cr: 3, r: ['estuni'], a: 'est' },
  { id: 'fml', n: 'Fundamentos de Machine Learning', c: 5, cr: 3, r: ['estuni'], a: 'ia' },
  { id: 'pi1', n: 'Proyecto Interdisciplinario I', c: 5, cr: 3, r: ['iagen'], a: 'proy' },
  { id: 'sust', n: 'Sustainable Computing', c: 5, cr: 3, r: [], rc: 60, a: 'prog' },
  { id: 'tdcpe3', n: 'Taller: Comp. Personales III', c: 5, cr: 1, r: ['tdcpe2'], a: 'tall' },
  { id: 'tmi', n: 'Técnicas y Modelos de Innovación', c: 5, cr: 3, r: ['rob'], a: 'gest' },
  // ---- Ciclo 6 ----
  { id: 'arqd', n: 'Arquitectura de Datos', c: 6, cr: 4, r: ['estmul'], a: 'est' },
  { id: 'cd', n: 'Ciencia de Datos', c: 6, cr: 3, r: ['estmul'], a: 'est' },
  { id: 'fin', n: 'Finanzas para Ingeniería', c: 6, cr: 3, r: ['calc1'], a: 'gest' },
  { id: 'ger', n: 'Gerencia para Ingeniería', c: 6, cr: 3, r: [], rc: 100, a: 'gest' },
  { id: 'opt1', n: 'Optimización I', c: 6, cr: 4, r: ['alg'], a: 'mat' },
  { id: 'tdcpro3', n: 'Taller: Comp. Profesionales III', c: 6, cr: 1, r: ['tdcpro2'], a: 'tall' },
  { id: 'taml1', n: 'Técnicas Avanzadas de Machine Learning I', c: 6, cr: 3, r: ['fml'], a: 'ia' },
  // ---- Ciclo 7 ----
  { id: 'cloud', n: 'Cloud Computing', c: 7, cr: 3, r: ['cd'], a: 'prog' },
  { id: 'evalp', n: 'Evaluación de Proyectos', c: 7, cr: 4, r: ['ger', 'fin'], a: 'gest' },
  { id: 'lpcv', n: 'Lenguaje, Pensamiento y Cognición Visual', c: 7, cr: 3, r: ['arqd'], a: 'hum' },
  { id: 'opt2', n: 'Optimización II', c: 7, cr: 3, r: ['opt1'], a: 'mat' },
  { id: 'pi2', n: 'Proyecto Interdisciplinario II', c: 7, cr: 3, r: ['pi1'], a: 'proy' },
  { id: 'tdcpe4', n: 'Taller: Comp. Personales IV', c: 7, cr: 1, r: ['tdcpe3'], a: 'tall' },
  { id: 'taml2', n: 'Técnicas Avanzadas de Machine Learning II', c: 7, cr: 3, r: ['taml1'], a: 'ia' },
  // ---- Ciclo 8 ----
  { id: 'cur', n: 'Curaduría y Gobernanza de Datos', c: 8, cr: 3, r: ['arqd'], a: 'est' },
  { id: 'bigd', n: 'Fundamentos de Big Data', c: 8, cr: 3, r: ['fml'], a: 'est' },
  { id: 'pln', n: 'Procesamiento de Lenguaje Natural', c: 8, cr: 3, r: ['lpcv'], a: 'ia' },
  { id: 'pma', n: 'Project Management & Agile', c: 8, cr: 3, r: ['evalp'], a: 'gest' },
  { id: 'pi3', n: 'Proyecto Interdisciplinario III', c: 8, cr: 3, r: ['pi2'], a: 'proy' },
  { id: 'segia', n: 'Seguridad en Inteligencia Artificial', c: 8, cr: 3, r: [], rc: 120, a: 'ia' },
  { id: 'tdcpro4', n: 'Taller: Comp. Profesionales IV', c: 8, cr: 1, r: ['tdcpro3'], a: 'tall' },
  // ---- Ciclo 9 ----
  { id: 'start', n: 'Desarrollo de Startups de IA', c: 9, cr: 3, r: [], rc: 120, a: 'gest' },
  { id: 'mlops', n: 'Despliegue de Modelos de IA (MLOps)', c: 9, cr: 3, r: ['taml2'], a: 'ia' },
  { id: 'ele1', n: 'Electivo de Especialidad I', c: 9, cr: 3, r: [], a: 'ele' },
  { id: 'ele2', n: 'Electivo de Especialidad II', c: 9, cr: 3, r: [], a: 'ele' },
  { id: 'ieint1', n: 'Electivo Internacional I', c: 9, cr: 1.5, r: [], a: 'ele' },
  { id: 'impl', n: 'Implicaciones Sociales, Riesgos y Regulación de la IA', c: 9, cr: 3, r: [], rc: 120, a: 'hum' },
  { id: 'tdcpe5', n: 'Taller: Comp. Personales V', c: 9, cr: 1, r: ['tdcpe4'], a: 'tall' },
  { id: 'tesis1', n: 'Trabajo de Tesis I', c: 9, cr: 3, r: [], rc: 140, a: 'proy' },
  // ---- Ciclo 10 ----
  { id: 'ele3', n: 'Electivo de Especialidad III', c: 10, cr: 3, r: [], a: 'ele' },
  { id: 'ele4', n: 'Electivo de Especialidad IV', c: 10, cr: 3, r: [], a: 'ele' },
  { id: 'ele5', n: 'Electivo de Especialidad V', c: 10, cr: 3, r: [], a: 'ele' },
  { id: 'ieint2', n: 'Electivo Internacional II', c: 10, cr: 1.5, r: [], a: 'ele' },
  { id: 'bi', n: 'Inteligencia de Negocios & Data Storytelling', c: 10, cr: 3, r: ['fml'], a: 'est' },
  { id: 'psico', n: 'Psicología Cognitiva y Percepción', c: 10, cr: 3, r: ['lpcv'], a: 'hum' },
  { id: 'tdcpro5', n: 'Taller: Comp. Profesionales V', c: 10, cr: 1, r: ['tdcpro4'], a: 'tall' },
  { id: 'tesis2', n: 'Trabajo de Tesis II', c: 10, cr: 3, r: ['tesis1'], a: 'proy' }
]

export const CICLOS = {
  0: { t: 'Pre-form.', s: 'convalidable' },
  1: { t: 'Ciclo 01', s: '20 créditos' },
  2: { t: 'Ciclo 02', s: '21 créditos' },
  3: { t: 'Ciclo 03', s: '20 créditos' },
  4: { t: 'Ciclo 04', s: '19 créditos' },
  5: { t: 'Ciclo 05', s: '19 créditos' },
  6: { t: 'Ciclo 06', s: '21 créditos' },
  7: { t: 'Ciclo 07', s: '20 créditos' },
  8: { t: 'Ciclo 08', s: '19 créditos' },
  9: { t: 'Ciclo 09', s: '20.5 créditos' },
  10: { t: 'Ciclo 10', s: '20.5 créditos' }
}
