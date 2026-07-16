// Áreas temáticas de los cursos: dan color a las líneas de la malla
// para distinguir cada cadena (matemáticas, programación, gestión, etc.).
// Cada curso declara su área en el campo `a` (cursos.js / cursosIndustrial.js);
// la línea toma el color del área del curso al que llega.
// Los colores son apagados a propósito: el resaltado verde/ámbar de
// «Qué abre» / «Qué requiere» sigue siendo el protagonista al seleccionar.

export const AREAS = {
  mat: { label: 'Matemáticas', color: '#4472B8' },
  est: { label: 'Estadística y datos', color: '#8355C6' },
  prog: { label: 'Programación y computación', color: '#0E8B8F' },
  ia: { label: 'Inteligencia artificial', color: '#C8508F' },
  cie: { label: 'Ciencias', color: '#5F9E3C' },
  ind: { label: 'Ingeniería y operaciones', color: '#A0522D' },
  gest: { label: 'Gestión y negocios', color: '#D07C2C' },
  mark: { label: 'Marketing y comunicación', color: '#C99327' },
  crea: { label: 'Diseño y producción audiovisual', color: '#2AA5C9' },
  hum: { label: 'Humanidades', color: '#7A6A56' },
  proy: { label: 'Proyectos y tesis', color: '#B23A48' },
  tall: { label: 'Talleres y méritos', color: '#98A0A8' },
  ele: { label: 'Electivos', color: '#BFC5CC' }
}
