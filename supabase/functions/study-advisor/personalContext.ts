export const LIMITS = Object.freeze({ requestBytes: 32000, historyChars: 6000, historyMessages: 8, questionChars: 1200, readSteps: 4, resultChars: 18000 })
const text = (v: unknown, max = 160) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const normalized = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
export function validateHistory(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error('invalid_history');
  let budget = LIMITS.historyChars;
  const result: {role: string; content: string}[] = [];
  for (const item of value.slice(-LIMITS.historyMessages).reverse()) {
    if (!item || !['user','assistant'].includes(item.role) || typeof item.content !== 'string') throw new Error('invalid_history');
    const content = text(item.content,Math.min(1800,budget));
    if (content) result.unshift({role:item.role,content});
    budget -= content.length;
  }
  return result;
}
export function limaDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
async function read(query: any) {
  const { data, error } = await query;
  if (error) throw new Error('personal_context_unavailable');
  return data;
}
// Closed, deterministic read registry. No SQL, table names, owner or URLs from the model/client.
export async function loadPersonalContext(client: any, userId: string, question: string, history: any[]) {
  const profile = await read(client.from('profiles').select('carrera,curriculum_version,alias').eq('id',userId).maybeSingle());
  if (!profile) throw new Error('profile_required');
  const topic = normalized(question + ' ' + history.filter(m=>m.role==='user').slice(-1).map(m=>m.content).join(' '));
  const academic = /curso|carrera|ciclo|credit|malla|plan|matricul|prerrequis|requisito|requiere|avance|estudi/.test(topic);
  const agenda = /hoy|manana|semana|agenda|horario|calendario|evento|clase|examen|entrega|tiempo|organiza|estudi/.test(topic);
  const tasks = agenda || /tarea|pendiente|priori|deber|venc/.test(topic);
  const today = limaDate();
  const end = new Date(today+'T12:00:00Z'); end.setUTCDate(end.getUTCDate()+30);
  const until = end.toISOString().slice(0,10);
  const result: any = { today, timezone:'America/Lima', profile:{ alias:text(profile.alias,60), careerId:profile.carrera, curriculumVersion:profile.curriculum_version }, consulted:[], limits:{calendarWindow:{from:today,to:until}}, unavailable:[] };
  // Three bounded tools at most, plus profile. Independent reads share one request deadline.
  if (academic) {
    const [progress,statuses,setup] = await Promise.all([
      read(client.from('progress').select('done,plan').eq('student_id',userId).maybeSingle()),
      read(client.from('course_status').select('course_id,status').eq('student_id',userId).limit(200)),
      read(client.from('student_setup').select('preferences').eq('student_id',userId).maybeSingle()),
    ]);
    result.academic = { done:[...new Set([...(progress?.done||[]),...(statuses||[]).filter((s:any)=>['aprobado','convalidado'].includes(s.status)).map((s:any)=>s.course_id)])].slice(0,200), plan:(progress?.plan||[]).slice(0,30), enrolled:(statuses||[]).filter((s:any)=>s.status==='matriculado').map((s:any)=>text(s.course_id,100)), semester:Number(setup?.preferences?.semester)||null };
    result.consulted.push('courses');
  }
  if (tasks) {
    const rows = await read(client.from('calendar_tasks').select('title,due_date,course_id').eq('student_id',userId).eq('completed',false).lte('due_date',until).order('due_date',{ascending:true}).limit(41));
    result.tasks = rows.slice(0,40).map((r:any)=>({title:text(r.title),due_date:r.due_date,course_id:text(r.course_id,100)}));
    result.limits.tasksTruncated=rows.length>40; result.consulted.push('tasks');
  }
  if (agenda) {
    // Include recurring and multi-day events overlapping the window, including legacy date/start_date.
    const rows = await read(client.from('calendar_events').select('title,date,start_date,end_date,start_time,end_time,event_type,repeat_rule,repeat_until,course_id').eq('student_id',userId)
      .or(`and(date.gte.${today},date.lte.${until}),and(start_date.gte.${today},start_date.lte.${until}),and(start_date.lte.${until},end_date.gte.${today}),and(repeat_rule.eq.weekly,or(repeat_until.is.null,repeat_until.gte.${today}),or(date.lte.${until},start_date.lte.${until}))`)
      .order('date',{ascending:true,nullsFirst:false}).limit(41));
    result.events=rows.slice(0,40).map((r:any)=>({...r,title:text(r.title),course_id:text(r.course_id,100)}));
    result.limits.eventsTruncated=rows.length>40; result.consulted.push('agenda');
  }
  if (JSON.stringify(result).length>LIMITS.resultChars) throw new Error('context_limit');
  return result;
}
