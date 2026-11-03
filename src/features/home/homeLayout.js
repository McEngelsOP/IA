export const HOME_BLOCKS = ['hero', 'hoy', 'stats', 'notas', 'racha', 'semestre', 'panel']
export const EDITABLE_BLOCKS = HOME_BLOCKS.filter(id => id !== 'hero')
export const HOME_SIZES = ['compact', 'medium', 'wide']
export const HOME_FRAME_LIMITS = { minHeight: 180, maxHeight: 900 }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
export function frameFromBounds(width, height, containerWidth, columns = 4) {
  const count = columns >= 4 ? 4 : 2
  const units = clamp(Math.round(width / Math.max(1, containerWidth) * count), 1, count)
  return { span: units * 12 / count, height: Math.round(clamp(height, HOME_FRAME_LIMITS.minHeight, HOME_FRAME_LIMITS.maxHeight)) }
}
const uniqueBlocks = value => Array.isArray(value) ? [...new Set(value.filter(id => HOME_BLOCKS.includes(id)))] : []
export function normalizeLayout(value = {}) {
  const order = uniqueBlocks(value?.order).filter(id => id !== 'hero')
  const legacy = uniqueBlocks(value?.compact)
  const sizes = Object.fromEntries(EDITABLE_BLOCKS.map(id => [id, [...HOME_SIZES, 'custom'].includes(value?.sizes?.[id]) ? value.sizes[id] : legacy.includes(id) ? 'compact' : 'wide']))
  const frames = Object.fromEntries(EDITABLE_BLOCKS.filter(id => sizes[id] === 'custom').map(id => {
    const frame = value?.frames?.[id]
    return [id, { span: clamp(Math.round((Number(frame?.span) || 12) / 3) * 3, 3, 12), height: clamp(Math.round(Number(frame?.height) || 360), HOME_FRAME_LIMITS.minHeight, HOME_FRAME_LIMITS.maxHeight) }]
  }))
  return { version: 3, order: ['hero', ...order, ...EDITABLE_BLOCKS.filter(id => !order.includes(id))], hidden: uniqueBlocks(value?.hidden).filter(id => id !== 'hero'), compact: EDITABLE_BLOCKS.filter(id => sizes[id] === 'compact'), sizes, frames }
}
export const blockSpan = (size, columns) => size === 'compact' ? 1 : size === 'medium' ? Math.min(2, columns) : columns
// First-fit packing fills available cells. DOM order follows the returned reading order.
// Every row has one height: full content spans the row; summaries share a common height.
export function packBlocks(ids, sizes, columns = 2, frames = {}) {
  columns = columns >= 4 ? 4 : 2
  const rows = [], result = []
  for (const id of [...new Set(ids)].filter(id => EDITABLE_BLOCKS.includes(id))) {
    const span = sizes?.[id] === 'custom' ? clamp(Math.round((frames[id]?.span || 12) / 12 * columns), 1, columns) : blockSpan(sizes?.[id], columns)
    let row = 0, col = -1
    while (col < 0) {
      rows[row] ||= Array(columns).fill(false)
      for (let start = 0; start <= columns - span; start++) if (rows[row].slice(start, start + span).every(v => !v)) { col = start; break }
      if (col < 0) row++
    }
    rows[row].fill(true, col, col + span)
    result.push({ id, row: row + 1, col: col + 1, span })
  }
  result.sort((a, b) => a.row - b.row || a.col - b.col)
  // A partly occupied row shares its free width among its tiles instead of leaving a blank area.
  // Twelve render tracks divide evenly for logical rows of one, two, three or four cells.
  for (const row of new Set(result.map(p => p.row))) {
    const items = result.filter(p => p.row === row), custom = items.some(p => sizes?.[p.id] === 'custom'), weight = custom ? columns : items.reduce((sum,p) => sum+p.span,0)
    let start = 1
    for (const item of items) { item.fitCol = start; item.fitSpan = item.span*12/weight; start += item.fitSpan }
  }
  return result
}
export function reorderVisible(state, visible) {
  const next = normalizeLayout(state), allowed = [...new Set(visible)].filter(id => EDITABLE_BLOCKS.includes(id) && !next.hidden.includes(id))
  let index = 0
  next.order = next.order.map(id => allowed.includes(id) ? allowed[index++] : id)
  return next
}
// Keep the chosen drop destination when dense packing would otherwise pull the tile back.
// Its previous row's remaining tiles reflow with it, so the move does not strand an empty cell.
export function movePackedBlock(state, visible, moving, target, after, columns) {
  const next = normalizeLayout(state)
  let order = visible.filter(id => id !== moving)
  const index = order.indexOf(target)
  if (index < 0 || moving === target) return next
  order.splice(index + (after ? 1 : 0), 0, moving)
  for (let pass = 0; pass < 3; pass++) {
    const packed = packBlocks(order, next.sizes, columns, next.frames)
    const source = packed.find(p => p.id === moving), destination = packed.find(p => p.id === target)
    if (!source || !destination || (after ? packed.indexOf(source) > packed.indexOf(destination) : packed.indexOf(source) < packed.indexOf(destination))) break
    const row = after ? source.row : destination.row
    const companions = packed.filter(p => p.row === row && p.id !== moving && p.id !== target).map(p => p.id)
    if (!companions.length) break
    order = order.filter(id => !companions.includes(id))
    order.splice(order.indexOf(moving) + (after ? 0 : 1), 0, ...companions)
  }
  return reorderVisible(next, order)
}
const session = new Map(), unsaved = new Set()
export const isLayoutSaved = owner => !unsaved.has(layoutKey(owner))
export const layoutKey = owner => `lyra-home-layout-v1:${owner || 'guest'}`
export function readLayout(owner, storage) {
  const key = layoutKey(owner)
  if (unsaved.has(key)) return session.get(key)
  try {
    storage ||= globalThis.localStorage
    const saved = storage.getItem(key)
    if (saved) return normalizeLayout(JSON.parse(saved))
    if (session.has(key)) return session.get(key)
    const legacy = JSON.parse(storage.getItem(`esan-inicio-orden-v1:${owner || 'guest'}`))
    return normalizeLayout({ order: legacy })
  } catch { return session.get(key) || normalizeLayout() }
}
export function writeLayout(owner, value, storage) {
  const key = layoutKey(owner), next = normalizeLayout(value)
  session.set(key, next)
  try { storage ||= globalThis.localStorage; storage.setItem(key, JSON.stringify(next)); unsaved.delete(key); return true } catch { unsaved.add(key); return false }
}
