import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import StudyAdvisor from '../../src/features/assistant/StudyAdvisor.jsx'
import '../../src/app/portal.css'
import '../../src/shared/styles/OfficialSurfaces.css'
import '../../src/app/AcademicWorkspace.css'
window.calls=[]
window.owner='11111111-1111-4111-8111-111111111111'
window.failSave=false
window.expired=false
window.aiDenied=false
const client={auth:{getUser:async()=>({data:{user:window.expired?null:{id:window.owner}}})},rpc:async name=>({data:name==='ai_access_policy'?{access:{sharedEligible:false,personalRequired:true},usage:{source:'personal',remaining:10,limit:10,dailyRemaining:200,dailyLimit:200}}:{total_votes:0}}),functions:{invoke:async(name,{body})=>{
 window.calls.push(body)
 if(window.aiDenied&&!body.action)return {data:{error:'personal_key_required',usage:{source:'personal',remaining:10,limit:10,dailyRemaining:200,dailyLimit:200}}}
 if(body.action==='prepare_draft')return {data:{token:'fixture',expires:Date.now()+300000}}
 if(body.action==='save_draft')return window.failSave?{data:{error:'save_failed'}}:{data:{saved:{id:body.operationId}}}
 return {data:{answer:'Tu tarea está lista para revisar. <img src=x onerror="window.injected=true">',contextSources:['tasks','agenda'],curriculumVersion:'fixture-reviewed',contextWindow:{from:'2026-10-25',to:'2026-11-01'},answeredAt:'2026-10-25T12:00:00Z',draft:{kind:'task',title:'Informe',date:'2026-10-25',start_time:'',end_time:''}}}
}}}
function Fixture(){const[owner,setOwner]=useState(window.owner);window.switchOwner=id=>{window.owner=id;setOwner(id)};return <div id="app"><main className="official-tools" style={{maxWidth:1000,margin:'auto',padding:16}}><StudyAdvisor key={owner} userId={owner} client={client} embedded="web" careerId="ia" careerName="Ingeniería en IA" planCourses={[]} onClose={()=>{}}/></main></div>}
createRoot(document.getElementById('root')).render(<Fixture/> )
