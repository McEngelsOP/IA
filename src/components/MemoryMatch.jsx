import { useRef, useEffect, useState, useReducer } from 'react'
import '../styles/AstroDefensa.css'
import '../styles/MemoryMatch.css'

// MEMORY MATCH+ · parejas de cartas con progresión: tableros cada vez más
// grandes (4×4 → 6×6) contra el reloj, rachas que regalan power-ups y
// cartas especiales (❄️ hielo, 💀 trampa, 💣 bomba, 🃏 comodín).
// A diferencia de los otros juegos es DOM + CSS (voltear cartas), pero
// comparte estructura (fases en refs) y los overlays ast-* del arcade.
// Puntúan Clásico, Difícil y Caótico (onGameOver(score, ranked));
// Fácil y Zen NO envían puntaje al ranking.

// El "tick" del juego corre cada 100 ms: tiempos en décimas de segundo.
// Vidas: quedarse sin tiempo cuesta 1 vida y el reloj se reinicia; al pasar
// de nivel se recupera SOLO 1 (sin superar el máximo del modo). El gradiente
// va de Fácil (7 vidas, tiempo normal) a Caótico (5 vidas, menos tiempo).
export const MODES = {
  clasico: {
    key: 'clasico', label: 'CLÁSICO', icon: '🧠', ranked: true,
    time: true, timeFactor: 0.95, lives: 6, preview: 0, shuffle: 0,
    trampa: false, bomba: false, hielo: true, comodin: 2, invert: false, penalty: 0,
    desc: '6 vidas y tableros crecientes (4×4 a 6×6) contra el reloj: parejas, rachas y power-ups. Puntúa en el ranking.'
  },
  facil: {
    key: 'facil', label: 'FÁCIL', icon: '🌱', ranked: false,
    time: true, timeFactor: 1, lives: 7, preview: 25, shuffle: 0,
    trampa: false, bomba: false, hielo: true, comodin: 1, invert: false, penalty: 0,
    desc: '7 vidas, un destello inicial muestra todas las cartas y no hay castigos. Para calentar; no puntúa.'
  },
  dificil: {
    key: 'dificil', label: 'DIFÍCIL', icon: '💀', ranked: true,
    time: true, timeFactor: 0.9, lives: 5, preview: 0, shuffle: 120,
    trampa: true, bomba: false, hielo: true, comodin: 1, invert: false, penalty: 10,
    desc: '5 vidas, menos tiempo, cartas 💀 trampa que restan puntos y el tablero se rebaraja cada 12 s. Puntúa.'
  },
  caotico: {
    key: 'caotico', label: 'CAÓTICO', icon: '🌪️', ranked: true,
    time: true, timeFactor: 0.85, lives: 5, preview: 0, shuffle: 90,
    trampa: true, bomba: true, hielo: true, comodin: 1, invert: true, penalty: 10,
    desc: '5 vidas y aún menos tiempo: rebarajeo constante, cartas 💣 con cuenta regresiva, trampas y colores invertidos. Puntúa.'
  },
  zen: {
    key: 'zen', label: 'ZEN', icon: '🧘', ranked: false,
    time: false, timeFactor: 1, lives: 0, preview: 0, shuffle: 0,
    trampa: false, bomba: false, hielo: false, comodin: 0, invert: false, penalty: 0,
    desc: 'Sin cronómetro, vidas ni castigos: voltea a tu ritmo tableros infinitos. No puntúa.'
  }
}

// Temáticas visuales: rotan con cada nivel
const TEMAS = [
  { name: 'ANIMALES', faces: ['🐸', '🦊', '🐼', '🐙', '🦉', '🐢', '🦋', '🐝', '🦖', '🐳', '🐞', '🦜', '🐺', '🦔', '🐌', '🦀', '🐬', '🐴'] },
  { name: 'FRUTAS', faces: ['🍎', '🍌', '🍇', '🍉', '🍓', '🍍', '🥝', '🍑', '🥑', '🍒', '🍋', '🥭', '🍐', '🫐', '🍅', '🌽', '🥕', '🍄'] },
  { name: 'RETRO', faces: ['🎮', '👾', '🕹️', '💾', '📼', '🤖', '🛸', '⭐', '🚀', '💿', '📟', '🔮', '🎲', '🧩', '⚡', '🔑', '💎', '🏆'] },
  { name: 'CARITAS', faces: ['😀', '😎', '🤩', '😴', '🤠', '🥶', '😱', '🤯', '😇', '🤡', '👻', '🎃', '😈', '🥸', '🫠', '😍', '🤓', '😷'] },
  { name: 'COSMOS', faces: ['🌑', '🌕', '☄️', '🪐', '🌈', '🔥', '❄️', '🌊', '🌪️', '☀️', '🌙', '⚡', '🌸', '🍀', '🌵', '🌋', '🗻', '🌴'] }
]

