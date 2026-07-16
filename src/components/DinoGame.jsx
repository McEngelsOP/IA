import { useRef, useEffect, useState } from 'react'

// DINO RUN+ · versión propia del dinosaurio de Chrome con modos de juego.
// Canvas puro con requestAnimationFrame; el estado del juego vive en un ref
// para no re-renderizar React 60 veces por segundo. Los menús (selección de
// modo, pausa, game over) son overlays HTML encima del canvas.
// SOLO el modo Clásico envía puntaje al ranking global (onGameOver(sc, ranked)).

const W = 720, H = 240, GROUND = 198, DINO_X = 48

// Paletas día/noche (se alternan cada 700 puntos)
const PAL = {
  noche: {
    bg: '#121830', ground: '#3a4568', text: '#8b96c9', dino: '#2de2e6',
    dinoDuck: '#25bfc2', cactus: '#ff6c9f', bird: '#ffd166', rock: '#c9a37e',
    meteor: '#ff9f43', star: 'rgba(233,238,255,0.5)'
  },
  dia: {
    bg: '#26335e', ground: '#5a68a3', text: '#b7c0e8', dino: '#2de2e6',
    dinoDuck: '#25bfc2', cactus: '#ff6c9f', bird: '#ffd166', rock: '#c9a37e',
    meteor: '#ff9f43', star: 'transparent'
  }
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
    ...BASE, key: 'facil', label: 'FÁCIL', icon: '🌵', ranked: false, powers: true,
    speed0: 5, maxSpeed: 9.5, accel: 3400, jumpV: -13.2, grav: 0.55, pad: 8,
    spawnMin: 340, spawnRng: 430, birdFrom: 5200,
    desc: 'Más lento, saltos más largos y menos obstáculos. Con power-ups.'
  },
  dificil: {
    ...BASE, key: 'dificil', label: 'DIFÍCIL', icon: '🔥', ranked: false, powers: true,
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
  turbo: { icon: '⚡', label: 'TURBO', dur: 330 },
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
    timers: { turbo: 0, lento: 0, x2: 0, pluma: 0 },
    event: null, eventT: 0, eventCool: 500 + Math.random() * 400, wind: 0,
    airDodges: 0, particles: [], floats: [], shakeT: 0,
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
          if (s.y < GROUND) { s.vy += 12.0; s.stats.fastFalls++ } // Fast Fall
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
  const spawn = s => {
    const c = s.cfg
    const roll = Math.random()
    if (c.birds && s.dist > c.birdFrom && roll < 0.26) {
      const ys = [GROUND - 22, GROUND - 52, GROUND - 86]
      s.obstacles.push({ kind: 'bird', x: W + 40, y: ys[(Math.random() * 3) | 0], w: 34, h: 18 })
    } else if (c.rocks && roll < 0.42) {
      // roca baja: salto corto y rápido
      s.obstacles.push({ kind: 'rock', x: W + 40, y: GROUND - 16, w: 22, h: 16 })
    } else if (c.tall && roll < 0.58) {
      // cactus alto: exige salto preciso
      const h = 56 + ((Math.random() * 10) | 0)
      s.obstacles.push({ kind: 'cactus', x: W + 40, y: GROUND - h, w: 16, h })
    } else {
      // grupo de cactus (triples solo en difícil/caótico)
      const max = c.triple ? 3 : 2
      const n = 1 + ((Math.random() * max) | 0)
      let x = W + 40
      for (let i = 0; i < n; i++) {
        const h = 28 + ((Math.random() * 20) | 0)
        s.obstacles.push({ kind: 'cactus', x, y: GROUND - h, w: 14, h })
        x += 16
      }
    }
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
  const drawDino = (ctx, s, pal, dead) => {
    const f = ((s.frame / 6) | 0) % 2
    const blink = s.invT > 0 && ((s.frame / 4) | 0) % 2 === 0
    if (blink) return
    ctx.fillStyle = s.ducking && s.y >= GROUND ? pal.dinoDuck : pal.dino
    if (s.ducking && s.y >= GROUND) {
      ctx.fillRect(DINO_X, GROUND - 24, 40, 16)
      ctx.fillRect(DINO_X + 36, GROUND - 30, 16, 12)
      ctx.fillRect(DINO_X - 8, GROUND - 20, 10, 6)
      ctx.fillRect(DINO_X + 6 + (f ? 14 : 0), GROUND - 8, 8, 8)
    } else {
      const y = s.y
      ctx.fillRect(DINO_X + 4, y - 40, 22, 22)
      ctx.fillRect(DINO_X + 16, y - 52, 18, 16)
      ctx.fillRect(DINO_X - 6, y - 34, 12, 8)
      ctx.fillRect(DINO_X + 18, y - 32, 12, 5)
      if (y >= GROUND) {
        ctx.fillRect(DINO_X + 6 + (f ? 0 : 12), y - 18, 8, 18)
        ctx.fillRect(DINO_X + 6 + (f ? 12 : 0), y - 18, 8, 12)
      } else {
        ctx.fillRect(DINO_X + 8, y - 18, 8, 14)
        ctx.fillRect(DINO_X + 18, y - 18, 8, 14)
      }
      ctx.fillStyle = '#0d1220'
      if (dead) {
        ctx.fillRect(DINO_X + 24, y - 48, 2, 6)
        ctx.fillRect(DINO_X + 22, y - 46, 6, 2)
      } else {
        ctx.fillRect(DINO_X + 25, y - 47, 3, 3)
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
    const pal = ((sc / 700) | 0) % 2 === 1 ? PAL.dia : PAL.noche

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
      ctx.fillStyle = '#dfe4f5'
      ctx.beginPath(); ctx.arc(W - 90, 44, 12, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = pal.bg
      ctx.beginPath(); ctx.arc(W - 96, 40, 10, 0, Math.PI * 2); ctx.fill()
    } else {
      ctx.fillStyle = '#ffd166'
      ctx.beginPath(); ctx.arc(W - 90, 44, 13, 0, Math.PI * 2); ctx.fill()
    }

    // suelo
    ctx.fillStyle = pal.ground
    ctx.fillRect(0, GROUND + 2, W, 2)
    const off = -(s.dist % 28)
    for (let x = off; x < W; x += 28) ctx.fillRect(x, GROUND + 8, 12, 2)

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

    // obstáculos
    s.obstacles.forEach(o => {
      if (o.kind === 'bird') {
        ctx.fillStyle = pal.bird
        const flap = ((s.frame / 8) | 0) % 2
        ctx.fillRect(o.x, o.y + 6, o.w, 6)
        ctx.fillRect(o.x + 22, o.y + 2, 10, 6)
        ctx.fillRect(o.x + 8, o.y + (flap ? -4 : 10), 12, 6)
      } else if (o.kind === 'rock') {
        ctx.fillStyle = pal.rock
        ctx.fillRect(o.x + 2, o.y + 4, o.w - 4, o.h - 4)
        ctx.fillRect(o.x + 6, o.y, o.w - 12, 4)
      } else if (o.kind === 'meteor') {
        ctx.fillStyle = pal.meteor
        ctx.fillRect(o.x, o.y, o.w, o.h)
        ctx.fillStyle = 'rgba(255,159,67,0.4)'
        ctx.fillRect(o.x + 4, o.y - 10, o.w - 8, 10)
        if (o.y < 40) { // aviso de dónde caerá
          ctx.fillStyle = pal.meteor
          ctx.font = '700 14px "JetBrains Mono", monospace'
          ctx.fillText('!', o.x + o.w / 2, 16)
          ctx.font = '20px serif'
        }
      } else {
        ctx.fillStyle = pal.cactus
        ctx.fillRect(o.x + 4, o.y, o.w - 8, o.h)
        ctx.fillRect(o.x, o.y + 8, 4, 6)
        ctx.fillRect(o.x + o.w - 4, o.y + 12, 4, 6)
      }
    })

    drawDino(ctx, s, pal, false)

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
      const grd = ctx.createRadialGradient(DINO_X + 14, s.y - 26, 55, DINO_X + 14, s.y - 26, 200)
      grd.addColorStop(0, 'rgba(5,8,18,0)')
      grd.addColorStop(1, 'rgba(5,8,18,0.98)')
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
      ctx.fillStyle = '#ffd166'
      ctx.fillText(EVENTS[s.event].label, W / 2, 28)
    }
    if (s.cfg.zen) {
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(139,150,201,0.6)'
      ctx.fillText('MODO ZEN', W / 2, H - 14)
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
      const turbo = s.timers.turbo > 0 ? 1.4 : 1
      const speed = Math.min(s.cfg.maxSpeed, s.cfg.speed0 + s.dist / s.cfg.accel) * turbo
      const eff = speed * ts
      s.dist += eff
      s.pts += (eff / 10) * (s.timers.x2 > 0 ? 2 : 1) * (turbo > 1 ? 1.3 : 1)
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
            life: 22, color: s.event === 'tormenta' ? '#d6b26e' : 'rgba(255,255,255,0.5)',
            size: s.event === 'tormenta' ? 2 : 1.5
          })
        }
      }

      // física del salto (el viento empuja un poco en el aire)
      if (s.y < GROUND || s.vy < 0) {
        s.vy += s.cfg.grav * ts
        if (s.wind && s.y < GROUND) s.vy += s.wind * 0.02
        s.y = Math.min(GROUND, s.y + s.vy * ts)
        if (s.y >= GROUND) {
          s.vy = 0
          burst(s, DINO_X + 10, GROUND, 'rgba(139,150,201,0.7)', 4)
          // combo: obstáculos esquivados sin tocar el suelo
          if (s.airDodges >= 2) {
            const bonus = s.airDodges * 15
            s.pts += bonus
            float(s, DINO_X + 40, s.y - 70, `COMBO x${s.airDodges} +${bonus}`, '#ffd166')
          }
          s.airDodges = 0
        }
      }

      // obstáculos: aparecer, mover, marcar esquivados
      s.nextIn -= eff
      if (s.nextIn <= 0) {
        spawn(s)
        s.nextIn = s.cfg.spawnMin + Math.random() * s.cfg.spawnRng
      }
      s.obstacles.forEach(o => {
        if (o.kind === 'meteor') {
          o.x += o.vx * ts
          o.y += o.vy * ts
          if (o.y + o.h >= GROUND + 2) {
            o.dead = true
            burst(s, o.x + 8, GROUND, PAL.noche.meteor, 12)
            s.shakeT = Math.max(s.shakeT, 6)
          }
        } else {
          // el viento acerca (>0) o aleja (<0) los obstáculos
          o.x -= (eff * (o.kind === 'bird' ? 1.15 : 1)) + s.wind * ts
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
          float(s, it.x, it.y, POWERS[it.p].label, '#2de2e6')
          if (it.p === 'escudo') s.shield = true
          else s.timers[it.p] = POWERS[it.p].dur
        }
      })
      s.items = s.items.filter(it => !it.dead && it.x > -40)

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
            burst(s, DINO_X + 14, s.y - 26, PAL.noche.dino, 22)
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
                    {m.ranked && <span className="dg-rank-tag mono">🏆 RANKING</span>}
                  </span>
                  <span className="dg-mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>
            <p className="dg-note mono">SOLO EL MODO CLÁSICO ENVÍA TU PUNTAJE AL RANKING GLOBAL</p>
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
