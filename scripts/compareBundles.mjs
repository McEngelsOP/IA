import {readFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {resolve} from 'node:path'
const [before,after]=process.argv.slice(2)
if(!before||!after)throw new Error('Uso: node scripts/compareBundles.mjs <dist-anterior> <dist-nuevo>')
function measure(dir){
 const manifest=JSON.parse(readFileSync(resolve(dir,'.vite/manifest.json')))
 const size=files=>[...new Set(files)].reduce((r,file)=>{const b=readFileSync(resolve(dir,file));return{bytes:r.bytes+b.length,gzip:r.gzip+gzipSync(b).length}}, {bytes:0,gzip:0})
 function entry(key){const seen=new Set(),js=[],css=[];function visit(k){if(seen.has(k))return;seen.add(k);const item=manifest[k];if(!item)throw Error('Entry missing: '+k);if(item.file.endsWith('.js'))js.push(item.file);css.push(...(item.css||[]));for(const child of item.imports||[])visit(child)}visit(key);return{js:size(js),css:size(css)}}
 const feature=stem=>{const item=Object.values(manifest).find(v=>v.name===stem);return item?size([item.file]):null}
 return{login:entry('login.html'),portal:entry('pagina.html'),gamesEntry:feature('OfficialArcadeGame'),geoDuelo:feature('Geoduelo'),pdfImport:feature('pdf'),pdfExport:feature('exportAcademicRecord')}
}
console.log(JSON.stringify({method:'Vite production manifest, static imports only, gzip per file; excludes media, dynamic imports and runtime network timing.',before:measure(before),after:measure(after)},null,2))
