-- ============================================================================
-- النظام المحاسبي المتكامل لشركة النقل — مخطط Supabase (PostgreSQL)
-- عزل كامل عبر company_id + اشتراك واحد (شهري/سنوي/مفتوح) + أمان مشدّد
--
-- التشغيل (تثبيت جديد): الصق هذا الملف كاملاً في Supabase Dashboard > SQL Editor > Run
-- الترقية من نسخة قائمة: استخدم supabase/migration_company_id.sql
--
-- ⚠️  بريد المطوّر مُرمَّز في دالة is_admin() هنا وفي src/lib/auth.ts (ADMIN_EMAIL)
--     يجب أن يبقيا متطابقين.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- دوال الصلاحيات
--   ملاحظة: auth_company_id و is_company_active تعتمدان على جدولي profiles/companies،
--   لذلك يُعرَّفان بعد إنشاء الجدولين (PostgreSQL 14+ يفحص جسم دوال SQL عند الإنشاء).
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce((auth.jwt() ->> 'email'), '') = 'conta.moha@gmail.com';
$$;

-- ---------------------------------------------------------------------------
-- الشركات (وحدة العزل + الاشتراك)
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  phone              text default '',
  email              text default '',
  address            text default '',
  currency           text default 'ر.س',
  vat_rate           double precision not null default 15,
  vat_note           text default 'فاتورة مرجعية — ضريبة القيمة المضافة 15%',
  plan_type          text not null default 'monthly' check (plan_type in ('monthly', 'yearly', 'open')),
  trial_end          date not null default (current_date + 7),
  subscription_start date,
  subscription_end   date,          -- null = اشتراك مفتوح بلا تحديد
  is_active          boolean not null default true,
  created_at         timestamptz default now()
);

-- الحقول التشغيلية القابلة للتعديل من شاشة «الإعدادات ← بيانات الشركة»
-- (تُضاف هنا حتى تعمل النسخة الجديدة من أول تشغيل، وإلا ظهر «permission denied»)
alter table public.companies add column if not exists name_en          text default '';   -- الاسم بالإنجليزية
alter table public.companies add column if not exists website         text default '';
alter table public.companies add column if not exists tax_number      text default '';   -- الرقم الضريبي
alter table public.companies add column if not exists commercial_reg  text default '';   -- السجل التجاري
alter table public.companies add column if not exists unified_number  text default '';   -- الرقم الموحّد للمنشأة
alter table public.companies add column if not exists entity_type     text default 'establishment';
alter table public.companies add column if not exists tax_status      text default 'taxable';
alter table public.companies add column if not exists country         text default 'SA';
alter table public.companies add column if not exists region          text default '';
alter table public.companies add column if not exists city            text default '';
alter table public.companies add column if not exists district        text default '';
alter table public.companies add column if not exists street          text default '';
alter table public.companies add column if not exists building_no     text default '';
alter table public.companies add column if not exists postal_code     text default '';
alter table public.companies add column if not exists additional_no   text default '';
alter table public.companies add column if not exists address_note    text default '';
alter table public.companies add column if not exists print_settings  jsonb not null default '{}'::jsonb;

alter table public.companies drop constraint if exists companies_entity_type_check;
alter table public.companies add constraint companies_entity_type_check
  check (entity_type in ('establishment', 'company', 'individual', 'nonprofit', 'government'));
alter table public.companies drop constraint if exists companies_tax_status_check;
alter table public.companies add constraint companies_tax_status_check
  check (tax_status in ('taxable', 'exempt', 'not_registered'));

-- ---------------------------------------------------------------------------
-- الملفات الشخصية (رابط المستخدم ← شركته) — بلا نظام أدوار/صلاحيات
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  email      text not null default '',
  name       text default '',
  created_at timestamptz default now()
);

-- معرّف الشركة للمستخدم الحالي (security definer + search_path مُقيّد)
create or replace function public.auth_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.company_id from public.profiles p where p.id = auth.uid();
$$;

-- هل شركة المستخدم الحالي نشطة واشتراكها ساري (أو ضمن التجربة المجانية)؟
create or replace function public.is_company_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.is_active and (
            c.trial_end >= current_date                       -- ضمن التجربة
            or c.plan_type = 'open'                           -- اشتراك مفتوح
            or (c.subscription_end is not null and c.subscription_end >= current_date)
         )
     from public.companies c
     join public.profiles p on p.company_id = c.id
     where p.id = auth.uid()),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- سجل النشاط (audit log)
-- ---------------------------------------------------------------------------
create table if not exists public.activity_logs (
  id          bigint generated by default as identity primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text default '',
  action      text not null,
  entity      text default '',
  entity_id   text default '',
  detail      text default '',
  created_at  timestamptz default now()
);

create or replace function public.log_activity(
  p_action text, p_entity text default '', p_entity_id text default '', p_detail text default ''
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_logs (actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), p_action, p_entity, p_entity_id, p_detail);
end $$;

