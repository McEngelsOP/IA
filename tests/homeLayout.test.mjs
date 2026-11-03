import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLayout, packBlocks, frameFromBounds, readLayout, writeLayout } from '../src/features/home/homeLayout.js'

test('custom frames snap to responsive grid columns and bound crop height', () => {
  assert.deepEqual(frameFromBounds(500, 340, 1000, 4), { span: 6, height: 340 })
  assert.deepEqual(frameFromBounds(270, 1800, 360, 2), { span: 12, height: 900 })
  assert.deepEqual(frameFromBounds(10, 50, 1000, 4), { span: 3, height: 180 })
})

test('normalization preserves existing presets, ignores unsafe frames and fixes the hero', () => {
  const old = normalizeLayout({ version: 2, compact: ['stats'], hidden: ['hero', 'racha'], order: ['notas', 'hero'] })
  assert.equal(old.sizes.stats, 'compact')
  assert.equal(old.order[0], 'hero')
  assert.deepEqual(old.hidden, ['racha'])
  const next = normalizeLayout({ sizes: { stats: 'custom', hoy: 'wide' }, frames: { stats: { span: 1000, height: -1 }, hoy: { span: 6, height: 400 }, unknown: {} } })
  assert.deepEqual(next.frames, { stats: { span: 12, height: 180 } })
  assert.deepEqual(normalizeLayout(next), next)
})

test('custom widths retain their chosen footprint and pack without overlapping on desktop and mobile', () => {
  const layout = normalizeLayout({ sizes: { stats: 'custom', notas: 'compact', racha: 'custom' }, frames: { stats: { span: 6, height: 340 }, racha: { span: 9, height: 420 } } })
  for (const columns of [4, 2]) {
    const packed = packBlocks(['stats', 'notas', 'racha', 'hoy'], layout.sizes, columns, layout.frames)
    assert.equal(packed.find(p => p.id === 'stats').fitSpan, 6)
    for (let a = 0; a < packed.length; a++) for (let b = a + 1; b < packed.length; b++) {
      if (packed[a].row !== packed[b].row) continue
      assert(packed[a].fitCol + packed[a].fitSpan <= packed[b].fitCol)
    }
    assert(packed.every(p => p.fitCol >= 1 && p.fitCol + p.fitSpan <= 13))
  }
})

test('custom dimensions survive storage and remain isolated by account', () => {
  const cache = new Map(), storage = { getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value) }
  const layout = normalizeLayout({ sizes: { stats: 'custom' }, frames: { stats: { span: 9, height: 430 } } })
  assert(writeLayout('resize-fixture', layout, storage))
  assert.deepEqual(readLayout('resize-fixture', storage).frames.stats, { span: 9, height: 430 })
  assert.equal(readLayout('different-fixture', storage).sizes.stats, 'wide')
})
