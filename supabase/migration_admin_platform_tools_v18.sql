-- ============================================================================
-- v18: أدوات منصة المطوّر وخصوصية النشاط وتتبع الزوار
--
-- 1) إعادة ضبط البيانات التشغيلية لشركة واحدة مع إبقاء الشركة/الحساب/الاشتراك.
-- 2) قراءة المميزات والمستخدمين عبر RPC محمية بدلاً من قراءة الجداول مباشرة.
-- 3) نظرة عامة إدارية لا تقرأ أرقام أو مبالغ أعمال العملاء.
-- 4) تشخيص بنيوي للاتصال والجداول والسياسات دون قراءة محتوى العملاء.
-- 5) زائر فريد بمعرّف Cookie؛ الانتقال بين الصفحات يزيد page_views لا visitors.
-- 6) سجل النشاط المرئي للمطوّر يقتصر على أفعال حساب المطوّر نفسه.
-- آمن لإعادة التشغيل.
-- ============================================================================

-- يسمح لدالة إدارية بإنشاء سنة جديدة لشركة محددة، مع استمرار منع المستخدم
-- العادي من تزوير company_id في أي إدراج مباشر.
create or replace function public.set_company_id() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.is_admin() and new.company_id is not null then
    return new;
  end if;
  new.company_id := public.auth_company_id();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- سجل الزوار: لا وصول مباشر من المتصفح؛ الكتابة بمفتاح الخدمة والقراءة عبر RPC.
-- ---------------------------------------------------------------------------
create table if not exists public.site_visitors (
  visitor_key text primary key,
  ip_address  text not null default '',
  user_agent  text not null default '',
  browser     text not null default '',
  operating_system text not null default '',
  device_type text not null default '',
  country     text not null default '',
  region      text not null default '',
  city        text not null default '',
  first_path  text not null default '',
  last_path   text not null default '',
  referrer    text not null default '',
  page_views  bigint not null default 1 check (page_views >= 1),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  constraint site_visitors_key_format check (visitor_key ~ '^[a-f0-9]{64}$')
);
create index if not exists idx_site_visitors_last_seen on public.site_visitors(last_seen desc);
create index if not exists idx_site_visitors_first_seen on public.site_visitors(first_seen desc);

alter table public.site_visitors enable row level security;
revoke all on public.site_visitors from public, anon, authenticated;
grant select, insert, update, delete on public.site_visitors to service_role;

