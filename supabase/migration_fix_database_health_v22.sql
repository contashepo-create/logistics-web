-- ============================================================================
-- v22 — إصلاح شامل: overloads + is_admin() مع service_role + فحص محدّث
--
-- المشاكل المُصلحة:
--   1) admin_database_health_v18 تستخدم to_regproc الذي يفشل مع overloads
--      (ظهور ✕ save_invoice() رغم وجود الدالة)
--   2) is_admin() لا تعيد true مع service_role، مما يمنع استخدام serviceClient
--      في مسارات الخادم (features/companies routes) ويسبب أخطاء 500
--   3) وجود overloads لـ save_invoice يربك PostgREST عند استدعاء RPC
--
-- آمن لإعادة التشغيل بالكامل.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) إصلاح is_admin(): قبول service_role + فحص email للمصادقين
--     هذا يسمح للـ API routes باستخدام serviceClient (أكثر موثوقية من JWT)
--     مع الحفاظ على الأمان (service_role متاح فقط من الخادم).
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select (current_user in ('service_role', 'postgres'))
      or coalesce((auth.jwt() ->> 'email'), '') = 'conta.moha@gmail.com';
$$;

-- ---------------------------------------------------------------------------
-- (2) حذف overloads save_invoice القديمة (إن وُجدت)
--     نُبقي التوقيع الحالي (8 معاملات) ونحذف أي توقيع آخر.
-- ---------------------------------------------------------------------------
do $drop_overloads$
declare
  r record;
  v_current_args text := 'bigint, date, bigint, double precision, text, jsonb, jsonb, text';
begin
  for r in
    select p.oid::regprocedure as sig,
           pg_get_function_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'save_invoice'
  loop
    if r.args is distinct from v_current_args then
      execute format('drop function if exists %s', r.sig);
      raise notice 'حُذفت نسخة قديمة من save_invoice: %', r.sig;
    end if;
  end loop;
end $drop_overloads$;

-- ---------------------------------------------------------------------------
-- (3) إصلاح admin_database_health_v18: pg_proc بدلاً من to_regproc
--     + إضافة admin_get_company_extras_v18 للقائمة
-- ---------------------------------------------------------------------------
create or replace function public.admin_database_health_v18()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_expected_tables text[] := array[
    'companies','profiles','feature_catalog','company_features','activity_logs',
    'financial_years','customers','employees','vehicles','cashboxes','banks',
    'invoices','invoice_trips','trip_expenses','receipt_vouchers','payment_vouchers',
    'credit_debit_notes','credit_note_trips','payrolls','advance_settlements','deduction_settlements','employee_deductions','year_snapshots',
    'activation_requests','suppliers','purchase_invoices','purchase_items','year_opening_balances',
    'support_messages','complaints','complaint_messages','app_settings','site_visitors'
  ];
  v_expected_functions text[] := array[
    'auth_company_id','is_company_active','register_company_with_year','save_invoice',
    'save_payroll','admin_set_company_feature','admin_get_company_extras_v18',
    'admin_reset_company_data_v18','admin_platform_stats_v18','record_site_visit_v18'
  ];
  v_tables jsonb; v_functions jsonb; v_healthy boolean;
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'name', expected.name,
      'exists', c.oid is not null,
      'rls_enabled', coalesce(c.relrowsecurity, false),
      'policy_count', (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = expected.name)
    ) order by expected.name), '[]'::jsonb),
    coalesce(bool_and(c.oid is not null and c.relrowsecurity), false)
    into v_tables, v_healthy
    from unnest(v_expected_tables) expected(name)
    left join pg_namespace n on n.nspname = 'public'
    left join pg_class c on c.relnamespace = n.oid and c.relname = expected.name and c.relkind = 'r';

  -- pg_proc بدلاً من to_regproc: يدعم overloads ولا يفشل مع الأسماء المكررة
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', expected.name,
      'exists', exists(select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = expected.name)
    ) order by expected.name), '[]'::jsonb)
    into v_functions
    from unnest(v_expected_functions) expected(name);

  if exists(
    select 1 from unnest(v_expected_functions) f(name)
     where not exists(select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = f.name)
  ) then v_healthy := false; end if;

  return jsonb_build_object(
    'healthy', v_healthy,
    'checked_at', now(),
    'database_time', clock_timestamp(),
    'postgres_version', current_setting('server_version'),
    'tables', v_tables,
    'functions', v_functions
  );
end $$;

revoke all on function public.admin_database_health_v18() from public, anon;
grant execute on function public.admin_database_health_v18() to authenticated, service_role;

-- ضمان ملكية الدوال المعدّلة لـ postgres
do $owner$
declare r record;
  fns text[] := array['is_admin', 'admin_database_health_v18'];
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    for r in
      select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.proname = any(fns)
    loop
      begin execute format('alter function %s owner to postgres', r.sig);
      exception when others then null; end;
    end loop;
  end if;
end $owner$;

-- ============================================================================
-- تحقّق بعد التنفيذ:
--
-- 1) is_admin() مع service_role:
--    set local role service_role;
--    select public.is_admin();  -- يجب أن تعيد true
--    set local role postgres;
--
-- 2) save_invoice overloads:
--    select p.proname, pg_get_function_arguments(p.oid) as args
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'save_invoice';
--    -- يجب أن يعيد صفاً واحداً فقط
--
-- 3) الفحص من لوحة المطوّر: يجب أن تظهر ✓ save_invoice()
-- ============================================================================
