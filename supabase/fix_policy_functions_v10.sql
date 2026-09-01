-- ============================================================================
-- إصلاح عاجل v10 — 403 على /rest/v1/companies وحلقة «أنشئ شركة جديدة»
--
-- السبب (خطأ في migration_linter_hardening_v8.sql):
--   v8 سحبت EXECUTE من الدور `authenticated` عن دوال SECURITY DEFINER الداخلية
--   ظنّاً أنها «لا تُستدعى عبر REST». وهذا خطأ: تعبيرات سياسات RLS تُقيَّم
--   **بصلاحيات الدور المستدعي** (authenticated) وليس بصلاحيات مالك الجدول.
--   فلمّا فقد الدور EXECUTE على:
--       auth_company_id() / is_company_active() / is_admin() / is_active_user()
--   صارت كل سياسة تستدعيها ترمي «permission denied for function»
--   ⇒ PostgREST يعيد 403 على قراءة companies وكل جداول التشغيل.
--
--   والنتيجة في الواجهة: getCompany() تفشل ⇒ تُرجع null ⇒ AppLayout يحوّل إلى
--   /onboarding ⇒ المستخدم ينشئ شركة ⇒ register_company تنجح (SECURITY DEFINER)
--   لكن القراءة التالية تفشل بـ 403 مجدداً ⇒ يعود إلى /onboarding — حلقة لا تنتهي.
--
-- ملاحظة مهمة: لا تُعيد هذه الترحيلة فتح أي ثغرة. الدوال المعادة هنا لا تكشف
-- بيانات: كلها تُرجع قيمة عن **المستخدم المتصل نفسه** (معرّف شركته، هل هو
-- مطوّر، هل اشتراكه فعّال) أو دوال نصية بحتة. تنبيهات المدقّق 0028/0029 عليها
-- مقبولة ومقصودة لأنها شرط تشغيل RLS.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) دوال تستدعيها سياسات RLS ⇒ يجب أن تكون قابلة للتنفيذ من authenticated
-- ---------------------------------------------------------------------------
do $policy_fns$
declare
  r record;
  needed text[] := array[
    'auth_company_id',    -- شرط العزل الأساسي في كل سياسة
    'is_company_active',  -- شرط الاشتراك الفعّال
    'is_admin',           -- سياسات الجداول الإدارية
    'is_active_user'      -- متوافقية مع قواعد قديمة
  ];
  fn text;
begin
  foreach fn in array needed loop
    for r in
      select p.oid::regprocedure as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn and p.prokind = 'f'
    loop
      execute format('grant execute on function %s to authenticated', r.sig);
      raise notice 'أُعيدت صلاحية التنفيذ لـ %', r.sig;
    end loop;
  end loop;
end $policy_fns$;

-- ---------------------------------------------------------------------------
-- 2) دوال مساعدة تُستدعى من داخل مُشغّلات (triggers) تعمل بصلاحيات المستخدم
--    set_company_id / set_profile_guard / set_note_company_id ... تستدعي
--    auth_company_id و safe_text و is_allowed_email أثناء INSERT العادي.
--    بدون EXECUTE يفشل أي إدراج بـ «permission denied for function».
-- ---------------------------------------------------------------------------
do $trigger_helpers$
declare
  r record;
  fn text;
  helpers text[] := array['safe_text', 'is_allowed_email', 'gen_code', 'log_activity'];
begin
  foreach fn in array helpers loop
    for r in
      select p.oid::regprocedure as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn and p.prokind = 'f'
    loop
      execute format('grant execute on function %s to authenticated', r.sig);
    end loop;
  end loop;

  -- الزائر يحتاج is_allowed_email قبل إنشاء الحساب
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_allowed_email' and p.prokind = 'f'
  loop
    execute format('grant execute on function %s to anon', r.sig);
  end loop;
end $trigger_helpers$;

-- ---------------------------------------------------------------------------
-- 3) التأكد من أن سياسات قراءة الشركة والملف الشخصي سليمة
--    (لازمة لخروج المستخدم من حلقة /onboarding)
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
drop policy if exists companies_own on public.companies;
create policy companies_own on public.companies
  for select to authenticated
  using (id = public.auth_company_id() or public.is_admin());

drop policy if exists companies_own_update on public.companies;
create policy companies_own_update on public.companies
  for update to authenticated
  using (id = public.auth_company_id())
  with check (id = public.auth_company_id());

alter table public.profiles enable row level security;
drop policy if exists profiles_own_select on public.profiles;
create policy profiles_own_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

grant select on public.companies to authenticated;
grant select on public.profiles  to authenticated;

commit;

-- ============================================================================
-- تحقّق بعد التنفيذ — يجب أن تُرجع true لكل الدوال الأربع:
--   select p.proname,
--          has_function_privilege('authenticated', p.oid, 'execute') as ok
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('auth_company_id','is_company_active','is_admin','is_active_user');
--
-- ثم في المتصفح: سجّل خروجاً ودخولاً — يجب أن تفتح لوحة النظام مباشرة
-- بلا المرور على /onboarding.
-- ============================================================================
