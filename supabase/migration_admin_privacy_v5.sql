-- ============================================================================
-- v5 — خصوصية بيانات العملاء التشغيلية (آمن التكرار)
--
-- المطوّر يتحكّم في الاشتراك والبيانات التعريفية/الضريبية فقط،
-- ولا يستطيع الاطّلاع على فواتير العملاء أو أرصدتهم أو عملياتهم — حتى من SQL
-- عبر واجهة التطبيق (RLS)، لأن سياسة admin_full_access تُحذف من جداول التشغيل.
-- (مفتاح الخدمة service_role يُستخدم فقط في مسارات خادمية محمية مثل إنشاء المستخدم الإضافي.)
-- ============================================================================

do $privacy$
declare
  t text;
  -- الجداول الإدارية التي يحتاجها المطوّر فعلاً
  allowed text[] := array[
    'companies', 'profiles', 'activation_requests', 'support_messages',
    'complaints', 'complaint_messages', 'app_settings', 'activity_logs',
    'feature_catalog', 'company_features'
  ];
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public'
       and tablename <> all (allowed)
  loop
    -- أي سياسة تمنح المطوّر وصولاً كاملاً على بيانات تشغيلية تُحذف
    execute format('drop policy if exists admin_full_access on public.%I', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
  end loop;
end $privacy$;

-- التأكد من بقاء عزل المستأجر على تلك الجداول (كل شركة ترى بياناتها فقط)
do $tenant$
declare t text;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (
         select 1 from information_schema.columns col
          where col.table_schema = 'public' and col.table_name = c.relname
            and col.column_name = 'company_id'
       )
       and c.relname <> all (array[
         'companies', 'profiles', 'activation_requests', 'support_messages',
         'complaints', 'complaint_messages', 'company_features'
       ])
  loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t and policyname = 'tenant_isolation'
    ) then
      execute format(
        'create policy tenant_isolation on public.%I for all
           using (company_id = public.auth_company_id())
           with check (company_id = public.auth_company_id())', t);
    end if;
  end loop;
end $tenant$;

-- ============================================================================
-- للتأكد: يجب ألا تُرجع هذه أي صف (لا سياسة وصول كامل للمطوّر على جداول التشغيل)
--   select tablename, policyname from pg_policies
--    where schemaname = 'public'
--      and policyname in ('admin_full_access')
--      and tablename not in ('companies','profiles','activation_requests',
--                            'support_messages','complaints','complaint_messages',
--                            'app_settings','activity_logs');
-- ============================================================================
