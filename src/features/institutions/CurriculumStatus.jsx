import { useEffect,useRef,useState } from 'react'
import { CurriculumImport } from './CurriculumImport.jsx'
import { analysisLabels,analysisError,startAnalysis } from './curriculumAnalysisClient.js'
export function AnalysisFindings({result={}}){
 return <><p>{result.summary}</p>{!!result.issues?.length&&<ul className="ci-findings">{result.issues.map((v,i)=><li key={i}><strong>{v.row?`Fila ${v.row}`:'Documento'} · {v.severity==='error'?'Corregir':'Verificar'}</strong><span>{v.message}</span></li>)}</ul>}{!!result.assessments?.length&&<details><summary>Ver análisis por proveedor</summary>{result.assessments.map((v,i)=><div key={i}><h4>{v.provider}</h4><p>{v.summary}</p></div>)}</details>}</>
}
export function CurriculumStatus({client,profile,onBusy=()=>{},onCatalogChanged=()=>{}}){
 const [record,setRecord]=useState(null),[history,setHistory]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[original,setOriginal]=useState('')
 const alive=useRef(true),lock=useRef(false),attempted=useRef(false),pendingState=useRef(false)
 const id=profile.custom_curriculum_id
 async function refresh(){
  const [r,h]=await Promise.all([client.from('custom_curricula').select('*').eq('id',id).maybeSingle(),client.from('curriculum_review_log').select('id,actor_kind,decision,note,created_at,issues:evidence->issues').eq('curriculum_id',id).order('created_at',{ascending:false}).limit(20)])
  if(!alive.current)return
  setLoading(false)
  if(r.error||!r.data){setError('No pudimos consultar tu malla. Actualiza el estado para reintentar.');return}
  setError('');setRecord(r.data);setHistory(h.data||[]);pendingState.current=['queued','analyzing'].includes(r.data.validation_state)
  if(r.data.validation_state==='queued'&&r.data.owner_id===profile.id&&!attempted.current){attempted.current=true;void startAnalysis(client,id).then(()=>refresh()).catch(()=>{if(alive.current)setError('La malla está guardada y en cola. El análisis continuará en segundo plano; puedes actualizar su estado.')})}
 }
 useEffect(()=>{alive.current=true;void refresh();const started=Date.now(),timer=setInterval(()=>{if(pendingState.current&&Date.now()-started<300000&&!document.hidden)void refresh()},10000);return()=>{alive.current=false;clearInterval(timer)}},[id])
 async function retry(){if(lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError('');try{const r=await client.rpc('request_curriculum_analysis',{p_curriculum:id});if(r.error)throw r.error;await startAnalysis(client,id);await refresh()}catch(e){if(alive.current)setError(analysisError(e))}finally{lock.current=false;if(alive.current)setBusy(false);onBusy(false)}}
 async function edit(){setError('');const r=await client.from('curriculum_sources').select('source_text').eq('curriculum_id',id).maybeSingle();if(!alive.current)return;if(r.error){setError('No pudimos recuperar el texto original. Reintenta.');return}setOriginal(r.data?.source_text||'');setEditing(true)}
 if(loading)return <section className="blk ci"><h2>Mi malla curricular</h2><p role="status">Consultando el análisis…</p></section>
 if(editing)return <><button className="h-btn" disabled={busy} onClick={()=>setEditing(false)}>Volver al resultado</button><CurriculumImport client={client} profile={profile} initialRecord={{...record,source_text:original}} onBusy={v=>{setBusy(v);onBusy(v)}} onSaved={async()=>{setEditing(false);attempted.current=false;await refresh();onCatalogChanged()}}/></>
 const own=record?.owner_id===profile.id,state=record?.validation_state||'review',pending=['queued','analyzing'].includes(state)
 return <section className="blk ci" aria-label="Estado de mi malla"><h2>Mi malla curricular</h2>{record&&<><h3>{record.career_name}</h3><p className="ci-status" role="status">{analysisLabels[state]}</p><p>{state==='approved'?'La malla está disponible para alumnos de tu universidad. La revisión comprueba coherencia; confirma la vigencia del plan con tu institución.':'La propuesta sigue privada. Puedes usar tu borrador para organizar tu avance mientras se resuelve su validación.'}</p><AnalysisFindings result={record.analysis_summary}/>{pending&&<p>El análisis continúa aunque cierres esta pantalla. Normalmente toma unos segundos; si tarda, actualiza el estado.</p>}<div className="ci-actions">{own&&!pending&&state!=='approved'&&<button className="h-btn" disabled={busy} onClick={edit}>Corregir mi malla</button>}{own&&state==='review'&&<button className="h-btn" disabled={busy} onClick={retry}>{busy?'Analizando…':'Reintentar análisis con IA'}</button>}</div>{!!history.length&&<details><summary>Historial de validación</summary><ol>{history.map(h=><li key={h.id}><strong>{h.actor_kind==='ai'?'IA':h.actor_kind==='moderator'?'Moderación':'Alumno'} · {new Date(h.created_at).toLocaleString('es-PE')}</strong><p>{h.note}</p>{!!h.issues?.length&&<details><summary>Hallazgos de esa versión</summary><AnalysisFindings result={{issues:h.issues}}/></details>}</li>)}</ol></details>}</>}<button className="h-btn" disabled={busy} onClick={()=>{setError('');void refresh()}}>Actualizar estado</button>{error&&<p role="alert">{error}</p>}</section>
}
