-- ============================================================================
-- ترقية قاعدة بيانات قائمة (النسخة أحادية الشركة) إلى نسخة متعددة المستخدمين + VAT
-- الصق هذا الملف كاملاً في Supabase Dashboard > SQL Editor > Run
-- (بديل عن schema.sql — لا يحذف أي بيانات، يضيف الأعمدة والسياسات فقط)
-- ============================================================================

-- دوال الصلاحيات
create or replace function public.is_admin() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce((auth.jwt() ->> 'email'), '') = 'conta.moha@gmail.com';
$$;

-- ملفات المستخدمين
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  name         text default '',
  company_name text default '',
  phone        text default '',
  role         text not null default 'user' check (role in ('user', 'admin')),
  is_active    boolean not null default true,
  created_at   timestamptz default now()
);

-- إضافة عمود user_id لكل جدول بيانات قائم
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings','financial_years','customers','employees','vehicles','cashboxes','banks',
    'invoices','invoice_trips','trip_expenses','receipt_vouchers',
    'payment_vouchers','payrolls','advance_settlements','year_snapshots'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists user_id uuid default auth.uid() references auth.users(id) on delete cascade', t);
  end loop;
end $$;

-- إعادة بناء مفتاح الإعدادات ليكون مركّباً (user_id, key) — مع الحفاظ على القيم الحالية
do $$
begin
  alter table public.settings drop constraint if exists settings_pkey;
  alter table public.settings alter column key drop not null;
end $$;
alter table public.settings alter column key set not null;
alter table public.settings add primary key (user_id, key);

-- السنة تصبح فريدة داخل نطاق المستخدم
alter table public.financial_years drop constraint if exists financial_years_year_key;
alter table public.financial_years add constraint financial_years_user_year_key unique (user_id, year);

-- عمود نسبة الضريبة على الفواتير
alter table public.invoices add column if not exists vat_rate double precision not null default 15;

-- دالة الحالة النشطة (بعد إنشاء profiles)
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select p.is_active from public.profiles p where p.id = auth.uid()),
    true
  );
$$;

-- RLS: ملفات المستخدمين والإعدادات
alter table public.profiles enable row level security;
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.settings enable row level security;
drop policy if exists settings_own on public.settings;
create policy settings_own on public.settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings
  for all using (public.is_admin()) with check (public.is_admin());

-- RLS لبقية الجداول
do $$
declare
  t text;
begin
  foreach t in array array[
    'financial_years','customers','employees','vehicles','cashboxes','banks',
    'invoices','invoice_trips','trip_expenses','receipt_vouchers',
    'payment_vouchers','payrolls','advance_settlements','year_snapshots'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all
         using (user_id = auth.uid() and public.is_active_user())
         with check (user_id = auth.uid() and public.is_active_user())', t);
    -- (أُزيلت) admin_full_access — سبب ظهور بيانات شركة أخرى في حساب المطوّر.
    execute format('drop policy if exists admin_full_access on public.%I', t);
  end loop;
end $$;

-- صلاحية المطوّر تلقائياً
create or replace function public.set_admin_role() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.email = 'conta.moha@gmail.com' then
    new.role := 'admin';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_admin on public.profiles;
create trigger trg_profiles_admin
  before insert on public.profiles
  for each row execute function public.set_admin_role();

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
