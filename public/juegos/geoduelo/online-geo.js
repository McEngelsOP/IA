export function decodeTopology(topo) {
  const tf = topo.transform
  const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(p => { x += p[0]; y += p[1]; return tf ? [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]] : p }) })
  const ring = ids => ids.flatMap((id, i) => { const a = id < 0 ? [...arcs[~id]].reverse() : arcs[id]; return i ? a.slice(1) : a })
  const object = topo.objects.countries || topo.objects.world || Object.values(topo.objects)[0]
  return object.geometries.map(g => ({ type: 'Feature', id: g.id, properties: g.properties || {}, geometry: { type: g.type, coordinates: g.type === 'Polygon' ? g.arcs.map(ring) : g.arcs.map(p => p.map(ring)) } }))
}
export function distance(a, b) {
  const r = Math.PI / 180, dlat = (b[1] - a[1]) * r, dlon = (b[0] - a[0]) * r
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dlon / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))))
}
function inRing(point, ring) {
  let x = ring[0][0], previous = ring[0], inside = false
  const points = [[x, previous[1]]]
  for (const p of ring.slice(1)) { let delta = p[0] - previous[0]; while (delta > 180) delta -= 360; while (delta < -180) delta += 360; x += delta; points.push([x, p[1]]); previous = p }
  const mid = points.reduce((sum, p) => sum + p[0], 0) / points.length
  const px = point[0] + Math.round((mid - point[0]) / 360) * 360, py = point[1]
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j]
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export function contains(feature, point) {
  const g = feature.geometry, polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polygons.some(rings => inRing(point, rings[0]) && !rings.slice(1).some(r => inRing(point, r)))
}
