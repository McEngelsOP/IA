import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { temporadaActual } from '../lib/temporada'
import '../styles/ResumenCiclo.css'

// «Tu ciclo en números» · resumen visual compartible (estilo Wrapped):
// se dibuja en un canvas de 1080×1350 (formato 4:5 para redes) y se
// descarga como PNG. TODO se calcula en el cliente con datos propios;
// el alumno decide si lo comparte y qué ciclo muestra. No expone alias
// ni identidad: solo números.

const W = 1080, H = 1350
const PASS = 10.5

const JUEGOS = {
  dino: { icon: '🦖', name: 'DINO RUN+' },
  astro: { icon: '🚀', name: 'ASTRO-DEFENSA' },
  galaxia: { icon: '🛸', name: 'ESCUADRÓN GALÁCTICO' },
  frogger: { icon: '🐸', name: 'FROGGER+' },
  memoria: { icon: '🧠', name: 'MEMORY MATCH+' }
}

export default function ResumenCiclo({ open, onClose, user, cursos, ciclos, done, grades, statuses, logrosCount, uni, nombre }) {
  const canvasRef = useRef(null)
  const [scope, setScope] = useState('todo') // 'todo' | número de ciclo
  const [arcadeBest, setArcadeBest] = useState(null) // { game, score } | null

  // Mejor puntaje del arcade en la temporada actual (una sola vez al abrir)
  useEffect(() => {
    if (!open || !user || arcadeBest !== null) return
    Promise.all(
      Object.keys(JUEGOS).map(g =>
        supabase.rpc('my_game_score', { g }).then(({ data }) => ({ game: g, score: data || 0 }))
      )
    ).then(rs => {
      const best = rs.reduce((a, b) => (b.score > a.score ? b : a), { game: null, score: 0 })
      setArcadeBest(best)
    }).catch(() => setArcadeBest({ game: null, score: 0 }))
  }, [open, user, arcadeBest])

  // Ciclos que tienen al menos un curso llevado (para el selector)
  const ciclosConAvance = useMemo(
    () => Object.keys(ciclos).map(Number).sort((a, b) => a - b)
      .filter(num => cursos.some(c => c.c === num && done.has(c.id))),
    [ciclos, cursos, done]
  )

  const datos = useMemo(() => {
    const enScope = c => done.has(c.id) && (scope === 'todo' || c.c === Number(scope))
    const llevados = cursos.filter(enScope)
    const cred = llevados.reduce((s, c) => s + c.cr, 0)
    const totalCarrera = cursos.reduce((s, c) => s + c.cr, 0)
    const credCarrera = cursos.reduce((s, c) => s + (done.has(c.id) ? c.cr : 0), 0)
    const pct = totalCarrera > 0 ? Math.round((credCarrera / totalCarrera) * 100) : 0
    // ponderado del scope con la misma regla del panel (retiros fuera)
    let pcr = 0, psum = 0
    llevados.forEach(c => {
      const g = grades[c.id]
      if (g !== undefined && c.cr > 0 && (done.has(c.id) || statuses[c.id]?.status === 'desaprobado')) {
        pcr += c.cr
        psum += g * c.cr
      }
    })
    return {
      label: scope === 'todo' ? 'TODA LA CARRERA' : ciclos[scope]?.t || `CICLO ${scope}`,
      llevados: llevados.length,
      cred,
      pct,
      pond: pcr > 0 ? psum / pcr : null
    }
  }, [scope, cursos, ciclos, done, grades, statuses])

  // ---------- Dibujo del póster ----------
  useEffect(() => {
    if (!open || !canvasRef.current) return
    const cv = canvasRef.current
    const x = cv.getContext('2d')
    const d = datos

    const render = () => {
      // fondo
      x.fillStyle = '#0d1220'
      x.fillRect(0, 0, W, H)
      // manchas de color muy suaves (decoración)
      const blob = (cx, cy, r, color) => {
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r)
        g.addColorStop(0, color)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = g
        x.fillRect(cx - r, cy - r, r * 2, r * 2)
      }
      blob(140, 180, 340, 'rgba(45, 226, 230, 0.10)')
      blob(950, 480, 380, 'rgba(200, 107, 255, 0.09)')
      blob(220, 1180, 400, 'rgba(168, 224, 95, 0.09)')
      // marco
      x.strokeStyle = 'rgba(255,255,255,0.16)'
      x.lineWidth = 3
      x.beginPath()
      x.roundRect(42, 42, W - 84, H - 84, 34)
      x.stroke()

      x.textAlign = 'center'
      // cabecera
      x.fillStyle = '#8b96c9'
      x.font = '600 28px "JetBrains Mono", monospace'
      x.fillText(uni.toUpperCase(), W / 2, 150)
      x.fillStyle = '#dfe4f5'
      x.font = '700 40px "Inter", sans-serif'
      x.fillText(nombre, W / 2, 208, W - 180)
      // título
      x.fillStyle = '#ffffff'
      x.font = '700 86px "Source Serif 4", serif'
      x.fillText('Mi avance en números', W / 2, 330)
      x.fillStyle = '#ffd166'
      x.font = '700 34px "JetBrains Mono", monospace'
      x.fillText(d.label, W / 2, 392)

      // héroe: ponderado si hay notas; si no, créditos
      const heroVal = d.pond !== null ? d.pond.toFixed(2) : String(d.cred)
      const heroLbl = d.pond !== null
        ? `PONDERADO${d.pond >= PASS ? ' · APROBANDO ✓' : ''}`
        : 'CRÉDITOS LLEVADOS'
      x.fillStyle = '#2de2e6'
      x.font = '700 190px "JetBrains Mono", monospace'
      x.fillText(heroVal, W / 2, 620)
      x.fillStyle = '#8b96c9'
      x.font = '600 30px "JetBrains Mono", monospace'
      x.fillText(heroLbl, W / 2, 678)

      // tarjetas 2×2
      const cards = [
        { v: String(d.llevados), l: 'CURSOS LLEVADOS' },
        { v: String(d.cred), l: 'CRÉDITOS' },
        { v: `${d.pct}%`, l: 'DE LA CARRERA' },
        { v: String(logrosCount), l: 'LOGROS' }
      ]
      const cw = 440, ch = 170, gap = 40
      const x0 = (W - cw * 2 - gap) / 2
      const y0 = 740
      cards.forEach((c, i) => {
        const cx = x0 + (i % 2) * (cw + gap)
        const cy = y0 + Math.floor(i / 2) * (ch + gap)
        x.fillStyle = 'rgba(255,255,255,0.05)'
        x.strokeStyle = 'rgba(255,255,255,0.13)'
        x.lineWidth = 2
        x.beginPath()
        x.roundRect(cx, cy, cw, ch, 24)
        x.fill()
        x.stroke()
        x.fillStyle = '#ffffff'
        x.font = '700 72px "JetBrains Mono", monospace'
        x.fillText(c.v, cx + cw / 2, cy + 92)
        x.fillStyle = '#8b96c9'
        x.font = '600 24px "JetBrains Mono", monospace'
        x.fillText(c.l, cx + cw / 2, cy + 138)
      })

      // arcade (si hay puntaje esta temporada)
      let fy = 1210
      if (arcadeBest?.game) {
        const j = JUEGOS[arcadeBest.game]
        x.fillStyle = 'rgba(255, 209, 102, 0.10)'
        x.strokeStyle = 'rgba(255, 209, 102, 0.4)'
        x.beginPath()
        x.roundRect(x0, 1148, cw * 2 + gap, 96, 24)
        x.fill()
        x.stroke()
        x.fillStyle = '#ffd166'
        x.font = '600 34px "JetBrains Mono", monospace'
        x.fillText(`${j.icon} MEJOR ARCADE · ${j.name} · ${arcadeBest.score} PTS`, W / 2, 1208)
        fy = 1286
      }

      // pie
      x.fillStyle = '#6b76a8'
      x.font = '600 26px "JetBrains Mono", monospace'
      x.fillText(`MALLA CURRICULAR INTERACTIVA · TEMPORADA ${temporadaActual()}`, W / 2, fy)
    }

    // esperar a que las fuentes web estén listas para que el póster salga bien
    if (document.fonts?.ready) document.fonts.ready.then(render)
    else render()
  }, [open, datos, arcadeBest, logrosCount, uni, nombre])

  if (!open) return null

  const descargar = () => {
    const a = document.createElement('a')
    a.download = `mi-avance-${scope === 'todo' ? 'carrera' : 'ciclo-' + scope}.png`
    a.href = canvasRef.current.toDataURL('image/png')
    a.click()
  }

  return (
    <div className="rc-backdrop" onClick={onClose}>
      <div className="rc-modal" onClick={e => e.stopPropagation()}>
        <header className="rc-head">
          <h3>🎁 Tu avance en números</h3>
          <button className="rc-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <p className="rc-hint">
          Genera una imagen con tu avance para compartirla donde quieras.
          Solo muestra números — ni tu nombre ni tu alias.
        </p>
        <label className="rc-scope">
          Mostrar:
          <select value={scope} onChange={e => setScope(e.target.value)}>
            <option value="todo">Toda la carrera</option>
            {ciclosConAvance.map(num => (
              <option key={num} value={num}>{ciclos[num].t}</option>
            ))}
          </select>
        </label>
        <canvas ref={canvasRef} width={W} height={H} className="rc-canvas" />
        <div className="rc-actions">
          <button className="rc-btn" onClick={descargar}>⬇ Descargar imagen</button>
          <button className="rc-btn ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}