-- ---------------------------------------------------------------------------
-- جداول البيانات (كلها بشرط company_id)
-- ---------------------------------------------------------------------------
create table if not exists public.financial_years (
  id        bigint generated by default as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  year      integer not null,
  date_from date not null,
  date_to   date not null,
  status    text not null default 'open' check (status in ('open', 'closed')),
  notes     text default '',
  unique (company_id, year)
);

create table if not exists public.customers (
  id               bigint generated by default as identity primary key,
  company_id       uuid not null references public.companies(id) on delete cascade,
  code             text not null default '',
  name             text not null,
  address          text default '',
  phone            text default '',
  opening_balance  double precision not null default 0,
  notes            text default '',
  created_at       timestamptz default now()
);

create table if not exists public.employees (
  id          bigint generated by default as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null default '',
  name        text not null,
  nationality text default '',
  phone       text default '',
  emp_type    text not null default 'driver' check (emp_type in ('driver', 'admin')),
  notes       text default '',
  created_at  timestamptz default now()
);

create table if not exists public.vehicles (
  id                bigint generated by default as identity primary key,
  company_id        uuid not null references public.companies(id) on delete cascade,
  code              text not null default '',
  plate_number      text not null default '',
  vehicle_type      text default '',
  default_driver_id bigint references public.employees(id) on delete set null,
  notes             text default '',
  created_at        timestamptz default now()
);

create table if not exists public.cashboxes (
  id              bigint generated by default as identity primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  code            text not null default '',
  name            text not null,
  created_date    date not null,
  opening_balance double precision not null default 0,
  notes           text default '',
  created_at      timestamptz default now()
);

create table if not exists public.banks (
  id              bigint generated by default as identity primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  code            text not null default '',
  name            text not null,
  created_date    date not null,
  account_number  text default '',
  iban            text default '',
  opening_balance double precision not null default 0,
  notes           text default '',
  created_at      timestamptz default now()
);

create table if not exists public.invoices (
  id               bigint generated by default as identity primary key,
  company_id       uuid not null references public.companies(id) on delete cascade,
  number           integer not null,
  date             date not null,
  customer_id      bigint not null references public.customers(id),
  vat_rate         double precision not null default 15,
  notes            text default '',
  attachments      jsonb default '[]'::jsonb,
  container_number text default '',
  created_at       timestamptz default now()
);

create table if not exists public.invoice_trips (
  id         bigint generated by default as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  vehicle_id bigint references public.vehicles(id) on delete set null,
  driver_id  bigint references public.employees(id) on delete set null,
  from_loc   text default '',
  to_loc     text default '',
  qty        integer not null default 1,
  unit_price double precision not null default 0,
  price      double precision not null default 0,
  notes      text default ''
);

create table if not exists public.trip_expenses (
  id           bigint generated by default as identity primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  trip_id      bigint not null references public.invoice_trips(id) on delete cascade,
  expense_type text not null default 'other'
               check (expense_type in ('trip', 'fuel', 'card', 'other')),
  qty          double precision not null default 1,
  unit_amount  double precision not null default 0,
  amount       double precision not null default 0,
  source       text not null default 'cash'
               check (source in ('cash', 'driver', 'supplier', 'customer')),
  account_kind text,
  account_id   bigint,
  supplier_name text default '',
  notes        text default ''
);

create table if not exists public.receipt_vouchers (
  id           bigint generated by default as identity primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  number       integer not null,
  date         date not null,
  account_kind text not null check (account_kind in ('cashbox', 'bank')),
  account_id   bigint not null,
  voucher_type text not null check (voucher_type in ('customer', 'other')),
  customer_id  bigint references public.customers(id) on delete set null,
  amount       double precision not null default 0,
  description  text default '',
  created_at   timestamptz default now()
);

create table if not exists public.payment_vouchers (
  id                  bigint generated by default as identity primary key,
  company_id          uuid not null references public.companies(id) on delete cascade,
  number              integer not null,
  date                date not null,
  account_kind        text not null check (account_kind in ('cashbox', 'bank')),
  account_id          bigint not null,
  voucher_type        text not null
                      check (voucher_type in ('trip', 'advance', 'vehicle', 'general', 'supplier', 'owner')),
  trip_id             bigint references public.invoice_trips(id) on delete set null,
  employee_id         bigint references public.employees(id) on delete set null,
  vehicle_id          bigint references public.vehicles(id) on delete set null,
  vehicle_expense     text default '',
  supplier_id         bigint references public.suppliers(id) on delete set null,
  purchase_invoice_id bigint references public.purchase_invoices(id) on delete set null,
  source_expense_id   bigint references public.trip_expenses(id) on delete cascade,
  amount              double precision not null default 0,
  description         text default '',
  created_at          timestamptz default now()
);

