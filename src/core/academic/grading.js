export const GRADE_SCALES = Object.freeze({
  twenty: { kind: 'numeric', min: 0, max: 20, passing: 10.5, decimals: 2, weighting: 'credits' },
  hundred: { kind: 'numeric', min: 0, max: 100, passing: 60, decimals: 2, weighting: 'credits' },
  letters: { kind: 'letters', min: 0, max: 4, passing: 2, decimals: 2, weighting: 'credits', letters: { A: 4, B: 3, C: 2, D: 1, F: 0 } }
})
export function validScale(scale) {
  return !!scale && ['numeric', 'letters'].includes(scale.kind) && Number.isFinite(scale.min) && Number.isFinite(scale.max) && scale.max > scale.min && scale.passing >= scale.min && scale.passing <= scale.max && ['credits', 'equal'].includes(scale.weighting) && Number.isInteger(scale.decimals) && scale.decimals >= 0 && scale.decimals <= 4 && (scale.kind !== 'letters' || (scale.letters && Object.keys(scale.letters).length > 1 && Object.values(scale.letters).every(n => Number.isFinite(n) && n >= scale.min && n <= scale.max) && new Set(Object.values(scale.letters)).size === Object.keys(scale.letters).length))
}
export function validGrade(value, scale = GRADE_SCALES.twenty) {
  return Number.isFinite(value) && value >= scale.min && value <= scale.max && (scale.kind !== 'letters' || Object.values(scale.letters).includes(value))
}
export function parseGrade(raw, scale = GRADE_SCALES.twenty) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (scale.kind === 'letters') return scale.letters[text.toUpperCase()] ?? NaN
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return NaN
  const number = Number(text.replace(',', '.'))
  return validGrade(number, scale) && (text.split(/[.,]/)[1]?.length || 0) <= scale.decimals ? number : NaN
}
export function formatGrade(value, scale = GRADE_SCALES.twenty, digits = 2) {
  if (!Number.isFinite(value)) return '—'
  if (scale.kind === 'letters') return Object.entries(scale.letters).find(([, n]) => n === value)?.[0] || `${value.toFixed(digits)} / ${scale.max}`
  return value.toLocaleString('es-PE', { maximumFractionDigits: digits })
}
export const scaleLabel = scale => scale.kind === 'letters' ? Object.keys(scale.letters).join(', ') : `${scale.min}–${scale.max}`
export function weightedGrade(rows, scale = GRADE_SCALES.twenty) {
  const eligible = rows.filter(r => validGrade(r.grade, scale) && (scale.weighting === 'equal' || r.credits > 0))
  const weight = eligible.reduce((s, r) => s + (scale.weighting === 'equal' ? 1 : r.credits), 0)
  return weight ? eligible.reduce((s, r) => s + r.grade * (scale.weighting === 'equal' ? 1 : r.credits), 0) / weight : null
}
export function evaluationResult(rows, target, scale = GRADE_SCALES.twenty) {
  const total = rows.reduce((s, r) => s + Number(r.w || 0), 0)
  if (Math.abs(total - 100) > .01 || rows.some(r => !Number.isFinite(+r.w) || r.w < 0 || r.w > 100 || (r.s !== null && !validGrade(r.s, scale)))) return { kind: 'invalid' }
  const pending = rows.filter(r => r.s === null).reduce((s, r) => s + +r.w, 0)
  const accumulated = rows.reduce((s, r) => s + (r.s === null ? 0 : r.w * r.s), 0)
  return pending ? { kind: 'pending', needed: (target * 100 - accumulated) / pending } : { kind: 'final', grade: accumulated / 100 }
}