create or replace function public.record_site_visit_v18(
  p_visitor_key text,
  p_ip_address text,
  p_user_agent text,
  p_browser text,
  p_operating_system text,
  p_device_type text,
  p_country text,
  p_region text,
  p_city text,
  p_path text,
  p_referrer text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'غير مصرح بتسجيل الزيارة.';
  end if;
  if p_visitor_key is null or p_visitor_key !~ '^[a-f0-9]{64}$' then
    raise exception 'معرّف الزائر غير صالح.';
  end if;

  insert into public.site_visitors(
    visitor_key, ip_address, user_agent, browser, operating_system, device_type,
    country, region, city, first_path, last_path, referrer, page_views, first_seen, last_seen
  ) values (
    p_visitor_key,
    left(coalesce(p_ip_address, ''), 80), left(coalesce(p_user_agent, ''), 500),
    left(coalesce(p_browser, ''), 80), left(coalesce(p_operating_system, ''), 80),
    left(coalesce(p_device_type, ''), 40), left(coalesce(p_country, ''), 80),
    left(coalesce(p_region, ''), 120), left(coalesce(p_city, ''), 120),
    left(coalesce(p_path, ''), 300), left(coalesce(p_path, ''), 300),
    left(coalesce(p_referrer, ''), 500), 1, now(), now()
  )
  on conflict (visitor_key) do update set
    ip_address = excluded.ip_address,
    user_agent = excluded.user_agent,
    browser = excluded.browser,
    operating_system = excluded.operating_system,
    device_type = excluded.device_type,
    country = case when excluded.country <> '' then excluded.country else site_visitors.country end,
    region = case when excluded.region <> '' then excluded.region else site_visitors.region end,
    city = case when excluded.city <> '' then excluded.city else site_visitors.city end,
    last_path = excluded.last_path,
    referrer = case when site_visitors.referrer = '' then excluded.referrer else site_visitors.referrer end,
    page_views = site_visitors.page_views + 1,
    last_seen = now();
end $$;

revoke all on function public.record_site_visit_v18(text,text,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_site_visit_v18(text,text,text,text,text,text,text,text,text,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- إصلاح صفحة المميزات: لقطة إدارية محمية لا تعتمد على SELECT مباشر من الشركات.
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_company_extras_v18(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_features jsonb; v_users jsonb;
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if not exists(select 1 from public.companies where id = p_company_id) then
    raise exception 'الشركة غير موجودة.';
  end if;

  select coalesce(jsonb_object_agg(cf.feature_key, cf.enabled), '{}'::jsonb)
    into v_features
    from public.company_features cf
   where cf.company_id = p_company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'company_id', p.company_id, 'name', p.name, 'email', p.email,
    'phone', p.phone, 'role', p.role, 'is_active', p.is_active, 'created_at', p.created_at
  ) order by p.created_at), '[]'::jsonb)
    into v_users
    from public.profiles p
   where p.company_id = p_company_id;

  return jsonb_build_object('features', v_features, 'users', v_users);
end $$;

revoke all on function public.admin_get_company_extras_v18(uuid) from public, anon;
grant execute on function public.admin_get_company_extras_v18(uuid) to authenticated, service_role;

-- إعادة منح القراءة الأساسية؛ RLS ما زالت تمنع غير المطوّر من قراءة شركات الغير.
grant select on public.companies, public.profiles, public.company_features to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- إعادة ضبط بيانات العمل لشركة واحدة. الجداول الاختيارية تُحذف إن كانت موجودة.
-- لا تُحذف companies/profiles/company_features/activation_requests/support/messages.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reset_company_data_v18(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_table text; v_count bigint; v_total bigint := 0;
  v_counts jsonb := '{}'::jsonb; v_year_id bigint; v_year int;
  v_tables text[] := array[
    'credit_note_trips', 'credit_debit_notes', 'advance_settlements',
    'purchase_items', 'payment_vouchers', 'receipt_vouchers', 'payrolls',
    'trip_expenses', 'invoice_trips', 'invoices',
    'purchase_invoices', 'suppliers',
    'year_opening_balances', 'year_snapshots', 'financial_years',
    'vehicles', 'employees', 'cashboxes', 'banks', 'customers'
  ];
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if p_company_id is null or not exists(select 1 from public.companies where id = p_company_id) then
    raise exception 'الشركة غير موجودة.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reset-company:' || p_company_id::text, 0));

  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      execute format('delete from public.%I where company_id = $1', v_table) using p_company_id;
      get diagnostics v_count = row_count;
      v_total := v_total + v_count;
      v_counts := v_counts || jsonb_build_object(v_table, v_count);
    end if;
  end loop;

  v_year := extract(year from current_date)::int;
  insert into public.financial_years(company_id, year, date_from, date_to, status, notes)
  values(
    p_company_id, v_year, make_date(v_year, 1, 1), make_date(v_year, 12, 31),
    'open', 'سنة جديدة أُنشئت تلقائياً بعد إعادة ضبط بيانات الشركة'
  ) returning id into v_year_id;

  perform public.log_activity(
    'admin.reset_company_data', 'company', p_company_id::text,
    'deleted_rows=' || v_total::text || '; new_year=' || v_year::text
  );
  return jsonb_build_object(
    'deleted_rows', v_total,
    'new_financial_year', v_year,
    'new_financial_year_id', v_year_id,
    'tables', v_counts
  );
end $$;