-- إشعارات الدائن والمدين (تصحيح الفواتير الصادرة بدون تعديلها)
create table if not exists public.credit_debit_notes (
  id          bigint generated by default as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  number      integer not null,
  note_type   text not null check (note_type in ('credit', 'debit')),
  invoice_id  bigint not null references public.invoices(id),
  customer_id bigint not null references public.customers(id),
  date        date not null,
  amount      numeric(14,2) not null check (amount > 0),
  vat_rate    numeric(5,2) not null default 15,
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  unique (company_id, number)
);
create index if not exists idx_notes_company_customer_date
  on public.credit_debit_notes(company_id, customer_id, date);
create or replace function public.set_note_company_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.company_id := public.auth_company_id();
  if new.company_id is null then raise exception 'لا توجد شركة مرتبطة بالحساب.'; end if;
  if not exists(select 1 from public.invoices i where i.id = new.invoice_id and i.company_id = new.company_id and i.customer_id = new.customer_id) then
    raise exception 'الفاتورة والعميل لا ينتميان إلى الشركة الحالية.';
  end if;
  return new;
end $$;
drop trigger if exists trg_note_company on public.credit_debit_notes;
create trigger trg_note_company before insert or update on public.credit_debit_notes
  for each row execute function public.set_note_company_id();

create table if not exists public.payrolls (
  id                bigint generated by default as identity primary key,
  company_id        uuid not null references public.companies(id) on delete cascade,
  number            integer not null,
  date              date not null,
  employee_id       bigint not null references public.employees(id),
  period_year       integer not null,
  period_month      integer not null,
  account_kind      text not null check (account_kind in ('cashbox', 'bank')),
  account_id        bigint not null,
  base_salary       double precision not null default 0,
  additions         double precision not null default 0,
  additions_note    text default '',
  advance_deduction double precision not null default 0,
  other_deductions  double precision not null default 0,
  net_salary        double precision not null default 0,
  notes             text default '',
  created_at        timestamptz default now()
);

create table if not exists public.advance_settlements (
  id                 bigint generated by default as identity primary key,
  company_id         uuid not null references public.companies(id) on delete cascade,
  payment_voucher_id bigint not null references public.payment_vouchers(id) on delete cascade,
  payroll_id         bigint not null references public.payrolls(id) on delete cascade,
  amount             double precision not null default 0
);

create table if not exists public.year_snapshots (
  id         bigint generated by default as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  year_id    bigint not null unique references public.financial_years(id) on delete cascade,
  created_at timestamptz default now(),
  data       jsonb not null default '{}'::jsonb
);

