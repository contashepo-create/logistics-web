-- ============================================================================
-- v21 — إصلاح «permission denied for function admin_reset_company_data_v18»
--        عند تصفير بيانات شركة من لوحة المطوّر
--
-- السبب الجذري (أمران يشتركان في النتيجة نفسها):
--   1) `migration_linter_hardening_v8.sql` مصمَّم «آمن التكرار» لكنه ليس كذلك
--      بعد إنشاء دوال أحدث منه: فهو يسحب EXECUTE من الدور `authenticated`
--      عن **كل** دوال public ثم يعيد المنح من قائمة ثابتة كُتبت وقت إصداره.
--      أي دالة أُنشئت بعده (save_purchase_invoice_v14 / delete_purchase_invoice_v14 /
--      save_credit_note_for_trips_v16 / دوال admin_*_v18 و v20 ...) تفقد صلاحية
--      التنفيذ إذا أُعيد تشغيل v8 لاحقاً أو طُبّقت الملفات خارج ترتيبها.
--   2) دوال SECURITY DEFINER تُنفَّذ بصلاحيات مالكها، وتُفحَص صلاحية EXECUTE
--      على **دور المُستدعي** (authenticated عبر JWT المطوّر في التطبيق، وليس
--      دور المالك في SQL Editor) — لذلك ينجح لصق الكود وتشغيله في SQL Editor
--      («الاكواد مكتوبة سليمة») بينما يرفض التطبيق بـ permission denied.
--
-- الحل (آمن لإعادة التشغيل بالكامل — يمكن لصقه في Supabase SQL Editor كما هو):
--   • إعادة الضبط الكامل لصلاحيات EXECUTE بنفس منهجية v8 لكن بقوائم محدَّثة
--     تشمل كل دوال v14–v20 (الاسم، لا التوقيع، حتى تنجو من تغيّر التوقيعات).
--   • ضمان ملكية دوال المطوّر لدور مالك الجداول (postgres) إن وُجد.
--   • يبقى المنع سارياً: anon بلا EXECUTE إلا is_allowed_email، ودوال الزيارة
--     والداخلية بلا EXECUTE لـ authenticated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) فحص مسبق: دالة التصفير نفسها — إن غابت فلن يصلح المنح وحده
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.admin_reset_company_data_v18(uuid)') is null then
    raise warning 'admin_reset_company_data_v18 غير موجودة في قاعدة البيانات — نفّذ أولاً supabase/migration_admin_platform_tools_v18.sql (أو migration_admin_permissions_v20.sql) ثم أعد تشغيل هذا الملف.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (2) إعادة ضبط EXECUTE لكل دوال public — قوائم محدَّثة بالكامل
--     (نفس بنية v8 حتى يتطابق الطرفان على الحالة النهائية ذاتها)
-- ---------------------------------------------------------------------------
do $grants_v21$
declare
  r record;
  -- دوال RPC التي تستدعيها الواجهة/مسارات الخادم بحساب مصادق (JWT ⇒ authenticated)
  rpc_authenticated text[] := array[
    -- التسجيل وإنشاء الشركات
    'register_company',
    'register_company_with_year',
    -- الحفظ الذرّي والتصدير من واجهة النظام (v7–v19)
    'export_company_data',
    'create_next_financial_year',
    'save_invoice',
    'save_payroll',
    'save_purchase_invoice',
    'save_purchase_invoice_v14',
    'delete_purchase_invoice_v14',
    'save_credit_note_for_trips_v16',
    'valid_trip_container_numbers',
    -- لوحة المطوّر وأدوات المنصة (من v8 إلى v20)
    'admin_update_app_settings',
    'admin_set_company_feature',
    'has_company_feature',
    'admin_set_company_status',
    'admin_set_subscription',
    'admin_delete_company',
    'admin_review_activation_request',
    'admin_set_profile_status',
    'admin_set_profile_role',
    'admin_platform_stats',
    'admin_get_company_extras_v18',
    'admin_reset_company_data_v18',   -- ← دالة تصفير الشركة (الخطأ المبلغ عنه)
    'admin_platform_stats_v18',
    'admin_recent_visitors_v18',
    'admin_database_health_v18',
    -- التشخيص
    'whoami'
  ];
  -- دوال يحتاجها الزائر قبل إنشاء الحساب
  rpc_anon text[] := array['is_allowed_email'];
  -- ⚠️ حرج: تستدعيها تعبيرات سياسات RLS والمشغّلات؛ تُقيَّم بصلاحيات الدور
  -- المستدعي، وسحب EXECUTE عنها يكسّر كل الجداول (403 — انظر fix_policy_functions_v10).
  policy_fns text[] := array[
    'auth_company_id', 'is_company_active', 'is_admin', 'is_active_user',
    'safe_text', 'gen_code', 'log_activity'
  ];
