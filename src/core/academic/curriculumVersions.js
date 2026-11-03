export function compareCurricula(before, after) {
  const old = new Map(before.cursos.map(c => [c.id, c])), next = new Map(after.cursos.map(c => [c.id, c]))
  const fields = ['n', 'cr', 'c', 'rc', 'requirementNote']
  return { added: after.cursos.filter(c => !old.has(c.id)), removed: before.cursos.filter(c => !next.has(c.id)),
    changed: after.cursos.filter(c => old.has(c.id)).flatMap(c => {
      const previous = old.get(c.id), changes = fields.filter(k => (previous[k] ?? null) !== (c[k] ?? null))
      if (JSON.stringify([...(previous.r || [])].sort()) !== JSON.stringify([...(c.r || [])].sort())) changes.push('r')
      return changes.length ? [{ before: previous, after: c, fields: changes }] : []
    }) }
}