-- طلبات الاشتراك/الترقية/التجديد (يرفعها العميل، يراجعها المطوّر)
create table if not exists public.activation_requests (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  plan_type   text not null check (plan_type in ('monthly', 'yearly')),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  receipt_url text,
  notes       text default '',
  admin_notes text default '',
  created_at  timestamptz default now(),
  reviewed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- الفهارس
-- ---------------------------------------------------------------------------
create index if not exists idx_trips_invoice on public.invoice_trips(invoice_id);
create index if not exists idx_expenses_trip on public.trip_expenses(trip_id);
create index if not exists idx_invoices_customer on public.invoices(customer_id);
create index if not exists idx_invoices_date on public.invoices(date);
create index if not exists idx_receipts_customer on public.receipt_vouchers(customer_id);
create index if not exists idx_payments_trip on public.payment_vouchers(trip_id);
create index if not exists idx_settlements_payroll on public.advance_settlements(payroll_id);
create index if not exists idx_settlements_voucher on public.advance_settlements(payment_voucher_id);
create index if not exists idx_logs_created on public.activity_logs(created_at);
create index if not exists idx_activation_company on public.activation_requests(company_id);
-- منع وجود أكثر من طلب معلق واحد لكل شركة (حماية من سباق الطلبات المكررة)
create unique index if not exists uq_activation_pending
  on public.activation_requests(company_id) where status = 'pending';
-- منع تكرار أرقام المستندات داخل الشركة الواحدة (سلامة محاسبية + منع سباق الترقيم)
create unique index if not exists uq_invoices_company_number on public.invoices(company_id, number);
create unique index if not exists uq_receipts_company_number on public.receipt_vouchers(company_id, number);
create unique index if not exists uq_payments_company_number on public.payment_vouchers(company_id, number);
create unique index if not exists uq_payrolls_company_number on public.payrolls(company_id, number);

-- ---------------------------------------------------------------------------
-- حارس فرض company_id عند الإدراج (يمنع أي عميل من تزوير الشركة)
-- ---------------------------------------------------------------------------
create or replace function public.set_company_id() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.company_id := public.auth_company_id();
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'financial_years','customers','employees','vehicles','cashboxes','banks',
    'invoices','invoice_trips','trip_expenses','receipt_vouchers',
    'payment_vouchers','payrolls','advance_settlements','year_snapshots','activation_requests'
  ]
  loop
    execute format('drop trigger if exists trg_set_company_id on public.%I', t);
    execute format(
      'create trigger trg_set_company_id before insert on public.%I
       for each row execute function public.set_company_id()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: عزل كامل عبر company_id
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_own_select on public.profiles for select using (id = auth.uid());
-- إنشاء الملف الشخصي مباشرةً: يجب ألا يعيّن المستخدم company_id بنفسه (وإلا
-- استطاع ربط حسابه بشركة أخرى وقراءة بياناتها). الشركة تُربط حصراً عبر
-- register_company (security definer يتجاوز RLS).
create policy profiles_own_insert on public.profiles for insert
  with check (id = auth.uid() and company_id is null);
create policy profiles_own_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.companies enable row level security;
create policy companies_own on public.companies
  for select using (id = public.auth_company_id() or public.is_admin());
create policy companies_own_update on public.companies
  for update using (id = public.auth_company_id()) with check (id = public.auth_company_id());
create policy companies_admin on public.companies for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.activity_logs enable row level security;
create policy activity_read on public.activity_logs for select
  using (actor_id = auth.uid() or public.is_admin());

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
    execute format(
      'create policy tenant_isolation on public.%I for all
         using (company_id = public.auth_company_id() and public.is_company_active())
         with check (company_id = public.auth_company_id() and public.is_company_active())', t);
    -- لا تُنشأ سياسة admin_full_access على جداول التشغيل: سياسات RLS تُجمع بـ OR،
    -- فكانت تمنح حساب المطوّر رؤية بيانات كل الشركات مدمجة داخل شاشاته العادية
    -- (تسريب بين المستأجرين). خصوصية العميل مطلوبة، والمطوّر يدير الاشتراكات فقط.
    execute format('drop policy if exists admin_full_access on public.%I', t);
  end loop;
end $$;

-- إشعارات الدائن والمدين: عزل عبر company_id مع حارس يتحقق من الفاتورة/العميل
alter table public.credit_debit_notes enable row level security;
create policy notes_tenant on public.credit_debit_notes for all
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());

-- طلبات الاشتراك: يُسمح للمالك بالقراءة/الإدراج/الحذف حتى بعد انتهاء اشتراكه
-- (وإلا لما استطاع العميل المنتهي تقديم طلب تجديد). company_id يُفرض عبر حارس
-- set_company_id قبل الإدراج، فلا يمكن تزوير الشركة.
alter table public.activation_requests enable row level security;
create policy activation_owner_select on public.activation_requests
  for select using (company_id = public.auth_company_id());
create policy activation_owner_insert on public.activation_requests
  for insert with check (company_id = public.auth_company_id());
create policy activation_owner_delete on public.activation_requests
  for delete using (company_id = public.auth_company_id());
create policy activation_admin on public.activation_requests for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- التسجيل: إنشاء الشركة + الملف الشخصي (الطريقة الوحيدة لإنشاء شركة)
-- ---------------------------------------------------------------------------
create or replace function public.register_company(
  p_company_name text, p_name text default '', p_phone text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_company uuid;
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول أولاً.'; end if;
  if p_company_name is null or btrim(p_company_name) = '' then
    raise exception 'اسم الشركة مطلوب.';
  end if;

  select company_id into v_company from public.profiles where id = v_user;
  if v_company is not null then
    return v_company;
  end if;

  insert into public.companies (name, phone, email)
  values (btrim(p_company_name), p_phone, v_email)
  returning id into v_company;
  insert into public.profiles (id, company_id, email, name) values (v_user, v_company, v_email, p_name);
  perform public.log_activity('signup', 'company', v_company::text, p_company_name);
  return v_company;
end $$;

revoke execute on function public.register_company(text, text, text) from public, anon;
grant execute on function public.register_company(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- دوال إدارة المطوّر (فحص is_admin داخلياً)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_company_status(p_company_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  update public.companies set is_active = p_active where id = p_company_id;
  perform public.log_activity(
    case when p_active then 'admin.activate_company' else 'admin.deactivate_company' end,
    'company', p_company_id::text, '');
end $$;

create or replace function public.admin_set_subscription(
  p_company_id uuid, p_plan_type text, p_end_date date default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if p_plan_type not in ('monthly', 'yearly', 'open') then
    raise exception 'نوع الاشتراك غير صالح.';
  end if;
  update public.companies
  set plan_type = p_plan_type,
      subscription_end = case when p_plan_type = 'open' then null else p_end_date end
  where id = p_company_id;
  perform public.log_activity('admin.set_subscription', 'company', p_company_id::text,
    p_plan_type || coalesce(' | ' || p_end_date::text, ''));
end $$;

create or replace function public.admin_delete_company(p_company_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  delete from public.companies where id = p_company_id;  -- cascades عبر الشركة
  perform public.log_activity('admin.delete_company', 'company', p_company_id::text, '');
end $$;

revoke execute on function public.admin_set_company_status(uuid, boolean) from public, anon;
revoke execute on function public.admin_set_subscription(uuid, text, date) from public, anon;
revoke execute on function public.admin_delete_company(uuid) from public, anon;
grant execute on function public.admin_set_company_status(uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_set_subscription(uuid, text, date) to authenticated, service_role;
grant execute on function public.admin_delete_company(uuid) to authenticated, service_role;

-- مراجعة طلب الاشتراك (موافقة/رفض) — قفل الصف + تحديث الاشتراك في معاملة واحدة
create or replace function public.admin_review_activation_request(
  p_request_id uuid, p_approve boolean, p_admin_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req activation_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;

  select * into v_req from public.activation_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود.'; end if;
  if v_req.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقاً.'; end if;

  if p_approve then
    update public.activation_requests
    set status = 'approved', admin_notes = p_admin_notes, reviewed_at = now()
    where id = p_request_id;

    update public.companies
    set plan_type = v_req.plan_type,
        subscription_start = current_date,
        subscription_end = current_date + (case when v_req.plan_type = 'yearly' then 365 else 30 end),
        trial_end = current_date
    where id = v_req.company_id;
  else
    update public.activation_requests
    set status = 'rejected', admin_notes = p_admin_notes, reviewed_at = now()
    where id = p_request_id;
  end if;

  perform public.log_activity(
    case when p_approve then 'admin.approve_request' else 'admin.reject_request' end,
    'activation_request', p_request_id::text, v_req.plan_type);
end $$;

revoke execute on function public.admin_review_activation_request(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_activation_request(uuid, boolean, text) to authenticated, service_role;

-- تصدير بيانات الشركة (متاح حتى بعد انتهاء الاشتراك — قراءة بيانات الشركة فقط)
create or replace function public.export_company_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid := public.auth_company_id();
  v_out jsonb := '{}'::jsonb;
begin
  if v_cid is null then raise exception 'لا توجد شركة مرتبطة بحسابك.'; end if;
  select jsonb_build_object(
    'company', to_jsonb(c),
    'customers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.customers x where x.company_id = v_cid),
    'employees', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.employees x where x.company_id = v_cid),
    'vehicles', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.vehicles x where x.company_id = v_cid),
    'cashboxes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.cashboxes x where x.company_id = v_cid),
    'banks', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.banks x where x.company_id = v_cid),
    'financial_years', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.financial_years x where x.company_id = v_cid),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoices x where x.company_id = v_cid),
    'invoice_trips', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoice_trips x where x.company_id = v_cid),
    'trip_expenses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.trip_expenses x where x.company_id = v_cid),
    'receipt_vouchers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.receipt_vouchers x where x.company_id = v_cid),
    'payment_vouchers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.payment_vouchers x where x.company_id = v_cid),
    'payrolls', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.payrolls x where x.company_id = v_cid),
    'advance_settlements', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.advance_settlements x where x.company_id = v_cid)
  )
  into v_out
  from public.companies c where c.id = v_cid;
  return v_out;
end $$;

revoke execute on function public.export_company_data() from public, anon;
grant execute on function public.export_company_data() to authenticated;

-- ---------------------------------------------------------------------------
-- حفظ ذرّي للمستندات: يمنع سباق الترقيم ويكفل وحدة العملية (معاملة واحدة)
-- (انظر migration_atomic_saves.sql للتفاصيل الكاملة)
-- ---------------------------------------------------------------------------
create or replace function public.save_invoice(
  p_invoice_id  bigint, p_date date, p_customer_id bigint, p_vat_rate double precision,
  p_notes text default '', p_attachments jsonb default '[]'::jsonb, p_trips jsonb default '[]'::jsonb,
  p_container_number text default ''
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid := public.auth_company_id(); v_invoice_id bigint := p_invoice_id;
  v_number int; v_old_date date; v_trip jsonb; v_trip_id bigint;
  v_kept bigint[] := '{}'::bigint[]; v_linked int; v_exp jsonb;
  v_qty int; v_unit double precision; v_line double precision;
  v_eqty double precision; v_eunit double precision; v_eamount double precision;
  v_source text; v_kind text; v_acc bigint; v_exp_id bigint; v_pnum int;
begin
  if v_cid is null then raise exception 'لا توجد شركة مرتبطة بحسابك.'; end if;
  if not public.is_company_active() then raise exception 'الوصول غير متاح: اشتراك منتهي أو شركة موقوفة.'; end if;
  if p_customer_id is null then raise exception 'اختر العميل.'; end if;
  if jsonb_array_length(p_trips) = 0 then raise exception 'أضف نقلة واحدة على الأقل للفاتورة.'; end if;
  perform 1 from public.companies where id = v_cid for update;
  if not exists (select 1 from public.customers where id = p_customer_id and company_id = v_cid) then
    raise exception 'العميل المحدد غير موجود.';
  end if;

  if p_invoice_id is null then
    if not exists (select 1 from public.financial_years where company_id = v_cid and status = 'open' and date_from <= p_date and date_to >= p_date) then
      raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
    end if;
    select coalesce(max(number), 0) + 1 into v_number from public.invoices where company_id = v_cid;
    insert into public.invoices (company_id, number, date, customer_id, vat_rate, notes, attachments, container_number)
    values (v_cid, v_number, p_date, p_customer_id, p_vat_rate, p_notes, p_attachments, coalesce(p_container_number, ''))
    returning id into v_invoice_id;
  else
    select date into v_old_date from public.invoices where id = p_invoice_id and company_id = v_cid for update;
    if v_old_date is null then raise exception 'الفاتورة غير موجودة.'; end if;
    if not exists (select 1 from public.financial_years where company_id = v_cid and status = 'open' and date_from <= v_old_date and date_to >= v_old_date) then
      raise exception 'لا يمكن تعديل حركة بتاريخ قديم خارج السنة المالية المفتوحة.';
    end if;
    if not exists (select 1 from public.financial_years where company_id = v_cid and status = 'open' and date_from <= p_date and date_to >= p_date) then
      raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
    end if;
    update public.invoices set date = p_date, customer_id = p_customer_id, vat_rate = p_vat_rate, notes = p_notes, attachments = p_attachments,
      container_number = coalesce(p_container_number, '')
    where id = v_invoice_id;
  end if;

  for v_trip in select * from jsonb_array_elements(p_trips) loop
    if (v_trip->>'id') is not null then v_kept := array_append(v_kept, (v_trip->>'id')::bigint); end if;
  end loop;

  -- حذف النقلات المُزالة: تُمنع فقط إن كانت مرتبطة بسندات دفع يدوية
  for v_trip_id in select id from public.invoice_trips where invoice_id = v_invoice_id and not (id = any(v_kept)) loop
    select count(*) into v_linked from public.payment_vouchers
     where voucher_type = 'trip' and trip_id = v_trip_id and source_expense_id is null;
    if v_linked > 0 then raise exception 'لا يمكن حذف نقلة مرتبطة بسندات دفع يدوية. احذف السندات المرتبطة أولاً.'; end if;
    delete from public.payment_vouchers where trip_id = v_trip_id and source_expense_id is not null;
    delete from public.invoice_trips where id = v_trip_id;
  end loop;

  for v_trip in select * from jsonb_array_elements(p_trips) loop
    v_qty  := greatest(coalesce((v_trip->>'qty')::int, 1), 1);
    v_unit := coalesce((v_trip->>'unit_price')::double precision, 0);
    if v_unit <= 0 then v_unit := coalesce((v_trip->>'price')::double precision, 0) / v_qty; end if;
    v_line := round((v_qty * v_unit)::numeric, 2)::double precision;
    if v_line <= 0 then raise exception 'سعر النقلة يجب أن يكون أكبر من صفر.'; end if;

    if (v_trip->>'id') is not null then
      v_trip_id := (v_trip->>'id')::bigint;
      update public.invoice_trips set
        vehicle_id = nullif(v_trip->>'vehicle_id', '')::bigint,
        driver_id  = nullif(v_trip->>'driver_id', '')::bigint,
        from_loc   = coalesce(v_trip->>'from_loc', ''),
        to_loc     = coalesce(v_trip->>'to_loc', ''),
        qty        = v_qty,
        unit_price = v_unit,
        price      = v_line,
        notes      = coalesce(v_trip->>'notes', '')
      where id = v_trip_id and invoice_id = v_invoice_id;
      if not found then raise exception 'النقلة غير موجودة ضمن هذه الفاتورة.'; end if;
      delete from public.trip_expenses where trip_id = v_trip_id;
    else
      insert into public.invoice_trips (company_id, invoice_id, vehicle_id, driver_id, from_loc, to_loc, qty, unit_price, price, notes)
      values (v_cid, v_invoice_id, nullif(v_trip->>'vehicle_id', '')::bigint, nullif(v_trip->>'driver_id', '')::bigint,
              coalesce(v_trip->>'from_loc', ''), coalesce(v_trip->>'to_loc', ''), v_qty, v_unit, v_line, coalesce(v_trip->>'notes', ''))
      returning id into v_trip_id;
    end if;

    for v_exp in select * from jsonb_array_elements(coalesce(v_trip->'expenses', '[]'::jsonb)) loop
      v_eqty  := greatest(coalesce((v_exp->>'qty')::double precision, 1), 0.0001);
      v_eunit := coalesce((v_exp->>'unit_amount')::double precision, 0);
      if v_eunit <= 0 then v_eunit := coalesce((v_exp->>'amount')::double precision, 0) / v_eqty; end if;
      v_eamount := round((v_eqty * v_eunit)::numeric, 2)::double precision;
      if v_eamount <= 0 then raise exception 'مبلغ مصروف النقلة يجب أن يكون أكبر من صفر.'; end if;

      v_source := coalesce(v_exp->>'source', 'cash');
      if v_source not in ('cash', 'driver', 'supplier', 'customer') then
        raise exception 'مصدر تمويل المصروف غير صالح.';
      end if;

      v_kind := nullif(v_exp->>'account_kind', '');
      v_acc  := nullif(v_exp->>'account_id', '')::bigint;

      if v_source = 'cash' then
        if v_kind is null or v_acc is null then
          raise exception 'اختر الخزينة أو البنك الذي صُرف منه المصروف النقدي.';
        end if;
        if v_kind = 'cashbox' then
          if not exists (select 1 from public.cashboxes where id = v_acc and company_id = v_cid) then
            raise exception 'الخزينة المحددة غير موجودة.'; end if;
        elsif v_kind = 'bank' then
          if not exists (select 1 from public.banks where id = v_acc and company_id = v_cid) then
            raise exception 'البنك المحدد غير موجود.'; end if;
        else
          raise exception 'نوع الحساب غير صالح.';
        end if;
      end if;

      if v_source = 'driver' and nullif(v_trip->>'driver_id', '') is null then
        raise exception 'حدّد السائق في النقلة قبل تسجيل مصروف من عهدته.';
      end if;

      insert into public.trip_expenses
        (company_id, trip_id, expense_type, qty, unit_amount, amount, source, account_kind, account_id, supplier_name, notes)
      values
        (v_cid, v_trip_id, coalesce(v_exp->>'expense_type', 'other'), v_eqty, v_eunit, v_eamount, v_source,
         case when v_source = 'cash' then v_kind else null end,
         case when v_source = 'cash' then v_acc else null end,
         coalesce(v_exp->>'supplier_name', ''), coalesce(v_exp->>'notes', ''))
      returning id into v_exp_id;

      if v_source = 'cash' then
        select coalesce(max(number), 0) + 1 into v_pnum from public.payment_vouchers where company_id = v_cid;
        insert into public.payment_vouchers
          (company_id, number, date, account_kind, account_id, voucher_type, trip_id, employee_id, vehicle_id,
           amount, description, source_expense_id)
        values
          (v_cid, v_pnum, p_date, v_kind, v_acc, 'trip', v_trip_id,
           nullif(v_trip->>'driver_id', '')::bigint, nullif(v_trip->>'vehicle_id', '')::bigint,
           v_eamount,
           'مصروف نقلة (تلقائي): ' || coalesce(v_exp->>'notes', coalesce(v_exp->>'expense_type', '')),
           v_exp_id);
      end if;
    end loop;
  end loop;

  perform public.log_activity('invoice.save', 'invoice', v_invoice_id::text, '');
  return v_invoice_id;
end $$;

create or replace function public.save_payroll(
  p_payroll_id bigint, p_date date, p_employee_id bigint, p_period_year int, p_period_month int,
  p_account_kind text, p_account_id bigint, p_base_salary double precision, p_additions double precision,
  p_additions_note text default '', p_advance_deduction double precision default 0,
  p_other_deductions double precision default 0, p_notes text default '', p_settlements jsonb default '[]'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid := public.auth_company_id(); v_payroll_id bigint := p_payroll_id;
  v_number int; v_old_date date; v_pair jsonb; v_vid bigint; v_amt double precision;
  v_settled double precision; v_adv_amount double precision; v_total double precision := 0; v_net double precision;
begin
  if v_cid is null then raise exception 'لا توجد شركة مرتبطة بحسابك.'; end if;
  if not public.is_company_active() then raise exception 'الوصول غير متاح: اشتراك منتهي أو شركة موقوفة.'; end if;
  if p_employee_id is null then raise exception 'اختر الموظف/السائق.'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and company_id = v_cid) then raise exception 'الموظف المحدد غير موجود.'; end if;
  if p_account_kind = 'cashbox' then
    if not exists (select 1 from public.cashboxes where id = p_account_id and company_id = v_cid) then raise exception 'الخزينة المحددة غير موجودة.'; end if;
  elsif p_account_kind = 'bank' then
    if not exists (select 1 from public.banks where id = p_account_id and company_id = v_cid) then raise exception 'البنك المحدد غير موجود.'; end if;
  else raise exception 'جهة الصرف غير صالحة.'; end if;
  if p_period_month < 1 or p_period_month > 12 then raise exception 'شهر الراتب يجب أن يكون بين 1 و 12.'; end if;
  if p_period_year < 1900 or p_period_year > 2200 then raise exception 'سنة الراتب غير منطقية.'; end if;
  if p_base_salary <= 0 then raise exception 'الراتب الأساسي يجب أن يكون أكبر من صفر.'; end if;
  for v_pair in select * from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_pair->>1)::double precision, 0);
  end loop;
  if abs(v_total - p_advance_deduction) > 0.001 then raise exception 'مجموع خصومات السلف الموزعة لا يطابق قيمة الخصم من السلف.'; end if;
  v_net := round((p_base_salary + p_additions - p_advance_deduction - p_other_deductions)::numeric, 2);
  if v_net < 0 then raise exception 'صافي الراتب سالب: راجع الإضافات والخصومات.'; end if;
  perform 1 from public.companies where id = v_cid for update;
  if p_payroll_id is null then
    if not exists (select 1 from public.financial_years where company_id = v_cid and status = 'open' and date_from <= p_date and date_to >= p_date) then
      raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
    end if;
    select coalesce(max(number), 0) + 1 into v_number from public.payrolls where company_id = v_cid;
    insert into public.payrolls (company_id, number, date, employee_id, period_year, period_month, account_kind, account_id, base_salary, additions, additions_note, advance_deduction, other_deductions, net_salary, notes)
    values (v_cid, v_number, p_date, p_employee_id, p_period_year, p_period_month, p_account_kind, p_account_id, p_base_salary, p_additions, p_additions_note, p_advance_deduction, p_other_deductions, v_net, p_notes)
    returning id into v_payroll_id;
  else
    select date into v_old_date from public.payrolls where id = p_payroll_id and company_id = v_cid for update;
    if v_old_date is null then raise exception 'الراتب غير موجود.'; end if;
    if not exists (select 1 from public.financial_years where company_id = v_cid and status = 'open' and date_from <= v_old_date and date_to >= v_old_date) then
      raise exception 'لا يمكن تعديل حركة بتاريخ قديم خارج السنة المالية المفتوحة.';
    end if;
    if not exists (select 1 from public.financial_years where company_id = v_cid and status = 'open' and date_from <= p_date and date_to >= p_date) then
      raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
    end if;
    update public.payrolls set date = p_date, employee_id = p_employee_id, period_year = p_period_year, period_month = p_period_month,
      account_kind = p_account_kind, account_id = p_account_id, base_salary = p_base_salary, additions = p_additions,
      additions_note = p_additions_note, advance_deduction = p_advance_deduction, other_deductions = p_other_deductions,
      net_salary = v_net, notes = p_notes where id = v_payroll_id;
    delete from public.advance_settlements where payroll_id = v_payroll_id;
  end if;
  for v_pair in select * from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb)) loop
    v_vid := (v_pair->>0)::bigint;
    v_amt := coalesce((v_pair->>1)::double precision, 0);
    if v_amt <= 0 then continue; end if;
    if not exists (select 1 from public.payment_vouchers where id = v_vid and voucher_type = 'advance' and employee_id = p_employee_id and company_id = v_cid) then
      raise exception 'سلفة غير موجودة أو لا تخص هذا الموظف.';
    end if;
    select amount into v_adv_amount from public.payment_vouchers where id = v_vid;
    select coalesce(sum(amount), 0) into v_settled from public.advance_settlements where payment_voucher_id = v_vid;
    if v_amt > (v_adv_amount - v_settled) + 0.001 then raise exception 'قيمة الخصم من إحدى السلف أكبر من المتبقي منها.'; end if;
    insert into public.advance_settlements (company_id, payment_voucher_id, payroll_id, amount) values (v_cid, v_vid, v_payroll_id, v_amt);
  end loop;
  perform public.log_activity('payroll.save', 'payroll', v_payroll_id::text, '');
  return v_payroll_id;