// Parejas y columnas por nivel (del 5 en adelante el tablero se queda
// en 6×6 pero el tiempo se encoge)
const PAIRS = [8, 10, 12, 15, 18]
const COLS_BY = [4, 5, 6, 6, 6]

const POWER_META = {
  ojo: { icon: '👁️', label: 'Mirilla: revela todo 2 s' },
  pista: { icon: '🔍', label: 'Pista: ilumina una pareja' },
  tiempo: { icon: '⏳', label: 'Tiempo extra: +15 s' },
  baraja: { icon: '🌀', label: 'Re-barajar las que faltan' }
}
const randPower = cfg => {
  const pool = ['ojo', 'pista', 'baraja']
  if (cfg.time) pool.push('tiempo', 'tiempo') // más probable si hay reloj
  return pool[(Math.random() * pool.length) | 0]
}

const shuffleArr = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export default function MemoryMatch({ onGameOver }) {
  const g = useRef(null)
  const phaseRef = useRef('menu') // 'menu' | 'run' | 'pause' | 'over'
  const [phase, setPhase] = useState('menu')
  const [result, setResult] = useState(null)
  const [, force] = useReducer(x => x + 1, 0)
  const overRef = useRef(onGameOver)
  useEffect(() => { overRef.current = onGameOver }, [onGameOver])

  const setPh = p => { phaseRef.current = p; setPhase(p) }

  // ---------- Tablero ----------
  const buildBoard = s => {
    const c = s.cfg
    const idx = Math.min(s.nivel - 1, PAIRS.length - 1)
    const nPairs = PAIRS[idx]
    const tema = TEMAS[(s.nivel - 1) % TEMAS.length]
    const faces = shuffleArr([...tema.faces]).slice(0, nPairs)
    const kinds = faces.map(f => ({ face: f, kind: 'normal' }))
    // las cartas especiales reemplazan parejas normales
    const specials = []
    if (c.hielo) specials.push({ face: '🧊', kind: 'hielo' })
    if (c.trampa) specials.push({ face: '💀', kind: 'trampa' })
    if (c.bomba) specials.push({ face: '💣', kind: 'bomba' })
    specials.forEach((sp, i) => { kinds[kinds.length - 1 - i] = sp })
    const cards = []
    kinds.forEach((k, i) => {
      cards.push({ key: i * 2, ...k, state: 'down' }, { key: i * 2 + 1, ...k, state: 'down' })
    })
    // el comodín es una carta SUELTA: al emparejarla con X, la gemela de X
    // también se limpia (así el tablero sigue cerrando en cero)
    if (c.comodin && s.nivel >= c.comodin) cards.push({ key: 999, face: '🃏', kind: 'comodin', state: 'down' })
    shuffleArr(cards)
    s.cards = cards
    s.cols = COLS_BY[idx]
    s.tema = tema.name
    s.flipped = []
    s.lock = false
    s.bombT = null
    s.hint = null
    s.hintT = 0
    s.previewT = c.preview
    s.shuffleT = c.shuffle
    s.invertT = 0
    s.shakeT = 0
    if (c.preview) cards.forEach(cd => { cd.state = 'up' })
    s.timeMax = c.time
      ? Math.round((300 + nPairs * 60) * c.timeFactor * Math.pow(0.95, Math.max(0, s.nivel - 5)))
      : 0
    s.timeLeft = s.timeMax
  }

  const init = cfg => {
    const s = {
      cfg, nivel: 1, score: 0, racha: 0, freeze: 0, powers: [], lives: cfg.lives,
      stats: { parejas: 0, movs: 0, mejorRacha: 0 }
    }
    buildBoard(s)
    return s
  }

  const start = modeKey => {
    g.current = init(MODES[modeKey])
    setResult(null)
    setPh('run')
  }

  const addScore = (s, d) => { s.score = Math.max(0, s.score + d) }

  const endGame = s => {
    setResult({
      score: s.score, mode: s.cfg,
      stats: { parejas: s.stats.parejas, nivel: s.nivel, movs: s.stats.movs, racha: s.stats.mejorRacha }
    })
    setPh('over')
    overRef.current && overRef.current(Math.min(s.score, 100000), s.cfg.ranked)
  }

  const checkCleared = s => {
    if (!s.cards.some(cd => cd.state !== 'gone')) {
      const bonus = 300 + s.nivel * 100 + (s.cfg.time ? Math.round(s.timeLeft / 10) * 5 : 0)
      addScore(s, bonus)
      s.nivel++
      // pasar de nivel recupera SOLO 1 vida, sin superar el máximo del modo
      if (s.cfg.lives) s.lives = Math.min(s.cfg.lives, s.lives + 1)
      buildBoard(s)
      s.banner = `NIVEL ${s.nivel} · ${s.tema} · +${bonus}`
      s.bannerT = 30
    }
  }

  // ---------- Emparejar ----------
  const doMatch = s => {
    const [ia, ib] = s.flipped
    const a = s.cards[ia], b = s.cards[ib]
    const other = a.kind === 'comodin' ? b : a          // la carta "real" del par
    const kind = other.kind
    a.state = 'gone'
    b.state = 'gone'
    // comodín: la gemela de la otra carta también se limpia
    if (a.kind === 'comodin' || b.kind === 'comodin') {
      const twin = s.cards.find(cd =>
        cd.state !== 'gone' && cd.face === other.face && cd.kind === other.kind)
      if (twin) twin.state = 'gone'
    }
    let pts = 0
    if (kind === 'trampa') pts = 0                       // se libra de ellas, sin premio
    else if (kind === 'hielo') { s.freeze += 80; pts = 100 }
    else if (kind === 'bomba') { s.bombT = null; pts = 250 }
    else pts = 100
    if (pts) addScore(s, pts + s.racha * 25)
    s.racha++
    s.stats.parejas++
    s.stats.mejorRacha = Math.max(s.stats.mejorRacha, s.racha)
    // cada racha de 3 regala un power-up
    if (s.racha % 3 === 0 && s.powers.length < 3) s.powers.push(randPower(s.cfg))
    s.flipped = []
    s.lock = false
    checkCleared(s)
  }

  const flip = i => {
    const s = g.current
    if (!s || phaseRef.current !== 'run') return
    const cd = s.cards[i]
    if (s.lock || s.previewT > 0 || cd.state !== 'down' || s.flipped.length >= 2) return
    cd.state = 'up'
    s.stats.movs++
    if (cd.kind === 'trampa') addScore(s, -30)
    if (cd.kind === 'bomba' && s.bombT == null) s.bombT = 120 // 12 s para desactivarla
    s.flipped.push(i)
    if (s.flipped.length === 2) {
      const [a, b] = s.flipped.map(ix => s.cards[ix])
      const match = a.kind === 'comodin' || b.kind === 'comodin' || (a.face === b.face && a.kind === b.kind)
      s.lock = true
      setTimeout(() => {
        if (g.current !== s || phaseRef.current === 'over') return
        if (match) doMatch(s)
        else {
          s.flipped.forEach(ix => { if (s.cards[ix].state === 'up') s.cards[ix].state = 'down' })
          s.flipped = []
          s.lock = false
          s.racha = 0
          if (s.cfg.penalty) addScore(s, -s.cfg.penalty)
        }
        force()
      }, match ? 350 : 750)
    }
    force()
  }

  // rebaraja SOLO las cartas boca abajo (las volteadas no se mueven)
  const doShuffle = s => {
    const downIdx = []
    s.cards.forEach((cd, i) => { if (cd.state === 'down') downIdx.push(i) })
    const pool = shuffleArr(downIdx.map(i => s.cards[i]))
    downIdx.forEach((ix, k) => { s.cards[ix] = pool[k] })
    s.hint = null
    s.shakeT = 6
  }

  const usePower = i => {
    const s = g.current
    if (!s || phaseRef.current !== 'run' || s.previewT > 0) return
    const p = s.powers.splice(i, 1)[0]
    if (p === 'ojo') s.previewT = 20
    else if (p === 'tiempo') s.timeLeft = Math.min(s.timeMax, s.timeLeft + 150)
    else if (p === 'baraja') doShuffle(s)
    else if (p === 'pista') {
      const down = s.cards.filter(cd => cd.state === 'down' && cd.kind !== 'comodin')
      for (const cd of down) {
        const twin = down.find(o => o !== cd && o.face === cd.face && o.kind === cd.kind)
        if (twin) { s.hint = [cd.key, twin.key]; s.hintT = 18; break }
      }
    }
    force()
  }

  // ---------- Tick de 100 ms (cronómetro, bombas, rebarajeo) ----------
  useEffect(() => {
    if (phase !== 'run') return
    const id = setInterval(() => {
      const s = g.current
      if (!s) return
      if (s.previewT > 0 && --s.previewT === 0) {
        s.cards.forEach(cd => {
          if (cd.state === 'up' && !s.flipped.includes(s.cards.indexOf(cd))) cd.state = 'down'
        })
        // el destello inicial no debe dejar volteadas de más
        s.flipped.forEach(ix => { s.cards[ix].state = 'up' })
      }
      if (s.hintT > 0 && --s.hintT === 0) s.hint = null
      if (s.bannerT > 0) s.bannerT--
      if (s.shakeT > 0) s.shakeT--
      if (s.invertT > 0) s.invertT--
      else if (s.cfg.invert && Math.random() < 0.005) s.invertT = 30

      if (s.freeze > 0) s.freeze--
      else if (s.cfg.time && s.previewT === 0) {
        if (--s.timeLeft <= 0) {
          // sin tiempo: cuesta 1 vida y el reloj se reinicia en el mismo tablero
          s.lives--
          if (s.lives <= 0) { endGame(s); return }
          s.timeLeft = s.timeMax
          s.racha = 0
          s.banner = `⏰ −1 VIDA · QUEDAN ${s.lives}`
          s.bannerT = 30
        }
      }

      // bomba revelada y sin desactivar: explota (puntos y tiempo)
      if (s.bombT != null && --s.bombT <= 0) {
        s.cards.forEach(cd => { if (cd.kind === 'bomba') cd.state = 'gone' })
        s.flipped = s.flipped.filter(ix => s.cards[ix].state === 'up')
        s.bombT = null
        addScore(s, -150)
        if (s.cfg.time) s.timeLeft = Math.max(1, s.timeLeft - 100)
        s.racha = 0
        checkCleared(s)
      }

      if (s.cfg.shuffle && s.previewT === 0 && --s.shuffleT <= 0) {
        doShuffle(s)
        s.shuffleT = s.cfg.shuffle
      }
      force()
    }, 100)
    return () => clearInterval(id)
  }, [phase])

  // ---------- Teclado: R reinicia, ESC pausa ----------
  useEffect(() => {
    const down = e => {
      const p = phaseRef.current
      if (e.code === 'Escape') {
        if (p === 'run') { e.preventDefault(); setPh('pause') }
        else if (p === 'pause') { e.preventDefault(); setPh('run') }
        return
      }
      if (e.code === 'KeyR' && (p === 'run' || p === 'over') && g.current && !e.repeat) {
        start(g.current.cfg.key)
        return
      }
      if (p === 'over' && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault()
        if (!e.repeat && g.current) start(g.current.cfg.key)
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  const s = g.current
  const timePct = s && s.cfg.time ? Math.max(0, s.timeLeft / s.timeMax) : 0

  return (
    <div className="ast-wrap">
      <div className="ast-stage mm-stage">
        {s && phase !== 'menu' && (
          <div className={'mm-wrap' + (s.invertT > 0 ? ' mm-invert' : '') + (s.shakeT > 0 ? ' mm-shake' : '')}>
            <div className="mm-hud mono">
              <span className="mm-hud-left">NIVEL {s.nivel} · {s.tema}</span>
              {s.cfg.lives > 0 && (
                <span className={'mm-lives' + (s.lives <= 2 ? ' low' : '')}>❤️×{s.lives}</span>
              )}
              <span className={'mm-racha' + (s.racha >= 3 ? ' hot' : '')}>RACHA ×{s.racha}</span>
              <span className="mm-score">{String(s.score).padStart(6, '0')}</span>
            </div>
            {s.cfg.time > 0 && (
              <div className="mm-timerbar">
                <div
                  className={'mm-timerfill' + (s.freeze > 0 ? ' frozen' : timePct < 0.25 ? ' low' : '')}
                  style={{ width: `${timePct * 100}%` }}
                />
              </div>
            )}
            <div className="mm-grid" style={{ gridTemplateColumns: `repeat(${s.cols}, 1fr)` }}>
              {s.cards.map((cd, i) => {
                const up = cd.state === 'up' || s.previewT > 0
                return (
                  <button
                    key={cd.key}
                    className={
                      'mm-card' + (up ? ' up' : '') + (cd.state === 'gone' ? ' gone' : '')
                      + (s.hint && s.hintT > 0 && s.hint.includes(cd.key) ? ' hint' : '')
                      + (cd.kind !== 'normal' && up ? ` mm-${cd.kind}` : '')
                    }
                    onClick={() => flip(i)}
                    aria-label={up ? cd.face : 'carta boca abajo'}
                  >
                    <span className="mm-inner">
                      <span className="mm-back mono">?</span>
                      <span className="mm-face">
                        {cd.face}
                        {cd.kind === 'bomba' && cd.state === 'up' && s.bombT != null && (
                          <em className="mm-bomb-t mono">{Math.ceil(s.bombT / 10)}</em>
                        )}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="mm-powers">
              {s.powers.length === 0 ? (
                <span className="mm-powers-empty mono">RACHA DE 3 = POWER-UP</span>
              ) : s.powers.map((p, i) => (
                <button key={i} className="mm-power" title={POWER_META[p].label} onClick={() => usePower(i)}>
                  {POWER_META[p].icon}
                </button>
              ))}
            </div>
            {s.bannerT > 0 && <div className="mm-banner mono">{s.banner}</div>}
          </div>
        )}

        {phase === 'menu' && (
          <div className="ast-overlay">
            <div className="ast-title mono">MEMORY MATCH+</div>
            <div className="ast-modes">
              {Object.values(MODES).map(m => (
                <button key={m.key} className="ast-mode" onClick={() => start(m.key)}>
                  <span className="ast-mode-name mono">
                    {m.icon} {m.label}
                    {m.ranked && <span className="ast-rank-tag">RANKING</span>}
                  </span>
                  <span className="ast-mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>
            <p className="ast-note mono">PUNTÚAN EN EL RANKING: CLÁSICO, DIFÍCIL Y CAÓTICO · TEMÁTICA NUEVA CADA NIVEL</p>
          </div>
        )}

        {phase === 'pause' && (
          <div className="ast-overlay ast-dim">
            <div className="ast-title mono">PAUSA</div>
            <div className="ast-btns">
              <button className="ast-btn mono" onClick={() => setPh('run')}>REANUDAR (ESC)</button>
              <button className="ast-btn ghost mono" onClick={() => setPh('menu')}>SALIR AL MENÚ</button>
            </div>
          </div>
        )}

        {phase === 'over' && result && (
          <div className="ast-overlay ast-dim">
            <div className="ast-title mono over">SIN VIDAS</div>
            <div className="ast-score mono">
              {result.mode.icon} {result.mode.label} · <b>{result.score}</b> PTS
            </div>
            {!result.mode.ranked && (
              <p className="ast-note mono">ESTE MODO NO PUNTÚA EN EL RANKING</p>
            )}
            <div className="ast-stats mono">
              <span>PAREJAS {result.stats.parejas}</span>
              <span>NIVEL {result.stats.nivel}</span>
              <span>MOVIMIENTOS {result.stats.movs}</span>
              <span>MEJOR RACHA {result.stats.racha}</span>
            </div>
            <div className="ast-btns">
              <button className="ast-btn mono" onClick={() => start(result.mode.key)}>REINTENTAR (R)</button>
              <button className="ast-btn ghost mono" onClick={() => setPh('menu')}>CAMBIAR MODO</button>
            </div>
          </div>
        )}
      </div>
      <div className="ast-foot mono">
        <span>CLICK / TOQUE VOLTEAR · R REINICIAR · ESC PAUSA · RACHA DE 3 = POWER-UP</span>
      </div>
    </div>
  )
}
