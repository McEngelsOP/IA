import {PGlite} from '@electric-sql/pglite'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
test('additive performance indexes are repeatable and preserve private rows and RLS',async()=>{
 const db=new PGlite();await db.exec(`create table calendar_events(id uuid,student_id uuid,date date,start_date date,end_date date,repeat_until date,repeat_rule text);create table calendar_tasks(id uuid,student_id uuid,due_date date);alter table calendar_events enable row level security;create policy private_calendar on calendar_events using(student_id=current_setting('fixture.student')::uuid);insert into calendar_events values(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','2026-01-01',null,null,null,'none');`)
 const sql=await readFile(new URL('../supabase/performance_indexes.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql)
 assert.equal((await db.query('select count(*)::int n from calendar_events')).rows[0].n,1)
 assert.equal((await db.query("select count(*)::int n from pg_policies where tablename='calendar_events'")).rows[0].n,1)
 assert.equal((await db.query("select relrowsecurity from pg_class where relname='calendar_events'")).rows[0].relrowsecurity,true)
 assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname like 'calendar_%student%'")).rows[0].n,2);await db.close()
})

test('actual period filter preserves legacy ranges and older recurrences while excluding historical rows and other users',async()=>{
 const {calendarFilter}=await import('../src/lib/calendarQueries.js');const db=new PGlite()
 await db.exec(`create table calendar_events(id text,student_id text,date text,start_date text,end_date text,repeat_until text,repeat_rule text);insert into calendar_events select 'old-'||i,'a',to_char(date '2000-01-01'+i,'YYYY-MM-DD'),null,null,null,'none' from generate_series(1,5000)i;insert into calendar_events values('weekly','a','2026-01-05',null,null,null,'weekly'),('legacy','a',null,'2026-01-05',null,'2026-12-01','weekly'),('span','a',null,'2026-09-01','2026-12-01',null,'none'),('private','b','2026-10-18',null,null,null,'none');`)
 function split(s){let depth=0,start=0,out=[];for(let i=0;i<s.length;i++){if(s[i]==='(')depth++;if(s[i]===')')depth--;if(s[i]===','&&!depth){out.push(s.slice(start,i));start=i+1}}out.push(s.slice(start));return out}
 const args=[];function sql(s){if(s.startsWith('and(')||s.startsWith('or(')){const start=s.indexOf('(');return '('+split(s.slice(start+1,-1)).map(sql).join(s.startsWith('and')?' AND ':' OR ')+')'}const [column,op,...value]=s.split('.');assert(['date','start_date','end_date','repeat_rule','repeat_until'].includes(column));if(op==='is'){assert.equal(value.join('.'),'null');return column+' IS NULL'}const operator={gte:'>=',lte:'<=',eq:'='}[op];assert(operator);args.push(value.join('.'));return column+operator+'$'+args.length}
 const where=split(calendarFilter('2026-09-28','2026-11-01')).map(sql).join(' OR ')
 const rows=(await db.query("select id from calendar_events where student_id='a' and ("+where+')',args)).rows.map(r=>r.id).sort();assert.deepEqual(rows,['legacy','span','weekly']);assert.equal((await db.query('select count(*)::int n from calendar_events')).rows[0].n,5004);await db.close()
})
