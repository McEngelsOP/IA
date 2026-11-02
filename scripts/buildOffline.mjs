import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json','utf8'))
const urls = new Set(['/offline.html','/icon-192.png','/manifest.webmanifest'])
const visited = new Set()
function visit(key) {
 if (visited.has(key)) return
 visited.add(key)
 const item = manifest[key]
 if (!item) throw new Error('Offline build entry missing: '+key)
 urls.add('/'+item.file)
 for(const css of item.css || []) urls.add('/'+css)
 for(const dependency of item.imports || []) visit(dependency)
}
visit('offline.html')
const hash=createHash('sha256')
for(const url of [...urls].sort()) hash.update(await readFile('dist'+url))
const template=await readFile('public/sw.js','utf8')
hash.update(template)
const version='lyra-'+hash.digest('hex').slice(0,16)
await writeFile('dist/sw.js',template.replace('__LYRA_CACHE__',version).replace('__LYRA_PRELOAD__',JSON.stringify([...urls])))
console.log(`Offline: ${urls.size} resources, ${version}`)
