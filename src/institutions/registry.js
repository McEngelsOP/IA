import { CARRERAS } from './esan/carreras.js'
import { ESAN } from './esan/config.js'

export const INSTITUTIONS = Object.freeze({ [ESAN.id]: ESAN })
const releases = import.meta.glob('/data/catalogs/esan/releases/*/*.json', { import: 'default' })
export async function loadCurriculum(careerKey, version) {
  const current = CARRERAS[careerKey]
  if (!current) throw new Error('CAREER_NOT_SUPPORTED')
  if (!version || version === current.version) return current
  const release = releases[`/data/catalogs/esan/releases/${careerKey}/${version}.json`]
  if (!release) throw new Error('CURRICULUM_VERSION_UNAVAILABLE')
  const catalog = await release()
  if (catalog.key !== careerKey || catalog.version !== version || catalog.institutionId !== ESAN.id) throw new Error('INVALID_CURRICULUM_VERSION')
  return catalog
}
