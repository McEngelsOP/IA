import { useRef, useEffect, useState } from 'react'
import '../styles/AstroDefensa.css'

// FROGGER+ · cruza la carretera (autos, camiones, motos, tren bala) y el río
// (troncos, tortugas que se hunden, cocodrilos) hasta llenar las 5 metas.
// Canvas puro con rAF y estado en refs, misma estructura que DinoGame /
// AstroDefensa / Galaxia; reusa los overlays ast-*.
// Puntúan Clásico, Difícil y Caótico (onGameOver(score, ranked));
// Fácil y Zen NO envían puntaje al ranking.

const TILE = 32, COLS = 14, HUD_H = 34
const W = COLS * TILE                 // 448
const ROWS = 13                       // 0 metas · 1-5 río · 6 berma · 7-11 pista · 12 salida
const H = HUD_H + ROWS * TILE         // 450
const MARGIN = 90                     // los objetos dan la vuelta fuera de pantalla
const SPAN = W + MARGIN * 2
const START_ROW = 12
const SLOT_W = W / 5                  // ancho de cada meta
const rowY = r => HUD_H + r * TILE

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const MODES = {
  clasico: {
    key: 'clasico', label: 'CLÁSICO', icon: '🐸', ranked: true,
    lives: 3, speed: 1, density: 1, time: 2700, drop: 0.5,
    sink: false, snake: false, train: false, events: false,
    crocFrom: 3, motoFrom: 2, pad: 0, zen: false,
    desc: 'Tráfico y río clásicos: 3 vidas y la velocidad sube con cada nivel. Puntúa en el ranking.'
  },
  facil: {
    key: 'facil', label: 'FÁCIL', icon: '🌱', ranked: false,
    lives: 5, speed: 0.72, density: 0.7, time: 3600, drop: 0.85,
    sink: false, snake: false, train: false, events: false,
    crocFrom: 99, motoFrom: 99, pad: 4, zen: false,
    desc: '5 vidas, menos autos, troncos más largos y power-ups frecuentes. Para calentar; no puntúa.'
  },
  dificil: {
    key: 'dificil', label: 'DIFÍCIL', icon: '💀', ranked: true,
    lives: 3, speed: 1.32, density: 1.25, time: 2400, drop: 0.35,
    sink: true, snake: true, train: true, events: false,
    crocFrom: 1, motoFrom: 1, pad: 0, zen: false,
    desc: 'Autos rápidos, serpiente en la berma, tortugas y troncos que se hunden y el TREN BALA. Puntúa.'
  },
  caotico: {
    key: 'caotico', label: 'CAÓTICO', icon: '🌪️', ranked: true,
    lives: 3, speed: 1.18, density: 1.1, time: 2700, drop: 0.55,
    sink: true, snake: false, train: true, events: true,
    crocFrom: 1, motoFrom: 1, pad: 0, zen: false,
    desc: 'Cocodrilos y tren bala más inundaciones, tráfico que se invierte y terremotos. Puntúa.'
  },
  zen: {
    key: 'zen', label: 'ZEN', icon: '🧘', ranked: false,
    lives: 1, speed: 0.8, density: 0.85, time: 0, drop: 0.6,
    sink: false, snake: false, train: false, events: false,
    crocFrom: 99, motoFrom: 99, pad: 0, zen: true,
    desc: 'Sin peligro ni cronómetro: los autos no dañan y el agua solo te regresa. Recoge monedas; no puntúa.'
  }
}

// Biomas: cambian cada 5 niveles (paleta + efecto ambiental)
const BIOMAS = [
  { name: 'CIUDAD', grass: '#1d3a2a', water: '#14304d', road: '#151a2b', meta: '#0f2436', fx: null },
  { name: 'NOCHE', grass: '#14241d', water: '#0d2038', road: '#0e1220', meta: '#0a1826', fx: 'noche' },
  { name: 'DESIERTO', grass: '#4a3b22', water: '#1c4a56', road: '#2b2417', meta: '#3a2e1a', fx: 'arena' },
  { name: 'PANTANO', grass: '#1c3324', water: '#1e3d2f', road: '#161d18', meta: '#122a1c', fx: 'niebla' },
  { name: 'INVIERNO', grass: '#33415c', water: '#274866', road: '#1a2233', meta: '#22304a', fx: 'nieve' }
]
const biomaDe = level => BIOMAS[(((level - 1) / 5) | 0) % BIOMAS.length]

const POWERS = {
  estrella: { icon: '⭐', label: 'INVULNERABLE', dur: 300 },
  congelar: { icon: '🕒', label: 'TIEMPO CONGELADO', dur: 180 },
  escudo: { icon: '🛡️', label: 'ESCUDO' },
  rapido: { icon: '⚡', label: 'VELOCIDAD EXTRA', dur: 480 },
  x2: { icon: '💰', label: 'BONUS ×2 EN LA META' }
}
const pickPower = () => {
  const r = Math.random()
  if (r < 0.25) return 'estrella'
  if (r < 0.5) return 'congelar'
  if (r < 0.7) return 'escudo'
  if (r < 0.88) return 'rapido'
  return 'x2'
}

// ---------- Sprites pixel art ----------
const FROG = [
  '.XX.....XX.',
  '.XXX...XXX.',
  '..XXXXXXX..',
  '.XXXXXXXXX.',
  'XX.XXXXX.XX',
  'X.XXXXXXX.X',
  'X.XXXXXXX.X',
  '.XXX...XXX.',
  '.XX.....XX.'
]
const TURT = [
  '...XXXX...',
  '..XXXXXX..',
  '.XXXXXXXX.',
  'X.XXXXXX.X',
  '.XXXXXXXX.',
  '..X.XX.X..'
]

