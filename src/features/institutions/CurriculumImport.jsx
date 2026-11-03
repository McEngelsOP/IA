import { prepareDownload } from '../../native/files.js'
import { useEffect, useId, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { extractCurriculum, validateRows, curriculumMarkdown, MAX_SOURCE } from './curriculumMarkdown.js'
import { readCurriculum } from './readCurriculum.js'
import './CurriculumImport.css'
import { CurriculumImportGuide } from './CurriculumImportGuide.jsx'
import { analysisError,startAnalysis } from './curriculumAnalysisClient.js'
const blank = () => ({code:'',name:'',credits:'',cycle:'',type:'curso',requirements:''})
export function CurriculumImport({ client, profile, onSaved, onBusy = () => {}, initialRecord }) {
  const [source,setSource]=useState(initialRecord?.source_text||''), [rows,setRows]=useState(initialRecord?.rows||[]), [issues,setIssues]=useState([]), [filename,setFilename]=useState(initialRecord?.source_name||'Texto pegado'),[sourceUrl,setSourceUrl]=useState(initialRecord?.source_url||'')
  const [career,setCareer]=useState(initialRecord?.career_name||profile.external_career || ''), [busy,setBusy]=useState(false), [error,setError]=useState(''), [confirmed,setConfirmed]=useState(false)
  const lock=useRef(false), requestId=useRef(crypto.randomUUID())
  const reviewSection=useRef(null), reviewList=useRef(null), focusAdded=useRef(false)
  const sourceId=useId(), validationId=useId()
  const rowIssue=rows.length?validateRows(rows):''
  const markdown=curriculumMarkdown({university:profile.university_name || 'Mi universidad',career,rows,source:filename})
  function change(next){setRows(next);setConfirmed(false);setError('')}
  function revealRow(index){
    const entry=reviewList.current?.children[index]
    if(!entry)return
    reviewSection.current.open=true;entry.open=true
    const field=entry.querySelector('input[required]:invalid')||entry.querySelector('input[required]')
    field?.focus({preventScroll:true})
    entry.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})
  }
  useEffect(()=>{if(focusAdded.current){focusAdded.current=false;revealRow(rows.length-1)}},[rows.length])
  function addRow(){focusAdded.current=true;change([...rows,blank()])}
  async function file(e){const f=e.target.files?.[0];if(!f||lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError('');try{setSource(await readCurriculum(f));setFilename(f.name);setRows([]);setConfirmed(false)}catch(e){setError(e.message)}finally{lock.current=false;setBusy(false);onBusy(false)}}
  function extract(){try{const r=extractCurriculum(source);change(r.rows);setIssues(r.issues);if(!r.rows.length)setError('No reconocimos una tabla. Completa los datos manualmente o usa las columnas Curso;Créditos;Ciclo.')}catch(e){setError(e.message)}}
  async function save(e){e.preventDefault();if(lock.current)return;const issue=validateRows(rows);if(new TextEncoder().encode(markdown).length>300000){setError('El Markdown supera los 300 KB. Reduce las descripciones de requisitos antes de guardar.');return}if(sourceUrl&&!/^https:\/\/\S+$/.test(sourceUrl)){setError('La fuente debe ser un enlace HTTPS.');return}if(issue||career.trim().length<2||!confirmed){setError(issue||'Confirma tu carrera y la revisión de todos los datos.');return}lock.current=true;setBusy(true);onBusy(true);setError('');try{const id=initialRecord?.id||requestId.current,args={p_career:career.trim(),p_rows:rows,p_source:filename,p_source_text:source,p_source_url:sourceUrl};const r=await client.rpc(initialRecord?'revise_curriculum':'submit_curriculum_v2',initialRecord?{...args,p_curriculum:id}:{...args,p_request:id,p_markdown:markdown});if(r.error)throw r.error;void startAnalysis(client,id).catch(()=>{});onBusy(false);await onSaved()}catch(e){setError(analysisError(e))}finally{lock.current=false;setBusy(false);onBusy(false)}}
  async function download(){try{const file=await prepareDownload(new Blob([markdown],{type:'text/markdown;charset=utf-8'}),'malla-lyra.md');if(file.share)await file.share()}catch{setError('No pudimos guardar el archivo. Reintenta.')}}
  return <section className="ci blk" aria-label="Importar mi malla"><h2>{initialRecord?'Corrige tu malla':'Prepara tu malla'}</h2><p>La IA integrada revisará la coherencia de los cursos con tu documento. Si todo está claro, se compartirá automáticamente con tu universidad. Los casos inconclusos pasan a moderación.</p>{initialRecord&&<p>Si ya registraste avance, conserva el orden, el número de cursos y sus códigos (o sus nombres si no tienen código) para mantener tus datos.</p>}<form onSubmit={save}><fieldset disabled={busy}>
    <label>Carrera<input value={career} maxLength={120} onChange={e=>{setCareer(e.target.value);setConfirmed(false)}} required/></label>
    <label>Archivo de la malla<input type="file" accept=".pdf,.xlsx,.md,.txt,.csv,.tsv" onChange={file}/></label><p className="h-muted">PDF con texto, Excel o texto · hasta 8 MB. El archivo se procesa en tu dispositivo. Los PDF escaneados necesitan OCR previo.</p>
    <CurriculumImportGuide/>
    <label htmlFor={sourceId}>Texto de la malla</label><textarea id={sourceId} rows="7" maxLength={MAX_SOURCE} value={source} onChange={e=>{setSource(e.target.value);setConfirmed(false)}} placeholder={'Curso;Créditos;Ciclo\nMatemáticas;4;1'}/>
    <label>Enlace institucional de la malla · opcional<input type="url" maxLength={1000} placeholder="https://…" value={sourceUrl} onChange={e=>{setSourceUrl(e.target.value);setConfirmed(false)}}/></label>
    <button className="h-btn" type="button" disabled={!source.trim()} onClick={extract}>Convertir y extraer datos</button>
    {!!issues.length&&<details><summary>{issues.length} líneas no interpretadas · revisar fuente</summary><pre>{issues.slice(0,200).map(v=>`${v.line}: ${v.text}`).join('\n')}</pre></details>}
    <h3>Revisa los datos extraídos</h3><p>Nombre, créditos y ciclo son obligatorios. Código y prerrequisitos son opcionales: déjalos vacíos si no aparecen en tu documento.</p>
    {!!rows.length&&<details ref={reviewSection} className="ci-review-list" open>
      <summary><strong>Verificar cursos</strong><span>{rows.length} cursos y talleres · {rows.reduce((sum,r)=>sum+(Number(r.credits)||0),0)} créditos</span></summary>
      <p className="ci-review-hint">Desplaza la lista y abre un curso para revisar sus datos. Puedes contraer toda la lista al terminar.</p>
      <div ref={reviewList} className="ci-rows" role="region" aria-label="Lista de cursos para verificar" tabIndex={0}>
        {rows.map((r,i)=><details key={i} className="ci-course">
          <summary><span className="ci-course-title">{i+1}. {r.name.trim()||'Curso sin nombre'}</span><span className="ci-course-meta">{r.credits!==''&&r.credits!=null?`${r.credits} créditos`:'Créditos pendientes'} · {String(r.cycle??'').trim()?+r.cycle===0?'Formación adicional':`Ciclo ${r.cycle}`:'Ciclo pendiente'}{validateRows([r])&&<span className="ci-course-warning"> · Revisar datos</span>}</span></summary>
          <fieldset className="ci-row"><legend>Curso o taller {i+1}</legend>{[['name','Nombre'],['credits','Créditos'],['cycle','Ciclo'],['code','Código'],['requirements','Requisitos']].map(([key,label])=><label key={key} className={['name','requirements'].includes(key)?'ci-wide':undefined}>{label}{['code','requirements'].includes(key)?' · opcional':''}<input required={['name','credits','cycle'].includes(key)} aria-label={`${label} ${i+1}`} value={r[key]??''} maxLength={key==='requirements'?800:key==='name'?180:40} inputMode={key==='cycle'?'numeric':key==='credits'?'decimal':undefined} onChange={e=>change(rows.map((row,j)=>i===j?{...row,[key]:(key==='credits'?e.target.value.replace(',','.'):e.target.value)}:row))}/></label>)}<label>Tipo<select value={r.type||'curso'} onChange={e=>change(rows.map((row,j)=>i===j?{...row,type:e.target.value}:row))}>{['curso','taller','electivo'].map(t=><option key={t}>{t}</option>)}</select></label><button className="h-btn" type="button" onClick={()=>change(rows.filter((_,j)=>j!==i))}>Quitar fila {i+1}</button></fieldset>
        </details>)}
      </div>
    </details>}
    <button className="h-btn" type="button" disabled={rows.length>=400} onClick={addRow}>Añadir curso o taller</button>
    {!!rows.length&&<><details><summary>Ver Markdown</summary><pre>{markdown}</pre><button type="button" className="h-btn" onClick={download}>Descargar Markdown</button></details><p>Al enviar, autorizas el análisis del texto y los cursos con los proveedores de IA integrados. No incluyas datos personales. No necesitas una API key propia para validar la malla.</p><label className="ci-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Revisé los datos con mi documento original y quiero enviarlos a validación.</label>{rowIssue&&<div><p id={validationId} role="status" aria-live="polite">{rowIssue}</p><button type="button" className="h-btn" onClick={()=>revealRow(Number(rowIssue.match(/^Fila (\d+)/)?.[1]||1)-1)}>Ir al curso por corregir</button></div>}<button className="h-btn primary" aria-describedby={rowIssue?validationId:undefined} disabled={!confirmed||!!rowIssue} type="submit">{initialRecord?'Guardar correcciones y analizar':'Guardar malla y configurar mi avance'}</button><p>Podrás consultar el resultado y corregir tu borrador desde Mi perfil.</p></>}
    {busy&&<p role="status">Procesando la malla…</p>}{error&&<p role="alert">{error}</p>}
  </fieldset></form></section>
}
export function mountCurriculumImport(container,props){const root=createRoot(container);root.render(<CurriculumImport {...props}/>);return()=>root.unmount()}
