-- ============================================================================
-- إعدادات الطباعة لكل شركة (حجم الورق، الهوامش، الترويسة، التذييل، الشعار…)
-- الصق هذا الملف في Supabase Dashboard > SQL Editor > Run (آمن التكرار)
-- ============================================================================

alter table public.companies
  add column if not exists print_settings jsonb not null default '{}'::jsonb;

comment on column public.companies.print_settings is
  'إعدادات الطباعة الخاصة بالشركة — تُدار من شاشة الإعدادات > تبويب الطباعة';
