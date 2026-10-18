import { CAREER_OPTIONS } from '../data/careerOptions.js'
import { careerImports } from '../data/careerImports.js'

// Only public catalogue data is shared across sessions. Private data is never
// stored here. A failed import can be retried; concurrent callers share a read.
export const CARRERAS = Object.fromEntries(Object.entries(CAREER_OPTIONS).map(([key, meta]) => [key, { ...meta, cursos: [], ciclos: {} }]))
const pending = new Map()
export function loadCareer(key) {
 if (!Object.hasOwn(careerImports,key)) return Promise.reject(new Error('INVALID_CAREER'))
 if (CARRERAS[key].cursos.length) return Promise.resolve(CARRERAS[key])
 if (!pending.has(key)) {
  const read = careerImports[key]().then(({default:career}) => { CARRERAS[key]=career;return career }).finally(()=>pending.delete(key))
  pending.set(key,read)
 }
 return pending.get(key)
}
