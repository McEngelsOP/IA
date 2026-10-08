// ---------- Layout (idéntico al HTML original) ----------
export const NODE_W = 200, NODE_H = 58, COL_GAP = 88, ROW_GAP = 18, TOP = 68, LEFT = 26
export const COL_W = NODE_W + COL_GAP

// Calcula el grafo y las posiciones de una malla; se hace una sola vez por carrera
export function buildMalla(carrera) {
  const cursos = carrera.cursos.map(c => ({ ...c }))
  const byId = {}
  cursos.forEach(c => (byId[c.id] = c))

  const unlocks = {}
  const edges = []
  cursos.forEach(c =>
    c.r.forEach(req => {
      ;(unlocks[req] = unlocks[req] || []).push(c.id)
      edges.push({ from: req, to: c.id })
    })
  )

  // minC: primer ciclo de la malla (0 en ESAN por la pre-formación, 1 en PUCP);
  // las columnas se normalizan para no dejar una franja vacía a la izquierda
  const minC = Math.min(...cursos.map(c => c.c))

  // Orden dentro de cada ciclo: heurística de baricentro (Sugiyama) para que
  // las líneas se crucen lo menos posible. Cada curso se acomoda cerca del
  // promedio vertical de sus requisitos (pasada →) y de los cursos que abre
  // (pasada ←); los cursos sin conexiones caen al fondo de su columna.
  const cols = {}
  cursos.forEach(c => (cols[c.c] = cols[c.c] || []).push(c))
  const colKeys = Object.keys(cols).map(Number).sort((a, b) => a - b)
  const pos = {}
  colKeys.forEach(k => cols[k].forEach((c, i) => (pos[c.id] = i)))
  const suelto = c => c.r.length === 0 && !(unlocks[c.id]?.length)

  const ordenarCol = (k, vecinos) => {
    const keyed = cols[k].map((c, i) => {
      const ps = vecinos(c).map(id => pos[id]).filter(p => p !== undefined)
      const key = ps.length
        ? ps.reduce((a, b) => a + b, 0) / ps.length
        : suelto(c) ? 999 + i : pos[c.id]
      return { c, key, i }
    })
    keyed.sort((a, b) => a.key - b.key || a.i - b.i)
    keyed.forEach((x, i) => (pos[x.c.id] = i))
    cols[k] = keyed.map(x => x.c)
  }

  for (let pasada = 0; pasada < 4; pasada++) {
    colKeys.forEach(k => ordenarCol(k, c => c.r))
    ;[...colKeys].reverse().forEach(k => ordenarCol(k, c => unlocks[c.id] || []))
  }

  let maxRows = 0
  colKeys.forEach(k => {
    maxRows = Math.max(maxRows, cols[k].length)
    cols[k].forEach((c, i) => {
      c.row = i
      c.x = LEFT + (c.c - minC) * COL_W
      c.y = TOP + i * (NODE_H + ROW_GAP)
    })
  })
  const numCols = Math.max(...cursos.map(c => c.c)) - minC + 1
  const W = LEFT * 2 + numCols * COL_W - COL_GAP
  const H = TOP + maxRows * (NODE_H + ROW_GAP) + 26

  return { ...carrera, cursos, byId, unlocks, edges, W, H, minC }
}

export function bfs(startId, adj) {
  const seen = new Set()
  const q = [...(adj(startId) || [])]
  while (q.length) {
    const x = q.shift()
    if (seen.has(x)) continue
    seen.add(x)
    ;(adj(x) || []).forEach(y => q.push(y))
  }
  return seen
}

export const edgePath = (e, byId) => {
  const a = byId[e.from], b = byId[e.to]
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2
  const x2 = b.x, y2 = b.y + NODE_H / 2
  const dx = Math.max((x2 - x1) * 0.45, 36)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

export const completedCredits = (malla, done) =>
  malla.cursos.reduce((total, course) => total + (done.has(course.id) ? course.cr : 0), 0)

export const canTake = (course, done, credits) => !done.has(course.id)
  && course.r.every(id => done.has(id)) && (!course.rc || credits >= course.rc)

// Preview changes before asking the student to confirm a prerequisite cascade.
// Removing a course preserves its prerequisites and removes only dependent courses.
export function previewCompleted(malla, done, id) {
  const next = new Set(done)
  if (!malla.byId[id]) return { next, added: [], removed: [], blocked: null }
  if (next.has(id)) {
    next.delete(id)
    let changed = true
    while (changed) {
      changed = false
      const credits = completedCredits(malla, next)
      for (const course of malla.cursos) {
        if (next.has(course.id) && (course.r.some(req => !next.has(req))
          || (course.rc && credits - course.cr < course.rc))) {
          next.delete(course.id)
          changed = true
        }
      }
    }
  } else {
    next.add(id)
    bfs(id, key => malla.byId[key]?.r).forEach(key => next.add(key))
    const credits = completedCredits(malla, next)
    const blocked = malla.cursos.find(course => next.has(course.id) && course.rc && credits - course.cr < course.rc)
    if (blocked) return { next: new Set(done), added: [], removed: [], blocked }
  }
  return {
    next,
    added: malla.cursos.filter(course => next.has(course.id) && !done.has(course.id)),
    removed: malla.cursos.filter(course => done.has(course.id) && !next.has(course.id)),
    blocked: null
  }
}

export function validPlan(malla, plan, done) {
  const credits = completedCredits(malla, done)
  return new Set([...plan].filter(id => malla.byId[id] && canTake(malla.byId[id], done, credits)))
}
