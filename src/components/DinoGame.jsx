import { useRef, useEffect, useState } from 'react'
import '../styles/DinoGame.css'

// DINO RUN+ · versión propia del dinosaurio de Chrome con modos de juego.
// Canvas puro con requestAnimationFrame; el estado del juego vive en un ref
// para no re-renderizar React 60 veces por segundo. Los menús (selección de
// modo, pausa, game over) son overlays HTML encima del canvas.
// SOLO el modo Clásico envía puntaje al ranking global (onGameOver(sc, ranked)).

const W = 720, H = 240, GROUND = 198, DINO_X = 48

// Estilo clásico del dino de Chrome: monocromo, empieza de día (fondo claro,
// siluetas oscuras) y cada 700 puntos se invierte a noche (con luna y estrellas)
const PAL = {
  dia: {
    bg: '#f7f7f7', ink: '#535353', text: '#535353',
    cloud: 'rgba(83,83,83,0.30)', star: 'transparent'
  },
  noche: {
    bg: '#121830', ink: '#e8ecfb', text: '#9aa6d4',
    cloud: 'rgba(232,236,251,0.28)', star: 'rgba(233,238,255,0.6)'
  }
}

// ---------- Sprites pixel art ('X' = píxel encendido) ----------
const DINO_BODY = [
  '..........XXXXXXXXXX..',
  '.........XXX.XXXXXXX..',
  '.........XXXXXXXXXXX..',
  '.........XXXXXXXXXXX..',
  '.........XXXXXXXXXXX..',
  '.........XXXXXX.......',
  '.........XXXXXXXXX....',
  'X........XXXXXX.......',
  'X.......XXXXXXX.......',
  'XX.....XXXXXXXXXX.....',
  'XXX...XXXXXXXXXX.X....',
  'XXXXXXXXXXXXXXXX.X....',
  'XXXXXXXXXXXXXXXXXX....',
  'XXXXXXXXXXXXXXXXX.....',
  '.XXXXXXXXXXXXXXX......',
  '..XXXXXXXXXXXXX.......',
  '...XXXXXXXXXXX........',
  '....XXXXXXXXX.........',
  '.....XXXXXXX..........'
]
const DINO_A = [...DINO_BODY, // pata trasera apoyada
  '......XX.....XX.......',
  '......XX..............',
  '......XXX.............'
]
const DINO_B = [...DINO_BODY, // pata delantera apoyada
  '......XX.....XX.......',
  '.............XX.......',
  '.............XXX......'
]
const DINO_JUMP = [...DINO_BODY, // ambas patas recogidas
  '......XX.....XX.......',
  '......XX.....XX.......',
  '......XXX....XXX......'
]
const DUCK_BODY = [
  '.....................XXXXXXXX.',
  '....................XXX.XXXXX.',
  '....................XXXXXXXXX.',
  'X...................XXXXXXXXX.',
  'XX.......XXXXXXX....XXXXXX....',
  'XXX.XXXXXXXXXXXXXXXXXXXXXXXX..',
  'XXXXXXXXXXXXXXXXXXXXXXXX.X....',
  '.XXXXXXXXXXXXXXXXXXXXXXX.X....',
  '..XXXXXXXXXXXXXXXXXXXXXX......',
  '...XXXXXXXXXXXXXXXXXXX........'
]
const DUCK_A = [...DUCK_BODY,
  '......XX........XX............',
  '......XX......................',
  '......XXX.....................'
]
const DUCK_B = [...DUCK_BODY,
  '......XX........XX............',
  '................XX............',
  '................XXX...........'
]
const BIRD_UP = [
  '..........XXX.........',
  '..........XXXX........',
  '..........XXXXX.......',
  '..........XXXXXX......',
  '.XX.......XXXXXXX.....',
  'XXXXX..XXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXXXXXXXX',
  '...XXXXXXXXXXXXXXXX...'
]
const BIRD_DOWN = [
  '.XX...................',
  'XXXXX..XXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXXXXXXXX',
  '...XXXXXXXXXXXXXXXX...',
  '..........XXXXXX......',
  '..........XXXXX.......',
  '..........XXXX........',
  '..........XXX.........'
]
const CACTUS_S = [
  '....XX....',
  '....XX....',
  '.X..XX..X.',
  '.X..XX..X.',
  '.X..XX..X.',
  '.X..XX..X.',
  '.XX.XX.XX.',
  '..XXXXXX..',
  '....XX....',
  '....XX....',
  '....XX....',
  '....XX....',
  '....XX....',
  '....XX....',
  '....XX....',
  '....XX....',
  '....XX....',
  '....XX....',
  '....XX....',
  '....XX....'
]
const CACTUS_L = [
  '......XX......',
  '......XX......',
  '.XX...XX...XX.',
  '.XX...XX...XX.',
  '.XX...XX...XX.',
  '.XX...XX...XX.',
  '.XX...XX...XX.',
  '.XX...XX...XX.',
  '.XXX..XX..XXX.',
  '..XXXXXXXXXX..',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......',
  '......XX......'
]
const ROCK = [
  '...XXXX...',
  '..XXXXXX..',
  '.XXXXXXXX.',
  'XXXXXXXXXX',
  'XXXXXXXXXX',
  'XXXXXXXXXX'
]
const CLOUD = [
  '.......XXXXX..........',
  '.....XXXXXXXXX........',
  '..XXXXXXXXXXXXXX......',
  '.XXXXXXXXXXXXXXXXXXX..',
  'XXXXXXXXXXXXXXXXXXXXXX'
]

