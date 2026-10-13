export const MAX_TASK_TEXT = 6000
export function parseTaskSuggestions(answer, courses = []) {
  const value = JSON.parse(answer.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''))
  if (!value || !Array.isArray(value.tasks) || value.tasks.length > 10) throw new Error('invalid_response')
  const ids = new Set(courses.map(c => c.id))
  const seen = new Set()
  return value.tasks.map(t => {
    if (!t || typeof t.title !== 'string' || !t.title.trim() || t.title.length > 160) throw new Error('invalid_title')
    let date = t.due_date || ''
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('invalid_date')
    const course = ids.has(t.course_id) ? t.course_id : ''
    const key = `${t.title.trim().toLowerCase()}|${date}|${course}`
    if (seen.has(key)) return null
    seen.add(key)
    return { title: t.title.trim(), due_date: date, course_id: course, selected: true }
  }).filter(Boolean)
}
