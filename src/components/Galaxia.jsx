import { useRef, useEffect, useState } from 'react'
import '../styles/AstroDefensa.css'

// ESCUADRÓN GALÁCTICO · shooter vertical: tu nave abajo, oleadas de naves
// enemigas descienden y disparan. Canvas puro con rAF y estado en refs,
// misma estructura que DinoGame/AstroDefensa; reusa los overlays ad-*.
// SOLO el modo Normal envía puntaje al ranking (onGameOver(score, ranked)).

const W = 460, H = 560
const SHIP_Y_MIN = H * 0.55, SHIP_Y_MAX = H - 34

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const MODES = {
  normal: {
    key: 'normal', label: 'NORMAL', icon: '🛸', ranked: true,
    hp: 3, spawnEvery: 50, eSpeed: 1.1, aggro: 1.15, drop: 0, events: false,
    desc: '3 de casco y cielos cargados: oleadas densas sin power-ups. El único modo que puntúa en el ranking.'
  },
  facil: {
    key: 'facil', label: 'FÁCIL', icon: '🌟', ranked: true,
    hp: 5, spawnEvery: 95, eSpeed: 0.7, aggro: 0.6, drop: 0.22, events: false,
    desc: '5 de casco, enemigos lentos que disparan poco y power-ups frecuentes.'
  },
  caotico: {
    key: 'caotico', label: 'CAÓTICO', icon: '🔥', ranked: true,
    hp: 3, spawnEvery: 34, eSpeed: 1.35, aggro: 1.5, drop: 0.13, events: true,
    desc: 'Saturación total, enjambres, meteoritos y un JEFE cada 3 oleadas. Los power-ups son tu única salida.'
  }
}

const EVENTS = {
  enjambre: { label: '⚠ ENJAMBRE', dur: 1 },
  meteoritos: { label: '⚠ LLUVIA DE METEORITOS', dur: 1 }
}

const POWERS = {
  escudo: { icon: '⭐', label: 'ESCUDO' },
  rapido: { icon: '⚡', label: 'DISPARO RÁPIDO', dur: 480 },
  triple: { icon: '🌀', label: 'DISPARO EXPANSIVO', dur: 480 },
  bomba: { icon: '💥', label: 'BOMBA DE PLASMA' },
  vida: { icon: '❤️', label: 'CASCO +1' }
}

const pickPower = () => {
  const r = Math.random()
  if (r < 0.28) return 'escudo'
  if (r < 0.55) return 'rapido'
  if (r < 0.82) return 'triple'
  if (r < 0.94) return 'bomba'
  return 'vida'
}

