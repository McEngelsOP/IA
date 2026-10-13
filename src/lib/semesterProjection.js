export function projectSemesters(courses, completedIds, limit, inProgressIds = []) {
  const byId = Object.fromEntries(courses.map(course => [course.id, course]))
  const completed = new Set([...completedIds, ...inProgressIds].filter(id => byId[id]))
  const pending = new Set(courses.filter(course => !completed.has(course.id)).map(course => course.id))
  let approvedCredits = [...completed].reduce((total, id) => total + (byId[id]?.cr || 0), 0)
  const semesters = []

  for (let index = 0; pending.size > 0 && index < 30; index++) {
    const eligible = [...pending]
      .map(id => byId[id])
      .filter(course =>
        course.r.every(id => completed.has(id)) &&
        (!course.rc || approvedCredits >= course.rc)
      )
      .sort((a, b) => a.c - b.c || a.cr - b.cr || a.n.localeCompare(b.n, 'es'))

    if (!eligible.length) break

    const selected = []
    let credits = 0
    for (const course of eligible) {
      if (credits + course.cr <= limit) {
        selected.push(course)
        credits += course.cr
      }
    }
    // Si un solo curso excede el tope elegido, prográmalo solo para no atascar la proyección.
    if (!selected.length) {
      const course = eligible[0]
      selected.push(course)
      credits = course.cr
    }

    selected.forEach(course => {
      pending.delete(course.id)
      completed.add(course.id)
    })
    approvedCredits += credits
    semesters.push({ number: index + 1, courses: selected, credits })
  }

  return { semesters, remaining: pending.size }
}