begin
  for r in
    select p.oid::regprocedure as sig,
           p.proname            as name,
           p.prosecdef          as secdef,
           pg_get_function_result(p.oid) = 'trigger' as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    -- المنع الشامل أولاً (public/anon/authenticated)
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);

    if r.is_trigger then
      -- دوال الـ trigger لا تُستدعى عبر REST؛ تُنفَّذ داخلياً عند إطلاق المشغّل
      continue;
    end if;

    if r.name = any (rpc_anon) then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    elsif r.name = any (policy_fns) or r.name = any (rpc_authenticated) then
      -- إلزامي لعمل RLS والواجهة — لا تسحبها مهما قال مدقّق Supabase (0028/0029 مقبولة هنا)
      execute format('grant execute on function %s to authenticated', r.sig);
    elsif not r.secdef then
      -- دوال SECURITY INVOKER العادية (مساعدات تُستخدم داخل السياسات/الاستعلامات)
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    -- الباقي (دوال SECURITY DEFINER الداخلية) تبقى بلا EXECUTE للأدوار العامة
  end loop;
end $grants_v21$;

-- service_role يبقى كامل الصلاحيات (مسارات الخادم / الصيانة / record_site_visit_v18)
do $svc_v21$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $svc_v21$;

-- ---------------------------------------------------------------------------
-- (3) ضمان ملكية دوال المطوّر لدور مالك الجداول (postgres عادةً)
--     — SECURITY DEFINER يُنفَّذ بصلاحيات مالك الدالة؛ ملكية ناقصة تعني
--     «permission denied for table …» من داخل دالة سليمة الظاهر.
-- ---------------------------------------------------------------------------
do $owner_v21$
declare
  r record;
  admin_fns text[] := array[
    'admin_set_company_feature', 'admin_set_company_status', 'admin_set_subscription',
    'admin_delete_company', 'admin_review_activation_request', 'admin_set_profile_status',
    'admin_set_profile_role', 'admin_platform_stats', 'admin_get_company_extras_v18',
    'admin_reset_company_data_v18', 'admin_platform_stats_v18', 'admin_recent_visitors_v18',
    'admin_database_health_v18', 'admin_update_app_settings', 'record_site_visit_v18',
    'register_company', 'register_company_with_year', 'export_company_data',
    'create_next_financial_year', 'save_invoice', 'save_payroll', 'save_purchase_invoice',
    'save_purchase_invoice_v14', 'delete_purchase_invoice_v14', 'save_credit_note_for_trips_v16',
    'log_activity', 'is_allowed_email', 'has_company_feature'
  ];
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    for r in
      select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.proname = any (admin_fns)
    loop
      begin
        execute format('alter function %s owner to postgres', r.sig);
      exception when others then null; end;
    end loop;
  end if;
end $owner_v21$;

-- ============================================================================
-- تحقّق بعد التنفيذ — يجب أن تعيد الاستعلامات التالية صفاً واحداً
-- بـ authenticated_ok = true و anon_ok = false:
--
--   select p.proname,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated_ok,
--          has_function_privilege('anon',           p.oid, 'execute') as anon_ok
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in (
--            'admin_reset_company_data_v18', 'admin_get_company_extras_v18',
--            'admin_platform_stats_v18', 'admin_recent_visitors_v18',
--            'admin_database_health_v18', 'admin_set_company_feature'
--          )
--    order by p.proname;
--
-- ثم أعد المحاولة من لوحة المطوّر: الشركات ← «تصفير البيانات».
-- ============================================================================
