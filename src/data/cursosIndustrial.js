// Malla curricular · Ingeniería Industrial y Comercial · ESAN
// id: identificador corto · n: nombre · c: ciclo (0 = pre-formación)
// cr: créditos · r: prerequisitos (ids) · rc: créditos aprobados requeridos
//
// IMPORTANTE: los cursos equivalentes a la malla de IA comparten el MISMO id
// (com0, mat0, com1, prog1, est1, calc1, calc2, fis1, fin, glob y los talleres).
// Ese id compartido es lo que hace que la lista de profesores y sus votos
// se vean desde ambas carreras. No cambiar esos ids sin migrar la tabla
// `professors` en Supabase.

export const TOTAL_CRED_INDUSTRIAL = 215

export const CURSOS_INDUSTRIAL = [
  { id: 'com0', n: 'Comunicaciones', c: 0, cr: 0, r: [] },
  { id: 'mat0', n: 'Matemáticas', c: 0, cr: 0, r: [] },
  { id: 'com1', n: 'Comunicación y Literatura I', c: 1, cr: 3, r: ['com0'] },
  { id: 'est1', n: 'Estadística y Probabilidades', c: 1, cr: 3, r: [] },
  { id: 'prog1', n: 'Fundamentos de Programación', c: 1, cr: 3, r: [] },
  { id: 'glob', n: 'Globalización y Realidad Nacional', c: 1, cr: 3, r: [] },
  { id: 'iic', n: 'Intro. a la Ing. Industrial y Comercial', c: 1, cr: 3, r: [] },
  { id: 'pcrit', n: 'Pensamiento Crítico', c: 1, cr: 2, r: [] },
  { id: 'precalc', n: 'Pre Cálculo', c: 1, cr: 3, r: ['mat0'] },
  { id: 'tdcpe1', n: 'Taller: Comp. Personales I', c: 1, cr: 1, r: [] },
  { id: 'adat1', n: 'Análisis de Datos I', c: 2, cr: 3, r: ['est1'] },
  { id: 'calc1', n: 'Cálculo I', c: 2, cr: 4, r: ['precalc'] },
  { id: 'comlit2', n: 'Comunicación y Literatura II', c: 2, cr: 3, r: ['com1'] },
  { id: 'contab', n: 'Contabilidad General', c: 2, cr: 3, r: [] },
  { id: 'dising1', n: 'Diseño de Ingeniería I', c: 2, cr: 3, r: [] },
  { id: 'mer1', n: 'Mérito curricular I (Deporte/Arte)', c: 2, cr: 0, r: [] },
  { id: 'quim1', n: 'Química I', c: 2, cr: 4, r: [] },
  { id: 'tdcpro1', n: 'Taller: Comp. Profesionales I', c: 2, cr: 1, r: [] },
  { id: 'calc2', n: 'Cálculo II', c: 3, cr: 4, r: ['calc1'] },
  { id: 'dising2', n: 'Diseño de Ingeniería II', c: 3, cr: 4, r: ['dising1'] },
  { id: 'estinf', n: 'Estadística Inferencial', c: 3, cr: 5, r: ['est1', 'calc1'] },
  { id: 'fis1', n: 'Física I', c: 3, cr: 4, r: ['calc1'] },
  { id: 'quim2', n: 'Química II', c: 3, cr: 4, r: ['quim1'] },
  { id: 'tdcpe2', n: 'Taller: Comp. Personales II', c: 3, cr: 1, r: ['tdcpe1'] },
  { id: 'calcav', n: 'Cálculo Avanzado', c: 4, cr: 4, r: ['calc2'] },
  { id: 'costos', n: 'Costos y Presupuestos', c: 4, cr: 4, r: ['contab'] },
  { id: 'econ', n: 'Economía General', c: 4, cr: 4, r: ['glob'] },
  { id: 'fis2', n: 'Física II', c: 4, cr: 4, r: ['fis1'] },
  { id: 'io1', n: 'Investigación Operativa I', c: 4, cr: 4, r: ['calc2'] },
  { id: 'mer2', n: 'Mérito curricular II (Resp. Social)', c: 4, cr: 0, r: [] },
  { id: 'tdcpro2', n: 'Taller: Comp. Profesionales II', c: 4, cr: 1, r: ['tdcpro1'] },
  { id: 'iele1', n: 'Electivo I', c: 5, cr: 3, r: [] },
  { id: 'estat', n: 'Estática', c: 5, cr: 4, r: ['fis1', 'calc2'] },
  { id: 'fin', n: 'Finanzas para Ingeniería I', c: 5, cr: 3, r: ['contab'] },
  { id: 'ingmat', n: 'Ingeniería de Materiales', c: 5, cr: 4, r: ['fis2', 'quim2'] },
  { id: 'io2', n: 'Investigación Operativa II', c: 5, cr: 4, r: ['io1'] },
  { id: 'pcp', n: 'Planeamiento y Control de la Producción', c: 5, cr: 4, r: ['io1'] },
  { id: 'tdcpe3', n: 'Taller: Comp. Personales III', c: 5, cr: 1, r: ['tdcpe2'] },
  { id: 'adat2', n: 'Análisis de Datos II', c: 6, cr: 3, r: ['estinf', 'adat1'] },
  { id: 'iele2', n: 'Electivo II', c: 6, cr: 3, r: [] },
  { id: 'iele3', n: 'Electivo III', c: 6, cr: 3, r: [] },
  { id: 'ingproc', n: 'Ingeniería de Procesos', c: 6, cr: 4, r: ['pcp'] },
  { id: 'mer3', n: 'Mérito curricular III (Círculos acad.)', c: 6, cr: 0, r: [] },
  { id: 'metinv', n: 'Metodología de la Investigación', c: 6, cr: 3, r: [], rc: 105 },
  { id: 'procfab', n: 'Procesos de Fabricación', c: 6, cr: 3, r: ['dising1', 'ingmat'] },
  { id: 'resmat', n: 'Resistencia de Materiales', c: 6, cr: 4, r: ['estat'] },
  { id: 'tdcpro3', n: 'Taller: Comp. Profesionales III', c: 6, cr: 1, r: ['tdcpro2'] },
  { id: 'iele4', n: 'Electivo IV', c: 7, cr: 3, r: [] },
  { id: 'eia', n: 'Estudio del Impacto Ambiental', c: 7, cr: 3, r: ['ingmat'] },
  { id: 'fin2', n: 'Finanzas para Ingeniería II', c: 7, cr: 3, r: ['fin'] },
  { id: 'oscm1', n: 'Operations & Supply Chain Mgmt. I', c: 7, cr: 3, r: ['io1'] },
  { id: 'pfd', n: 'Procesos de Fabricación Digital', c: 7, cr: 3, r: ['procfab'] },
  { id: 'qmcs', n: 'Quality Mgmt. & Customer Services', c: 7, cr: 4, r: ['estinf'] },
  { id: 'spe', n: 'Strategic Planning for Engineering', c: 7, cr: 3, r: ['pcp', 'fin'], rc: 110 },
  // El plan oficial indica que este taller requiere el de Profesionales III (no Personales III)
  { id: 'tdcpe4', n: 'Taller: Comp. Personales IV', c: 7, cr: 1, r: ['tdcpro3'] },
  { id: 'dep', n: 'Diseño y Evaluación de Proyectos', c: 8, cr: 4, r: ['fin2', 'eia'] },
  { id: 'iele5', n: 'Electivo V', c: 8, cr: 3, r: [] },
  { id: 'iele6', n: 'Electivo VI', c: 8, cr: 3, r: [] },
  { id: 'entre', n: 'Entrepreneurship', c: 8, cr: 4, r: [], rc: 110 },
  // Requisito real: 3 meses de práctica pre profesional (no es un curso de la malla)
  { id: 'mer4', n: 'Mérito curricular IV (Práctica pre prof.)', c: 8, cr: 0, r: [] },
  { id: 'oscm2', n: 'Operations & Supply Chain Mgmt. II', c: 8, cr: 3, r: ['oscm1'] },
  { id: 'peng', n: 'Product Engineering', c: 8, cr: 4, r: ['pfd'] },
  { id: 'tdcpro4', n: 'Taller: Comp. Profesionales IV', c: 8, cr: 1, r: ['entre', 'peng'] },
  { id: 'iele7', n: 'Electivo VII', c: 9, cr: 3, r: [] },
  { id: 'iele8', n: 'Electivo VIII', c: 9, cr: 3, r: [] },
  { id: 'iele9', n: 'Electivo IX', c: 9, cr: 3, r: [] },
  { id: 'pmi', n: 'Project Management', c: 9, cr: 3, r: ['oscm2'] },
  { id: 'simproc', n: 'Simulación de Procesos', c: 9, cr: 4, r: [], rc: 160 },
  { id: 'tdcpe5', n: 'Taller: Comp. Personales V', c: 9, cr: 1, r: ['tdcpe4'] },
  { id: 'ttesis1', n: 'Trabajo de Tesis I', c: 9, cr: 3, r: ['metinv'], rc: 140 },
  { id: 'capstone', n: 'Capstone Project', c: 10, cr: 5, r: ['dep'] },
  { id: 'ieint1', n: 'Electivo Internacional I', c: 10, cr: 1.5, r: [] },
  { id: 'ieint2', n: 'Electivo Internacional II', c: 10, cr: 1.5, r: [] },
  { id: 'iele10', n: 'Electivo X', c: 10, cr: 3, r: [] },
  { id: 'iele11', n: 'Electivo XI', c: 10, cr: 3, r: [] },
  { id: 'tdcpro5', n: 'Taller: Comp. Profesionales V', c: 10, cr: 1, r: ['tdcpro4'] },
  { id: 'ttesis2', n: 'Trabajo de Tesis II', c: 10, cr: 3, r: ['ttesis1'] }
]

export const CICLOS_INDUSTRIAL = {
  0: { t: 'Pre-form.', s: 'convalidable' },
  1: { t: 'Ciclo 01', s: '21 créditos' },
  2: { t: 'Ciclo 02', s: '21 créditos' },
  3: { t: 'Ciclo 03', s: '22 créditos' },
  4: { t: 'Ciclo 04', s: '21 créditos' },
  5: { t: 'Ciclo 05', s: '23 créditos' },
  6: { t: 'Ciclo 06', s: '24 créditos' },
  7: { t: 'Ciclo 07', s: '23 créditos' },
  8: { t: 'Ciclo 08', s: '22 créditos' },
  9: { t: 'Ciclo 09', s: '20 créditos' },
  10: { t: 'Ciclo 10', s: '18 créditos' }
}
