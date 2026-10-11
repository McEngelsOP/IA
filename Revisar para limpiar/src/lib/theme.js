// Tema claro/oscuro de la app (el arcade tiene su propio look y no cambia).
// La elección se guarda en localStorage: el modo elegido queda como el modo
// con el que la app inicia siempre en ese dispositivo.
const KEY = 'malla-tema'

export const getTheme = () =>
  (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) === 'dark'
    ? 'dark'
    : 'light'

export const applyTheme = t => {
  document.documentElement.dataset.theme = t
  // la barra del navegador móvil acompaña el tema elegido
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0d1220' : '#ffffff')
}

export const saveTheme = t => {
  try { localStorage.setItem(KEY, t) } catch { /* modo incógnito estricto */ }
  applyTheme(t)
}
