export const ESAN = Object.freeze({
  id: 'esan',
  name: 'Universidad ESAN',
  shortName: 'ESAN',
  timeZone: 'America/Lima',
  gradeScale: { min: 0, max: 20, passing: 10.5 },
  registration: { firstPromotion: 25, codeLength: 8 },
  enabled: true
})

export function isEsanStudentCode(code, now = new Date()) {
  const year = Number(new Intl.DateTimeFormat('en', { timeZone: ESAN.timeZone, year: 'numeric' }).format(now)) % 100
  return /^\d{8}$/.test(code) && Number(code.slice(0, 2)) >= ESAN.registration.firstPromotion && Number(code.slice(0, 2)) <= year
}
