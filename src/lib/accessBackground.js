/* Decorative media never participates in authentication readiness. */
export function initializeAccessBackground({
  document = window.document,
  reduce = window.matchMedia('(prefers-reduced-motion: reduce)'),
  connection = window.navigator.connection,
  requestAnimationFrame = window.requestAnimationFrame.bind(window),
} = {}) {
  const $ = id => document.getElementById(id)
  const landscape = $('landscape')
  let manualPause = false
  let backgroundStarted = false, backgroundFailed = false, playRevision = 0
  function motion() {
    const paused = manualPause || reduce.matches || document.hidden
    document.body.dataset.paused = String(paused)
    const button = $('motionToggle'); button.disabled = reduce.matches || backgroundFailed
    button.setAttribute('aria-pressed', String(manualPause || reduce.matches))
    button.setAttribute('aria-label', backgroundFailed ? 'Paisaje estático: video no disponible' : reduce.matches ? 'Movimiento reducido del sistema activado' : manualPause ? 'Reanudar movimiento del paisaje' : 'Pausar movimiento del paisaje')
    $('pauseIcon').toggleAttribute('hidden', manualPause || reduce.matches); $('playIcon').toggleAttribute('hidden', !(manualPause || reduce.matches))
    const revision = ++playRevision
    if (paused) landscape.pause()
    else if (backgroundStarted && !backgroundFailed) landscape.play().catch(() => {
      // A stale play promise can be rejected by a subsequent pause.
      if (revision !== playRevision) return
      manualPause = true; motion()
    })
  }
  function startBackground(force = false) {
    if (backgroundStarted || backgroundFailed || document.hidden || reduce.matches) return
    if (!force && (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || ''))) {
      manualPause = true; motion(); return
    }
    backgroundStarted = true
    landscape.src = landscape.dataset.src
    landscape.load()
    motion()
  }
  landscape.addEventListener('error', () => {
    backgroundFailed = true
    landscape.pause(); landscape.removeAttribute('src'); landscape.load()
    $('motionToggle').disabled = true
    $('motionToggle').setAttribute('aria-label', 'Paisaje estático: video no disponible')
  }, { once: true })
  motion()
  reduce.addEventListener('change', () => { motion(); startBackground() })
  $('motionToggle').addEventListener('click', () => { manualPause = !manualPause; if (!manualPause) startBackground(true); motion() })
  // Two frames give the form a paint before the decorative video starts loading.
  requestAnimationFrame(() => requestAnimationFrame(() => startBackground()))
  document.addEventListener('visibilitychange', () => { motion(); if (!document.hidden) startBackground() })
}
