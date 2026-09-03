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
-- الملفات الشخصية (رابط المستخدم ← شركته) مع مالك ومستخدم إضافي واحد
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  email      text not null default '',
  name       text default '',
  role       text not null default 'owner' check (role in ('owner', 'additional')),
  phone      text not null default '',
  address    text not null default '',
  is_active  boolean not null default true,
  created_at timestamptz default now()
);
create unique index if not exists uq_profiles_one_owner_per_company
  on public.profiles(company_id) where company_id is not null and role = 'owner';
create unique index if not exists uq_profiles_one_additional_per_company
  on public.profiles(company_id) where company_id is not null and role = 'additional';

-- سجل المميزات: غياب صف الشركة يعني أن الميزة غير مفعّلة افتراضياً.
create table if not exists public.feature_catalog (
  feature_key text primary key,
  name_ar text not null,
  description_ar text not null default '',
  created_at timestamptz not null default now()
);
insert into public.feature_catalog (feature_key, name_ar, description_ar) values
  ('tax_invoice', 'الفاتورة الضريبية', 'تفعيل خصائص الفاتورة الضريبية والتحقق وطباعة رمز QR.'),
  ('additional_user', 'المستخدم الإضافي', 'السماح لحساب إضافي واحد بالدخول إلى بيانات الشركة نفسها.')
on conflict (feature_key) do update set name_ar = excluded.name_ar, description_ar = excluded.description_ar;

create table if not exists public.company_features (
  company_id uuid not null references public.companies(id) on delete cascade,
  feature_key text not null references public.feature_catalog(feature_key) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, feature_key)
);
create index if not exists idx_company_features_lookup
  on public.company_features(company_id, feature_key, enabled);

-- معرّف الشركة للمستخدم الحالي (security definer + search_path مُقيّد)
create or replace function public.auth_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.company_id
    from public.profiles p
   where p.id = auth.uid()
     and (
       p.role = 'owner'
       or (
         p.role = 'additional'
         and p.is_active
         and exists (
           select 1 from public.company_features cf
            where cf.company_id = p.company_id
              and cf.feature_key = 'additional_user'
              and cf.enabled
         )
       )
     );
$$;

