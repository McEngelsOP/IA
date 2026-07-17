import { useRef, useEffect, useState } from 'react'
import '../styles/AstroDefensa.css'

// ASTRO-DEFENSA · clon de Asteroids con modos, OVNIs, power-ups e hiper-salto.
// Canvas puro con rAF y estado en refs, misma estructura que DinoGame.jsx.
// SOLO el modo Normal envía puntaje al ranking (onGameOver(score, ranked)).

const W = 720, H = 600, SHIP_R = 11

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const MODES = {
  normal: {
    key: 'normal', label: 'NORMAL', icon: '🚀', ranked: true,
    lives: 3, astros0: 4, astroSpeed: 1, wobble: false,
    ufoEvery: [1000, 1600], ufoShoot: 90, ufoAim: 0.30, ufoBullet: 2.7,
    astroDrop: 0, ufoDrop: 0,
    desc: '3 vidas, sin power-ups: la experiencia clásica y balanceada. El único modo que puntúa en el ranking.'
  },
  facil: {
    key: 'facil', label: 'FÁCIL', icon: '🌟', ranked: true,
    lives: 5, astros0: 3, astroSpeed: 0.65, wobble: false,
    ufoEvery: [1800, 2600], ufoShoot: 130, ufoAim: 0.55, ufoBullet: 2.0,
    astroDrop: 0.14, ufoDrop: 0.6,
    desc: '5 vidas, asteroides lentos, OVNIs despistados y power-ups frecuentes. Para entrenar.'
  },
  caotico: {
    key: 'caotico', label: 'CAÓTICO', icon: '🔥', ranked: true,
    lives: 3, astros0: 6, astroSpeed: 1.5, wobble: true,
    ufoEvery: [380, 700], ufoShoot: 55, ufoAim: 0.10, ufoBullet: 3.3,
    astroDrop: 0, ufoDrop: 0.9,
    desc: 'Lluvia de asteroides erráticos y OVNIs certeros. Los power-ups (solo de OVNIs) son tu única salida.'
  }
}

const POWERS = {
  escudo: { icon: '⭐', label: 'ESCUDO' },
  rapido: { icon: '⚡', label: 'DISPARO RÁPIDO', dur: 480 },
  triple: { icon: '🌀', label: 'DISPARO EXPANSIVO', dur: 480 },
  bomba: { icon: '💥', label: 'BOMBA DE PLASMA' },
  vida: { icon: '❤️', label: 'VIDA EXTRA' }
}

// la bomba y la vida extra son raras
const pickPower = () => {
  const r = Math.random()
  if (r < 0.28) return 'escudo'
  if (r < 0.55) return 'rapido'
  if (r < 0.82) return 'triple'
  if (r < 0.94) return 'bomba'
  return 'vida'
}

const ASTRO_PTS = [0, 100, 50, 20] // por tamaño (1 pequeño · 2 mediano · 3 grande)

class Vec {
  constructor(x, y) { this.x = x; this.y = y }
  add(v) { return new Vec(this.x + v.x, this.y + v.y) }
  sub(v) { return new Vec(this.x - v.x, this.y - v.y) }
  scale(s) { return new Vec(this.x * s, this.y * s) }
  lenSq() { return this.x * this.x + this.y * this.y }
}

const wrap = (p, r) => {
  if (p.x < -r) p.x = W + r
  if (p.x > W + r) p.x = -r
  if (p.y < -r) p.y = H + r
  if (p.y > H + r) p.y = -r
}

