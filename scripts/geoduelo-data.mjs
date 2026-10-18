// Rebuild the online question bank from the supplied local game and licensed map.
import fs from 'node:fs/promises'
import vm from 'node:vm'
const root = new URL('../', import.meta.url)
const html = await fs.readFile(new URL('public/juegos/geoduelo/index.html', root), 'utf8')
const sandbox = { world: JSON.parse(await fs.readFile(new URL('public/juegos/geoduelo/world.json', root), 'utf8')) }
vm.createContext(sandbox)
vm.runInContext(await fs.readFile(new URL('public/juegos/geoduelo/vendor/d3.v3.min.js', root), 'utf8'), sandbox)
const block = (start, end) => html.slice(html.indexOf(start), html.indexOf(end))
vm.runInContext(`const KM=6371; const nrm=s=>String(s).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
${block('const ES_RAW=', 'const LEVELS=')}
${block('function topoToFeatures(', 'function nearest(')}
${block('const CAP_RAW=', '/* ---------- Ciudades:')}
${block('const CITY_RAW=', 'const LTOL=')}
`, sandbox)
const data = vm.runInContext(`({countries:prepare(topoToFeatures(world)).filter(f=>f._ok).sort((a,b)=>b._area-a._area).map(f=>({id:f.id,name:f.es,center:f._ctr,area:f._km2,tolerance:f._tol,...(EXD[nrm(f.es)]||{})})),capitals:CAPS,places:PLACES,cities:CITIES})`, sandbox)
await fs.writeFile(new URL('workers/geoduelo/src/game-data.json', root), JSON.stringify(data) + '\n')
console.log(`Question bank: ${data.countries.length} countries, ${data.capitals.length} capitals, ${data.places.length} places, ${data.cities.length} cities`)