-- هل شركة المستخدم الحالي نشطة واشتراكها ساري (أو ضمن التجربة المجانية)؟
create or replace function public.is_company_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.is_active
            and p.is_active
            and (
              p.role = 'owner'
              or (p.role = 'additional' and exists (
                select 1 from public.company_features cf
                 where cf.company_id = c.id
                   and cf.feature_key = 'additional_user'
                   and cf.enabled
              ))
            )
            and (
              c.trial_end >= current_date                       -- ضمن التجربة
              or c.plan_type = 'open'                            -- اشتراك مفتوح
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

-- يتحقق من بنية أرقام الحاويات داخل كل نقلة: مصفوفة نصوص غير فارغة
-- وغير مكررة، وعددها لا يتجاوز كمية النقلة.
create or replace function public.valid_trip_container_numbers(
  p_numbers jsonb, p_qty integer
) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_item jsonb; v_value text; v_key text; v_seen text[] := '{}'::text[];
begin
  if p_numbers is null or jsonb_typeof(p_numbers) <> 'array' or p_qty is null or p_qty < 1 then return false; end if;
  if jsonb_array_length(p_numbers) > p_qty then return false; end if;
  for v_item in select value from jsonb_array_elements(p_numbers) loop
    if jsonb_typeof(v_item) <> 'string' then return false; end if;
    v_value := btrim(v_item #>> '{}');
    if v_value = '' or char_length(v_value) > 100 then return false; end if;
    v_key := upper(v_value);
    if v_key = any(v_seen) then return false; end if;
    v_seen := array_append(v_seen, v_key);
  end loop;
  return true;
end $$;

create table if not exists public.invoice_trips (
  id         bigint generated by default as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  vehicle_id bigint references public.vehicles(id) on delete set null,
  driver_id  bigint references public.employees(id) on delete set null,
  from_loc   text default '',
  to_loc     text default '',
  qty        integer not null default 1,
  unit_price        double precision not null default 0,
  price             double precision not null default 0,
  container_numbers jsonb not null default '[]'::jsonb,
  notes              text default '',
  constraint invoice_trips_container_numbers_valid
    check (public.valid_trip_container_numbers(container_numbers, qty))
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
                      check (voucher_type in ('trip', 'advance', 'vehicle', 'general', 'supplier', 'purchase', 'owner')),
  trip_id             bigint references public.invoice_trips(id) on delete set null,
  employee_id         bigint references public.employees(id) on delete set null,
  vehicle_id          bigint references public.vehicles(id) on delete set null,
  vehicle_expense     text default '',
  supplier_id         bigint references public.suppliers(id) on delete set null,
  purchase_invoice_id bigint references public.purchase_invoices(id) on delete set null,
  source_expense_id   bigint references public.trip_expenses(id) on delete cascade,
  quantity            double precision not null default 1 check (quantity > 0),
  unit_amount         double precision not null default 0 check (unit_amount >= 0),
  amount              double precision not null default 0,
  description         text default '',
  created_at          timestamptz default now()
);
-- عند تشغيل schema.sql فوق قاعدة موجودة أقدم من v12.
alter table public.payment_vouchers
  add column if not exists quantity double precision not null default 1,
  add column if not exists unit_amount double precision not null default 0;
update public.payment_vouchers set quantity = 1, unit_amount = amount
 where unit_amount <= 0 and amount > 0;

create or replace function public.normalize_payment_voucher_amount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.quantity is null or new.quantity <= 0 then
    raise exception 'عدد وحدات المصروف يجب أن يكون أكبر من صفر.';
  end if;
  if tg_op = 'UPDATE' then
    if new.amount is distinct from old.amount
       and new.quantity is not distinct from old.quantity
       and new.unit_amount is not distinct from old.unit_amount then
      new.unit_amount := round((new.amount / new.quantity)::numeric, 2)::double precision;
    end if;
  end if;
  if new.unit_amount is null or new.unit_amount <= 0 then
    if coalesce(new.amount, 0) <= 0 then raise exception 'قيمة وحدة المصروف يجب أن تكون أكبر من صفر.'; end if;
    new.unit_amount := round((new.amount / new.quantity)::numeric, 2)::double precision;
  end if;
  new.amount := round((new.quantity * new.unit_amount)::numeric, 2)::double precision;
  if new.amount <= 0 then raise exception 'إجمالي سند الصرف يجب أن يكون أكبر من صفر.'; end if;
  return new;
end;
$$;
drop trigger if exists trg_normalize_payment_voucher_amount on public.payment_vouchers;
create trigger trg_normalize_payment_voucher_amount
before insert or update of quantity, unit_amount, amount on public.payment_vouchers
for each row execute function public.normalize_payment_voucher_amount();

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

-- النقلات المرتجعة المرتبطة بإشعار دائن. القيمة لقطة من سعر النقلة وقت الإصدار.
create table if not exists public.credit_note_trips (
  id             bigint generated by default as identity primary key,
  company_id     uuid not null references public.companies(id) on delete cascade,
  credit_note_id bigint not null references public.credit_debit_notes(id) on delete cascade,
  trip_id        bigint not null references public.invoice_trips(id),
  amount         numeric(14,2) not null check (amount > 0),
  created_at     timestamptz not null default now()
);
create unique index if not exists uq_credit_note_trips_note_trip
  on public.credit_note_trips(credit_note_id, trip_id);
create unique index if not exists uq_credit_note_trips_one_return_per_trip
  on public.credit_note_trips(company_id, trip_id);
create index if not exists idx_credit_note_trips_note
  on public.credit_note_trips(credit_note_id);

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
  deduction_deduction double precision not null default 0,
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

-- خصومات الموظفين/السائقين: تُسجَّل كبند مستقل ثم تُقتطع من الرواتب كلياً أو جزئياً
create table if not exists public.employee_deductions (
  id          bigint generated by default as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  number      integer not null,
  date        date not null,
  employee_id bigint not null references public.employees(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  reason      text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  unique (company_id, number)
);

-- تسويات الخصم داخل مسيرات الرواتب (تُكتب حصراً عبر save_payroll)
create table if not exists public.deduction_settlements (
  id                    bigint generated by default as identity primary key,
  company_id            uuid not null references public.companies(id) on delete cascade,
  employee_deduction_id bigint not null references public.employee_deductions(id) on delete cascade,
  payroll_id            bigint not null references public.payrolls(id) on delete cascade,
  amount                double precision not null default 0
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
create index if not exists idx_employee_deductions_employee_date on public.employee_deductions(employee_id, date);
create index if not exists idx_employee_deductions_company_date on public.employee_deductions(company_id, date);
create index if not exists idx_deduction_settlements_payroll on public.deduction_settlements(payroll_id);
create index if not exists idx_deduction_settlements_deduction on public.deduction_settlements(employee_deduction_id);
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
    'payment_vouchers','payrolls','advance_settlements','year_snapshots','activation_requests',
    'credit_note_trips','employee_deductions','deduction_settlements'
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

alter table public.feature_catalog enable row level security;
create policy feature_catalog_authenticated_read on public.feature_catalog
  for select to authenticated using (true);
alter table public.company_features enable row level security;
create policy company_features_own_read on public.company_features
  for select to authenticated
  using (company_id = public.auth_company_id() or public.is_admin());
create policy company_features_admin_write on public.company_features
  for all to authenticated
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
    'payment_vouchers','payrolls','advance_settlements','year_snapshots',
    'employee_deductions','deduction_settlements'
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
alter table public.credit_note_trips enable row level security;
create policy credit_note_trips_tenant_select on public.credit_note_trips
  for select to authenticated
  using (company_id = public.auth_company_id() and public.is_company_active());

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
-- أدوات v13 الأساسية لمسار التسجيل. طبقات الحراسة الشاملة والفهارس موجودة في
-- migration_registration_validation_v13.sql ويجب تشغيلها أيضاً في النشر الجديد.
create or replace function public.safe_text(p_in text, p_max int default 2000)
returns text language sql immutable set search_path = public, pg_temp as $$
  select left(
    btrim(regexp_replace(regexp_replace(coalesce(p_in, ''), '<[^>]*>', ' ', 'g'),
      '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]', '', 'g')),
    greatest(0, least(coalesce(p_max, 2000), 10000))
  );
$$;

create or replace function public.normalize_phone(p_in text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when regexp_replace(translate(coalesce(p_in, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g') like '00%' then substring(regexp_replace(translate(coalesce(p_in, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g') from 3)
    else regexp_replace(translate(coalesce(p_in, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g')
  end;
$$;

create or replace function public.valid_phone(p_in text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare d text := regexp_replace(public.normalize_phone(p_in), '\D', '', 'g');
begin
  return coalesce(p_in, '') ~ '^\+?[0-9٠-٩۰-۹[:space:]().-]+$'
    and length(d) between 8 and 15
    and d !~ '^(.)\1+$'
    and d !~ '(0123456789|1234567890|9876543210|0987654321)'
    and d !~ '(.)\1{6,}$';
end $$;

create or replace function public.is_plausible_identity_text(p_in text, p_min int default 2)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v text := public.safe_text(p_in, 500);
  n text := lower(regexp_replace(v, '[[:space:]._/\\-]+', ' ', 'g'));
  compact text;
begin
  compact := regexp_replace(n, '[[:space:]]', '', 'g');
  if length(v) < greatest(1, p_min) then return false; end if;
  if n = any(array['test','testing','demo','dummy','fake','sample','none','null','undefined','unknown','n/a','na','xxx','xxxx',
      'اختبار','تجربة','تجريبي','وهمي','غير معروف','بدون','لا يوجد','لايوجد','اسم','عنوان','عميل','مستخدم','مورد','شركة',
      'شركة وهمية','شركة تجريبية','customer','user','supplier','company']) then return false; end if;
  if length(compact) >= 3 and compact ~ '^(.)\1+$' then return false; end if;
  if compact ~ '^(1234567890|0123456789|9876543210|0987654321)+$' then return false; end if;
  return length(regexp_replace(v, '[^[:alpha:]]', '', 'g')) >= 2;
end $$;

create or replace function public.is_allowed_email(p_email text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select lower(split_part(btrim(coalesce(p_email, '')), '@', 2)) = any(array[
    'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','yahoo.fr','yahoo.de','yahoo.it','yahoo.es','yahoo.ca','yahoo.com.au','yahoo.co.in','yahoo.co.jp','ymail.com','rocketmail.com',
    'hotmail.com','hotmail.co.uk','hotmail.fr','hotmail.de','hotmail.it','hotmail.es','outlook.com','outlook.sa','outlook.fr','outlook.de','outlook.es','outlook.com.au','live.com','live.co.uk','msn.com','icloud.com','me.com','mac.com'
  ])
  and length(btrim(coalesce(p_email, ''))) <= 254
  and btrim(coalesce(p_email, '')) ~* '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$'
  and split_part(btrim(coalesce(p_email, '')), '@', 1) !~ '(^\.|\.$|\.\.)'
  and regexp_replace(lower(split_part(split_part(btrim(coalesce(p_email, '')), '@', 1), '+', 1)), '[._-]', '', 'g')
    <> all(array['test','testing','demo','dummy','fake','example','sample','user','unknown','noreply','noemail','xxx'])
  and regexp_replace(lower(split_part(split_part(btrim(coalesce(p_email, '')), '@', 1), '+', 1)), '[._-]', '', 'g') !~ '^(.)\1{3,}$';
$$;

create or replace function public.register_company_with_year(
  p_company_name text, p_name text, p_phone text, p_address text,
  p_year_start date, p_year_end date
) returns uuid
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_company uuid;
  v_phone text := public.normalize_phone(p_phone);
  v_company_name text := public.safe_text(p_company_name, 120);
  v_name text := public.safe_text(p_name, 120);
  v_address text := public.safe_text(p_address, 300);
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول أولاً.'; end if;
  select company_id into v_company from public.profiles where id = v_user;
  if v_company is not null then return v_company; end if;
  v_email := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), (select email from auth.users where id = v_user), ''));
  if not public.is_allowed_email(v_email) then raise exception 'البريد الإلكتروني غير صالح أو غير مسموح.'; end if;
  if not public.is_plausible_identity_text(v_company_name, 2) then raise exception 'اسم الشركة مطلوب ويجب أن يكون حقيقياً.'; end if;
  if not public.is_plausible_identity_text(v_name, 2) then raise exception 'اسم المسؤول مطلوب ويجب أن يكون حقيقياً.'; end if;
  if not public.is_plausible_identity_text(v_address, 5) then raise exception 'عنوان المسؤول مطلوب ويجب أن يكون حقيقياً.'; end if;
  if not public.valid_phone(p_phone) then raise exception 'رقم الهاتف مطلوب ويجب أن يكون حقيقياً وصحيحاً.'; end if;
  if p_year_start is null or p_year_end is null or p_year_start < date '1900-01-01' or p_year_end > date '2200-12-31'
     or (p_year_end - p_year_start + 1) not between 180 and 550 then
    raise exception 'نطاق السنة المالية غير صالح؛ المدة المسموحة من 180 إلى 550 يوماً.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('signup-phone:' || v_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('signup-email:' || v_email, 0));
  if exists(select 1 from public.companies where public.normalize_phone(phone) = v_phone)
    or exists(select 1 from public.profiles where public.normalize_phone(phone) = v_phone)
    then raise exception 'رقم الهاتف مستخدم بالفعل في حساب آخر.'; end if;
  if exists(select 1 from public.companies where lower(btrim(email)) = v_email)
    or exists(select 1 from public.profiles where lower(btrim(email)) = v_email and id <> v_user)
    then raise exception 'البريد الإلكتروني مستخدم بالفعل في حساب آخر.'; end if;

  insert into public.companies(name, phone, email, address, currency, vat_rate)
  values(v_company_name, v_phone, v_email, v_address, 'ر.س', 15) returning id into v_company;
  insert into public.profiles(id, company_id, email, name, phone, address, role, is_active)
  values(v_user, v_company, v_email, v_name, v_phone, v_address, 'owner', true)
  on conflict(id) do update set company_id=excluded.company_id, email=excluded.email, name=excluded.name,
    phone=excluded.phone, address=excluded.address, role='owner', is_active=true;
  insert into public.financial_years(company_id, year, date_from, date_to, status, notes)
  values(v_company, extract(year from p_year_start)::integer, p_year_start, p_year_end, 'open', 'السنة المالية الأولى');
  perform public.log_activity('company.register', 'company', v_company::text, 'company + first financial year');
  return v_company;
end $$;

-- المسار القديم يسمح بشركة بلا سنة مالية، لذلك يُلغى تنفيذه نهائياً.
create or replace function public.register_company(p_company_name text, p_name text default '', p_phone text default '')
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'مسار التسجيل القديم متوقف. حدّث التطبيق وأنشئ السنة المالية مع الشركة.';
end $$;
revoke all on function public.register_company(text, text, text) from public, anon, authenticated;
revoke all on function public.register_company_with_year(text, text, text, text, date, date) from public, anon;
grant execute on function public.register_company_with_year(text, text, text, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- دوال إدارة المطوّر (فحص is_admin داخلياً)
-- ---------------------------------------------------------------------------
create or replace function public.has_company_feature(p_feature_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(exists (
    select 1 from public.company_features cf
     where cf.company_id = public.auth_company_id()
       and cf.feature_key = p_feature_key
       and cf.enabled
  ), false);
$$;

create or replace function public.admin_set_company_feature(
  p_company_id uuid, p_feature_key text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if not exists (select 1 from public.companies where id = p_company_id) then raise exception 'الشركة غير موجودة.'; end if;
  if not exists (select 1 from public.feature_catalog where feature_key = p_feature_key) then raise exception 'الميزة غير معروفة.'; end if;
  insert into public.company_features (company_id, feature_key, enabled, updated_by, updated_at)
  values (p_company_id, p_feature_key, coalesce(p_enabled, false), auth.uid(), now())
  on conflict (company_id, feature_key) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_activity(
    case when p_enabled then 'admin.enable_feature' else 'admin.disable_feature' end,
    'company_feature', p_company_id::text, p_feature_key);
end $$;

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

revoke execute on function public.has_company_feature(text) from public, anon;
revoke execute on function public.admin_set_company_feature(uuid, text, boolean) from public, anon;
revoke execute on function public.admin_set_company_status(uuid, boolean) from public, anon;
revoke execute on function public.admin_set_subscription(uuid, text, date) from public, anon;
revoke execute on function public.admin_delete_company(uuid) from public, anon;
grant execute on function public.has_company_feature(text) to authenticated, service_role;
grant execute on function public.admin_set_company_feature(uuid, text, boolean) to authenticated, service_role;
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
    'advance_settlements', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.advance_settlements x where x.company_id = v_cid),
    'employee_deductions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.employee_deductions x where x.company_id = v_cid),
    'deduction_settlements', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.deduction_settlements x where x.company_id = v_cid)
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
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cid uuid := public.auth_company_id(); v_invoice_id bigint := p_invoice_id;
  v_number int; v_old_date date; v_trip jsonb; v_trip_id bigint;
  v_kept bigint[] := '{}'::bigint[]; v_linked int; v_exp jsonb;
  v_qty int; v_unit double precision; v_line double precision;
  v_containers jsonb; v_container jsonb; v_container_text text;
  v_normalized_containers jsonb; v_seen_containers text[] := '{}'::text[];
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

    v_containers := coalesce(v_trip->'container_numbers', '[]'::jsonb);
    if jsonb_typeof(v_containers) <> 'array' then raise exception 'أرقام الحاويات يجب أن تكون قائمة.'; end if;
    if jsonb_array_length(v_containers) > v_qty then
      raise exception 'عدد أرقام الحاويات لا يجوز أن يتجاوز عدد النقلات (%).', v_qty;
    end if;
    v_normalized_containers := '[]'::jsonb;
    for v_container in select value from jsonb_array_elements(v_containers) loop
      if jsonb_typeof(v_container) <> 'string' then raise exception 'رقم الحاوية يجب أن يكون نصاً.'; end if;
      v_container_text := btrim(v_container #>> '{}');
      if v_container_text = '' then raise exception 'رقم الحاوية لا يمكن أن يكون فارغاً.'; end if;
      if char_length(v_container_text) > 100 then raise exception 'رقم الحاوية أطول من الحد المسموح (100 حرف).'; end if;
      if upper(v_container_text) = any(v_seen_containers) then
        raise exception 'رقم الحاوية «%» مكرر داخل الفاتورة.', v_container_text;
      end if;
      v_seen_containers := array_append(v_seen_containers, upper(v_container_text));
      v_normalized_containers := v_normalized_containers || jsonb_build_array(v_container_text);
    end loop;

    if (v_trip->>'id') is not null then
      v_trip_id := (v_trip->>'id')::bigint;
      update public.invoice_trips set
        vehicle_id = nullif(v_trip->>'vehicle_id', '')::bigint,
        driver_id  = nullif(v_trip->>'driver_id', '')::bigint,
        from_loc   = coalesce(v_trip->>'from_loc', ''),
        to_loc     = coalesce(v_trip->>'to_loc', ''),
        qty        = v_qty,
        unit_price        = v_unit,
        price             = v_line,
        container_numbers = v_normalized_containers,
        notes              = coalesce(v_trip->>'notes', '')
      where id = v_trip_id and invoice_id = v_invoice_id;
      if not found then raise exception 'النقلة غير موجودة ضمن هذه الفاتورة.'; end if;
      delete from public.trip_expenses where trip_id = v_trip_id;
    else
      insert into public.invoice_trips
        (company_id, invoice_id, vehicle_id, driver_id, from_loc, to_loc, qty, unit_price, price, container_numbers, notes)
      values (v_cid, v_invoice_id, nullif(v_trip->>'vehicle_id', '')::bigint, nullif(v_trip->>'driver_id', '')::bigint,
              coalesce(v_trip->>'from_loc', ''), coalesce(v_trip->>'to_loc', ''), v_qty, v_unit, v_line,
              v_normalized_containers, coalesce(v_trip->>'notes', ''))
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

-- مسير الرواتب الذرّي: تسويات السلف (p_settlements) وتسويات الخصومات
-- (p_deduction_settlements) تُكتب كلها داخل المعاملة مع ترقيم مُقفَل.
-- يُسقط الإصدار القديم (14 مُعاملاً) لأن توقيع الاستدعاء الاسمي تغيّر.
drop function if exists public.save_payroll(bigint, date, bigint, int, int, text, bigint, double precision, double precision, text, double precision, double precision, text, jsonb);

create or replace function public.save_payroll(
  p_payroll_id bigint, p_date date, p_employee_id bigint, p_period_year int, p_period_month int,
  p_account_kind text, p_account_id bigint, p_base_salary double precision, p_additions double precision,
  p_additions_note text default '', p_advance_deduction double precision default 0,
  p_other_deductions double precision default 0, p_notes text default '', p_settlements jsonb default '[]'::jsonb,
  p_deduction_settlements jsonb default '[]'::jsonb, p_deduction_deduction double precision default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid := public.auth_company_id(); v_payroll_id bigint := p_payroll_id;
  v_number int; v_old_date date; v_pair jsonb; v_vid bigint; v_amt double precision;
  v_settled double precision; v_src_amount double precision;
  v_total double precision := 0; v_ded_total double precision := 0;
  v_deduction_deduction double precision; v_net double precision;
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
  for v_pair in select * from jsonb_array_elements(coalesce(p_deduction_settlements, '[]'::jsonb)) loop
    v_ded_total := v_ded_total + coalesce((v_pair->>1)::double precision, 0);
  end loop;
  v_deduction_deduction := round(v_ded_total::numeric, 2);
  if p_deduction_deduction is not null and abs(v_deduction_deduction - p_deduction_deduction) > 0.01 then
    raise exception 'مجموع خصومات الخصومات الموزعة لا يطابق إجمالي خصم الخصومات.';
  end if;
  v_net := round((p_base_salary + p_additions - p_advance_deduction - v_deduction_deduction - p_other_deductions)::numeric, 2);
  if v_net < 0 then raise exception 'صافي الراتب سالب: راجع الإضافات والخصومات.'; end if;
  perform 1 from public.companies where id = v_cid for update;
  if p_payroll_id is null then
    if not exists (select 1 from public.financial_years where company_id = v_cid and status = 'open' and date_from <= p_date and date_to >= p_date) then
      raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
    end if;
    select coalesce(max(number), 0) + 1 into v_number from public.payrolls where company_id = v_cid;
    insert into public.payrolls (company_id, number, date, employee_id, period_year, period_month, account_kind, account_id, base_salary, additions, additions_note, advance_deduction, other_deductions, deduction_deduction, net_salary, notes)
    values (v_cid, v_number, p_date, p_employee_id, p_period_year, p_period_month, p_account_kind, p_account_id, p_base_salary, p_additions, p_additions_note, p_advance_deduction, p_other_deductions, v_deduction_deduction, v_net, p_notes)
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
      deduction_deduction = v_deduction_deduction, net_salary = v_net, notes = p_notes where id = v_payroll_id;
    delete from public.advance_settlements where payroll_id = v_payroll_id;
    delete from public.deduction_settlements where payroll_id = v_payroll_id;
  end if;
  for v_pair in select * from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb)) loop
    v_vid := (v_pair->>0)::bigint;
    v_amt := coalesce((v_pair->>1)::double precision, 0);
    if v_amt <= 0 then continue; end if;
    if not exists (select 1 from public.payment_vouchers where id = v_vid and voucher_type = 'advance' and employee_id = p_employee_id and company_id = v_cid) then
      raise exception 'سلفة غير موجودة أو لا تخص هذا الموظف.';
    end if;
    select amount into v_src_amount from public.payment_vouchers where id = v_vid;
    select coalesce(sum(amount), 0) into v_settled from public.advance_settlements where payment_voucher_id = v_vid;
    if v_amt > (v_src_amount - v_settled) + 0.001 then raise exception 'قيمة الخصم من إحدى السلف أكبر من المتبقي منها.'; end if;
    insert into public.advance_settlements (company_id, payment_voucher_id, payroll_id, amount) values (v_cid, v_vid, v_payroll_id, v_amt);
  end loop;
  for v_pair in select * from jsonb_array_elements(coalesce(p_deduction_settlements, '[]'::jsonb)) loop
    v_vid := (v_pair->>0)::bigint;
    v_amt := coalesce((v_pair->>1)::double precision, 0);
    if v_amt <= 0 then continue; end if;
    if not exists (select 1 from public.employee_deductions where id = v_vid and employee_id = p_employee_id and company_id = v_cid) then
      raise exception 'خصم غير موجود أو لا يخص هذا الموظف.';
    end if;
    select amount into v_src_amount from public.employee_deductions where id = v_vid;
    select coalesce(sum(amount), 0) into v_settled from public.deduction_settlements where employee_deduction_id = v_vid;
    if v_amt > (v_src_amount - v_settled) + 0.001 then raise exception 'قيمة الخصم من إحدى بنود الخصومات أكبر من المتبقي منها.'; end if;
    insert into public.deduction_settlements (company_id, employee_deduction_id, payroll_id, amount) values (v_cid, v_vid, v_payroll_id, v_amt);
  end loop;
  perform public.log_activity('payroll.save', 'payroll', v_payroll_id::text, '');
  return v_payroll_id;
end $$;

-- إشعار دائن ذري للنقلات المرتجعة: المبلغ والضريبة من الفاتورة، لا من المتصفح.
create or replace function public.save_credit_note_for_trips_v16(
  p_invoice_id bigint, p_date date, p_reason text, p_trip_ids bigint[]
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company_id uuid := public.auth_company_id();
  v_customer_id bigint; v_invoice_date date; v_vat_rate numeric(5,2);
  v_reason text; v_requested_count integer; v_trip_count integer;
  v_amount numeric(14,2); v_number integer; v_note_id bigint;
begin
  if v_company_id is null then raise exception 'لا توجد شركة مرتبطة بحسابك.'; end if;
  if not public.is_company_active() then raise exception 'الوصول غير متاح: اشتراك منتهي أو شركة موقوفة.'; end if;
  if p_invoice_id is null then raise exception 'الفاتورة غير صالحة.'; end if;
  if p_date is null then raise exception 'تاريخ الإشعار مطلوب.'; end if;
  if p_trip_ids is null or cardinality(p_trip_ids) = 0 then raise exception 'اختر نقلة واحدة على الأقل لإصدار الإشعار الدائن.'; end if;
  select count(distinct selected_id) into v_requested_count from unnest(p_trip_ids) as selected(selected_id);
  if v_requested_count <> cardinality(p_trip_ids) then raise exception 'قائمة النقلات المختارة تحتوي على تكرار.'; end if;
  v_reason := public.safe_text(p_reason, 4000);
  if v_reason = '' then raise exception 'سبب الإشعار إلزامي للمراجعة المحاسبية.'; end if;

  perform 1 from public.companies where id = v_company_id for update;
  select i.customer_id, i.date, round(i.vat_rate::numeric, 2)
    into v_customer_id, v_invoice_date, v_vat_rate
    from public.invoices i where i.id = p_invoice_id and i.company_id = v_company_id;
  if not found then raise exception 'الفاتورة المرتبطة غير موجودة.'; end if;
  if p_date < v_invoice_date then raise exception 'تاريخ الإشعار لا يجوز أن يسبق تاريخ الفاتورة.'; end if;
  if not exists(select 1 from public.financial_years y where y.company_id = v_company_id and y.status = 'open' and p_date between y.date_from and y.date_to) then
    raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
  end if;

  select count(*), round(coalesce(sum(t.price), 0)::numeric, 2) into v_trip_count, v_amount
    from public.invoice_trips t where t.company_id = v_company_id and t.invoice_id = p_invoice_id and t.id = any(p_trip_ids);
  if v_trip_count <> v_requested_count then raise exception 'إحدى النقلات المختارة غير موجودة أو لا تنتمي إلى هذه الفاتورة.'; end if;
  if v_amount <= 0 then raise exception 'إجمالي النقلات المختارة يجب أن يكون أكبر من صفر.'; end if;
  if exists(select 1 from public.credit_note_trips r where r.company_id = v_company_id and r.trip_id = any(p_trip_ids)) then
    raise exception 'تم إصدار إشعار دائن مسبقاً لإحدى النقلات المختارة.';
  end if;

  select coalesce(max(n.number), 0) + 1 into v_number from public.credit_debit_notes n where n.company_id = v_company_id;
  insert into public.credit_debit_notes(company_id, number, note_type, invoice_id, customer_id, date, amount, vat_rate, reason)
  values(v_company_id, v_number, 'credit', p_invoice_id, v_customer_id, p_date, v_amount, v_vat_rate, v_reason)
  returning id into v_note_id;
  insert into public.credit_note_trips(company_id, credit_note_id, trip_id, amount)
  select v_company_id, v_note_id, t.id, round(t.price::numeric, 2) from public.invoice_trips t
   where t.company_id = v_company_id and t.invoice_id = p_invoice_id and t.id = any(p_trip_ids);
  perform public.log_activity('credit_note.trip_return', 'credit_debit_note', v_note_id::text,
    'invoice=' || p_invoice_id::text || '; trips=' || array_to_string(p_trip_ids, ','));
  return v_note_id;
end $$;

revoke execute on function public.valid_trip_container_numbers(jsonb, integer) from public, anon;
grant execute on function public.valid_trip_container_numbers(jsonb, integer) to authenticated, service_role;
revoke execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text) from public, anon;
revoke execute on function public.save_payroll(bigint, date, bigint, int, int, text, bigint, double precision, double precision, text, double precision, double precision, text, jsonb, jsonb, double precision) from public, anon;
revoke all on function public.save_credit_note_for_trips_v16(bigint, date, text, bigint[]) from public, anon;
grant execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text) to authenticated, service_role;
grant execute on function public.save_payroll(bigint, date, bigint, int, int, text, bigint, double precision, double precision, text, double precision, double precision, text, jsonb, jsonb, double precision) to authenticated, service_role;
grant execute on function public.save_credit_note_for_trips_v16(bigint, date, text, bigint[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- أقل امتياز
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
-- روابط مرتجع النقلات تُكتب فقط عبر RPC الذرية؛ المستخدم يحتاج قراءتها للعرض.
revoke insert, update, delete on public.credit_note_trips from authenticated, anon;
grant select on public.credit_note_trips to authenticated, service_role;
grant usage, select on sequence public.credit_note_trips_id_seq to service_role;
-- تسويات الخصومات تُكتب حصراً عبر RPC الذرية save_payroll؛ القراءة فقط للعرض.
revoke insert, update, delete on public.deduction_settlements from authenticated, anon;
grant select on public.deduction_settlements to authenticated, service_role;
grant usage, select on sequence public.deduction_settlements_id_seq to service_role;

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


-- ============================================================================
-- منصة المطوّر وتشخيصها وتتبع الزوار (v18)
-- ============================================================================
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
    'credit_note_trips', 'credit_debit_notes', 'advance_settlements', 'deduction_settlements',
    'employee_deductions',
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
    'credit_debit_notes','credit_note_trips','payrolls','advance_settlements','deduction_settlements','employee_deductions','year_snapshots',
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
