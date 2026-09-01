-- ---------------------------------------------------------------------------
-- الراتب الأساسي للموظف (يظهر تلقائياً عند إصدار مسير الراتب وقابل للتعديل)
-- شغّل هذا الملف مرة واحدة في Supabase → SQL Editor
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists base_salary double precision not null default 0;

comment on column public.employees.base_salary is
  'الراتب الشهري الأساسي المسجّل للموظف — يُقترح تلقائياً في مسير الراتب ويمكن تعديله لكل شهر.';
