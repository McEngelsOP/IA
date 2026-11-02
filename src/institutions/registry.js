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

export async function loadAssignedCurriculum(profile,client){
 if(!profile.custom_curriculum_id)return loadCurriculum(profile.carrera,profile.curriculum_version,client)
 if(profile.curriculum_version&&profile.curriculum_version!==profile.custom_curriculum_id){const r=await client.from('curriculum_versions').select('catalog').eq('institution_id',profile.institution_id).eq('career_key',profile.carrera).eq('version',profile.curriculum_version).maybeSingle();if(r.error||!r.data?.catalog)throw Error('CURRICULUM_UNAVAILABLE');return r.data.catalog}
 const r=await client.from('custom_curricula').select('*').eq('id',profile.custom_curriculum_id).maybeSingle();if(r.error||!r.data)throw Error('CURRICULUM_UNAVAILABLE');return(await import('../features/institutions/curriculumMarkdown.js')).customCatalog({...r.data,university_name:profile.university_name})
}
