// Calendario académico por universidad.
// Las fechas oficiales vienen del PDF «Calendario Académico 2026-2» de ESAN
// y son inmutables en la interfaz (solo lectura). La PUCP aún no tiene
// calendario oficial cargado: sus alumnos solo ven sus eventos personales.
// Los colores de cada tipo viven en AcademicCalendar.css (clases t-* y c-*)
// para que el modo oscuro pueda definir su propia paleta.

export const TIPOS_EVENTO = {
  admin: { label: 'Trámite' },
  academic: { label: 'Académico' },
  deadline: { label: 'Fecha límite' },
  exams: { label: 'Evaluación' },
  holiday: { label: 'Feriado' },
  custom: { label: 'Personal' }
}

// Colores que el alumno puede elegir para sus eventos personales
export const COLORES_PERSONAL = [
  { key: 'gris', label: 'Gris' },
  { key: 'azul', label: 'Azul' },
  { key: 'verde', label: 'Verde' },
  { key: 'amarillo', label: 'Amarillo' },
  { key: 'naranja', label: 'Naranja' },
  { key: 'rojo', label: 'Rojo' },
  { key: 'morado', label: 'Morado' },
  { key: 'rosa', label: 'Rosa' }
]

const EVENTOS_ESAN_2026_2 = [
  {
    id: 'pago-1',
    title: 'Pago Primera boleta',
    start: '2026-07-23',
    end: '2026-07-30',
    type: 'admin',
    desc: 'Semana de pago para la primera boleta del ciclo 2026-2.'
  },
  {
    id: 'mat-virt-1',
    title: 'Matrícula virtual',
    start: '2026-08-03',
    end: '2026-08-05',
    type: 'admin',
    desc: 'De acuerdo al orden por carrera, prioridad y horario publicado. (09:00 a 17:00 hrs.)'
  },
  {
    id: 'mat-virt-2',
    title: 'Matrícula virtual',
    date: '2026-08-07',
    type: 'admin',
    desc: 'Continúa la matrícula según prioridad. (09:00 a 17:00 hrs.)'
  },
  {
    id: 'mat-ext-1',
    title: 'Matrícula extemporánea',
    date: '2026-08-10',
    type: 'admin',
    desc: 'Para alumnos regulares. (10:00 a 17:00 hrs.)'
  },
  {
    id: 'mat-ingr',
    title: 'Matrícula ingresantes',
    date: '2026-08-12',
    type: 'admin',
    desc: 'Matrícula exclusiva para alumnos ingresantes.'
  },
  {
    id: 'ind-est',
    title: 'Inducción (nuevos)',
    start: '2026-08-10',
    end: '2026-08-14',
    type: 'academic',
    desc: 'Inducción exclusiva para estudiantes nuevos.'
  },
  {
    id: 'global-week',
    title: 'Global Week',
    start: '2026-08-10',
    end: '2026-08-14',
    type: 'academic',
    desc: 'Semana Internacional: inician las clases de los cursos de la Global Week.'
  },
  {
    id: 'mat-ext-nuevos',
    title: 'Matrícula extemp. nuevos',
    date: '2026-08-17',
    type: 'admin',
    desc: 'Excepcionalmente, se permitirá una matrícula extemporánea de alumnos ingresantes hasta el 24 de agosto.'
  },
  {
    id: 'ini-clases',
    title: 'Inicio clases regulares',
    date: '2026-08-17',
    type: 'academic',
    desc: 'Comienzo oficial de los cursos regulares del semestre 2026-2.'
  },
  {
    id: 'feriado-1',
    title: 'Batalla de Junín',
    date: '2026-08-06',
    type: 'holiday',
    desc: 'Feriado nacional. Se suspenden todas las actividades académicas.'
  },
  {
    id: 'feriado-2',
    title: 'Combate de Angamos',
    date: '2026-10-08',
    type: 'holiday',
    desc: 'Feriado nacional. Se suspenden todas las actividades académicas.'
  },
  {
    id: 'lim-retiro-cur',
    title: 'Límite Retiro de curso',
    date: '2026-10-23',
    type: 'deadline',
    desc: 'Plazo máximo para retiro de curso hasta las 12:00 hrs.'
  },
  {
    id: 'lim-cambio-car',
    title: 'Límite Cambio de carrera',
    date: '2026-11-20',
    type: 'deadline',
    desc: 'Fecha límite para presentar solicitud de cambio de carrera hasta las 12:00 hrs.'
  },
  {
    id: 'lim-retiro-cic',
    title: 'Límite Retiro de ciclo',
    date: '2026-11-27',
    type: 'deadline',
    desc: 'Plazo máximo para retiro de ciclo hasta las 17:00 hrs.'
  },
  {
    id: 'fin-clases',
    title: 'Último día de clases',
    date: '2026-11-28',
    type: 'academic',
    desc: 'Fin de las clases regulares del semestre.'
  },
  {
    id: 'finales',
    title: 'Evaluaciones Finales',
    start: '2026-11-30',
    end: '2026-12-05',
    type: 'exams',
    desc: 'Semana de exámenes finales. Se suspenden las clases.'
  },
  {
    id: 'feriado-3',
    title: 'Inmaculada Concepción',
    date: '2026-12-08',
    type: 'holiday',
    desc: 'Feriado nacional. Se suspenden todas las actividades académicas.'
  },
  {
    id: 'feriado-4',
    title: 'Batalla de Ayacucho',
    date: '2026-12-09',
    type: 'holiday',
    desc: 'Feriado nacional. Se suspenden todas las actividades académicas.'
  },
  {
    id: 'rezagados-1',
    title: 'Eval. Rezagados',
    date: '2026-12-07',
    type: 'exams',
    desc: 'Exámenes de rezagados, solo con autorización confirmada (horarios en la UEvirtual).'
  },
  {
    id: 'rezagados-2',
    title: 'Eval. Rezagados',
    date: '2026-12-10',
    type: 'exams',
    desc: 'Exámenes de rezagados, solo con autorización confirmada (horarios en la UEvirtual).'
  },
  {
    id: 'dev-finales',
    title: 'Devolución finales',
    start: '2026-12-10',
    end: '2026-12-11',
    type: 'academic',
    desc: 'Devolución de evaluaciones finales (según horarios publicados en la UEvirtual).'
  },
  {
    id: 'dev-rezagados',
    title: 'Devolución rezagados',
    date: '2026-12-11',
    type: 'academic',
    desc: 'Devolución de evaluaciones de rezagados.'
  },
  {
    id: 'pub-rev-1',
    title: '1ra revisión',
    date: '2026-12-15',
    type: 'admin',
    desc: 'Publicación de primera revisión de evaluación final y de rezagados.'
  },
  {
    id: 'lim-rev-2',
    title: 'Sol. 2da revisión',
    date: '2026-12-16',
    type: 'deadline',
    desc: 'Presentación de solicitudes de segunda revisión (09:00 a 18:00 hrs). No se aceptan fuera de fecha.'
  },
  {
    id: 'pub-rev-2',
    title: '2da revisión',
    date: '2026-12-18',
    type: 'admin',
    desc: 'Publicación de la segunda revisión a partir de las 20:00 hrs.'
  },
  {
    id: 'cierre-actas',
    title: 'Cierre de actas',
    date: '2026-12-18',
    type: 'deadline',
    desc: 'Cierre oficial de actas del periodo 2026-2.'
  },
  {
    id: 'sin-atencion',
    title: 'Sin atención a alumnos',
    start: '2026-12-21',
    end: '2027-01-03',
    type: 'admin',
    desc: 'Se suspende la atención a alumnos desde el 21 de diciembre al 3 de enero de 2027.'
  }
]

// Clave = campo `uni` de data/carreras.js. Cada universidad ve SOLO su
// calendario oficial; los eventos personales son aparte (localStorage).
export const CALENDARIO_POR_UNI = {
  'Universidad ESAN': { titulo: 'Calendario Académico 2026-2', eventos: EVENTOS_ESAN_2026_2 },
  'PUCP': { titulo: 'Calendario 2026-2', eventos: [] }
}
