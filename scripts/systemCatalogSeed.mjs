import { CARRERAS } from '../src/institutions/esan/carreras.js'
const sql = s => "'"+s.replaceAll("'","''")+"'"
for(const c of Object.values(CARRERAS)) console.log(`update public.curriculum_versions set catalog=${sql(JSON.stringify(c))}::jsonb,published_at=coalesce(published_at,now()) where institution_id='esan' and career_key=${sql(c.key)} and version=${sql(c.version)} and catalog is null;`)