const sprCache = {}
const sprCv = (name, rows, color) => {
  const key = name + color
  let cv = sprCache[key]
  if (!cv) {
    cv = document.createElement('canvas')
    cv.width = rows[0].length
    cv.height = rows.length
    const c = cv.getContext('2d')
    c.fillStyle = color
    for (let r = 0; r < rows.length; r++) {
      for (let q = 0; q < rows[r].length; q++) {
        if (rows[r][q] === 'X') c.fillRect(q, r, 1, 1)
      }
    }
    sprCache[key] = cv
  }
  return cv
}
const drawSpr = (ctx, name, rows, x, y, w, h, color) => {
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprCv(name, rows, color), x | 0, y | 0, w, h)
}

const CAR_TINTS = ['#ff6c9f', '#ffd166', '#2de2e6']

export default function Frogger({ onGameOver }) {
  const canvasRef = useRef(null)
  const g = useRef(null)
  const ptr = useRef(null)              // inicio del gesto táctil
  const phaseRef = useRef('menu')       // 'menu' | 'run' | 'pause' | 'over'
  const [phase, setPhase] = useState('menu')
  const [result, setResult] = useState(null)
  const overRef = useRef(onGameOver)
  useEffect(() => { overRef.current = onGameOver }, [onGameOver])

  const setPh = p => { phaseRef.current = p; setPhase(p) }

  // ---------- Generación de nivel ----------
  const genLevel = s => {
    const c = s.cfg, lv = s.level
    const sm = c.speed * Math.min(1 + (lv - 1) * 0.07, 1.8)
    const sign = Math.random() < 0.5 ? 1 : -1

    // pista: 5 carriles; uno de camiones y quizá uno de motos
    const truckRow = 7 + ((Math.random() * 5) | 0)
    let motoRow = -1
    if (lv >= c.motoFrom) {
      do { motoRow = 7 + ((Math.random() * 5) | 0) } while (motoRow === truckRow)
    }
    s.roads = []
    for (let r = 7; r <= 11; r++) {
      const kind = r === truckRow ? 'camion' : r === motoRow ? 'moto' : 'auto'
      const dir = sign * (r % 2 ? 1 : -1)
      let sp = (0.55 + Math.random() * 0.45 + (11 - r) * 0.06) * sm
      if (kind === 'moto') sp *= 1.65
      if (kind === 'camion') sp *= 0.75
      const n = Math.max(1, Math.round((kind === 'camion' ? 2 : 3) * c.density))
      const vehicles = []
      for (let i = 0; i < n; i++) {
        const w = kind === 'camion' ? 78 : kind === 'moto' ? 22 : 40
        vehicles.push({ x: (SPAN / n) * i + Math.random() * 50 - MARGIN, w, kind, tint: (Math.random() * 3) | 0 })
      }
      s.roads.push({ row: r, dir, speed: sp, kind, vehicles })
    }

    // río: 5 carriles; dos de tortugas, el resto troncos (y cocodrilos)
    const turtleA = 1 + ((Math.random() * 5) | 0)
    let turtleB
    do { turtleB = 1 + ((Math.random() * 5) | 0) } while (turtleB === turtleA)
    s.waters = []
    for (let r = 1; r <= 5; r++) {
      const kind = (r === turtleA || r === turtleB) ? 'tortugas' : 'tronco'
      const dir = -sign * (r % 2 ? 1 : -1)
      const sp = (0.45 + Math.random() * 0.35 + r * 0.05) * sm * 0.9
      const n = kind === 'tortugas' ? 3 : (c.density < 1 || c.zen ? 4 : 3)
      const plats = []
      for (let i = 0; i < n; i++) {
        const isCroc = kind === 'tronco' && lv >= c.crocFrom && i === 0 && Math.random() < 0.55
        const tn = 2 + ((Math.random() * 2) | 0)
        const w = isCroc ? 96
          : kind === 'tortugas' ? tn * 26
          : 66 + Math.random() * 46 + (c.density < 1 ? 18 : 0)
        plats.push({
          x: (SPAN / n) * i + Math.random() * 40 - MARGIN, w,
          kind: isCroc ? 'croc' : kind, tn,
          ph: (Math.random() * 390) | 0,
          sink: c.sink && !isCroc && Math.random() < (kind === 'tortugas' ? 0.45 : 0.22)
        })
      }
      s.waters.push({ row: r, dir, speed: sp, plats })
    }

    s.snake = c.snake ? { x: 30, dir: 1, speed: 0.7 * sm } : null
    s.coins = []; s.powers = []
    s.train = null; s.trainWarn = 0
    s.ev = null; s.evT = 0
  }

  const resetFrog = s => {
    s.frog = {
      x: W / 2, y: rowY(START_ROW) + TILE / 2,
      fx: 0, fy: 0, tx: 0, ty: 0, hopT: 0, hopDur: 7,
      row: START_ROW, bestRow: START_ROW
    }
    s.timeLeft = s.cfg.time
    s.queue.length = 0
  }

  const init = cfg => {
    const s = {
      cfg, level: 1, frame: 0, score: 0, lives: cfg.lives,
      homes: [false, false, false, false, false],
      roads: [], waters: [], snake: null,
      coins: [], powers: [], floats: [], particles: [],
      frog: null, deadT: 0, queue: [],
      turboCool: 0, inv: 0, freeze: 0, fast: 0, shield: false, x2: false,
      combo: 0, banner: null, bannerT: 0, shake: 0,
      eventCool: 700 + Math.random() * 500, ev: null, evT: 0,
      trainCool: 1000 + Math.random() * 600, train: null, trainWarn: 0, trainLane: 7,
      coinCool: 90, powerCool: 480, timeLeft: cfg.time,
      stats: { saltos: 0, monedas: 0, metas: 0, maxCombo: 0 }
    }
    genLevel(s)
    resetFrog(s)
    return s
  }

  const start = modeKey => {
    g.current = init(MODES[modeKey])
    setResult(null)
    setPh('run')
  }

  // ---------- Utilitarios ----------
  const burst = (s, x, y, color, n = 12) => {
    if (REDUCED) n = Math.min(n, 4)
    for (let i = 0; i < n && s.particles.length < 150; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 0.5 + Math.random() * 2.4
      s.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 20 + Math.random() * 16, color, size: 1.5 + Math.random() * 2.5
      })
    }
  }
  const float = (s, x, y, text, color = '#ffd166') =>
    s.floats.push({ x: Math.max(40, Math.min(W - 40, x)), y, text, color, life: 60 })

  const setBanner = (s, text) => { s.banner = text; s.bannerT = 150 }

  const wrapX = o => {
    if (o.x - o.w / 2 > W + MARGIN) o.x -= SPAN
    else if (o.x + o.w / 2 < -MARGIN) o.x += SPAN
  }

  // fase del ciclo de hundimiento (tortugas / troncos en Difícil-Caótico)
  const sinkPh = (s, p) => (s.frame + p.ph) % 390
  const submerged = (s, p) => p.sink && sinkPh(s, p) >= 300
  const sinkWarn = (s, p) => p.sink && sinkPh(s, p) >= 240 && sinkPh(s, p) < 300

  const mouthOpen = (s, p) => ((s.frame + p.ph) % 260) < 90
  const mouthDanger = (s, lane, p, x) => {
    if (p.kind !== 'croc' || !mouthOpen(s, p)) return false
    const edge = lane.dir > 0 ? p.x + p.w / 2 - 12 : p.x - p.w / 2 + 12
    return Math.abs(x - edge) < 14
  }

  const platAt = (s, row, x) => {
    const lane = s.waters[row - 1]
    for (const p of lane.plats) {
      if (Math.abs(x - p.x) < p.w / 2 + 6) return { lane, p }
    }
    return null
  }

  // ---------- Muerte / metas ----------
  // Devuelve true si la rana efectivamente murió (en Zen nunca muere:
  // el "golpe" solo la regresa a la berma).
  const killFrog = (s, cause) => {
    const f = s.frog
    if (s.cfg.zen) {
      f.row = 6
      f.x = Math.max(TILE / 2, Math.min(W - TILE / 2, f.x))
      f.y = rowY(6) + TILE / 2
      f.hopT = 0
      f.bestRow = Math.min(f.bestRow, 6)
      burst(s, f.x, f.y, '#2de2e6', 8)
      return false
    }
    if (s.inv > 0) return false
    if (s.shield) {
      s.shield = false
      s.inv = 90
      float(s, f.x, f.y - 20, 'ESCUDO ROTO', '#ff6c9f')
      burst(s, f.x, f.y, '#ffd166', 12)
      return false
    }
    s.combo = 0
    s.deadT = 45
    burst(s, f.x, f.y, cause === 'agua' ? '#2de2e6' : '#ff6c9f', 20)
    return true
  }

  const endGame = s => {
    setResult({
      score: s.score, mode: s.cfg,
      stats: {
        metas: s.stats.metas, nivel: s.level, monedas: s.stats.monedas,
        saltos: s.stats.saltos, combo: s.stats.maxCombo
      }
    })
    setPh('over')
    overRef.current && overRef.current(Math.min(s.score, 100000), s.cfg.ranked)
  }

  const landWater = s => {
    const f = s.frog
    const hit = platAt(s, f.row, f.x)
    if (!hit) { killFrog(s, 'agua'); return }
    if (submerged(s, hit.p) || mouthDanger(s, hit.lane, hit.p, f.x)) killFrog(s, 'agua')
  }

  const tryHome = s => {
    const f = s.frog
    const i = Math.min(4, (f.x / SLOT_W) | 0)
    const cx = SLOT_W * (i + 0.5)
    if (Math.abs(f.x - cx) > 20 || s.homes[i]) {
      // meta ocupada o salto entre casas: rebota a la fila 1 (indulgente)
      f.row = 1
      f.y = rowY(1) + TILE / 2
      landWater(s)
      return
    }
    s.homes[i] = true
    s.combo++
    s.stats.metas++
    s.stats.maxCombo = Math.max(s.stats.maxCombo, s.combo)
    let pts = 200 + (s.cfg.time ? Math.ceil(s.timeLeft / 600) * 20 : 0) + (s.combo - 1) * 100
    if (s.x2) { pts *= 2; s.x2 = false }
    s.score += pts
    float(s, cx, rowY(0) + 24, `+${pts}`, '#a8e05f')
    burst(s, cx, rowY(0) + 16, '#a8e05f', 14)
    if (s.homes.every(Boolean)) {
      const bonus = 500 + s.level * 100
      s.score += bonus
      s.level++
      s.homes = [false, false, false, false, false]
      genLevel(s)
      float(s, W / 2, H / 2, `NIVEL ${s.level} · +${bonus}`, '#2de2e6')
      if ((s.level - 1) % 5 === 0) setBanner(s, `BIOMA: ${biomaDe(s.level).name}`)
    }
    resetFrog(s)
  }

  // ---------- Saltos ----------
  const tryHop = (s, dx, dy, turbo) => {
    const f = s.frog
    if (f.hopT > 0 || s.deadT > 0) return
    // terremoto: los saltos verticales pueden desviarse un carril
    if (s.ev === 'terremoto' && dy !== 0 && Math.random() < 0.3) {
      dx += Math.random() < 0.5 ? -1 : 1
    }
    const nr = Math.max(0, Math.min(START_ROW, f.row + dy))
    const nx = Math.max(TILE / 2, Math.min(W - TILE / 2, f.x + dx * TILE))
    if (nr === f.row && nx === f.x) return
    f.fx = f.x; f.fy = f.y
    f.tx = nx; f.ty = rowY(nr) + TILE / 2
    f.row = nr
    f.hopT = f.hopDur = turbo ? 9 : s.fast > 0 ? 5 : 7
    s.stats.saltos++
  }

  const land = s => {
    const f = s.frog
    // puntos por avanzar más lejos que nunca en este intento
    if (f.row < f.bestRow) {
      s.score += (f.bestRow - f.row) * 10
      f.bestRow = f.row
    }
    if (f.row === 0) { tryHome(s); return }
    if (f.row >= 1 && f.row <= 5) { landWater(s); return }
    // invierno: el hielo hace patinar al aterrizar
    if (biomaDe(s.level).fx === 'nieve' && Math.random() < 0.25) {
      f.x = Math.max(TILE / 2, Math.min(W - TILE / 2, f.x + (Math.random() < 0.5 ? -12 : 12)))
    }
  }

  const applyPower = (s, p) => {
    const f = s.frog
    float(s, f.x, f.y - 22, POWERS[p].label, '#2de2e6')
    if (p === 'estrella') s.inv = POWERS.estrella.dur
    else if (p === 'congelar') s.freeze = POWERS.congelar.dur
    else if (p === 'escudo') s.shield = true
    else if (p === 'rapido') { s.fast = POWERS.rapido.dur; s.turboCool = Math.min(s.turboCool, 60) }
    else if (p === 'x2') s.x2 = true
  }

  // monedas y power-ups: en el río viajan sobre una plataforma
  const spawnPickup = (s, kind) => {
    const row = 1 + ((Math.random() * 11) | 0)
    const item = { row, kind, life: 700 }
    if (row <= 5) {
      const lane = s.waters[row - 1]
      const p = lane.plats[(Math.random() * lane.plats.length) | 0]
      item.ride = p
      item.off = (Math.random() - 0.5) * Math.max(0, p.w - 24)
    } else {
      item.x = TILE / 2 + ((Math.random() * COLS) | 0) * TILE
    }
    if (kind === 'coin') s.coins.push(item)
    else { item.p = pickPower(); s.powers.push(item) }
  }
  const pickupX = it => it.ride ? it.ride.x + it.off : it.x

  // ---------- Controles ----------
  useEffect(() => {
    const DIRS = {
      ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
      ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0]
    }
    const down = e => {
      const p = phaseRef.current
      if (e.code === 'Escape') {
        if (p === 'run') { e.preventDefault(); setPh('pause') }
        else if (p === 'pause') { e.preventDefault(); setPh('run') }
        return
      }
      if (DIRS[e.code] || e.code === 'Space') e.preventDefault()
      if (p === 'over' && (e.code === 'Space' || e.code === 'Enter')) {
        if (!e.repeat && g.current) start(g.current.cfg.key)
        return
      }
      if (p !== 'run' || !g.current) return
      const s = g.current
      if (DIRS[e.code]) {
        if (s.queue.length < 2) s.queue.push({ dx: DIRS[e.code][0], dy: DIRS[e.code][1], turbo: false })
      } else if (e.code === 'Space' && !e.repeat && s.turboCool <= 0) {
        // turbo: salto doble hacia adelante, con enfriamiento
        s.queue.push({ dx: 0, dy: -2, turbo: true })
        s.turboCool = s.fast > 0 ? 90 : 280
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  // ---------- Dibujo ----------
  const draw = ctx => {
    const s = g.current
    const B = biomaDe(s.level)
    const f = s.frog

    ctx.save()
    if (s.shake > 0 && !REDUCED) {
      ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5)
    }

    // franjas del terreno
    ctx.fillStyle = B.meta
    ctx.fillRect(0, rowY(0), W, TILE)
    ctx.fillStyle = B.water
    ctx.fillRect(0, rowY(1), W, TILE * 5)
    const flooded = s.ev === 'inundacion' && s.evT <= 300
    const floodWarn = s.ev === 'inundacion' && s.evT > 300
    ctx.fillStyle = flooded ? B.water
      : floodWarn && ((s.frame / 8) | 0) % 2 ? '#2d5b8a' : B.grass
    ctx.fillRect(0, rowY(6), W, TILE)
    ctx.fillStyle = B.road
    ctx.fillRect(0, rowY(7), W, TILE * 5)
    ctx.fillStyle = B.grass
    ctx.fillRect(0, rowY(12), W, TILE)

    // olitas del río
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    for (let i = 0; i < 26; i++) {
      const r = 1 + (i % 5)
      const x = ((i * 83 + s.frame * (s.waters[r - 1]?.dir || 1) * 0.4) % SPAN + SPAN) % SPAN - MARGIN
      ctx.fillRect(x, rowY(r) + 6 + (i * 7) % 20, 14, 2)
    }
    // líneas discontinuas de la pista
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    for (let r = 8; r <= 11; r++) {
      for (let x = 4; x < W; x += 34) ctx.fillRect(x, rowY(r) - 1, 16, 2)
    }

    // metas (5 casas): arco oscuro, rana dentro si está ocupada
    for (let i = 0; i < 5; i++) {
      const x = i * SLOT_W
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(x + 7, rowY(0) + 4, SLOT_W - 14, TILE - 8)
      ctx.strokeStyle = s.homes[i] ? '#a8e05f' : 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 7, rowY(0) + 4, SLOT_W - 14, TILE - 8)
      if (s.homes[i]) {
        drawSpr(ctx, 'fg', FROG, x + SLOT_W / 2 - 10, rowY(0) + 8, 20, 16, '#a8e05f')
      }
    }

    // plataformas del río
    s.waters.forEach(lane => {
      const y = rowY(lane.row) + TILE / 2
      lane.plats.forEach(p => {
        const sub = submerged(s, p)
        const warn = sinkWarn(s, p) && ((s.frame / 6) | 0) % 2
        ctx.globalAlpha = sub ? 0.18 : warn ? 0.5 : 1
        if (p.kind === 'tronco') {
          ctx.fillStyle = '#8a5a33'
          ctx.fillRect(p.x - p.w / 2, y - 9, p.w, 18)
          ctx.fillStyle = '#6d4526'
          for (let x = p.x - p.w / 2 + 8; x < p.x + p.w / 2 - 8; x += 22) ctx.fillRect(x, y - 3, 12, 2)
        } else if (p.kind === 'tortugas') {
          for (let i = 0; i < p.tn; i++) {
            drawSpr(ctx, 'tt', TURT, p.x - p.w / 2 + i * 26 + 1, y - 8, 24, 15, '#4cae62')
          }
        } else { // cocodrilo
          const open = mouthOpen(s, p)
          ctx.fillStyle = '#3f7d4c'
          ctx.fillRect(p.x - p.w / 2, y - 9, p.w, 18)
          const hx = lane.dir > 0 ? p.x + p.w / 2 - 22 : p.x - p.w / 2
          ctx.fillStyle = open ? '#e05f5f' : '#2f5d39'
          ctx.fillRect(hx, y - 7, 22, 14)
          if (open) {
            ctx.fillStyle = '#fff'
            for (let i = 0; i < 4; i++) ctx.fillRect(hx + 3 + i * 5, y - 2, 3, 4)
          }
          ctx.fillStyle = '#ffd166'
          ctx.fillRect(lane.dir > 0 ? hx + 16 : hx + 3, y - 6, 3, 3)
        }
        ctx.globalAlpha = 1
      })
    })

    // monedas y power-ups
    ctx.textAlign = 'center'
    ctx.font = '15px serif'
    const drawPickup = it => {
      ctx.globalAlpha = it.life < 120 ? (((s.frame / 6) | 0) % 2 ? 0.35 : 1) : 1
      ctx.fillText(it.kind === 'coin' ? '🪙' : POWERS[it.p].icon, pickupX(it), rowY(it.row) + TILE / 2 + 5)
    }
    s.coins.forEach(drawPickup)
    s.powers.forEach(drawPickup)
    ctx.globalAlpha = 1

    // serpiente de la berma (Difícil)
    if (s.snake && !flooded) {
      const y = rowY(6) + TILE / 2
      ctx.fillStyle = '#7dc243'
      for (let i = 0; i < 5; i++) {
        const x = s.snake.x - i * 9 * s.snake.dir
        ctx.beginPath()
        ctx.arc(x, y + Math.sin(s.frame / 8 + i) * 3, i === 0 ? 6 : 4.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#e05f5f'
      ctx.fillRect(s.snake.x + 6 * s.snake.dir, y - 1, 4 * s.snake.dir, 2)
    }

    // vehículos (en Zen son inofensivos y se ven traslúcidos)
    if (s.cfg.zen) ctx.globalAlpha = 0.35
    s.roads.forEach(lane => {
      const y = rowY(lane.row) + TILE / 2
      lane.vehicles.forEach(v => {
        const noseX = lane.dir > 0 ? v.x + v.w / 2 : v.x - v.w / 2
        if (v.kind === 'auto') {
          ctx.fillStyle = CAR_TINTS[v.tint]
          ctx.fillRect(v.x - v.w / 2, y - 8, v.w, 16)
          ctx.fillStyle = 'rgba(10,14,26,0.7)'
          ctx.fillRect(v.x - 8, y - 6, 16, 12)
        } else if (v.kind === 'camion') {
          ctx.fillStyle = '#5b6591'
          ctx.fillRect(v.x - v.w / 2, y - 9, v.w - 20, 18)
          ctx.fillStyle = '#8b96c9'
          ctx.fillRect(lane.dir > 0 ? v.x + v.w / 2 - 20 : v.x - v.w / 2, y - 8, 20, 16)
        } else { // moto
          ctx.fillStyle = '#c86bff'
          ctx.fillRect(v.x - 11, y - 5, 22, 10)
          ctx.fillStyle = '#dfe4f5'
          ctx.beginPath(); ctx.arc(v.x, y - 7, 4, 0, Math.PI * 2); ctx.fill()
        }
        if (B.fx === 'noche' && !s.cfg.zen) {
          // faros en el bioma nocturno
          ctx.fillStyle = 'rgba(255,240,150,0.10)'
          ctx.beginPath()
          ctx.moveTo(noseX, y - 5)
          ctx.lineTo(noseX + lane.dir * 42, y - 14)
          ctx.lineTo(noseX + lane.dir * 42, y + 14)
          ctx.lineTo(noseX, y + 5)
          ctx.fill()
        }
      })
    })
    ctx.globalAlpha = 1

    // tren bala y su aviso
    if (s.trainWarn > 0 && ((s.frame / 5) | 0) % 2) {
      const lane = s.roads[s.trainLane - 7]
      ctx.font = '16px serif'
      ctx.fillText('🚄', lane.dir > 0 ? 16 : W - 16, rowY(s.trainLane) + TILE / 2 + 6)
      ctx.fillStyle = '#ffd166'
      ctx.fillRect(0, rowY(s.trainLane) + 1, W, 2)
      ctx.fillRect(0, rowY(s.trainLane) + TILE - 3, W, 2)
    }
    if (s.train) {
      const t = s.train
      const y = rowY(t.row) + TILE / 2
      ctx.fillStyle = '#aeb8e0'
      ctx.fillRect(t.x - t.w / 2, y - 11, t.w, 22)
      ctx.fillStyle = '#ffd166'
      ctx.fillRect(t.dir > 0 ? t.x + t.w / 2 - 14 : t.x - t.w / 2, y - 11, 14, 22)
      ctx.fillStyle = 'rgba(10,14,26,0.7)'
      for (let x = t.x - t.w / 2 + 20; x < t.x + t.w / 2 - 24; x += 26) ctx.fillRect(x, y - 6, 14, 8)
    }

    // rana (o explosión si acaba de morir)
    if (s.deadT > 0) {
      ctx.font = '20px serif'
      ctx.fillText('💥', f.x, f.y + 7)
    } else if (!(s.inv > 0 && ((s.frame / 5) | 0) % 2 === 0)) {
      const p = f.hopT > 0 ? 1 - f.hopT / f.hopDur : 0
      const arc = f.hopT > 0 ? Math.sin(p * Math.PI) * 9 : 0
      const sc = f.hopT > 0 ? 1.15 : 1
      drawSpr(ctx, 'fg', FROG, f.x - 13 * sc, f.y - arc - 11 * sc, 26 * sc, 22 * sc, '#a8e05f')
      ctx.fillStyle = '#0a0e1a'
      ctx.fillRect(f.x - 7, f.y - arc - 9, 3, 3)
      ctx.fillRect(f.x + 4, f.y - arc - 9, 3, 3)
      if (s.shield) {
        ctx.strokeStyle = 'rgba(255,209,102,0.85)'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.arc(f.x, f.y - arc, 19, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // partículas y textos flotantes
    s.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life / 36)
      ctx.fillStyle = p.color
      ctx.fillRect(p.x, p.y, p.size, p.size)
    })
    ctx.globalAlpha = 1
    ctx.font = '700 12px "JetBrains Mono", monospace'
    s.floats.forEach(fl => {
      ctx.globalAlpha = Math.min(1, fl.life / 30)
      ctx.fillStyle = fl.color
      ctx.fillText(fl.text, fl.x, fl.y)
    })
    ctx.globalAlpha = 1

    // efectos del bioma
    if (B.fx === 'noche') {
      ctx.fillStyle = 'rgba(2,4,18,0.32)'
      ctx.fillRect(0, rowY(0), W, H - HUD_H)
    } else if (B.fx === 'arena') {
      ctx.fillStyle = 'rgba(210,170,90,0.10)'
      ctx.fillRect(0, rowY(0), W, H - HUD_H)
      ctx.fillStyle = 'rgba(230,200,130,0.35)'
      for (let i = 0; i < 14; i++) {
        const x = ((i * 131 + s.frame * 3.2) % SPAN) - MARGIN
        ctx.fillRect(x, HUD_H + (i * 67) % (H - HUD_H), 10, 1.5)
      }
    } else if (B.fx === 'niebla') {
      for (let i = 0; i < 3; i++) {
        const x = ((i * 210 + s.frame * (0.3 + i * 0.15)) % SPAN) - MARGIN
        ctx.fillStyle = 'rgba(200,220,210,0.07)'
        ctx.beginPath()
        ctx.ellipse(x, rowY(2 + i * 4) + 10, 130, 26, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (B.fx === 'nieve' && !REDUCED) {
      ctx.fillStyle = 'rgba(240,246,255,0.5)'
      for (let i = 0; i < 24; i++) {
        const y = ((i * 91 + s.frame * (0.5 + (i % 3) * 0.25)) % (H - HUD_H)) + HUD_H
        ctx.fillRect((i * 67 + ((s.frame / 4 + i * 13) % 9)) % W, y, 2, 2)
      }
    }

    ctx.restore()

    // ---------- HUD ----------
    ctx.fillStyle = '#0a0e1a'
    ctx.fillRect(0, 0, W, HUD_H)
    ctx.textAlign = 'left'
    if (s.cfg.zen) {
      ctx.font = '700 12px "JetBrains Mono", monospace'
      ctx.fillStyle = '#a8e05f'
      ctx.fillText('∞', 12, 20)
    } else {
      for (let i = 0; i < s.lives; i++) {
        drawSpr(ctx, 'fg', FROG, 10 + i * 19, 7, 15, 13, '#a8e05f')
      }
    }
    ctx.font = '700 9px "JetBrains Mono", monospace'
    ctx.fillStyle = s.turboCool <= 0 ? '#2de2e6' : 'rgba(255,255,255,0.25)'
    ctx.fillText(s.turboCool <= 0 ? '⚡TURBO' : `⚡${Math.ceil(s.turboCool / 60)}s`, 12 + Math.max(1, s.cfg.zen ? 1 : s.lives) * 19 + 6, 17)
    ctx.textAlign = 'center'
    ctx.font = '700 10px "JetBrains Mono", monospace'
    ctx.fillStyle = '#8b96c9'
    ctx.fillText(`NIVEL ${s.level} · ${B.name}`, W / 2, 18)
    ctx.textAlign = 'right'
    ctx.font = '700 15px "JetBrains Mono", monospace'
    ctx.fillStyle = '#dfe4f5'
    ctx.fillText(String(s.score).padStart(6, '0'), W - 12, 21)
    // barra de tiempo
    if (s.cfg.time) {
      const pct = Math.max(0, s.timeLeft / s.cfg.time)
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.fillRect(10, 27, W - 20, 3)
      ctx.fillStyle = pct < 0.25 ? '#ff6c9f' : pct < 0.5 ? '#ffd166' : '#a8e05f'
      ctx.fillRect(10, 27, (W - 20) * pct, 3)
    }
    // power-ups activos
    ctx.textAlign = 'left'
    ctx.font = '13px serif'
    let px = 10
    const activeIcons = []
    if (s.inv > 0) activeIcons.push('⭐')
    if (s.freeze > 0) activeIcons.push('🕒')
    if (s.fast > 0) activeIcons.push('⚡')
    if (s.x2) activeIcons.push('💰')
    activeIcons.forEach(ic => { ctx.fillText(ic, px, HUD_H + 16); px += 18 })

    // banner de evento
    if (s.bannerT > 0) {
      ctx.textAlign = 'center'
      ctx.font = '700 13px "JetBrains Mono", monospace'
      ctx.fillStyle = '#ffd166'
      ctx.fillText(s.banner, W / 2, rowY(6) + 21)
    }
  }

  // ---------- Bucle principal ----------
  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d')
    if (phase === 'menu') {
      // telón estático del menú
      ctx.fillStyle = '#0a0e1a'
      ctx.fillRect(0, 0, W, HUD_H)
      const B = BIOMAS[0]
      ctx.fillStyle = B.meta; ctx.fillRect(0, rowY(0), W, TILE)
      ctx.fillStyle = B.water; ctx.fillRect(0, rowY(1), W, TILE * 5)
      ctx.fillStyle = B.grass; ctx.fillRect(0, rowY(6), W, TILE)
      ctx.fillStyle = B.road; ctx.fillRect(0, rowY(7), W, TILE * 5)
      ctx.fillStyle = B.grass; ctx.fillRect(0, rowY(12), W, TILE)
      return
    }
    if (phase !== 'run') return

    let raf
    const loop = () => {
      const s = g.current
      const c = s.cfg
      const f = s.frog
      s.frame++
      if (s.inv > 0) s.inv--
      if (s.freeze > 0) s.freeze--
      if (s.fast > 0) s.fast--
      if (s.turboCool > 0) s.turboCool--
      if (s.bannerT > 0) s.bannerT--
      if (s.shake > 0) s.shake--

      // eventos del modo caótico
      if (c.events && !s.ev && --s.eventCool <= 0) {
        const pick = ['inversion', 'inundacion', 'terremoto'][(Math.random() * 3) | 0]
        if (pick === 'inversion') {
          s.roads.forEach(l => { l.dir *= -1 })
          setBanner(s, '⚠ TRÁFICO INVERTIDO')
        } else if (pick === 'inundacion') {
          s.ev = 'inundacion'
          s.evT = 420 // 120 de aviso + 300 inundada
          setBanner(s, '⚠ INUNDACIÓN EN LA BERMA')
        } else {
          s.ev = 'terremoto'
          s.evT = 300
          s.shake = 300
          setBanner(s, '⚠ TERREMOTO')
        }
        s.eventCool = 900 + Math.random() * 600
      }
      if (s.evT > 0 && --s.evT === 0) s.ev = null

      // tren bala: aviso parpadeante y luego cruza a toda velocidad
      if (c.train && !s.train && s.trainWarn <= 0 && --s.trainCool <= 0) {
        s.trainLane = 7 + ((Math.random() * 5) | 0)
        s.trainWarn = 90
        s.trainCool = 1100 + Math.random() * 700
      }
      if (s.trainWarn > 0 && --s.trainWarn === 0) {
        const lane = s.roads[s.trainLane - 7]
        s.train = {
          row: s.trainLane, dir: lane.dir, w: 300, speed: 8,
          x: lane.dir > 0 ? -MARGIN - 160 : W + MARGIN + 160
        }
      }
      if (s.train && s.freeze <= 0) {
        s.train.x += s.train.dir * s.train.speed
        if (s.train.x - s.train.w / 2 > W + MARGIN + 180 || s.train.x + s.train.w / 2 < -MARGIN - 180) s.train = null
      }

      // tráfico (🕒 congela vehículos y tren, no el río)
      if (s.freeze <= 0) {
        s.roads.forEach(lane => lane.vehicles.forEach(v => {
          v.x += lane.dir * lane.speed
          wrapX(v)
        }))
      }
      // río y serpiente siempre se mueven
      s.waters.forEach(lane => lane.plats.forEach(p => {
        p.x += lane.dir * lane.speed
        wrapX(p)
      }))
      if (s.snake) {
        s.snake.x += s.snake.dir * s.snake.speed
        if (s.snake.x < 24 || s.snake.x > W - 24) s.snake.dir *= -1
      }

      // monedas y power-ups
      if (--s.coinCool <= 0 && s.coins.length < (c.zen ? 10 : 6)) {
        spawnPickup(s, 'coin')
        s.coinCool = c.zen ? 90 : 170
      }
      if (--s.powerCool <= 0) {
        if (s.powers.length < 2 && Math.random() < c.drop) spawnPickup(s, 'power')
        s.powerCool = 480
      }
      const tick = it => { it.life-- }
      s.coins.forEach(tick)
      s.powers.forEach(tick)
      s.coins = s.coins.filter(it => it.life > 0)
      s.powers = s.powers.filter(it => it.life > 0)

      if (s.deadT > 0) {
        // animación de muerte: el mundo sigue, la rana espera
        s.deadT--
        if (s.deadT === 0) {
          s.lives--
          if (s.lives <= 0) { endGame(s); draw(ctx); return }
          resetFrog(s)
        }
      } else {
        // cronómetro del cruce
        if (c.time) {
          s.timeLeft--
          if (s.timeLeft <= 0) {
            s.combo = 0
            s.deadT = 45
            float(s, f.x, f.y - 20, '⏰ SIN TIEMPO', '#ff6c9f')
            burst(s, f.x, f.y, '#ff6c9f', 16)
          }
        }

        // procesar la cola de saltos
        if (f.hopT === 0 && s.queue.length) {
          const q = s.queue.shift()
          tryHop(s, q.dx, q.dy, q.turbo)
        }
        if (f.hopT > 0) {
          f.hopT--
          const p = 1 - f.hopT / f.hopDur
          f.x = f.fx + (f.tx - f.fx) * p
          f.y = f.fy + (f.ty - f.fy) * p
          if (f.hopT === 0) land(s)
        }

        if (s.deadT === 0) {
          // fila visual actual (para choques incluso a mitad de salto)
          const rowNow = Math.round((f.y - HUD_H - TILE / 2) / TILE)

          // río: viajar sobre la plataforma o ahogarse
          if (f.hopT === 0 && f.row >= 1 && f.row <= 5) {
            const hit = platAt(s, f.row, f.x)
            if (!hit) killFrog(s, 'agua')
            else if (submerged(s, hit.p) || mouthDanger(s, hit.lane, hit.p, f.x)) killFrog(s, 'agua')
            else {
              f.x += hit.lane.dir * hit.lane.speed
              if (f.x < 10 || f.x > W - 10) killFrog(s, 'agua')
            }
          }

          // berma inundada (Caótico)
          if (s.deadT === 0 && s.ev === 'inundacion' && s.evT <= 300 && rowNow === 6 && f.hopT === 0) {
            killFrog(s, 'agua')
          }

          // pista: vehículos y tren (en Zen no dañan)
          if (s.deadT === 0 && !c.zen && rowNow >= 7 && rowNow <= 11) {
            const lane = s.roads[rowNow - 7]
            for (const v of lane.vehicles) {
              if (Math.abs(f.x - v.x) < v.w / 2 + 11 - c.pad) { killFrog(s, 'auto'); break }
            }
            if (s.deadT === 0 && s.train && s.train.row === rowNow
              && Math.abs(f.x - s.train.x) < s.train.w / 2 + 12) {
              killFrog(s, 'auto')
            }
          }

          // serpiente de la berma
          if (s.deadT === 0 && !c.zen && s.snake && rowNow === 6
            && Math.abs(f.x - s.snake.x) < 24) {
            killFrog(s, 'auto')
          }

          // recolectar monedas y power-ups
          if (s.deadT === 0) {
            s.coins.forEach(it => {
              if (it.row === rowNow && Math.abs(pickupX(it) - f.x) < 18) {
                it.life = 0
                s.score += 50
                s.stats.monedas++
                float(s, f.x, f.y - 18, '+50')
                burst(s, f.x, f.y, '#ffd166', 8)
              }
            })
            s.powers.forEach(it => {
              if (it.row === rowNow && Math.abs(pickupX(it) - f.x) < 18) {
                it.life = 0
                burst(s, f.x, f.y, '#2de2e6', 10)
                applyPower(s, it.p)
              }
            })
            s.coins = s.coins.filter(it => it.life > 0)
            s.powers = s.powers.filter(it => it.life > 0)
          }
        }
      }

      // partículas y textos
      s.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life-- })
      s.particles = s.particles.filter(p => p.life > 0)
      s.floats.forEach(fl => { fl.y -= 0.6; fl.life-- })
      s.floats = s.floats.filter(fl => fl.life > 0)

      draw(ctx)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  return (
    <div className="ast-wrap">
      <div className="ast-stage">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="ast-canvas fg-canvas"
          onPointerDown={e => {
            e.preventDefault()
            const p = phaseRef.current
            if (p === 'over' && g.current) { start(g.current.cfg.key); return }
            if (p !== 'run') return
            ptr.current = { x: e.clientX, y: e.clientY }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerUp={e => {
            if (phaseRef.current !== 'run' || !ptr.current || !g.current) { ptr.current = null; return }
            const dx = e.clientX - ptr.current.x
            const dy = e.clientY - ptr.current.y
            ptr.current = null
            const s = g.current
            if (s.queue.length >= 2) return
            // toque corto = saltar adelante; deslizar = saltar en esa dirección
            if (Math.abs(dx) < 14 && Math.abs(dy) < 14) s.queue.push({ dx: 0, dy: -1, turbo: false })
            else if (Math.abs(dx) > Math.abs(dy)) s.queue.push({ dx: dx > 0 ? 1 : -1, dy: 0, turbo: false })
            else s.queue.push({ dx: 0, dy: dy > 0 ? 1 : -1, turbo: false })
          }}
        />

        {phase === 'menu' && (
          <div className="ast-overlay">
            <div className="ast-title mono">FROGGER+</div>
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
            <p className="ast-note mono">PUNTÚAN EN EL RANKING: CLÁSICO, DIFÍCIL Y CAÓTICO · BIOMA NUEVO CADA 5 NIVELES</p>
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
            <div className="ast-title mono over">GAME OVER</div>
            <div className="ast-score mono">
              {result.mode.icon} {result.mode.label} · <b>{result.score}</b> PTS
            </div>
            {!result.mode.ranked && (
              <p className="ast-note mono">ESTE MODO NO PUNTÚA EN EL RANKING</p>
            )}
            <div className="ast-stats mono">
              <span>METAS {result.stats.metas}</span>
              <span>NIVEL {result.stats.nivel}</span>
              <span>MONEDAS {result.stats.monedas}</span>
              <span>SALTOS {result.stats.saltos}</span>
              {result.stats.combo > 1 && <span>COMBO MÁX {result.stats.combo}</span>}
            </div>
            <div className="ast-btns">
              <button className="ast-btn mono" onClick={() => start(result.mode.key)}>REINTENTAR (ESPACIO)</button>
              <button className="ast-btn ghost mono" onClick={() => setPh('menu')}>CAMBIAR MODO</button>
            </div>
          </div>
        )}
      </div>
      <div className="ast-foot mono">
        <span>↑ ↓ ← → / WASD SALTAR · ESPACIO TURBO (SALTO DOBLE) · DESLIZA EN MÓVIL · ESC PAUSA</span>
      </div>
    </div>
  )
}