// Cada sprite se pinta una vez por color en un canvas pequeño y luego se
// escala con drawImage (sin suavizado): pixel art nítido y sin costo por frame
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

const BASE = {
  speed0: 6, maxSpeed: 13, accel: 2600, jumpV: -12.4, grav: 0.75, pad: 4,
  spawnMin: 250, spawnRng: 330, birds: true, birdFrom: 3200,
  tall: false, rocks: false, triple: false, events: false, powers: false, zen: false
}

export const MODES = {
  clasico: {
    ...BASE, key: 'clasico', label: 'CLÁSICO', icon: '🦖', ranked: true,
    desc: 'El original: cactus, pájaros y día/noche. El único modo que puntúa en el ranking.'
  },
  facil: {
    ...BASE, key: 'facil', label: 'FÁCIL', icon: '🌵', ranked: true, powers: true,
    speed0: 5, maxSpeed: 9.5, accel: 3400, jumpV: -11.4, grav: 0.68, pad: 8,
    spawnMin: 340, spawnRng: 430, birdFrom: 5200,
    desc: 'Más lento, saltos cortos y controlables, menos obstáculos. Con power-ups.'
  },
  dificil: {
    ...BASE, key: 'dificil', label: 'DIFÍCIL', icon: '🔥', ranked: true, powers: true,
    speed0: 7, maxSpeed: 14.5, accel: 2200, pad: 3, spawnMin: 200, spawnRng: 250,
    birdFrom: 600, tall: true, rocks: true, triple: true,
    desc: 'Cactus altos, dobles y triples, rocas bajas y pájaros desde el inicio.'
  }
}
MODES.caotico = {
  ...MODES.dificil, key: 'caotico', label: 'CAÓTICO', icon: '🌪️', events: true,
  desc: 'Difícil + viento, meteoritos, oscuridad, tormenta de arena y terremotos.'
}
MODES.zen = {
  ...BASE, key: 'zen', label: 'ZEN', icon: '🧘', ranked: false, zen: true,
  desc: 'Nada te mata: practica saltos y tiempos sin presión. No puntúa.'
}

const EVENTS = {
  viento: { label: '⚠ VIENTO', dur: 420 },
  oscuridad: { label: '⚠ OSCURIDAD', dur: 380 },
  tormenta: { label: '⚠ TORMENTA DE ARENA', dur: 400 },
  terremoto: { label: '⚠ TERREMOTO', dur: 300 },
  meteoritos: { label: '⚠ METEORITOS', dur: 360 }
}

