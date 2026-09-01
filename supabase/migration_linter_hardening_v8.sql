-- ============================================================================
-- معالجة تنبيهات مدقّق أمان Supabase (Database Linter) — الإصدار v8
-- الصق الملف كاملاً في: Supabase > SQL Editor > New query > Run  (آمن التكرار)
--
-- يعالج:
--  1) 0011_function_search_path_mutable
--     تثبيت search_path لكل دوال المخطط public (is_admin, safe_text,
--     set_company_id, clean_activation_request, guard_supplier_delete,
--     set_client_code, set_profile_guard, gen_code, is_allowed_email,
--     check_tax_identifiers ... وأي دالة أخرى تُضاف لاحقاً).
--  2) 0025_public_bucket_allows_listing
--     إزالة سياسة SELECT الواسعة على دلو receipts العام (سرد كل الملفات).
--  3) 0028_anon_security_definer_function_executable
--     سحب EXECUTE من anon/public عن كل دوال SECURITY DEFINER
--     (باستثناء is_allowed_email المطلوبة قبل التسجيل).
--  4) 0029_authenticated_security_definer_function_executable
--     سحب EXECUTE من authenticated عن دوال الـ trigger والدوال الداخلية،
--     والإبقاء فقط على قائمة RPC التي تستدعيها الواجهة فعلياً.
--  5) auth_leaked_password_protection — إعداد لوحة تحكم (انظر آخر الملف).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) تثبيت search_path لكل دوال public (لا تعتمد على إعادة تعريف الدوال)
-- ---------------------------------------------------------------------------
do $fix_search_path$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (p.proconfig is null
           or not exists (
             select 1 from unnest(p.proconfig) cfg
             where cfg like 'search_path=%'
           ))
  loop
    begin
      execute format('alter function %s set search_path = public, pg_temp', r.sig);
    exception when others then
      raise notice 'تعذّر ضبط search_path للدالة %: %', r.sig, sqlerrm;
    end;
  end loop;
end $fix_search_path$;

-- ---------------------------------------------------------------------------
-- 2) دلو receipts: منع سرد الملفات مع بقاء روابط الكائنات العامة تعمل
--    (الدلو العام لا يحتاج سياسة SELECT على storage.objects لعرض الصور،
--     ووجودها يسمح لأي عميل بسرد كل ملفات الدلو.)
-- ---------------------------------------------------------------------------
do $storage$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "receipts_read_public" on storage.objects';
    -- رفع الملفات يبقى مقتصراً على المستخدمين المصادقين داخل الدلو
    execute 'drop policy if exists "receipts_upload_own" on storage.objects';
    execute $p$
      create policy "receipts_upload_own" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'receipts')
    $p$;
  end if;
exception when insufficient_privilege then
  raise notice 'لا توجد صلاحية لتعديل سياسات storage.objects — نفّذ هذا الجزء بحساب المالك.';
end $storage$;

-- ---------------------------------------------------------------------------
-- 3+4) ضبط صلاحيات EXECUTE على دوال SECURITY DEFINER
--      المبدأ: المنع افتراضياً، ثم منح ما تحتاجه الواجهة فقط.
-- ---------------------------------------------------------------------------
do $grants$
declare
  r record;
  -- دوال RPC التي تستدعيها الواجهة بحساب مصادق عليه
  rpc_authenticated text[] := array[
    'register_company',
    'export_company_data',
    'create_next_financial_year',
    'save_invoice',
    'save_payroll',
    'save_purchase_invoice',
    'admin_update_app_settings',
    'admin_set_company_status',
    'admin_set_subscription',
    'admin_delete_company',
    'admin_review_activation_request',
    'admin_set_profile_status',
    'admin_set_profile_role',
    'whoami'
  ];
  -- دوال يحتاجها الزائر (تحقق البريد قبل إنشاء الحساب)
  rpc_anon text[] := array['is_allowed_email'];
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
    -- المنع الشامل أولاً
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);

    if r.is_trigger then
      -- دوال الـ trigger لا تُستدعى عبر REST إطلاقاً
      continue;
    end if;

    if r.name = any (rpc_anon) then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    elsif r.name = any (rpc_authenticated) then
      execute format('grant execute on function %s to authenticated', r.sig);
    elsif not r.secdef then
      -- دوال SECURITY INVOKER العادية (مساعدات تُستخدم داخل السياسات/الاستعلامات)
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
    -- الباقي (دوال SECURITY DEFINER الداخلية مثل auth_company_id،
    -- is_company_active، is_active_user، log_activity، rls_audit، gen_code،
    -- safe_text) تبقى بلا EXECUTE للأدوار العامة؛ تعمل داخلياً عبر
    -- السياسات والمشغّلات ومالك الدوال.
  end loop;
end $grants$;

-- بقاء service_role بكامل صلاحياته (وظائف الخادم / الصيانة)
do $svc$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $svc$;

-- ---------------------------------------------------------------------------
-- 5) auth_leaked_password_protection — لا يمكن ضبطه بـ SQL
--    Supabase Dashboard > Authentication > Policies (Password) >
--    فعّل "Leaked password protection" (فحص HaveIBeenPwned)،
--    ويُنصح برفع الحد الأدنى لطول كلمة المرور إلى 8+ وتفعيل شروط التعقيد.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- تحقّق بعد التنفيذ:
--   -- لا يجب أن تعود أي صفوف:
--   select p.oid::regprocedure
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f'
--     and (p.proconfig is null or not exists (
--          select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
--
--   -- دوال SECURITY DEFINER التي ما زال بإمكان anon تنفيذها:
--   select p.oid::regprocedure
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and p.prosecdef
--     and has_function_privilege('anon', p.oid, 'execute');
-- ---------------------------------------------------------------------------
