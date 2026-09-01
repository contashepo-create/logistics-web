-- ============================================================================
-- إصلاح تسرّب البيانات بين الشركات (v9) — آمن التكرار
--
-- السبب الجذري:
--   ملفات schema.sql / migration_company_id.sql / migration_auth_vat.sql تنشئ
--   على كل جداول التشغيل سياسة ثانية اسمها admin_full_access:
--       for all using (public.is_admin()) with check (public.is_admin())
--   وسياسات RLS في Postgres تُجمَع بـ OR. فحساب المطوّر (conta.moha@gmail.com)
--   يتجاوز شرط company_id ويرى ويُعدّل بيانات كل الشركات — تظهر مدمجة داخل
--   شاشاته العادية (العملاء/الفواتير/…) وكأنها بياناته.
--   ملف migration_admin_privacy_v5.sql كان يحذف هذه السياسات، لكن إعادة تشغيل
--   أي ملف أقدم (schema.sql مثلاً) يعيد إنشاءها ⇒ يعود التسريب.
--
-- هذا الملف: يحذف admin_full_access نهائياً من جداول التشغيل، ويضمن وجود
--   tenant_isolation على كل جدول فيه company_id، ويمنع الصفوف بلا شركة.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) حذف كل سياسة تمنح المطوّر وصولاً كاملاً على بيانات تشغيلية
-- ---------------------------------------------------------------------------
do $privacy$
declare
  r record;
  admin_tables text[] := array[
    'companies', 'profiles', 'activation_requests', 'support_messages',
    'complaints', 'complaint_messages', 'app_settings', 'activity_logs'
  ];
begin
  for r in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename <> all (admin_tables)
       and (policyname = 'admin_full_access'
            or policyname like '%\_admin' escape '\'
            or policyname like 'admin\_%' escape '\')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    raise notice 'حُذفت سياسة % على %', r.policyname, r.tablename;
  end loop;
end $privacy$;

-- ---------------------------------------------------------------------------
-- 2) ضمان عزل المستأجر على كل جدول فيه company_id
--    (يشمل الجداول التي أُضيفت لاحقاً: suppliers, purchase_invoices,
--     purchase_items, credit_debit_notes, year_opening_balances ...)
-- ---------------------------------------------------------------------------
do $tenant$
declare
  t text;
  admin_tables text[] := array[
    'companies', 'profiles', 'activation_requests', 'support_messages',
    'complaints', 'complaint_messages', 'app_settings', 'activity_logs'
  ];
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname <> all (admin_tables)
       and exists (
         select 1 from information_schema.columns col
          where col.table_schema = 'public' and col.table_name = c.relname
            and col.column_name = 'company_id')
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all
         to authenticated
         using (company_id is not null and company_id = public.auth_company_id())
         with check (company_id is not null and company_id = public.auth_company_id())', t);
    -- الحارس الذي يفرض company_id عند الإدراج (لا يعتمد على المُرسَل من العميل)
    if t not in ('credit_debit_notes') then
      execute format('drop trigger if exists trg_set_company_id on public.%I', t);
      execute format(
        'create trigger trg_set_company_id before insert on public.%I
           for each row execute function public.set_company_id()', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $tenant$;

-- سياسات مكرّرة قديمة بأسماء مختلفة على نفس الجداول تُحذف حتى لا تُجمع بـ OR
do $dupes$
declare r record;
begin
  for r in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in (
         select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind='r'
            and exists (select 1 from information_schema.columns col
                         where col.table_schema='public' and col.table_name=c.relname
                           and col.column_name='company_id')
            and c.relname not in ('companies','profiles','activation_requests',
                                  'support_messages','complaints','complaint_messages',
                                  'app_settings','activity_logs'))
       and policyname not in ('tenant_isolation')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    raise notice 'حُذفت سياسة مكرّرة % على %', r.policyname, r.tablename;
  end loop;
end $dupes$;

-- ---------------------------------------------------------------------------
-- 3) منع تكرار الحالة: company_id إجباري على جداول التشغيل
-- ---------------------------------------------------------------------------
do $notnull$
declare t text; n bigint;
begin
  for t in
    select c.relname from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace
     where nsp.nspname='public' and c.relkind='r'
       and c.relname not in ('companies','profiles','activation_requests',
                             'support_messages','complaints','complaint_messages',
                             'app_settings','activity_logs')
       and exists (select 1 from information_schema.columns col
                    where col.table_schema='public' and col.table_name=c.relname
                      and col.column_name='company_id'
                      and col.is_nullable='YES')
  loop
    execute format('select count(*) from public.%I where company_id is null', t) into n;
    if n = 0 then
      begin
        execute format('alter table public.%I alter column company_id set not null', t);
      exception when others then
        raise notice 'تعذّر جعل company_id إجبارياً على %: %', t, sqlerrm;
      end;
    else
      raise notice 'تنبيه: % يحتوي % صفاً بلا company_id — راجعها يدوياً قبل فرض NOT NULL', t, n;
    end if;
  end loop;
end $notnull$;

-- ---------------------------------------------------------------------------
-- 4) بديل آمن لإحصاءات لوحة المطوّر
--    لوحة المطوّر (adminStats) كانت تَعُدّ صفوف customers/invoices/... مباشرة،
--    وكان ذلك ينجح فقط بفضل الثغرة (admin_full_access). بعد إغلاقها ستعود
--    الأصفار. البديل: دالة SECURITY DEFINER تُرجع **أرقاماً مجمّعة فقط**
--    (بلا أي صف بيانات عميل) ومحمية بفحص is_admin().
-- ---------------------------------------------------------------------------
create or replace function public.admin_platform_stats()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $stats$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح لك بهذا الإجراء.';
  end if;
  select jsonb_build_object(
    'companies',        (select count(*) from public.companies),
    'active_companies', (select count(*) from public.companies where is_active),
    'customers',        (select count(*) from public.customers),
    'invoices',         (select count(*) from public.invoices),
    'trips',            (select count(*) from public.invoice_trips),
    'receipts',         (select count(*) from public.receipt_vouchers),
    'payments',         (select count(*) from public.payment_vouchers),
    'payrolls',         (select count(*) from public.payrolls),
    'revenue',          (select coalesce(sum(price), 0)      from public.invoice_trips),
    'collected',        (select coalesce(sum(amount), 0)     from public.receipt_vouchers),
    'spent',            (select coalesce(sum(amount), 0)     from public.payment_vouchers),
    'salaries',         (select coalesce(sum(net_salary), 0) from public.payrolls)
  ) into v;
  return v;
end $stats$;

revoke all on function public.admin_platform_stats() from public, anon;
grant execute on function public.admin_platform_stats() to authenticated;

commit;

-- ============================================================================
-- تحقّق بعد التنفيذ — يجب ألا تُرجع أي صف:
--   select tablename, policyname from pg_policies
--    where schemaname='public' and policyname <> 'tenant_isolation'
--      and tablename in (select c.relname from pg_class c
--                          join pg_namespace n on n.oid=c.relnamespace
--                         where n.nspname='public' and c.relkind='r'
--                           and exists (select 1 from information_schema.columns col
--                                        where col.table_schema='public'
--                                          and col.table_name=c.relname
--                                          and col.column_name='company_id')
--                           and c.relname not in ('companies','profiles',
--                                'activation_requests','support_messages',
--                                'complaints','complaint_messages',
--                                'app_settings','activity_logs'));
-- ============================================================================
