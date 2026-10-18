import { monthDays } from './calendarModel.js'
export function calendarWindow(day) {
 const dates=monthDays(day)
 return { start:dates[0], end:dates.at(-1) }
}
// PostgREST union includes weekly series that began before the visible month,
// and non-repeating events crossing either boundary (legacy date/start_date).
export function calendarFilter(start,end) {
 return [
  `and(date.gte.${start},date.lte.${end})`,
  `and(start_date.gte.${start},start_date.lte.${end})`,
  `and(date.lte.${end},end_date.gte.${start})`,
  `and(start_date.lte.${end},end_date.gte.${start})`,
  ...['date','start_date'].map(column=>`and(repeat_rule.eq.weekly,${column}.lte.${end},or(repeat_until.is.null,repeat_until.gte.${start}))`)
 ].join(',')
}
export async function readCalendarPages(client,user,table,fields,{start,end,signal}={}) {
 const rows=[]
 for(let offset=0;;offset+=100){
  let query=client.from(table).select(fields).eq('student_id',user)
  query=table==='calendar_tasks'?query.gte('due_date',start).lte('due_date',end):query.or(calendarFilter(start,end))
  query=query.order('created_at').order('id').range(offset,offset+99)
  if(signal)query=query.abortSignal(signal)
  const {data,error}=await query
  if(error)throw error
  rows.push(...(data||[]))
  if(signal?.aborted)throw new DOMException('Aborted','AbortError')
  if((data||[]).length<100)return rows
 }
}

export async function readUpcomingClasses(client,user,fields,today,signal) {
 // Active series and events spanning today are independent of the month being
 // inspected. Two one-row seeks preserve the nearest future legacy/new event.
 const rows=[]
 for(let offset=0;;offset+=100){
  let recurring=client.from('calendar_events').select(fields).eq('student_id',user).eq('event_type','clase')
   .or(`and(repeat_rule.eq.weekly,or(date.lte.${today},start_date.lte.${today}),or(repeat_until.is.null,repeat_until.gte.${today})),and(end_date.gte.${today},or(date.lte.${today},start_date.lte.${today}))`)
   .order('created_at').order('id').range(offset,offset+99)
  if(signal)recurring=recurring.abortSignal(signal)
  const {data,error}=await recurring
  if(error)throw error;rows.push(...(data||[]));if((data||[]).length<100)break
 }
 const result=await Promise.all(['date','start_date'].map(column=>{
  let q=client.from('calendar_events').select(fields).eq('student_id',user).eq('event_type','clase').gte(column,today)
  if(column==='start_date')q=q.is('date',null)
  q=q.order(column).order('id').limit(1)
  return signal ? q.abortSignal(signal) : q
 }))
 for(const {data,error} of result){if(error)throw error;rows.push(...(data||[]))}
 return rows
}
