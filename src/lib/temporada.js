// Temporadas académicas del arcade: YYYY-I (enero–julio) y YYYY-II
// (agosto–diciembre). La MISMA regla vive en la base como
// temporada_actual() (query 26 · temporadas.sql): si se cambia aquí,
// cambiarla también allá.

export const PRIMERA_TEMPORADA = '2026-I'

export const temporadaActual = (d = new Date()) =>
  `${d.getFullYear()}-${d.getMonth() < 7 ? 'I' : 'II'}`

// Todas las temporadas desde la primera hasta la actual, la más
// reciente primero (para el selector del ranking)
export const listaTemporadas = () => {
  const out = []
  let [y, s] = PRIMERA_TEMPORADA.split('-')
  y = Number(y)
  const actual = temporadaActual()
  for (let i = 0; i < 80; i++) {
    const key = `${y}-${s}`
    out.push(key)
    if (key === actual) break
    if (s === 'I') s = 'II'
    else { s = 'I'; y++ }
  }
  return out.reverse()
}