revoke all on function public.admin_reset_company_data_v18(uuid) from public, anon;
grant execute on function public.admin_reset_company_data_v18(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- نظرة المنصة: بيانات إدارية فقط، بلا عملاء أو فواتير أو مبالغ تشغيلية.
-- ---------------------------------------------------------------------------
create or replace function public.admin_platform_stats_v18()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  return jsonb_build_object(
    'companies', (select count(*) from public.companies),
    'active_companies', (select count(*) from public.companies where is_active),
    'suspended_companies', (select count(*) from public.companies where not is_active),
    'trial_companies', (select count(*) from public.companies where is_active and trial_end >= current_date),
    'subscribed_companies', (select count(*) from public.companies
      where is_active and trial_end < current_date
        and (plan_type = 'open' or subscription_end >= current_date)),
    'expired_companies', (select count(*) from public.companies
      where is_active and trial_end < current_date
        and plan_type <> 'open' and (subscription_end is null or subscription_end < current_date)),
    'new_companies_today', (select count(*) from public.companies where created_at >= current_date),
    'new_companies_30d', (select count(*) from public.companies where created_at >= now() - interval '30 days'),
    'owner_accounts', (select count(*) from public.profiles where role = 'owner'),
    'additional_accounts', (select count(*) from public.profiles where role = 'additional'),
    'pending_requests', (select count(*) from public.activation_requests where status = 'pending'),
    'visitors', (select count(*) from public.site_visitors),
    'visitors_today', (select count(*) from public.site_visitors where first_seen >= current_date),
    'visitors_30d', (select count(*) from public.site_visitors where first_seen >= now() - interval '30 days'),
    'page_views', (select coalesce(sum(page_views), 0) from public.site_visitors),
    'last_visit_at', (select max(last_seen) from public.site_visitors)
  );
end $$;

create or replace function public.admin_recent_visitors_v18(p_limit int default 100)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'ip_address', v.ip_address,
      'browser', v.browser,
      'operating_system', v.operating_system,
      'device_type', v.device_type,
      'country', v.country,
      'region', v.region,
      'city', v.city,
      'first_path', v.first_path,
      'last_path', v.last_path,
      'referrer', v.referrer,
      'page_views', v.page_views,
      'first_seen', v.first_seen,
      'last_seen', v.last_seen
    ) order by v.last_seen desc)
    from (select * from public.site_visitors order by last_seen desc limit v_limit) v
  ), '[]'::jsonb);
end $$;

revoke all on function public.admin_platform_stats_v18() from public, anon;
revoke all on function public.admin_recent_visitors_v18(int) from public, anon;
grant execute on function public.admin_platform_stats_v18() to authenticated, service_role;
grant execute on function public.admin_recent_visitors_v18(int) to authenticated, service_role;

-- إبطال تسريب المؤشرات التشغيلية من اسم الدالة القديم مع إبقاء التوافق للخلف.
-- أي عميل قديم يستدعيها يحصل على مؤشرات المنصة الآمنة نفسها فقط.
create or replace function public.admin_platform_stats()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  return public.admin_platform_stats_v18();
end $$;
revoke all on function public.admin_platform_stats() from public, anon;
grant execute on function public.admin_platform_stats() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- تشخيص الاتصال والبنية فقط؛ لا يعيد أعداد صفوف أو محتوى جداول العملاء.
-- ---------------------------------------------------------------------------
create or replace function public.admin_database_health_v18()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_expected_tables text[] := array[
    'companies','profiles','feature_catalog','company_features','activity_logs',
    'financial_years','customers','employees','vehicles','cashboxes','banks',
    'invoices','invoice_trips','trip_expenses','receipt_vouchers','payment_vouchers',
    'credit_debit_notes','credit_note_trips','payrolls','advance_settlements','year_snapshots',
    'activation_requests','suppliers','purchase_invoices','purchase_items','year_opening_balances',
    'support_messages','complaints','complaint_messages','app_settings','site_visitors'
  ];
  v_expected_functions text[] := array[
    'auth_company_id','is_company_active','register_company_with_year','save_invoice',
    'save_payroll','admin_set_company_feature','admin_reset_company_data_v18',
    'admin_platform_stats_v18','record_site_visit_v18'
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

  select coalesce(jsonb_agg(jsonb_build_object(
      'name', expected.name,
      'exists', to_regproc('public.' || expected.name) is not null
    ) order by expected.name), '[]'::jsonb)
    into v_functions
    from unnest(v_expected_functions) expected(name);

  if exists(
    select 1 from unnest(v_expected_functions) f(name)
     where to_regproc('public.' || f.name) is null
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

-- المطوّر يرى أفعاله هو فقط، ولا تظهر عمليات العملاء اليومية في قسم النشاط.
drop policy if exists activity_read on public.activity_logs;
create policy activity_read on public.activity_logs
  for select to authenticated
  using (actor_id = auth.uid());
grant select on public.activity_logs to authenticated, service_role;
