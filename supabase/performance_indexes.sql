-- Optional additive indexes for the period-scoped calendar reads.
-- Reuses the existing student/date, student/start_date and student/due_date indexes.
-- Does not change data, functions, grants or RLS. Run in SQL Editor once;
-- the frontend continues to work without them. Schedule for quiet traffic.
begin;
create index if not exists calendar_events_student_end_date on public.calendar_events(student_id,end_date);
create index if not exists calendar_events_student_repeat on public.calendar_events(student_id,repeat_until) where repeat_rule='weekly';
commit;
