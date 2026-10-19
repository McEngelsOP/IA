import { PALOMA_SVG, MONITOR_SVG, NOTICE_SVG } from '../assets/lyraCompanion.js'
import '../styles/HomeCompanion.css'

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))

export function homeCompanion(message) {
  return `<div class="pal-companion" role="group" aria-label="Tu paloma compañera de estudio"><div class="pal-bubble"><span class="pal-ex">${NOTICE_SVG}</span><span class="pal-t" data-idle="${escape(message)}">${escape(message)}</span></div><div class="pal-stage"><div class="pal-ground"></div><div class="pal-mon">${MONITOR_SVG}</div><div class="pal-mv"><div class="pal-hop">${PALOMA_SVG}</div></div></div><p class="pal-caption">Tu compañera de estudio</p></div>`
}

export function mountHomeCompanion(page) {
  const sequence = [
    { state:'idle', ms:2400 },
    { state:'sip', ms:2900, text:'Un sorbito de café… ¡y seguimos con calma!' },
    { state:'idle', ms:1300 },
    { state:'walk', ms:4500, text:'Estirando las patitas un ratito…' },
    { state:'idle', ms:1400 },
    { state:'alert', ms:2300, text:'¡Aviso! Revisa tus pendientes de la semana.' },
    { state:'idle', ms:1400 },
    { state:'ok', ms:3200, text:'¡Todo en orden! Un paso más hacia tu meta.' },
    { state:'idle', ms:2200 }
  ]
  let hero = null, observer = null, timer = 0, index = 0
  let remaining = sequence[0].ms, deadline = 0, running = false, visible = true
  function paint() {
    if (!hero) return
    const phase = sequence[index], line = hero.querySelector('.pal-t')
    hero.dataset.s = phase.state
    line.textContent = phase.text || line.dataset.idle
  }
  function stop() {
    if (running) { remaining = Math.max(0, deadline - performance.now()); running = false }
    clearTimeout(timer); timer = 0
  }
  function start() {
    if (running || !hero?.isConnected || !visible || document.hidden) return
    running = true; deadline = performance.now() + remaining
    timer = setTimeout(() => {
      timer = 0; running = false; index = (index + 1) % sequence.length
      remaining = sequence[index].ms; paint(); start()
    }, remaining)
  }
  function sync() {
    if (!hero) return
    hero.dataset.offscreen = String(!visible || document.hidden)
    if (visible && !document.hidden) start(); else stop()
  }
  function bind() {
    const next = page.querySelector('#h-pal')
    if (next === hero) return
    stop(); observer?.disconnect(); hero = next; visible = true
    if (!hero) return
    paint()
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync() }, { threshold:.1 })
      observer.observe(hero.querySelector('.pal-companion'))
    }
    sync()
  }
  const changes = new MutationObserver(bind)
  changes.observe(page, { childList:true }); bind()
  document.addEventListener('visibilitychange', sync)
  return () => { stop(); changes.disconnect(); observer?.disconnect(); document.removeEventListener('visibilitychange', sync) }
}