const POWERS = {
  escudo: { icon: '⭐', label: 'ESCUDO' },
  lento: { icon: '🕒', label: 'TIEMPO LENTO', dur: 330 },
  x2: { icon: '💰', label: 'PUNTOS ×2', dur: 480 },
  pluma: { icon: '🪶', label: 'SALTO ALTO', dur: 390 }
}

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const fmtTime = fr => {
  const s = Math.floor(fr / 60)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function DinoGame({ onGameOver }) {
  const canvasRef = useRef(null)
  const g = useRef(null)              // estado mutable del juego
  const phaseRef = useRef('menu')     // 'menu' | 'run' | 'pause' | 'over'
  const [phase, setPhase] = useState('menu')
  const [result, setResult] = useState(null) // resumen al morir
  const overRef = useRef(onGameOver)
  useEffect(() => { overRef.current = onGameOver }, [onGameOver])

  const setPh = p => { phaseRef.current = p; setPhase(p) }

  const init = cfg => ({
    cfg, y: GROUND, vy: 0, ducking: false, dist: 0, pts: 0, frame: 0,
    obstacles: [], items: [],
    nextIn: 420,
    nextItem: cfg.powers ? 1100 + Math.random() * 900 : Infinity,
    shield: false, invT: 0,
    timers: { lento: 0, x2: 0, pluma: 0 },
    event: null, eventT: 0, eventCool: 500 + Math.random() * 400, wind: 0,
    airDodges: 0, particles: [], floats: [], shakeT: 0,
    clouds: [{ x: 130, y: 42 }, { x: 400, y: 74 }, { x: 640, y: 30 }],
    stats: { jumps: 0, ducks: 0, fastFalls: 0, birds: 0, maxSpeed: 0 }
  })

  const start = modeKey => {
    g.current = init(MODES[modeKey])
    setResult(null)
    setPh('run')
  }

  const jump = () => {
    const s = g.current
    if (!s || s.y < GROUND || s.ducking) return
    s.vy = s.cfg.jumpV * (s.timers.pluma > 0 ? 1.22 : 1)
    s.stats.jumps++
  }

  const action = () => {
    const p = phaseRef.current
    if (p === 'run') jump()
    else if (p === 'over') start(g.current.cfg.key)
    else if (p === 'pause') setPh('run')
  }

  // ---------- Controles ----------
  useEffect(() => {
    const down = e => {
      const p = phaseRef.current
      if (e.code === 'Escape') {
        if (p === 'run') { e.preventDefault(); setPh('pause') }
        else if (p === 'pause') { e.preventDefault(); setPh('run') }
        return
      }
      if (p === 'menu') return // el menú se maneja con sus botones
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault()
        if (!e.repeat) action()
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault()
        const s = g.current
        if (!s || p !== 'run') return
        s.ducking = true
        if (!e.repeat) {
          // Fast Fall: corta el salto en seco (mata la subida) y se desploma
          if (s.y < GROUND) { s.vy = Math.max(s.vy, 0) + 7; s.stats.fastFalls++ }
          else s.stats.ducks++
        }
      }
    }
    const up = e => {
      if ((e.code === 'ArrowDown' || e.code === 'KeyS') && g.current) g.current.ducking = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ---------- Generación de obstáculos ----------
  // Devuelve el ancho de lo colocado y si es "duro" (exige salto preciso):
  // el bucle usa eso para dejar un hueco justo antes del siguiente obstáculo.
  const spawn = s => {
    const c = s.cfg
    const roll = Math.random()
    if (c.birds && s.dist > c.birdFrom && roll < 0.26) {
      const ys = [GROUND - 22, GROUND - 52, GROUND - 86]
      s.obstacles.push({ kind: 'bird', x: W + 40, y: ys[(Math.random() * 3) | 0], w: 34, h: 18 })
      return { w: 34, hard: false }
    }
    if (c.rocks && roll < 0.42) {
      // roca baja: salto corto y rápido
      s.obstacles.push({ kind: 'rock', x: W + 40, y: GROUND - 16, w: 22, h: 16 })
      return { w: 22, hard: false }
    }
    if (c.tall && roll < 0.58) {
      // cactus alto: exige salto preciso
      const h = 56 + ((Math.random() * 10) | 0)
      s.obstacles.push({ kind: 'cactus', x: W + 40, y: GROUND - h, w: 16, h })
      return { w: 16, hard: true }
    }
    // grupo de cactus (triples solo en difícil/caótico)
    const max = c.triple ? 3 : 2
    const n = 1 + ((Math.random() * max) | 0)
    let x = W + 40
    for (let i = 0; i < n; i++) {
      const h = 28 + ((Math.random() * 20) | 0)
      s.obstacles.push({ kind: 'cactus', x, y: GROUND - h, w: 14, h })
      x += 16
    }
    return { w: n * 16, hard: n === 3 }
  }

  const spawnItem = s => {
    const keys = Object.keys(POWERS)
    const p = keys[(Math.random() * keys.length) | 0]
    s.items.push({ p, x: W + 40, y: GROUND - 64 - ((Math.random() * 46) | 0), w: 26, h: 26 })
  }

  const burst = (s, x, y, color, n = 10) => {
    if (REDUCED) return
    for (let i = 0; i < n && s.particles.length < 130; i++) {
      s.particles.push({
        x, y, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 4 - 1,
        life: 26 + Math.random() * 14, color, size: 2 + Math.random() * 3
      })
    }
  }

  const float = (s, x, y, text, color) =>
    s.floats.push({ x, y, text, color, life: 55 })

  const hitbox = s => s.ducking && s.y >= GROUND
    ? { x: DINO_X, y: GROUND - 26, w: 42, h: 26 }
    : { x: DINO_X + 2, y: s.y - 44, w: 28, h: 44 }

  const overlap = (a, o, pad) =>
    a.x < o.x + o.w - pad && a.x + a.w > o.x + pad &&
    a.y < o.y + o.h - pad && a.y + a.h > o.y + pad

  // ---------- Dibujo ----------
  // Patineta: tabla con kicks y ruedas. En el suelo el dino va montado
  // (ruedas "girando"); al subir en el salto la tabla hace un flip completo
  // y al caer vuelve bajo sus patas para aterrizar.
  const drawSkate = (ctx, pal, x, y, angle, frame) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.fillStyle = pal.ink
    ctx.fillRect(-15, -3, 30, 3)   // tabla
    ctx.fillRect(-18, -5, 4, 3)    // nose
    ctx.fillRect(14, -5, 4, 3)     // tail
    ctx.fillRect(-11, 0, 5, 5)     // ruedas
    ctx.fillRect(6, 0, 5, 5)
    // centro de las ruedas alternando = sensación de giro
    ctx.fillStyle = pal.bg
    const w = ((frame / 3) | 0) % 2
    ctx.fillRect(-9 + w, 1 + w, 1.6, 1.6)
    ctx.fillRect(8 - w, 1 + w, 1.6, 1.6)
    ctx.restore()
  }

  const drawDino = (ctx, s, pal, dead) => {
    const blink = s.invT > 0 && ((s.frame / 4) | 0) % 2 === 0
    if (blink) return
    const f = ((s.frame / 6) | 0) % 2
    const grounded = s.y >= GROUND
    const LIFT = 6 // el dino va parado sobre la tabla

    if (s.ducking && grounded) {
      drawSkate(ctx, pal, DINO_X + 18, GROUND - 3, 0, s.frame)
      drawSpr(ctx, 'k' + f, f ? DUCK_B : DUCK_A, DINO_X - 10, GROUND - 26 - LIFT, 60, 26, pal.ink)
    } else {
      const y = s.y
      const air = y < GROUND
      // la tabla: montada en el suelo; en el aire, flip al subir y de vuelta
      // bajo las patas al caer
      if (air) {
        if (s.vy < 0) s.boardA = (s.boardA || 0) + 0.38 // maniobra: flip girando
        else s.boardA = s.boardA ? s.boardA * 0.72 : 0  // cayendo: se endereza
        drawSkate(ctx, pal, DINO_X + 14, y + 4, s.boardA, s.frame)
      } else {
        s.boardA = 0
        drawSkate(ctx, pal, DINO_X + 14, GROUND - 3, 0, s.frame)
      }
      drawSpr(ctx, air ? 'dj' : 'd' + f, air ? DINO_JUMP : (f ? DINO_B : DINO_A),
        DINO_X - 8, y - 44 - (air ? 0 : LIFT), 44, 44, pal.ink)
      if (dead) {
        // el ojo se vuelve una ✖ (píxeles del color del fondo sobre la cabeza)
        ctx.fillStyle = pal.bg
        const ex = DINO_X + 12, ey = y - 43 - (air ? 0 : LIFT)
        ctx.fillRect(ex, ey, 3, 3); ctx.fillRect(ex + 6, ey, 3, 3)
        ctx.fillRect(ex + 3, ey + 3, 3, 3)
        ctx.fillRect(ex, ey + 6, 3, 3); ctx.fillRect(ex + 6, ey + 6, 3, 3)
      }
    }
    // escudo activo: anillo alrededor
    if (s.shield) {
      ctx.strokeStyle = 'rgba(255,209,102,0.85)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(DINO_X + 14, s.y - 26, 34, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  const draw = ctx => {
    const s = g.current
    const sc = Math.floor(s.pts)
    // empieza de día, como el original; cada 700 puntos se invierte
    const pal = ((sc / 700) | 0) % 2 === 1 ? PAL.noche : PAL.dia

    ctx.save()
    // terremoto: la cámara tiembla
    if (s.shakeT > 0 && !REDUCED) {
      ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 4)
    }

    // cielo
    ctx.fillStyle = pal.bg
    ctx.fillRect(-8, -8, W + 16, H + 16)
    if (pal === PAL.noche) {
      ctx.fillStyle = pal.star
      for (let i = 0; i < 14; i++) {
        ctx.fillRect(((i * 97 + 31) % W), ((i * 53) % 90) + 12, 2, 2)
      }
      // luna creciente
      ctx.fillStyle = pal.ink
      ctx.beginPath(); ctx.arc(W - 90, 44, 12, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = pal.bg
      ctx.beginPath(); ctx.arc(W - 97, 40, 10, 0, Math.PI * 2); ctx.fill()
    }
    // nubes de píxeles con parallax
    s.clouds.forEach(c => drawSpr(ctx, 'cl', CLOUD, c.x, c.y, 44, 10, pal.cloud))

    // suelo clásico: línea con montículos y piedritas (hash por tramo)
    ctx.fillStyle = pal.ink
    ctx.fillRect(0, GROUND + 3, W, 2)
    const k0 = Math.floor(s.dist / 8)
    for (let i = 0; i < W / 8 + 2; i++) {
      const k = k0 + i
      const h = (k * 2654435761) >>> 0
      const sx = k * 8 - s.dist
      if (h % 19 === 0) ctx.fillRect(sx, GROUND + 1, 6, 2)            // montículo
      if (h % 23 === 0) ctx.fillRect(sx, GROUND + 9 + (h % 6), 2, 2)  // piedrita
    }

    // partículas
    s.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life / 40)
      ctx.fillStyle = p.color
      ctx.fillRect(p.x, p.y, p.size, p.size)
    })
    ctx.globalAlpha = 1

    // power-ups flotantes
    ctx.font = '20px serif'
    ctx.textAlign = 'center'
    s.items.forEach(it => {
      const bob = Math.sin((s.frame + it.x) / 14) * 3
      ctx.fillText(POWERS[it.p].icon, it.x + 13, it.y + 20 + bob)
    })

    // obstáculos (sprites monocromos, como el original)
    s.obstacles.forEach(o => {
      if (o.kind === 'bird') {
        const flap = ((s.frame / 8) | 0) % 2
        drawSpr(ctx, 'b' + flap, flap ? BIRD_DOWN : BIRD_UP,
          o.x + o.w / 2 - 22, o.y, 44, 16, pal.ink)
      } else if (o.kind === 'rock') {
        drawSpr(ctx, 'rk', ROCK, o.x, o.y, o.w, o.h, pal.ink)
      } else if (o.kind === 'meteor') {
        // el meteorito conserva su color de alerta
        ctx.fillStyle = '#ff9f43'
        ctx.fillRect(o.x, o.y, o.w, o.h)
        ctx.fillStyle = 'rgba(255,159,67,0.4)'
        ctx.fillRect(o.x + 4, o.y - 10, o.w - 8, 10)
        if (o.y < 40) { // aviso de dónde caerá
          ctx.fillStyle = '#ff9f43'
          ctx.font = '700 14px "JetBrains Mono", monospace'
          ctx.textAlign = 'center'
          ctx.fillText('!', o.x + o.w / 2, 16)
          ctx.font = '20px serif'
        }
      } else {
        // saguaro chico o alto según la altura del obstáculo
        const tall = o.h >= 52
        const vw = o.h / 2
        drawSpr(ctx, tall ? 'cL' : 'cS', tall ? CACTUS_L : CACTUS_S,
          o.x + o.w / 2 - vw / 2, o.y, vw, o.h, pal.ink)
      }
    })

    drawDino(ctx, s, pal, !!s.dead)

    // textos flotantes (combos, power-ups)
    ctx.font = '700 12px "JetBrains Mono", monospace'
    s.floats.forEach(f => {
      ctx.globalAlpha = Math.min(1, f.life / 30)
      ctx.fillStyle = f.color
      ctx.fillText(f.text, f.x, f.y)
    })
    ctx.globalAlpha = 1

    // eventos con overlay de pantalla completa
    if (s.event === 'oscuridad') {
      // Ajustes de la oscuridad: el 3er número (90) es el radio totalmente
      // iluminado alrededor del dino, el 6to (320) hasta dónde se desvanece,
      // y el 0.82 la opacidad máxima en los bordes (1 = negro total).
      const grd = ctx.createRadialGradient(DINO_X + 14, s.y - 26, 90, DINO_X + 14, s.y - 26, 320)
      grd.addColorStop(0, 'rgba(5,8,18,0)')
      grd.addColorStop(1, 'rgba(5,8,18,0.82)')
      ctx.fillStyle = grd
      ctx.fillRect(-8, -8, W + 16, H + 16)
    } else if (s.event === 'tormenta') {
      ctx.fillStyle = 'rgba(214,178,110,0.26)'
      ctx.fillRect(-8, -8, W + 16, H + 16)
    }

    // HUD (después de los overlays para que siempre se lea)
    ctx.font = '700 14px "JetBrains Mono", monospace'
    ctx.textAlign = 'right'
    ctx.fillStyle = pal.text
    ctx.fillText(String(sc).padStart(5, '0'), W - 16, 28)
    // power-ups activos
    ctx.textAlign = 'left'
    let px = 16
    if (s.shield) { ctx.fillText('⭐', px, 28); px += 26 }
    Object.entries(s.timers).forEach(([k, t]) => {
      if (t > 0) { ctx.fillText(POWERS[k].icon, px, 28); px += 26 }
    })
    // banner del evento activo
    if (s.event) {
      ctx.textAlign = 'center'
      ctx.fillStyle = '#d18f00'
      ctx.fillText(EVENTS[s.event].label, W / 2, 28)
    }
    if (s.cfg.zen) {
      ctx.textAlign = 'center'
      ctx.globalAlpha = 0.55
      ctx.fillStyle = pal.text
      ctx.fillText('MODO ZEN', W / 2, H - 14)
      ctx.globalAlpha = 1
    }

    ctx.restore()
  }

  // ---------- Bucle principal ----------
  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d')
    if (phase === 'menu') {
      // escena estática de fondo para el menú
      g.current = init(MODES.clasico)
      draw(ctx)
      return
    }
    if (phase !== 'run') { return } // pausa y game over congelan el último frame

    let raf
    const loop = () => {
      const s = g.current
      s.frame++
      const ts = s.timers.lento > 0 ? 0.6 : 1 // tiempo lento
      const speed = Math.min(s.cfg.maxSpeed, s.cfg.speed0 + s.dist / s.cfg.accel)
      const eff = speed * ts
      s.dist += eff
      s.pts += (eff / 10) * (s.timers.x2 > 0 ? 2 : 1)
      s.stats.maxSpeed = Math.max(s.stats.maxSpeed, speed)

      // temporizadores
      Object.keys(s.timers).forEach(k => { if (s.timers[k] > 0) s.timers[k]-- })
      if (s.invT > 0) s.invT--
      if (s.shakeT > 0) s.shakeT--

      // eventos caóticos
      if (s.cfg.events) {
        if (s.event) {
          s.eventT--
          if (s.event === 'terremoto') s.shakeT = 2
          if (s.event === 'meteoritos' && s.frame % 46 === 0) {
            s.obstacles.push({
              kind: 'meteor', x: 220 + Math.random() * (W - 200), y: -20,
              w: 16, h: 16, vx: -1.5 - Math.random() * 2, vy: 4.6 + Math.random() * 2
            })
          }
          if (s.eventT <= 0) {
            s.event = null
            s.wind = 0
            s.eventCool = 350 + Math.random() * 450
          }
        } else if (--s.eventCool <= 0) {
          const keys = Object.keys(EVENTS)
          s.event = keys[(Math.random() * keys.length) | 0]
          s.eventT = EVENTS[s.event].dur
          if (s.event === 'viento') s.wind = (Math.random() < 0.5 ? -1 : 1) * 1.4
        }
        // ráfagas de viento y arena como partículas
        if ((s.event === 'viento' || s.event === 'tormenta') && !REDUCED && s.frame % 3 === 0
          && s.particles.length < 130) {
          s.particles.push({
            x: Math.random() * W, y: Math.random() * (GROUND - 10),
            vx: (s.event === 'tormenta' ? -7 : s.wind * 6), vy: 0.4,
            life: 22, color: s.event === 'tormenta' ? '#d6b26e' : 'rgba(128,128,128,0.55)',
            size: s.event === 'tormenta' ? 2 : 1.5
          })
        }
      }

      // física del salto (el viento empuja un poco en el aire)
      if (s.y < GROUND || s.vy < 0) {
        // manteniendo ↓ en el aire la gravedad se triplica: caída rápida,
        // nada de salto largo flotante
        s.vy += s.cfg.grav * ts * (s.ducking && s.y < GROUND ? 3 : 1)
        if (s.wind && s.y < GROUND) s.vy += s.wind * 0.02
        s.y = Math.min(GROUND, s.y + s.vy * ts)
        if (s.y >= GROUND) {
          s.vy = 0
          burst(s, DINO_X + 10, GROUND, 'rgba(128,128,128,0.6)', 4)
          // combo: obstáculos esquivados sin tocar el suelo
          if (s.airDodges >= 2) {
            const bonus = s.airDodges * 15
            s.pts += bonus
            float(s, DINO_X + 40, s.y - 70, `COMBO x${s.airDodges} +${bonus}`, '#d18f00')
          }
          s.airDodges = 0
        }
      }

      // obstáculos: aparecer, mover, marcar esquivados.
      // El hueco al siguiente: base del modo + ancho de lo recién puesto
      // + colchón que crece con la velocidad (a más rápido, más espacio para
      // aterrizar y volver a saltar) + 50% extra tras un obstáculo duro.
      s.nextIn -= eff
      if (s.nextIn <= 0) {
        const puesto = spawn(s)
        s.nextIn = s.cfg.spawnMin + puesto.w
          + speed * 16 * (puesto.hard ? 1.5 : 1)
          + Math.random() * s.cfg.spawnRng
      }
      s.obstacles.forEach(o => {
        if (o.kind === 'meteor') {
          o.x += o.vx * ts
          o.y += o.vy * ts
          if (o.y + o.h >= GROUND + 2) {
            o.dead = true
            burst(s, o.x + 8, GROUND, '#ff9f43', 12)
            s.shakeT = Math.max(s.shakeT, 6)
          }
        } else {
          // Todos a la misma velocidad (el viento acerca >0 o aleja <0):
          // si los pájaros fueran más rápidos alcanzarían al cactus de
          // adelante y llegarían apilados — combinación imposible de esquivar
          o.x -= eff + s.wind * ts
        }
        if (!o.passed && o.x + o.w < DINO_X) {
          o.passed = true
          if (o.kind === 'bird') s.stats.birds++
          if (s.y < GROUND) s.airDodges++
        }
      })
      s.obstacles = s.obstacles.filter(o => !o.dead && o.x > -90 && o.y < H + 30)

      // power-ups: aparecer, mover, recoger
      if (s.cfg.powers) {
        s.nextItem -= eff
        if (s.nextItem <= 0) {
          spawnItem(s)
          s.nextItem = 1300 + Math.random() * 1100
        }
      }
      const hb = hitbox(s)
      s.items.forEach(it => {
        it.x -= eff
        if (overlap(hb, it, 0)) {
          it.dead = true
          burst(s, it.x + 13, it.y + 13, '#ffd166', 12)
          float(s, it.x, it.y, POWERS[it.p].label, '#0b8a8c')
          if (it.p === 'escudo') s.shield = true
          else s.timers[it.p] = POWERS[it.p].dur
        }
      })
      s.items = s.items.filter(it => !it.dead && it.x > -40)

      // nubes con parallax
      s.clouds.forEach(c => {
        c.x -= eff * 0.25
        if (c.x < -50) { c.x = W + 30 + Math.random() * 80; c.y = 20 + Math.random() * 70 }
      })

      // partículas y textos flotantes
      s.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life-- })
      s.particles = s.particles.filter(p => p.life > 0)
      s.floats.forEach(f => { f.y -= 0.7; f.life-- })
      s.floats = s.floats.filter(f => f.life > 0)

      // colisiones (en Zen no existen)
      if (!s.cfg.zen && s.invT <= 0) {
        const hit = s.obstacles.find(o => overlap(hb, o, s.cfg.pad))
        if (hit) {
          if (s.shield) {
            s.shield = false
            hit.dead = true
            s.invT = 50
            burst(s, hit.x + hit.w / 2, hit.y + hit.h / 2, '#ffd166', 16)
            float(s, DINO_X + 40, s.y - 76, 'ESCUDO ROTO', '#ff6c9f')
            s.obstacles = s.obstacles.filter(o => !o.dead)
          } else {
            const sc = Math.floor(s.pts)
            burst(s, DINO_X + 14, s.y - 26, '#9aa0a6', 22)
            s.dead = true
            draw(ctx)
            setResult({
              score: sc, mode: s.cfg,
              stats: { ...s.stats, time: fmtTime(s.frame), maxSpeed: s.stats.maxSpeed.toFixed(1) }
            })
            setPh('over')
            overRef.current && overRef.current(sc, s.cfg.ranked)
            return
          }
        }
      }

      draw(ctx)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  // ---------- Overlays HTML ----------
  return (
    <div className="dino-wrap">
      <div className="dino-stage">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="dino-canvas"
          onPointerDown={e => { e.preventDefault(); action() }}
        />

        {phase === 'menu' && (
          <div className="dg-overlay">
            <div className="dg-title mono">DINO RUN+</div>
            <div className="dg-modes">
              {Object.values(MODES).map(m => (
                <button key={m.key} className="dg-mode" onClick={() => start(m.key)}>
                  <span className="dg-mode-name mono">
                    {m.icon} {m.label}
                    {!m.ranked && <span className="dg-rank-tag off mono">SIN RANKING</span>}
                  </span>
                  <span className="dg-mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>
            <p className="dg-note mono">TODOS LOS MODOS PUNTÚAN EN EL RANKING GLOBAL · MENOS ZEN</p>
          </div>
        )}

        {phase === 'pause' && (
          <div className="dg-overlay dg-dim">
            <div className="dg-title mono">PAUSA</div>
            <div className="dg-btns">
              <button className="dg-btn mono" onClick={() => setPh('run')}>REANUDAR (ESC)</button>
              <button className="dg-btn ghost mono" onClick={() => setPh('menu')}>SALIR AL MENÚ</button>
            </div>
          </div>
        )}

        {phase === 'over' && result && (
          <div className="dg-overlay dg-dim">
            <div className="dg-title mono over">GAME OVER</div>
            <div className="dg-score mono">
              {result.mode.icon} {result.mode.label} · <b>{result.score}</b> PTS
            </div>
            {!result.mode.ranked && (
              <p className="dg-note mono">ESTE MODO NO PUNTÚA EN EL RANKING</p>
            )}
            <div className="dg-stats mono">
              <span>SALTOS {result.stats.jumps}</span>
              <span>AGACHADAS {result.stats.ducks}</span>
              <span>FAST FALLS {result.stats.fastFalls}</span>
              <span>PÁJAROS {result.stats.birds}</span>
              <span>TIEMPO {result.stats.time}</span>
              <span>VEL. MÁX {result.stats.maxSpeed}</span>
            </div>
            <div className="dg-btns">
              <button className="dg-btn mono" onClick={() => start(result.mode.key)}>REINTENTAR (ESPACIO)</button>
              <button className="dg-btn ghost mono" onClick={() => setPh('menu')}>CAMBIAR MODO</button>
            </div>
          </div>
        )}
      </div>

      <div className="dino-foot mono">
        <span>ESPACIO / W / ↑ SALTAR · ↓ / S AGACHARSE Y FAST FALL · ESC PAUSA · TOCA EN MÓVIL</span>
      </div>
    </div>
  )
}