export default function AstroDefensa({ onGameOver }) {
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
    ship: { p: new Vec(W / 2, H / 2), v: new Vec(0, 0), a: -Math.PI / 2, inv: 0 },
    bullets: [], ufoBullets: [], asteroids: [], ufos: [], items: [],
    particles: [], floats: [],
    frame: 0, score: 0, level: 1, lives: cfg.lives,
    shootCool: 0, hyperCool: 0, nextLifeAt: 10000,
    nextUfo: cfg.ufoEvery[0] + Math.random() * (cfg.ufoEvery[1] - cfg.ufoEvery[0]),
    shield: false, timers: { rapido: 0, triple: 0 },
    stats: { rocas: 0, ovnis: 0 }
  })

  const createAsteroid = (s, p, size) => {
    const speed = (0.5 + Math.random() * 0.9) * s.cfg.astroSpeed * (1 + (s.level - 1) * 0.08)
    const dir = Math.random() * Math.PI * 2
    const a = {
      p, v: new Vec(Math.cos(dir) * speed, Math.sin(dir) * speed),
      a: Math.random() * Math.PI * 2,
      rot: (Math.random() - 0.5) * 0.03,
      size, radius: size * 18, verts: []
    }
    const n = 8 + ((Math.random() * 5) | 0)
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2
      const r = a.radius * (0.75 + Math.random() * 0.4)
      a.verts.push(new Vec(Math.cos(ang) * r, Math.sin(ang) * r))
    }
    return a
  }

  const spawnWave = (s, count) => {
    for (let i = 0; i < count; i++) {
      let p
      do {
        p = new Vec(Math.random() * W, Math.random() * H)
      } while (p.sub(s.ship.p).lenSq() < 180 * 180) // nunca encima de la nave
      s.asteroids.push(createAsteroid(s, p, 3))
    }
  }

  const spawnUfo = s => {
    // el pequeño (1000 pts) aparece más conforme subes de nivel
    const big = Math.random() > Math.min(0.25 + s.level * 0.07, 0.6)
    const fromLeft = Math.random() < 0.5
    const y = 60 + Math.random() * (H - 160)
    s.ufos.push({
      big, baseY: y,
      p: new Vec(fromLeft ? -30 : W + 30, y),
      vx: (fromLeft ? 1 : -1) * (big ? 1.3 : 2.4),
      wob: Math.random() * 10,
      shootT: 50, r: big ? 22 : 13
    })
  }

  const start = modeKey => {
    const s = init(MODES[modeKey])
    spawnWave(s, s.cfg.astros0)
    g.current = s
    setResult(null)
    setPh('run')
  }

  const burst = (s, x, y, color, n = 12) => {
    if (REDUCED) n = Math.min(n, 4)
    for (let i = 0; i < n && s.particles.length < 160; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 0.6 + Math.random() * 2.6
      s.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 24 + Math.random() * 18, color, size: 1.5 + Math.random() * 2.5
      })
    }
  }

  const float = (s, x, y, text, color = '#ffd166') =>
    s.floats.push({ x, y, text, color, life: 60 })

  const addScore = (s, pts, x, y) => {
    s.score += pts
    if (x !== undefined) float(s, x, y, `+${pts}`)
    if (s.score >= s.nextLifeAt) {
      s.lives = Math.min(s.lives + 1, 6)
      float(s, s.ship.p.x, s.ship.p.y - 30, '+1 VIDA ❤️', '#ff6c9f')
      s.nextLifeAt += 10000
    }
  }

  const fire = s => {
    if (s.shootCool > 0) return
    const sh = s.ship
    const nose = sh.p.add(new Vec(Math.cos(sh.a), Math.sin(sh.a)).scale(SHIP_R + 2))
    const angles = s.timers.triple > 0 ? [-0.26, 0, 0.26] : [0]
    angles.forEach(off => {
      s.bullets.push({
        p: nose,
        v: new Vec(Math.cos(sh.a + off), Math.sin(sh.a + off)).scale(8),
        life: 70
      })
    })
    s.shootCool = s.timers.rapido > 0 ? 5 : 11
  }

  const hyperJump = s => {
    if (s.hyperCool > 0) return
    burst(s, s.ship.p.x, s.ship.p.y, '#7b5cd6', 14)
    // aparición aleatoria: es un escape de emergencia, SIN invulnerabilidad
    s.ship.p = new Vec(40 + Math.random() * (W - 80), 40 + Math.random() * (H - 80))
    s.ship.v = s.ship.v.scale(0.25)
    burst(s, s.ship.p.x, s.ship.p.y, '#2de2e6', 14)
    s.hyperCool = 240
  }

  const applyPower = (s, p) => {
    float(s, s.ship.p.x, s.ship.p.y - 26, POWERS[p].label, '#2de2e6')
    if (p === 'escudo') s.shield = true
    else if (p === 'vida') s.lives = Math.min(s.lives + 1, 6)
    else if (p === 'bomba') {
      // destruye todos los asteroides (no a los OVNIs) y da sus puntos
      let pts = 0
      s.asteroids.forEach(a => {
        pts += ASTRO_PTS[a.size]
        s.stats.rocas++
        burst(s, a.p.x, a.p.y, '#b7c0e8', 8)
      })
      s.asteroids = []
      if (pts) addScore(s, pts, s.ship.p.x, s.ship.p.y - 44)
    } else s.timers[p] = POWERS[p].dur
  }

  const dropItem = (s, x, y, chance) => {
    if (Math.random() >= chance) return
    s.items.push({ p: pickPower(), x, y, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, life: 620 })
  }

  // el golpe puede venir de un asteroide, un OVNI o una bala enemiga
  const hitShip = s => {
    if (s.shield) {
      s.shield = false
      s.ship.inv = 70
      float(s, s.ship.p.x, s.ship.p.y - 26, 'ESCUDO ROTO', '#ff6c9f')
      burst(s, s.ship.p.x, s.ship.p.y, '#ffd166', 14)
      return false
    }
    s.lives--
    burst(s, s.ship.p.x, s.ship.p.y, '#2de2e6', 26)
    if (s.lives <= 0) {
      const res = {
        score: s.score, mode: s.cfg,
        stats: { ...s.stats, nivel: s.level }
      }
      setResult(res)
      setPh('over')
      overRef.current && overRef.current(s.score, s.cfg.ranked)
      return true
    }
    s.ship.p = new Vec(W / 2, H / 2)
    s.ship.v = new Vec(0, 0)
    s.ship.a = -Math.PI / 2
    s.ship.inv = 150
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
        'KeyA', 'KeyD', 'KeyW'].includes(e.code)) e.preventDefault()
      if (p === 'over' && (e.code === 'Space' || e.code === 'Enter')) {
        if (!e.repeat && g.current) start(g.current.cfg.key)
        return
      }
      if (p !== 'run') return
      keys.current[e.code] = true
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!e.repeat && g.current) hyperJump(g.current)
      }
    }
    const up = e => { keys.current[e.code] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ---------- Dibujo ----------
  const drawShip = (ctx, s) => {
    const sh = s.ship
    if (sh.inv > 0 && ((s.frame / 5) | 0) % 2 === 0) return // parpadeo invulnerable
    ctx.save()
    ctx.translate(sh.p.x, sh.p.y)
    ctx.rotate(sh.a)
    ctx.strokeStyle = '#2de2e6'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(SHIP_R + 2, 0)
    ctx.lineTo(-SHIP_R, -SHIP_R * 0.85)
    ctx.lineTo(-SHIP_R * 0.5, 0)
    ctx.lineTo(-SHIP_R, SHIP_R * 0.85)
    ctx.closePath()
    ctx.stroke()
    // llama del propulsor
    if ((keys.current.ArrowUp || keys.current.KeyW) && s.frame % 3 !== 0) {
      ctx.strokeStyle = '#ffd166'
      ctx.beginPath()
      ctx.moveTo(-SHIP_R * 0.7, -4)
      ctx.lineTo(-SHIP_R - 7, 0)
      ctx.lineTo(-SHIP_R * 0.7, 4)
      ctx.stroke()
    }
    ctx.restore()
    if (s.shield) {
      ctx.strokeStyle = 'rgba(255,209,102,0.85)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(sh.p.x, sh.p.y, SHIP_R + 10, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  const draw = ctx => {
    const s = g.current
    ctx.fillStyle = '#0d1220'
    ctx.fillRect(0, 0, W, H)
    // estrellas fijas (deterministas, no parpadean al azar)
    ctx.fillStyle = 'rgba(233,238,255,0.22)'
    for (let i = 0; i < 70; i++) {
      ctx.fillRect((i * 97 + 31) % W, (i * 173 + 7) % H, i % 3 ? 1.5 : 2, i % 3 ? 1.5 : 2)
    }

    // partículas
    s.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life / 42)
      ctx.fillStyle = p.color
      ctx.fillRect(p.x, p.y, p.size, p.size)
    })
    ctx.globalAlpha = 1

    // power-ups flotantes
    ctx.font = '20px serif'
    ctx.textAlign = 'center'
    s.items.forEach(it => {
      ctx.globalAlpha = it.life < 120 ? (((s.frame / 6) | 0) % 2 ? 0.35 : 1) : 1
      ctx.fillText(POWERS[it.p].icon, it.x, it.y + 7)
    })
    ctx.globalAlpha = 1

    // asteroides
    ctx.strokeStyle = '#b7c0e8'
    ctx.lineWidth = 1.5
    s.asteroids.forEach(a => {
      ctx.save()
      ctx.translate(a.p.x, a.p.y)
      ctx.rotate(a.a)
      ctx.beginPath()
      ctx.moveTo(a.verts[0].x, a.verts[0].y)
      for (let i = 1; i < a.verts.length; i++) ctx.lineTo(a.verts[i].x, a.verts[i].y)
      ctx.closePath()
      ctx.stroke()
      ctx.restore()
    })

    // OVNIs (dos ovalos con cúpula)
    s.ufos.forEach(u => {
      ctx.save()
      ctx.translate(u.p.x, u.p.y)
      ctx.strokeStyle = u.big ? '#ffd166' : '#ff6c9f'
      ctx.lineWidth = 1.8
      const r = u.r
      ctx.beginPath()
      ctx.ellipse(0, 0, r, r * 0.42, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.ellipse(0, -r * 0.34, r * 0.45, r * 0.32, 0, Math.PI, 0)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-r, 0); ctx.lineTo(r, 0)
      ctx.stroke()
      ctx.restore()
    })

    // balas
    ctx.fillStyle = '#2de2e6'
    s.bullets.forEach(b => {
      ctx.beginPath(); ctx.arc(b.p.x, b.p.y, 2.4, 0, Math.PI * 2); ctx.fill()
    })
    ctx.fillStyle = '#ff6c9f'
    s.ufoBullets.forEach(b => {
      ctx.beginPath(); ctx.arc(b.p.x, b.p.y, 3, 0, Math.PI * 2); ctx.fill()
    })

    drawShip(ctx, s)

    // textos flotantes
    ctx.font = '700 12px "JetBrains Mono", monospace'
    s.floats.forEach(f => {
      ctx.globalAlpha = Math.min(1, f.life / 30)
      ctx.fillStyle = f.color
      ctx.fillText(f.text, f.x, f.y)
    })
    ctx.globalAlpha = 1

    // HUD
    ctx.font = '700 18px "JetBrains Mono", monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#dfe4f5'
    ctx.fillText(String(s.score).padStart(6, '0'), 20, 32)
    ctx.font = '700 11px "JetBrains Mono", monospace'
    ctx.fillStyle = '#8b96c9'
    ctx.fillText(`NIVEL ${s.level}`, 20, 50)
    // power-ups activos
    ctx.font = '15px serif'
    let px = 20
    if (s.shield) { ctx.fillText('⭐', px, 72); px += 22 }
    Object.entries(s.timers).forEach(([k, t]) => {
      if (t > 0) { ctx.fillText(POWERS[k].icon, px, 72); px += 22 }
    })
    // hiper-salto
    ctx.font = '700 10px "JetBrains Mono", monospace'
    ctx.fillStyle = s.hyperCool > 0 ? 'rgba(139,150,201,0.45)' : '#7b5cd6'
    ctx.fillText(s.hyperCool > 0 ? 'HIPER-SALTO RECARGANDO…' : 'SHIFT · HIPER-SALTO LISTO', 20, H - 16)
    // vidas como navecitas
    for (let i = 0; i < s.lives; i++) {
      ctx.save()
      ctx.translate(W - 26 - i * 24, 26)
      ctx.rotate(-Math.PI / 2)
      ctx.strokeStyle = '#dfe4f5'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-3, 0); ctx.lineTo(-6, 7)
      ctx.closePath()
      ctx.stroke()
      ctx.restore()
    }
  }

  // ---------- Bucle principal ----------
  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d')
    if (phase === 'menu') {
      // fondo estático para el menú (pausa y game over congelan la partida)
      ctx.fillStyle = '#0d1220'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = 'rgba(233,238,255,0.22)'
      for (let i = 0; i < 70; i++) {
        ctx.fillRect((i * 97 + 31) % W, (i * 173 + 7) % H, 2, 2)
      }
      return
    }
    if (phase !== 'run') return

    let raf
    const loop = () => {
      const s = g.current
      s.frame++
      if (s.shootCool > 0) s.shootCool--
      if (s.hyperCool > 0) s.hyperCool--
      if (s.ship.inv > 0) s.ship.inv--
      Object.keys(s.timers).forEach(k => { if (s.timers[k] > 0) s.timers[k]-- })

      // nave: rotar, acelerar (con inercia), disparo sostenido
      const sh = s.ship
      if (keys.current.ArrowLeft || keys.current.KeyA) sh.a -= 0.075
      if (keys.current.ArrowRight || keys.current.KeyD) sh.a += 0.075
      if (keys.current.ArrowUp || keys.current.KeyW) {
        sh.v = sh.v.add(new Vec(Math.cos(sh.a), Math.sin(sh.a)).scale(0.11))
        if (sh.v.lenSq() > 36) sh.v = sh.v.scale(6 / Math.sqrt(sh.v.lenSq()))
        if (!REDUCED && s.frame % 4 === 0) {
          burst(s, sh.p.x - Math.cos(sh.a) * SHIP_R, sh.p.y - Math.sin(sh.a) * SHIP_R, 'rgba(255,209,102,0.8)', 1)
        }
      }
      if (keys.current.Space) fire(s)
      sh.v = sh.v.scale(0.988)
      sh.p = sh.p.add(sh.v)
      wrap(sh.p, SHIP_R)

      // oleada limpia → bonus y siguiente nivel
      if (s.asteroids.length === 0) {
        const bonus = 100 * s.level
        addScore(s, bonus)
        float(s, W / 2, H / 2 - 40, `OLEADA ${s.level} LIMPIA · +${bonus}`, '#2de2e6')
        s.level++
        spawnWave(s, Math.min(s.cfg.astros0 + s.level - 1, 11))
      }

      // OVNIs: aparición, vuelo ondulado y disparo al jugador
      if (--s.nextUfo <= 0) {
        spawnUfo(s)
        const [a, b] = s.cfg.ufoEvery
        s.nextUfo = a + Math.random() * (b - a)
      }
      s.ufos.forEach(u => {
        u.p.x += u.vx
        u.p.y = u.baseY + Math.sin(s.frame / 42 + u.wob) * 26
        if (--u.shootT <= 0) {
          const dir = Math.atan2(sh.p.y - u.p.y, sh.p.x - u.p.x)
            + (Math.random() - 0.5) * 2 * s.cfg.ufoAim
          s.ufoBullets.push({
            p: new Vec(u.p.x, u.p.y),
            v: new Vec(Math.cos(dir), Math.sin(dir)).scale(s.cfg.ufoBullet),
            life: 260
          })
          u.shootT = s.cfg.ufoShoot + Math.random() * 40
        }
      })
      s.ufos = s.ufos.filter(u => u.p.x > -60 && u.p.x < W + 60)

      // proyectiles
      s.bullets.forEach(b => { b.p = b.p.add(b.v); wrap(b.p, 2); b.life-- })
      s.bullets = s.bullets.filter(b => b.life > 0)
      s.ufoBullets.forEach(b => { b.p = b.p.add(b.v); b.life-- })
      s.ufoBullets = s.ufoBullets.filter(b =>
        b.life > 0 && b.p.x > -10 && b.p.x < W + 10 && b.p.y > -10 && b.p.y < H + 10)

      // asteroides (en caótico dan bandazos impredecibles)
      s.asteroids.forEach(a => {
        if (s.cfg.wobble && s.frame % 90 === 0 && Math.random() < 0.4) {
          const j = (Math.random() - 0.5) * 0.8
          a.v = new Vec(a.v.x + j, a.v.y - j)
        }
        a.p = a.p.add(a.v)
        a.a += a.rot
        wrap(a.p, a.radius)
      })

      // power-ups flotando
      s.items.forEach(it => { it.x += it.vx; it.y += it.vy; it.life-- })
      s.items = s.items.filter(it => it.life > 0)

      // balas del jugador vs asteroides
      const nextAstros = []
      s.asteroids.forEach(a => {
        let hit = false
        for (const b of s.bullets) {
          if (b.life <= 0) continue
          if (a.p.sub(b.p).lenSq() < a.radius * a.radius) { hit = true; b.life = 0; break }
        }
        if (hit) {
          s.stats.rocas++
          addScore(s, ASTRO_PTS[a.size], a.p.x, a.p.y)
          burst(s, a.p.x, a.p.y, '#b7c0e8', 8)
          dropItem(s, a.p.x, a.p.y, s.cfg.astroDrop)
          if (a.size > 1) {
            nextAstros.push(createAsteroid(s, new Vec(a.p.x, a.p.y), a.size - 1))
            nextAstros.push(createAsteroid(s, new Vec(a.p.x, a.p.y), a.size - 1))
          }
        } else nextAstros.push(a)
      })
      s.asteroids = nextAstros
      s.bullets = s.bullets.filter(b => b.life > 0)

      // balas del jugador vs OVNIs
      s.ufos.forEach(u => {
        for (const b of s.bullets) {
          if (b.life <= 0) continue
          if (u.p.sub(b.p).lenSq() < u.r * u.r) {
            b.life = 0
            u.dead = true
            s.stats.ovnis++
            addScore(s, u.big ? 300 : 1000, u.p.x, u.p.y)
            burst(s, u.p.x, u.p.y, u.big ? '#ffd166' : '#ff6c9f', 16)
            dropItem(s, u.p.x, u.p.y, s.cfg.ufoDrop)
            break
          }
        }
      })
      s.ufos = s.ufos.filter(u => !u.dead)
      s.bullets = s.bullets.filter(b => b.life > 0)

      // recoger power-ups
      s.items.forEach(it => {
        if (sh.p.sub(new Vec(it.x, it.y)).lenSq() < 26 * 26) {
          it.life = 0
          burst(s, it.x, it.y, '#ffd166', 10)
          applyPower(s, it.p)
        }
      })
      s.items = s.items.filter(it => it.life > 0)

      // impactos contra la nave
      if (sh.inv <= 0) {
        let dead = false
        for (const a of s.asteroids) {
          if (a.p.sub(sh.p).lenSq() < Math.pow(a.radius + SHIP_R * 0.8, 2)) {
            dead = hitShip(s); break
          }
        }
        if (!dead && sh.inv <= 0) {
          for (const u of s.ufos) {
            if (u.p.sub(sh.p).lenSq() < Math.pow(u.r + SHIP_R * 0.8, 2)) {
              dead = hitShip(s); break
            }
          }
        }
        if (!dead && sh.inv <= 0) {
          for (const b of s.ufoBullets) {
            if (b.p.sub(sh.p).lenSq() < Math.pow(SHIP_R * 0.9 + 3, 2)) {
              b.life = 0
              dead = hitShip(s); break
            }
          }
        }
        if (dead) { draw(ctx); return }
      }

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
          className="ad-canvas"
          onPointerDown={e => {
            e.preventDefault()
            const p = phaseRef.current
            if (p === 'run' && g.current) fire(g.current)
            else if (p === 'over' && g.current) start(g.current.cfg.key)
          }}
        />

        {phase === 'menu' && (
          <div className="ad-overlay">
            <div className="ad-title mono">ASTRO-DEFENSA</div>
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
              <span>NIVEL {result.stats.nivel}</span>
              <span>ASTEROIDES {result.stats.rocas}</span>
              <span>OVNIS {result.stats.ovnis}</span>
            </div>
            <div className="ad-btns">
              <button className="ad-btn mono" onClick={() => start(result.mode.key)}>REINTENTAR (ESPACIO)</button>
              <button className="ad-btn ghost mono" onClick={() => setPh('menu')}>CAMBIAR MODO</button>
            </div>
          </div>
        )}
      </div>
      <div className="ad-foot mono">
        <span>← → / A D ROTAR · ↑ / W ACELERAR · ESPACIO O CLIC DISPARAR · SHIFT HIPER-SALTO · ESC PAUSA</span>
      </div>
    </div>
  )
}