end $$;

revoke execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text) from public, anon;
revoke execute on function public.save_payroll(bigint, date, bigint, int, int, text, bigint, double precision, double precision, text, double precision, double precision, text, jsonb) from public, anon;
grant execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text) to authenticated, service_role;
grant execute on function public.save_payroll(bigint, date, bigint, int, int, text, bigint, double precision, double precision, text, double precision, double precision, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- أقل امتياز
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- الملف الشخصي: المستخدم يعدّل اسمه فقط
revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;

-- الشركة: المالك يعدّل بياناتها التشغيلية فقط (وليس الاشتراك أو الحالة)
revoke update on public.companies from authenticated;
-- المالك يعدّل بيانات الشركة التشغيلية فقط (لا الاشتراك/الحالة/الرقم — تبقى للمطوّر)
grant update (
  name, name_en, phone, email, website, address, currency, vat_rate, vat_note,
  tax_number, commercial_reg, unified_number, entity_type, tax_status,
  country, region, city, district, street, building_no, postal_code,
  additional_no, address_note, print_settings
) on public.companies to authenticated;

-- ---------------------------------------------------------------------------
-- تخزين صُور الوصول (عام حتى يستطيع بوت تليجرام جلب الصورة)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do update set public = true;

drop policy if exists "receipts_upload_own" on storage.objects;
create policy "receipts_upload_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts');

-- ملاحظة أمنية (Supabase linter 0025_public_bucket_allows_listing):
-- الدلو عام، لذا روابط الكائنات تعمل بلا سياسة SELECT. أي سياسة SELECT واسعة
-- تسمح للعملاء بسرد كل ملفات الدلو، لذلك تُحذف ولا يُعاد إنشاؤها.
drop policy if exists "receipts_read_public" on storage.objects;
