// Malla curricular · Comunicación Empresarial y Marketing Digital · ESAN
// Plan aprobado por Acuerdo N°003-03/2023 del Consejo Universitario.
// id: identificador corto · n: nombre · c: ciclo (0 = pre-formación)
// cr: créditos · r: prerequisitos (ids) · rc: créditos aprobados requeridos
// a: área temática (ver data/areas.js)
//
// IMPORTANTE: los cursos equivalentes a las otras carreras ESAN comparten el
// MISMO id (com0, mat0, com1, comlit2, glob, pcrit, precalc, est1, estinf,
// adat1, contab, costos, econ, fil, metinv, entre, ttesis1/2, ieint1/2 y los
// talleres tdcpe*/tdcpro*). Ese id compartido hace que los profesores y sus
// votos se vean desde las tres mallas ESAN. No cambiar esos ids sin migrar
// la tabla `professors`. Con la PUCP no se comparte nada (sus ids llevan
// prefijo 'pucp-').
// Los requisitos y créditos pueden variar por malla (p. ej. metinv pide 85
// créditos aquí y 105 en Industrial): cada archivo declara los suyos.

export const TOTAL_CRED_MARKETING = 215

export const CURSOS_MARKETING = [
  { id: 'com0', n: 'Comunicaciones', c: 0, cr: 0, r: [], a: 'hum' },
  { id: 'mat0', n: 'Matemáticas', c: 0, cr: 0, r: [], a: 'mat' },
  { id: 'admgen', n: 'Administración General', c: 1, cr: 4, r: [], a: 'gest' },
  { id: 'antro', n: 'Antropología Social', c: 1, cr: 3, r: [], a: 'hum' },
  { id: 'com1', n: 'Comunicación y Literatura I', c: 1, cr: 3, r: ['com0'], a: 'hum' },
  { id: 'glob', n: 'Globalización y Realidad Nacional', c: 1, cr: 3, r: [], a: 'hum' },
  { id: 'icc', n: 'Intro. a las Ciencias de la Comunicación', c: 1, cr: 2, r: [], a: 'mark' },
  { id: 'pcrit', n: 'Pensamiento Crítico', c: 1, cr: 2, r: [], a: 'hum' },
  { id: 'precalc', n: 'Pre Cálculo', c: 1, cr: 3, r: ['mat0'], a: 'mat' },
  { id: 'tdcpe1', n: 'Taller: Comp. Personales I', c: 1, cr: 1, r: [], a: 'tall' },
  { id: 'adat1', n: 'Análisis de Datos I', c: 2, cr: 3, r: [], a: 'est' },
  { id: 'comlit2', n: 'Comunicación y Literatura II', c: 2, cr: 3, r: ['com1'], a: 'hum' },
  { id: 'contab', n: 'Contabilidad General', c: 2, cr: 3, r: ['admgen'], a: 'gest' },
  { id: 'est1', n: 'Estadística y Probabilidades', c: 2, cr: 3, r: ['precalc'], a: 'est' },
  { id: 'fmark', n: 'Fundamentos de Marketing', c: 2, cr: 3, r: ['admgen'], a: 'mark' },
  { id: 'matcs', n: 'Matemática para Ciencias Sociales', c: 2, cr: 3, r: ['precalc'], a: 'mat' },
  { id: 'tfoto', n: 'Taller de Fotografía', c: 2, cr: 3, r: [], a: 'crea' },
  { id: 'tdcpro1', n: 'Taller: Comp. Profesionales I', c: 2, cr: 1, r: [], a: 'tall' },
  { id: 'ccons', n: 'Comportamiento del Consumidor', c: 3, cr: 4, r: ['fmark'], a: 'mark' },
  { id: 'econ', n: 'Economía General', c: 3, cr: 4, r: ['admgen'], a: 'gest' },
  { id: 'percom', n: 'Percepción y Comunicación', c: 3, cr: 3, r: ['comlit2'], a: 'hum' },
  { id: 'semio', n: 'Semiótica', c: 3, cr: 3, r: ['comlit2'], a: 'hum' },
  { id: 'tdg1', n: 'Taller de Diseño Gráfico I', c: 3, cr: 3, r: ['tfoto'], a: 'crea' },
  { id: 'tdcpe2', n: 'Taller: Comp. Personales II', c: 3, cr: 1, r: ['tdcpe1'], a: 'tall' },
  { id: 'tdo', n: 'Teoría y Diseño Organizacional', c: 3, cr: 5, r: ['admgen'], a: 'gest' },
  { id: 'chorg', n: 'Comportamiento Humano en las Organizaciones', c: 4, cr: 3, r: ['admgen'], a: 'gest' },
  { id: 'commk', n: 'Comunicaciones de Marketing', c: 4, cr: 3, r: ['ccons'], a: 'mark' },
  { id: 'costos', n: 'Costos y Presupuestos', c: 4, cr: 4, r: ['contab'], a: 'gest' },
  { id: 'cele1', n: 'Electivo I', c: 4, cr: 3, r: [], a: 'ele' },
  { id: 'estinf', n: 'Estadística Inferencial', c: 4, cr: 5, r: ['est1'], a: 'est' },
  { id: 'tdg2', n: 'Taller de Diseño Gráfico II', c: 4, cr: 4, r: ['tdg1'], a: 'crea' },
  { id: 'tdcpro2', n: 'Taller: Comp. Profesionales II', c: 4, cr: 1, r: ['tdcpro1'], a: 'tall' },
  { id: 'cele2', n: 'Electivo II', c: 5, cr: 3, r: [], a: 'ele' },
  { id: 'segpos', n: 'Estrategias de Segmentación y Posicionamiento', c: 5, cr: 4, r: ['ccons'], a: 'mark' },
  { id: 'fil', n: 'Filosofía y Ética', c: 5, cr: 3, r: [], a: 'hum' },
  { id: 'intdiv', n: 'Interculturalidad, Diversidad y Psicología', c: 5, cr: 3, r: ['antro'], a: 'hum' },
  { id: 'metinv', n: 'Metodología de la Investigación', c: 5, cr: 3, r: [], rc: 85, a: 'proy' },
  { id: 'tav', n: 'Taller de Audio y Video', c: 5, cr: 4, r: ['semio'], a: 'crea' },
  { id: 'tdcpe3', n: 'Taller: Comp. Personales III', c: 5, cr: 1, r: ['tdcpe2'], a: 'tall' },
  { id: 'creapub', n: 'Creatividad Publicitaria', c: 6, cr: 3, r: ['percom'], a: 'mark' },
  { id: 'emark', n: 'E-Marketing', c: 6, cr: 3, r: ['commk'], a: 'mark' },
  { id: 'cele3', n: 'Electivo III', c: 6, cr: 3, r: [], a: 'ele' },
  { id: 'cele4', n: 'Electivo IV', c: 6, cr: 3, r: [], a: 'ele' },
  { id: 'invcual', n: 'Investigación Cualitativa de Mercados', c: 6, cr: 4, r: ['estinf'], a: 'mark' },
  { id: 'tdgp', n: 'Taller de Diseño Gráfico Publicitario', c: 6, cr: 4, r: ['tdg2'], a: 'crea' },
  { id: 'tdcpro3', n: 'Taller: Comp. Profesionales III', c: 6, cr: 1, r: ['tdcpro2'], a: 'tall' },
  { id: 'brand', n: 'Branding', c: 7, cr: 3, r: ['commk'], a: 'mark' },
  { id: 'deremp', n: 'Derecho Empresarial', c: 7, cr: 4, r: [], rc: 85, a: 'gest' },
  { id: 'cele5', n: 'Electivo V', c: 7, cr: 3, r: [], a: 'ele' },
  { id: 'cele6', n: 'Electivo VI', c: 7, cr: 3, r: [], a: 'ele' },
  { id: 'invcuant', n: 'Investigación Cuantitativa de Mercados', c: 7, cr: 4, r: ['invcual'], a: 'mark' },
  { id: 'pubventas', n: 'Publicidad y Promoción de Ventas', c: 7, cr: 3, r: ['commk'], a: 'mark' },
  { id: 'tdcpe4', n: 'Taller: Comp. Personales IV', c: 7, cr: 1, r: ['tdcpe3'], a: 'tall' },
  { id: 'analitica', n: 'Analítica Digital', c: 8, cr: 4, r: ['emark'], a: 'mark' },
  { id: 'ieint1', n: 'Electivo Internacional I', c: 8, cr: 1.5, r: [], a: 'ele' },
  { id: 'ieint2', n: 'Electivo Internacional II', c: 8, cr: 1.5, r: [], a: 'ele' },
  { id: 'cele7', n: 'Electivo VII', c: 8, cr: 3, r: [], a: 'ele' },
  { id: 'cele8', n: 'Electivo VIII', c: 8, cr: 3, r: [], a: 'ele' },
  { id: 'planest', n: 'Planeación Estratégica', c: 8, cr: 4, r: [], rc: 110, a: 'gest' },
  { id: 'tprav', n: 'Taller de Producción y Realización Audiovisual', c: 8, cr: 4, r: ['tav'], a: 'crea' },
  { id: 'tdcpro4', n: 'Taller: Comp. Profesionales IV', c: 8, cr: 1, r: ['tdcpro3'], a: 'tall' },
  { id: 'entre', n: 'Entrepreneurship', c: 9, cr: 4, r: [], rc: 140, a: 'gest' },
  { id: 'ecoenv', n: 'Ecology, Environment and Social Responsability', c: 9, cr: 3, r: [], rc: 140, a: 'hum' },
  { id: 'cele9', n: 'Electivo IX', c: 9, cr: 3, r: [], a: 'ele' },
  { id: 'cele10', n: 'Electivo X', c: 9, cr: 3, r: [], a: 'ele' },
  { id: 'cele11', n: 'Electivo XI', c: 9, cr: 3, r: [], a: 'ele' },
  { id: 'tdcpe5', n: 'Taller: Comp. Personales V', c: 9, cr: 1, r: ['tdcpe4'], a: 'tall' },
  { id: 'ttesis1', n: 'Trabajo de Tesis I', c: 9, cr: 3, r: ['metinv'], a: 'proy' },
  { id: 'dircom', n: 'Dirección de Comunicación Corporativa', c: 10, cr: 4, r: [], rc: 175, a: 'mark' },
  { id: 'cele12', n: 'Electivo XII', c: 10, cr: 3, r: [], a: 'ele' },
  { id: 'cele13', n: 'Electivo XIII', c: 10, cr: 3, r: [], a: 'ele' },
  { id: 'cele14', n: 'Electivo XIV', c: 10, cr: 3, r: [], a: 'ele' },
  { id: 'tproydig', n: 'Taller de Proyectos Digitales', c: 10, cr: 4, r: ['analitica'], a: 'crea' },
  { id: 'tdcpro5', n: 'Taller: Comp. Profesionales V', c: 10, cr: 1, r: ['tdcpro4'], a: 'tall' },
  { id: 'ttesis2', n: 'Trabajo de Tesis II', c: 10, cr: 3, r: ['ttesis1'], a: 'proy' }
]

export const CICLOS_MARKETING = {
  0: { t: 'Pre-form.', s: 'convalidable' },
  1: { t: 'Ciclo 01', s: '21 créditos' },
  2: { t: 'Ciclo 02', s: '22 créditos' },
  3: { t: 'Ciclo 03', s: '23 créditos' },
  4: { t: 'Ciclo 04', s: '23 créditos' },
  5: { t: 'Ciclo 05', s: '21 créditos' },
  6: { t: 'Ciclo 06', s: '21 créditos' },
  7: { t: 'Ciclo 07', s: '21 créditos' },
  8: { t: 'Ciclo 08', s: '22 créditos' },
  9: { t: 'Ciclo 09', s: '20 créditos' },
  10: { t: 'Ciclo 10', s: '21 créditos' }
}