// ---------- Sprites pixel art ----------
const SHIP = [
  '......X......',
  '.....XXX.....',
  '.....XXX.....',
  '....XXXXX....',
  '....XXXXX....',
  '.X..XXXXX..X.',
  '.XX.XXXXX.XX.',
  '.XXXXXXXXXXX.',
  'XXXXXXXXXXXXX',
  'XXX.XXXXX.XXX',
  'XX...XXX...XX',
  '.....X.X.....'
]
const DRONE = [
  '..X.....X..',
  '...X...X...',
  '..XXXXXXX..',
  '.XX.XXX.XX.',
  'XXXXXXXXXXX',
  'X.XXXXXXX.X',
  'X.X.....X.X',
  '...XX.XX...'
]
const CAZA = [
  '.....XXX.....',
  '....XXXXX....',
  '.X..XXXXX..X.',
  '.XX.XXXXX.XX.',
  '.XXXXXXXXXXX.',
  'XXXXXXXXXXXXX',
  'XX.XXXXXXX.XX',
  'X..XX...XX..X',
  '...X.....X...',
  '..XX.....XX..'
]
const ACORAZADO = [
  '.......XXX.......',
  '......XXXXX......',
  '..X...XXXXX...X..',
  '..XX.XXXXXXX.XX..',
  '..XXXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXXX',
  'XXX.XXXXXXXXX.XXX',
  'XX..XX.....XX..XX',
  'X...XX.....XX...X',
  '....X.......X....',
  '...XX.......XX...'
]
const ROCA = [
  '..XXXX..',
  '.XXXXXX.',
  'XXXXXXXX',
  'XXXXXXXX',
  '.XXXXXX.',
  '..XXX...'
]
const BOSS = [
  '.....XXXXXXXXXXX.....',
  '....XXXXXXXXXXXXX....',
  '..XXXXXXXXXXXXXXXXX..',
  '.XXXX.XXXXXXXXX.XXXX.',
  'XXXXX.XXXXXXXXX.XXXXX',
  'XXXXXXXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXXXXXXX',
  'XX.XXXXXXXXXXXXXXX.XX',
  'XX.XXXX.......XXXX.XX',
  'X..XXXX.......XXXX..X',
  '...XXXXXXXXXXXXXXX...',
  '....XX.XX...XX.XX....',
  '....X...X...X...X....',
  '...XX...XX.XX...XX...'
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

// tipo de enemigo: sprite, tamaño en pantalla, casco, puntos y color
const TYPES = {
  drone: { spr: DRONE, name: 'dr', w: 22, h: 16, hp: 1, pts: 50, color: '#a8e05f' },
  caza: { spr: CAZA, name: 'cz', w: 26, h: 20, hp: 2, pts: 100, color: '#ff6c9f' },
  acorazado: { spr: ACORAZADO, name: 'ac', w: 34, h: 24, hp: 5, pts: 300, color: '#ff9f43' },
  roca: { spr: ROCA, name: 'ro', w: 18, h: 14, hp: 1, pts: 20, color: '#b7a68f' }
}

export default function Galaxia({ onGameOver }) {
  const canvasRef = useRef(null)
  const g = useRef(null)
  const keys = useRef({})
  const phaseRef = useRef('menu') // 'menu' | 'run' | 'pause' | 'over'
  const [phase, setPhase] = useState('menu')
  const [result, setResult] = useState(null)
  const overRef = useRef(onGameOver)
  useEffect(() => { overRef.current = onGameOver }, [onGameOver])

  const setPh = p => { phaseRef.current = p; setPhase(p) }

  const init = cfg => ({
    cfg,
    ship: { x: W / 2, y: H - 60, hp: cfg.hp, inv: 0 },
    bullets: [], eBullets: [], enemies: [], items: [], particles: [], floats: [],
    frame: 0, score: 0, wave: 1, waveT: 900, spawnT: 30, shootCool: 0,
    shield: false, timers: { rapido: 0, triple: 0 }, boss: null,
    eventCool: 550 + Math.random() * 300, banner: null, bannerT: 0,
    pointer: null, firing: false,
    stats: { derribos: 0, disparos: 0, jefes: 0 }
  })

  const start = modeKey => {
    g.current = init(MODES[modeKey])
    setResult(null)
    setPh('run')
  }

  const burst = (s, x, y, color, n = 12) => {
    if (REDUCED) n = Math.min(n, 4)
    for (let i = 0; i < n && s.particles.length < 170; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 0.6 + Math.random() * 2.8
      s.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 22 + Math.random() * 18, color, size: 1.5 + Math.random() * 2.5
      })
    }
  }

  const float = (s, x, y, text, color = '#ffd166') =>
    s.floats.push({ x, y, text, color, life: 60 })

  const spawnEnemy = (s, forceType) => {
    const r = Math.random()
    const type = forceType
      || (r < 0.55 ? 'drone' : r < 0.85 || s.wave < 2 ? 'caza' : 'acorazado')
    const t = TYPES[type]
    s.enemies.push({
      type, hp: t.hp,
      x: 26 + Math.random() * (W - 52), y: -26,
      wob: Math.random() * 10, shootT: 60 + Math.random() * 60, flash: 0
    })
  }

  const fire = s => {
    if (s.shootCool > 0) return
    const x = s.ship.x, y = s.ship.y - 14
    const dirs = s.timers.triple > 0 ? [-0.22, 0, 0.22] : [0]
    dirs.forEach(a => s.bullets.push({ x, y, vx: Math.sin(a) * 3, vy: -8.6 }))
    s.stats.disparos++
    s.shootCool = s.timers.rapido > 0 ? 5 : 10
  }

  const applyPower = (s, p) => {
    float(s, s.ship.x, s.ship.y - 26, POWERS[p].label, '#2de2e6')
    if (p === 'escudo') s.shield = true
    else if (p === 'vida') s.ship.hp = Math.min(s.ship.hp + 1, 6)
    else if (p === 'bomba') {
      // limpia las balas enemigas y golpea a toda nave en pantalla
      s.eBullets = []
      s.enemies.forEach(e => { e.hp -= 2; e.flash = 6 })
      burst(s, s.ship.x, s.ship.y, '#ffd166', 26)
    } else s.timers[p] = POWERS[p].dur
  }

  const hitShip = s => {
    if (s.ship.inv > 0) return false
    if (s.shield) {
      s.shield = false
      s.ship.inv = 80
      float(s, s.ship.x, s.ship.y - 26, 'ESCUDO ROTO', '#ff6c9f')
      burst(s, s.ship.x, s.ship.y, '#ffd166', 14)
      return false
    }
    s.ship.hp--
    s.ship.inv = 95
    burst(s, s.ship.x, s.ship.y, '#2de2e6', 24)
    if (s.ship.hp <= 0) {
      const acc = s.stats.disparos
        ? Math.round((s.stats.derribos / s.stats.disparos) * 100) : 0
      setResult({
        score: s.score, mode: s.cfg,
        stats: { derribos: s.stats.derribos, oleada: s.wave, precision: acc + '%', jefes: s.stats.jefes }
      })
      setPh('over')
      overRef.current && overRef.current(s.score, s.cfg.ranked)
      return true
    }
    return false
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
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
        'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(e.code)) e.preventDefault()
      if (p === 'over' && (e.code === 'Space' || e.code === 'Enter')) {
        if (!e.repeat && g.current) start(g.current.cfg.key)
        return
      }
      if (p !== 'run') return
      keys.current[e.code] = true
    }
    const up = e => { keys.current[e.code] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // Táctil / mouse: arrastrar mueve la nave y mantener presionado dispara
  const pointerPos = e => {
    const r = canvasRef.current.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H
    }
  }

  // ---------- Dibujo ----------
  const draw = ctx => {
    const s = g.current
    ctx.fillStyle = '#0d1220'
    ctx.fillRect(0, 0, W, H)
    // estrellas que caen lento (sensación de avance)
    ctx.fillStyle = 'rgba(233,238,255,0.25)'
    for (let i = 0; i < 60; i++) {
      const y = ((i * 173 + 7) + s.frame * (0.4 + (i % 3) * 0.3)) % H
      ctx.fillRect((i * 97 + 31) % W, y, i % 3 ? 1.5 : 2, i % 3 ? 1.5 : 2)
    }

    // partículas
    s.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life / 40)
      ctx.fillStyle = p.color
      ctx.fillRect(p.x, p.y, p.size, p.size)
    })
    ctx.globalAlpha = 1

    // power-ups
    ctx.font = '18px serif'
    ctx.textAlign = 'center'
    s.items.forEach(it => {
      ctx.globalAlpha = it.life < 120 ? (((s.frame / 6) | 0) % 2 ? 0.35 : 1) : 1
      ctx.fillText(POWERS[it.p].icon, it.x, it.y + 6)
    })
    ctx.globalAlpha = 1

    // enemigos
    s.enemies.forEach(e => {
      const t = TYPES[e.type]
      const color = e.flash > 0 ? '#ffffff' : t.color
      drawSpr(ctx, t.name + (e.flash > 0 ? 'f' : ''), t.spr,
        e.x - t.w / 2, e.y - t.h / 2, t.w, t.h, color)
    })

    // jefe con su barra de vida
    if (s.boss) {
      const b = s.boss
      drawSpr(ctx, 'bs' + (b.flash > 0 ? 'f' : ''), BOSS,
        b.x - 31, b.y - 21, 63, 42, b.flash > 0 ? '#ffffff' : '#c86bff')
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      ctx.fillRect(b.x - 30, b.y - 32, 60, 5)
      ctx.fillStyle = '#c86bff'
      ctx.fillRect(b.x - 30, b.y - 32, 60 * (b.hp / b.maxHp), 5)
    }

    // balas
    ctx.fillStyle = '#2de2e6'
    s.bullets.forEach(b => ctx.fillRect(b.x - 1.5, b.y - 5, 3, 8))
    ctx.fillStyle = '#ff6c9f'
    s.eBullets.forEach(b => {
      ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill()
    })

    // nave (parpadea si es invulnerable)
    if (!(s.ship.inv > 0 && ((s.frame / 5) | 0) % 2 === 0)) {
      drawSpr(ctx, 'sh', SHIP, s.ship.x - 13, s.ship.y - 12, 26, 24, '#2de2e6')
      // llama del motor
      if (s.frame % 3 !== 0) {
        ctx.fillStyle = '#ffd166'
        ctx.fillRect(s.ship.x - 3, s.ship.y + 12, 2.5, 4 + (s.frame % 2) * 3)
        ctx.fillRect(s.ship.x + 1, s.ship.y + 12, 2.5, 4 + ((s.frame + 1) % 2) * 3)
      }
      if (s.shield) {
        ctx.strokeStyle = 'rgba(255,209,102,0.85)'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.arc(s.ship.x, s.ship.y, 22, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // textos flotantes
    ctx.font = '700 12px "JetBrains Mono", monospace'
    s.floats.forEach(f => {
      ctx.globalAlpha = Math.min(1, f.life / 30)
      ctx.fillStyle = f.color
      ctx.fillText(f.text, f.x, f.y)
    })
    ctx.globalAlpha = 1

    // HUD: casco como barra (estilo retro), puntaje y oleada
    ctx.textAlign = 'left'
    ctx.font = '700 10px "JetBrains Mono", monospace'
    ctx.fillStyle = '#8b96c9'
    ctx.fillText('CASCO', 14, 22)
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i < s.ship.hp ? '#a8e05f' : 'rgba(255,255,255,0.12)'
      ctx.fillRect(58 + i * 13, 13, 10, 10)
    }
    ctx.textAlign = 'right'
    ctx.font = '700 15px "JetBrains Mono", monospace'
    ctx.fillStyle = '#dfe4f5'
    ctx.fillText(String(s.score).padStart(6, '0'), W - 14, 24)
    ctx.font = '700 10px "JetBrains Mono", monospace'
    ctx.fillStyle = '#8b96c9'
    ctx.fillText(`OLEADA ${s.wave}`, W - 14, 38)
    // power-ups activos
    ctx.textAlign = 'left'
    ctx.font = '14px serif'
    let px = 14
    if (s.shield) { ctx.fillText('⭐', px, 44); px += 20 }
    Object.entries(s.timers).forEach(([k, t]) => {
      if (t > 0) { ctx.fillText(POWERS[k].icon, px, 44); px += 20 }
    })
    // banner de evento
    if (s.bannerT > 0) {
      ctx.textAlign = 'center'
      ctx.font = '700 13px "JetBrains Mono", monospace'
      ctx.fillStyle = '#ffd166'
      ctx.fillText(s.banner, W / 2, 60)
    }
  }

  // ---------- Bucle principal ----------
  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d')
    if (phase === 'menu') {
      ctx.fillStyle = '#0d1220'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(233,238,255,0.25)'
      for (let i = 0; i < 60; i++) {
        ctx.fillRect((i * 97 + 31) % W, (i * 173 + 7) % H, 2, 2)
      }
      return
    }
    if (phase !== 'run') return

    let raf
    const loop = () => {
      const s = g.current
      const c = s.cfg
      s.frame++
      if (s.shootCool > 0) s.shootCool--
      if (s.ship.inv > 0) s.ship.inv--
      if (s.bannerT > 0) s.bannerT--
      Object.keys(s.timers).forEach(k => { if (s.timers[k] > 0) s.timers[k]-- })

      // nave: teclado y arrastre táctil
      const sh = s.ship
      const v = 4.6
      if (keys.current.ArrowLeft || keys.current.KeyA) sh.x -= v
      if (keys.current.ArrowRight || keys.current.KeyD) sh.x += v
      if (keys.current.ArrowUp || keys.current.KeyW) sh.y -= v * 0.8
      if (keys.current.ArrowDown || keys.current.KeyS) sh.y += v * 0.8
      if (s.pointer) {
        sh.x += (s.pointer.x - sh.x) * 0.35
        sh.y += (Math.max(SHIP_Y_MIN, s.pointer.y) - sh.y) * 0.35
      }
      sh.x = Math.max(16, Math.min(W - 16, sh.x))
      sh.y = Math.max(SHIP_Y_MIN, Math.min(SHIP_Y_MAX, sh.y))
      if (keys.current.Space || s.firing) fire(s)

      // oleadas: cada cierto tiempo sube la intensidad
      if (--s.waveT <= 0) {
        s.wave++
        s.waveT = 900
        const bonus = 100 * s.wave
        s.score += bonus
        float(s, W / 2, H / 2 - 40, `OLEADA ${s.wave} · +${bonus}`, '#2de2e6')
        // en caótico, cada 3 oleadas entra un JEFE
        if (c.events && s.wave % 3 === 0 && !s.boss) {
          s.boss = {
            x: W / 2, y: -50,
            maxHp: 30 + s.wave * 8, hp: 30 + s.wave * 8,
            atkT: 90, phase: 0, flash: 0
          }
          s.banner = '⚠ JEFE A LA VISTA'
          s.bannerT = 180
        }
      }
      const speedUp = 1 + (s.wave - 1) * 0.06

      // aparición de enemigos (con jefe en pantalla, la mitad de tropas)
      if (--s.spawnT <= 0) {
        spawnEnemy(s)
        s.spawnT = c.spawnEvery / speedUp * (0.7 + Math.random() * 0.6) * (s.boss ? 2 : 1)
      }

      // eventos del modo caótico
      if (c.events && --s.eventCool <= 0) {
        const ev = Math.random() < 0.5 ? 'enjambre' : 'meteoritos'
        s.banner = EVENTS[ev].label
        s.bannerT = 150
        if (ev === 'enjambre') {
          for (let i = 0; i < 7; i++) {
            spawnEnemy(s, 'drone')
            s.enemies[s.enemies.length - 1].y = -26 - i * 24
          }
        } else {
          for (let i = 0; i < 6; i++) {
            const t = { type: 'roca', hp: 1, x: 26 + Math.random() * (W - 52), y: -20 - i * 50, wob: Math.random() * 10, shootT: 9999, flash: 0 }
            s.enemies.push(t)
          }
        }
        s.eventCool = 600 + Math.random() * 400
      }

      // mover enemigos y disparar
      s.enemies.forEach(e => {
        if (e.flash > 0) e.flash--
        const sp = c.eSpeed * speedUp
        if (e.type === 'drone') {
          e.y += 1.5 * sp
          e.x += Math.sin(s.frame / 26 + e.wob) * 1.2
        } else if (e.type === 'caza') {
          e.y += 1.1 * sp
          e.x += Math.max(-0.8, Math.min(0.8, (sh.x - e.x) * 0.008))
        } else if (e.type === 'acorazado') {
          e.y += 0.55 * sp
          e.x += Math.sin(s.frame / 40 + e.wob) * 0.7
        } else { // roca
          e.y += 2.6 * sp
        }
        if (e.shootT !== undefined && --e.shootT <= 0 && e.y > 0 && e.y < H - 140) {
          if (e.type === 'caza') {
            s.eBullets.push({ x: e.x, y: e.y + 10, vx: 0, vy: 3.1 * c.aggro })
            e.shootT = (140 + Math.random() * 80) / c.aggro
          } else if (e.type === 'acorazado') {
            const d = Math.atan2(sh.y - e.y, sh.x - e.x)
            s.eBullets.push({ x: e.x, y: e.y + 10, vx: Math.cos(d) * 2.6 * c.aggro, vy: Math.sin(d) * 2.6 * c.aggro })
            e.shootT = (110 + Math.random() * 60) / c.aggro
          } else {
            e.shootT = 9999
          }
        }
      })
      s.enemies = s.enemies.filter(e => e.y < H + 40 && e.hp > 0)

      // ---------- Jefe (solo caótico) ----------
      if (s.boss) {
        const b = s.boss
        if (b.flash > 0) b.flash--
        // entra desde arriba y luego patrulla en zigzag
        if (b.y < 84) b.y += 1.2
        else b.x = W / 2 + Math.sin(s.frame / 58) * (W / 2 - 72)
        // ataques alternados: abanico ancho y ráfaga apuntada
        if (b.y > 20 && --b.atkT <= 0) {
          b.phase = (b.phase + 1) % 3
          if (b.phase !== 2) {
            for (let i = -2; i <= 2; i++) {
              s.eBullets.push({ x: b.x + i * 8, y: b.y + 22, vx: i * 1.15, vy: 3.3 })
            }
          } else {
            const d = Math.atan2(sh.y - b.y, sh.x - b.x)
            for (let i = 0; i < 3; i++) {
              const v = 2.6 + i * 0.55
              s.eBullets.push({ x: b.x, y: b.y + 22, vx: Math.cos(d) * v, vy: Math.sin(d) * v })
            }
          }
          b.atkT = Math.max(34, 56 - s.wave)
        }
        // balas del jugador contra el jefe
        for (const bl of s.bullets) {
          if (bl.dead) continue
          if (Math.abs(bl.x - b.x) < 31 && Math.abs(bl.y - b.y) < 22) {
            bl.dead = true
            b.hp--
            b.flash = 4
            if (b.hp <= 0) {
              const pts = 1000 + s.wave * 100
              s.score += pts
              s.stats.derribos++
              s.stats.jefes++
              float(s, b.x, b.y, `JEFE DERRIBADO · +${pts}`, '#c86bff')
              burst(s, b.x, b.y, '#c86bff', 30)
              // recompensa garantizada: dos power-ups
              s.items.push({ p: pickPower(), x: b.x - 22, y: b.y, life: 600 })
              s.items.push({ p: pickPower(), x: b.x + 22, y: b.y, life: 600 })
              s.boss = null
              break
            }
          }
        }
        s.bullets = s.bullets.filter(bl => !bl.dead)
        // chocar contra el jefe también duele
        if (s.boss && Math.abs(s.boss.x - sh.x) < 38 && Math.abs(s.boss.y - sh.y) < 28) {
          if (hitShip(s)) { draw(ctx); return }
        }
      }

      // balas
      s.bullets.forEach(b => { b.x += b.vx; b.y += b.vy })
      s.bullets = s.bullets.filter(b => b.y > -12 && b.x > -8 && b.x < W + 8)
      s.eBullets.forEach(b => { b.x += b.vx; b.y += b.vy })
      s.eBullets = s.eBullets.filter(b => b.y < H + 10 && b.y > -10 && b.x > -10 && b.x < W + 10)

      // balas del jugador vs enemigos
      s.enemies.forEach(e => {
        const t = TYPES[e.type]
        for (const b of s.bullets) {
          if (b.dead) continue
          if (Math.abs(b.x - e.x) < t.w / 2 + 2 && Math.abs(b.y - e.y) < t.h / 2 + 4) {
            b.dead = true
            e.hp--
            e.flash = 5
            if (e.hp <= 0) {
              s.stats.derribos++
              s.score += t.pts
              float(s, e.x, e.y, `+${t.pts}`)
              burst(s, e.x, e.y, t.color, 14)
              if (c.drop && Math.random() < c.drop) {
                s.items.push({ p: pickPower(), x: e.x, y: e.y, life: 600 })
              }
            }
            break
          }
        }
      })
      s.bullets = s.bullets.filter(b => !b.dead)
      s.enemies = s.enemies.filter(e => e.hp > 0)

      // power-ups caen lento
      s.items.forEach(it => { it.y += 1.1; it.life-- })
      s.items = s.items.filter(it => it.life > 0 && it.y < H + 20)
      s.items.forEach(it => {
        if (Math.abs(it.x - sh.x) < 22 && Math.abs(it.y - sh.y) < 22) {
          it.life = 0
          burst(s, it.x, it.y, '#ffd166', 10)
          applyPower(s, it.p)
        }
      })
      s.items = s.items.filter(it => it.life > 0)

      // impactos contra la nave
      let dead = false
      for (const b of s.eBullets) {
        if (Math.abs(b.x - sh.x) < 12 && Math.abs(b.y - sh.y) < 12) {
          b.dead = true
          dead = hitShip(s)
          break
        }
      }
      s.eBullets = s.eBullets.filter(b => !b.dead)
      if (!dead) {
        for (const e of s.enemies) {
          const t = TYPES[e.type]
          if (Math.abs(e.x - sh.x) < t.w / 2 + 9 && Math.abs(e.y - sh.y) < t.h / 2 + 9) {
            e.hp = 0
            burst(s, e.x, e.y, t.color, 12)
            dead = hitShip(s)
            break
          }
        }
        s.enemies = s.enemies.filter(e => e.hp > 0)
      }
      if (dead) { draw(ctx); return }

      // partículas y textos
      s.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.life-- })
      s.particles = s.particles.filter(p => p.life > 0)
      s.floats.forEach(f => { f.y -= 0.6; f.life-- })
      s.floats = s.floats.filter(f => f.life > 0)

      draw(ctx)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  return (
    <div className="ad-wrap">
      <div className="ad-stage">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="ad-canvas gx-canvas"
          onPointerDown={e => {
            e.preventDefault()
            const p = phaseRef.current
            if (p === 'run' && g.current) {
              g.current.pointer = pointerPos(e)
              g.current.firing = true
              e.currentTarget.setPointerCapture(e.pointerId)
            } else if (p === 'over' && g.current) start(g.current.cfg.key)
          }}
          onPointerMove={e => {
            if (phaseRef.current === 'run' && g.current?.firing) {
              g.current.pointer = pointerPos(e)
            }
          }}
          onPointerUp={() => {
            if (g.current) { g.current.firing = false; g.current.pointer = null }
          }}
        />

        {phase === 'menu' && (
          <div className="ad-overlay">
            <div className="ad-title mono">ESCUADRÓN GALÁCTICO</div>
            <div className="ad-modes">
              {Object.values(MODES).map(m => (
                <button key={m.key} className="ad-mode" onClick={() => start(m.key)}>
                  <span className="ad-mode-name mono">
                    {m.icon} {m.label}
                  </span>
                  <span className="ad-mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>
            <p className="ad-note mono">TODOS LOS MODOS PUNTÚAN EN EL RANKING GLOBAL</p>
          </div>
        )}

        {phase === 'pause' && (
          <div className="ad-overlay ad-dim">
            <div className="ad-title mono">PAUSA</div>
            <div className="ad-btns">
              <button className="ad-btn mono" onClick={() => setPh('run')}>REANUDAR (ESC)</button>
              <button className="ad-btn ghost mono" onClick={() => setPh('menu')}>SALIR AL MENÚ</button>
            </div>
          </div>
        )}

        {phase === 'over' && result && (
          <div className="ad-overlay ad-dim">
            <div className="ad-title mono over">GAME OVER</div>
            <div className="ad-score mono">
              {result.mode.icon} {result.mode.label} · <b>{result.score}</b> PTS
            </div>
            {!result.mode.ranked && (
              <p className="ad-note mono">ESTE MODO NO PUNTÚA EN EL RANKING</p>
            )}
            <div className="ad-stats mono">
              <span>DERRIBOS {result.stats.derribos}</span>
              <span>OLEADA {result.stats.oleada}</span>
              <span>PRECISIÓN {result.stats.precision}</span>
              {result.stats.jefes > 0 && <span>JEFES {result.stats.jefes}</span>}
            </div>
            <div className="ad-btns">
              <button className="ad-btn mono" onClick={() => start(result.mode.key)}>REINTENTAR (ESPACIO)</button>
              <button className="ad-btn ghost mono" onClick={() => setPh('menu')}>CAMBIAR MODO</button>
            </div>
          </div>
        )}
      </div>
      <div className="ad-foot mono">
        <span>← → ↑ ↓ / WASD MOVER · ESPACIO DISPARAR · ARRASTRA EN MÓVIL (DISPARA SOLO) · ESC PAUSA</span>
      </div>
    </div>
  )
}
