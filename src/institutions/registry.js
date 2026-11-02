import { CARRERAS } from './esan/carreras.js'
import { ESAN } from './esan/config.js'

export const INSTITUTIONS = Object.freeze({ [ESAN.id]: ESAN })
const releases = import.meta.glob('/data/catalogs/esan/releases/*/*.json', { import: 'default' })
export async function loadCurriculum(careerKey, version, client) {
  const current = CARRERAS[careerKey]
  if (!current) throw new Error('CAREER_NOT_SUPPORTED')
  if (!version || version === current.version) return current
  const release = releases[`/data/catalogs/esan/releases/${careerKey}/${version}.json`]
  let catalog;
  if(release)catalog=await release();
  else if(client){const result=await client.from('curriculum_versions').select('catalog,plan_year,plan_name').eq('institution_id',ESAN.id).eq('career_key',careerKey).eq('version',version).maybeSingle();if(result.error||!result.data?.catalog)throw new Error('CURRICULUM_VERSION_UNAVAILABLE');catalog={...result.data.catalog,planYear:result.data.plan_year,planName:result.data.plan_name}}
  else throw new Error('CURRICULUM_VERSION_UNAVAILABLE')
  if (catalog.key !== careerKey || catalog.version !== version || catalog.institutionId !== ESAN.id) throw new Error('INVALID_CURRICULUM_VERSION')
  return catalog
}
