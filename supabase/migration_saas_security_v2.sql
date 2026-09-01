-- ============================================================================
-- ترقية SaaS + تحصين أمني شامل (v2)
-- الصق هذا الملف كاملاً في Supabase Dashboard > SQL Editor > Run (آمن التكرار)
--
-- يشمل:
--  1) رقم عميل فريد (8 خانات عشوائية غير متتابعة) لكل شركة
--  2) مستخدم واحد فقط لكل شركة (يُفرض على مستوى قاعدة البيانات)
--  3) منع التسجيل بالبريد الوهمي/المؤقت — السماح بـ Gmail/Yahoo/Hotmail/Outlook/iCloud فقط
--  4) الباقة التجريبية (7 أيام) هي الافتراضية لأي شركة جديدة
--  5) طلبات الترقية/التجديد بتفاصيل كاملة (بلا رفع صور على الموقع)
--  6) قناة رسائل بين العميل والمطوّر (محمية من الإغراق والحقن)
--  7) نظام شكاوى للزوار والعملاء برقم تتبع غير قابل للتخمين
--  8) تدقيق شامل لعزل الشركات (RLS على كل الجداول) + دالة فحص
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) أدوات مشتركة
-- ---------------------------------------------------------------------------

-- توليد رمز عشوائي من أبجدية غير ملتبسة (بلا 0/O/1/I/L)
create or replace function public.gen_code(p_len int)
returns text language plpgsql volatile as $$
declare
  v_alpha constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_out text := '';
  i int;
begin
  for i in 1..p_len loop
    -- gen_random_bytes متاح عبر pgcrypto؛ نرتد إلى random() عند غيابه
    begin
      v_out := v_out || substr(v_alpha, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alpha)), 1);
    exception when others then
      v_out := v_out || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end;
  end loop;
  return v_out;
end $$;

-- التحقق من مزوّد البريد المسموح به (نفس قائمة src/lib/security.ts)
create or replace function public.is_allowed_email(p_email text)
returns boolean language sql immutable as $$
  select case
    when p_email is null or p_email = '' then false
    when p_email !~ '^[A-Za-z0-9][A-Za-z0-9._%+-]{0,62}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then false
    when split_part(lower(p_email), '@', 2) in (
      'gmail.com','googlemail.com',
      'yahoo.com','yahoo.co.uk','yahoo.fr','yahoo.de','yahoo.it','yahoo.es','yahoo.ca',
      'yahoo.com.au','yahoo.co.in','yahoo.co.jp','ymail.com','rocketmail.com',
      'hotmail.com','hotmail.co.uk','hotmail.fr','hotmail.de','hotmail.it','hotmail.es',
      'outlook.com','outlook.sa','outlook.fr','outlook.de','outlook.es','outlook.com.au',
      'live.com','live.co.uk','msn.com',
      'icloud.com','me.com','mac.com'
    ) then true
    else false
  end;
$$;

-- تعقيم نص وارد من مستخدم قبل تخزينه (إزالة الوسوم ومحارف التحكم وقصّ الطول)
create or replace function public.safe_text(p_in text, p_max int default 2000)
returns text language sql immutable as $$
  select left(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_in, ''), '<[^>]*>', ' ', 'g'),
        '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E]', '', 'g'
      )
    ), p_max);
$$;

-- ---------------------------------------------------------------------------
-- 1) رقم العميل الفريد (8 خانات) — عشوائي تماماً وغير قابل للتتبع
-- ---------------------------------------------------------------------------
alter table public.companies add column if not exists client_code text;

create or replace function public.set_client_code() returns trigger
language plpgsql as $$
declare
  v_code text;
  i int := 0;
begin
  if new.client_code is not null and new.client_code <> '' then
    return new;
  end if;
  loop
    i := i + 1;
    v_code := public.gen_code(8);
    exit when not exists (select 1 from public.companies c where c.client_code = v_code);
    if i > 25 then raise exception 'تعذّر توليد رقم عميل فريد.'; end if;
  end loop;
  new.client_code := v_code;
  return new;
end $$;

drop trigger if exists trg_companies_client_code on public.companies;
create trigger trg_companies_client_code before insert on public.companies
  for each row execute function public.set_client_code();

-- تعبئة الشركات القائمة
do $$
declare r record; v_code text;
begin
  for r in select id from public.companies where client_code is null or client_code = '' loop
    loop
      v_code := public.gen_code(8);
      exit when not exists (select 1 from public.companies c where c.client_code = v_code);
    end loop;
    update public.companies set client_code = v_code where id = r.id;
  end loop;
end $$;

create unique index if not exists uq_companies_client_code on public.companies(client_code);
-- العميل لا يستطيع تعديل رقمه
revoke update on public.companies from authenticated;
grant update (name, phone, address, currency, vat_rate, vat_note) on public.companies to authenticated;

-- ---------------------------------------------------------------------------
-- 2) مستخدم واحد فقط لكل شركة
-- ---------------------------------------------------------------------------
create unique index if not exists uq_profiles_one_user_per_company
  on public.profiles(company_id) where company_id is not null;

-- ---------------------------------------------------------------------------
-- 3) منع البريد الوهمي على مستوى قاعدة البيانات (يشمل التسجيل من أي واجهة)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_allowed_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and not public.is_allowed_email(new.email) then
    raise exception 'يُقبل التسجيل ببريد Gmail أو Yahoo أو Hotmail أو Outlook أو iCloud فقط.';
  end if;
  return new;
end $$;

-- (أ) على جدول مستخدمي المصادقة — يمنع إنشاء الحساب أصلاً
do $$
begin
  execute 'drop trigger if exists trg_auth_users_allowed_email on auth.users';
  execute 'create trigger trg_auth_users_allowed_email before insert on auth.users
             for each row execute function public.enforce_allowed_email()';
exception when insufficient_privilege then
  raise notice 'تعذّر إنشاء المُشغّل على auth.users (صلاحيات) — يبقى المنع فعّالاً في register_company وواجهة التسجيل.';
end $$;

-- (ب) على الملف الشخصي (طبقة ثانية)
create or replace function public.set_profile_guard() returns trigger
language plpgsql as $$
declare v_email text;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', new.email));
  if not public.is_allowed_email(v_email) then
    raise exception 'يُقبل التسجيل ببريد Gmail أو Yahoo أو Hotmail أو Outlook أو iCloud فقط.';
  end if;
  new.email := v_email;
  new.role := case when v_email = 'conta.moha@gmail.com' then 'admin' else 'user' end;
  new.is_active := coalesce(new.is_active, true);
  new.name := public.safe_text(new.name, 120);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4) الباقة التجريبية 7 أيام هي الافتراضية
-- ---------------------------------------------------------------------------
alter table public.companies drop constraint if exists companies_plan_type_check;
alter table public.companies add constraint companies_plan_type_check
  check (plan_type in ('trial', 'monthly', 'yearly', 'open'));
alter table public.companies alter column plan_type set default 'trial';
alter table public.companies alter column trial_end set default (current_date + 7);

-- الشركات التي لم تشترك فعلياً بعد تُعاد إلى الباقة التجريبية
update public.companies
   set plan_type = 'trial'
 where subscription_end is null and plan_type in ('monthly', 'yearly');

-- تسجيل شركة جديدة: تجريبية 7 أيام + بريد مسموح + مستخدم واحد
create or replace function public.register_company(
  p_company_name text, p_name text default '', p_phone text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_company uuid;
begin
  if v_user is null then raise exception 'يجب تسجيل الدخول أولاً.'; end if;
  if not public.is_allowed_email(v_email) then
    raise exception 'يُقبل التسجيل ببريد Gmail أو Yahoo أو Hotmail أو Outlook أو iCloud فقط.';
  end if;
  if public.safe_text(p_company_name, 120) = '' then raise exception 'اسم الشركة مطلوب.'; end if;

  select company_id into v_company from public.profiles where id = v_user;
  if v_company is not null then return v_company; end if;

  insert into public.companies (name, phone, email, plan_type, trial_end, subscription_start, subscription_end, is_active)
  values (public.safe_text(p_company_name, 120), public.safe_text(p_phone, 24), v_email,
          'trial', current_date + 7, current_date, null, true)
  returning id into v_company;

  insert into public.profiles (id, company_id, email, name)
  values (v_user, v_company, v_email, public.safe_text(p_name, 120));

  perform public.log_activity('signup', 'company', v_company::text, public.safe_text(p_company_name, 120));
  return v_company;
end $$;

-- المطوّر يستطيع تعيين أي باقة (بما فيها التجريبية والمفتوحة)
create or replace function public.admin_set_subscription(
  p_company_id uuid, p_plan_type text, p_end_date date default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if p_plan_type not in ('trial', 'monthly', 'yearly', 'open') then raise exception 'نوع الاشتراك غير صالح.'; end if;
  update public.companies
     set plan_type = p_plan_type,
         subscription_start = case when p_plan_type in ('monthly','yearly') then current_date else subscription_start end,
         subscription_end = case when p_plan_type in ('open','trial') then null else p_end_date end,
         trial_end = case when p_plan_type = 'trial' then coalesce(p_end_date, current_date + 7) else trial_end end
   where id = p_company_id;
  perform public.log_activity('admin.set_subscription', 'company', p_company_id::text,
    p_plan_type || coalesce(' | ' || p_end_date::text, ''));
end $$;

-- ---------------------------------------------------------------------------
-- 5) طلبات الاشتراك/الترقية/التجديد بتفاصيل كاملة
-- ---------------------------------------------------------------------------
alter table public.activation_requests add column if not exists request_kind text not null default 'new';
alter table public.activation_requests drop constraint if exists activation_requests_kind_check;
alter table public.activation_requests add constraint activation_requests_kind_check
  check (request_kind in ('new', 'upgrade', 'renew'));
alter table public.activation_requests add column if not exists amount numeric(14,2) not null default 0;
alter table public.activation_requests add column if not exists payer_name text default '';
alter table public.activation_requests add column if not exists payer_phone text default '';
alter table public.activation_requests add column if not exists pay_method text default '';
alter table public.activation_requests add column if not exists transfer_ref text default '';
alter table public.activation_requests add column if not exists receipt_sent boolean not null default false;

-- تعقيم إجباري لكل نص وارد في الطلب
create or replace function public.clean_activation_request() returns trigger
language plpgsql as $$
begin
  new.notes        := public.safe_text(new.notes, 1000);
  new.payer_name   := public.safe_text(new.payer_name, 120);
  new.payer_phone  := regexp_replace(public.safe_text(new.payer_phone, 24), '[^0-9+ -]', '', 'g');
  new.pay_method   := public.safe_text(new.pay_method, 60);
  new.transfer_ref := public.safe_text(new.transfer_ref, 80);
  new.receipt_url  := null; -- لا تخزين لأي صورة على الموقع إطلاقاً
  if new.amount is null or new.amount < 0 or new.amount > 1000000 then
    raise exception 'قيمة المبلغ غير منطقية.';
  end if;
  return new;
end $$;

drop trigger if exists trg_clean_activation_request on public.activation_requests;
create trigger trg_clean_activation_request before insert or update on public.activation_requests
  for each row execute function public.clean_activation_request();

-- تجديد/ترقية: الموافقة تمدّد من تاريخ الانتهاء الحالي إن كان مستقبلياً
create or replace function public.admin_review_activation_request(
  p_request_id uuid, p_approve boolean, p_admin_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req activation_requests%rowtype;
  v_from date;
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  select * into v_req from public.activation_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود.'; end if;
  if v_req.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقاً.'; end if;

  if p_approve then
    select greatest(coalesce(subscription_end, current_date), current_date) into v_from
      from public.companies where id = v_req.company_id;
    update public.activation_requests
       set status = 'approved', admin_notes = public.safe_text(p_admin_notes, 500), reviewed_at = now()
     where id = p_request_id;
    update public.companies
       set plan_type = v_req.plan_type,
           subscription_start = current_date,
           subscription_end = v_from + (case when v_req.plan_type = 'yearly' then 365 else 30 end),
           trial_end = current_date
     where id = v_req.company_id;
  else
    update public.activation_requests
       set status = 'rejected', admin_notes = public.safe_text(p_admin_notes, 500), reviewed_at = now()
     where id = p_request_id;
  end if;

  perform public.log_activity(
    case when p_approve then 'admin.approve_request' else 'admin.reject_request' end,
    'activation_request', p_request_id::text, v_req.plan_type || ' / ' || v_req.request_kind);
end $$;

-- لا رفع صور على الموقع: إغلاق دلو الوصولات نهائياً
do $$
begin
  update storage.buckets set public = false where id = 'receipts';
  execute 'drop policy if exists "receipts_upload_own" on storage.objects';
  execute 'drop policy if exists "receipts_read_public" on storage.objects';
exception when others then
  raise notice 'تخطّي إعدادات التخزين.';
end $$;

-- ---------------------------------------------------------------------------
-- 6) قناة الرسائل بين العميل والمطوّر
-- ---------------------------------------------------------------------------
create table if not exists public.support_messages (
  id          bigint generated by default as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  sender      text not null check (sender in ('client', 'admin')),
  body        text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_support_company on public.support_messages(company_id, created_at);

create or replace function public.clean_support_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recent int;
begin
  new.body := public.safe_text(new.body, 2000);
  if length(new.body) < 2 then raise exception 'اكتب رسالة صحيحة.'; end if;

  -- الحماية من الإغراق: 10 رسائل كحد أقصى في الدقيقة و100 في اليوم لكل شركة
  select count(*) into v_recent from public.support_messages
   where company_id = new.company_id and created_at > now() - interval '1 minute';
  if v_recent >= 10 then raise exception 'رسائل كثيرة جداً — انتظر قليلاً قبل الإرسال.'; end if;
  select count(*) into v_recent from public.support_messages
   where company_id = new.company_id and created_at > now() - interval '1 day';
  if v_recent >= 100 then raise exception 'تجاوزت الحد اليومي للرسائل.'; end if;

  -- العميل لا يستطيع انتحال رسالة المطوّر
  if not public.is_admin() then new.sender := 'client'; end if;
  return new;
end $$;

drop trigger if exists trg_clean_support_message on public.support_messages;
create trigger trg_clean_support_message before insert on public.support_messages
  for each row execute function public.clean_support_message();

alter table public.support_messages enable row level security;
drop policy if exists support_tenant on public.support_messages;
create policy support_tenant on public.support_messages for select
  using (company_id = public.auth_company_id() or public.is_admin());
drop policy if exists support_tenant_insert on public.support_messages;
create policy support_tenant_insert on public.support_messages for insert
  with check (company_id = public.auth_company_id() or public.is_admin());
drop policy if exists support_admin on public.support_messages;
create policy support_admin on public.support_messages for all
  using (public.is_admin()) with check (public.is_admin());

drop trigger if exists trg_set_company_id on public.support_messages;
create trigger trg_set_company_id before insert on public.support_messages
  for each row execute function public.set_company_id();

grant select, insert on public.support_messages to authenticated, service_role;
revoke update, delete on public.support_messages from authenticated;

-- ---------------------------------------------------------------------------
-- 7) الشكاوى (للزوار والعملاء) برقم تتبع غير قابل للتخمين
-- ---------------------------------------------------------------------------
create table if not exists public.complaints (
  id          uuid primary key default gen_random_uuid(),
  ticket      text not null unique,
  company_id  uuid references public.companies(id) on delete set null,
  name        text not null default '',
  email       text not null default '',
  phone       text not null default '',
  subject     text not null default '',
  body        text not null default '',
  status      text not null default 'open' check (status in ('open', 'answered', 'closed')),
  ip_hash     text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_complaints_status on public.complaints(status, created_at);

create table if not exists public.complaint_messages (
  id           bigint generated by default as identity primary key,
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  sender       text not null check (sender in ('visitor', 'admin')),
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_complaint_msgs on public.complaint_messages(complaint_id, created_at);

-- الشكاوى تُدار حصرياً عبر مسارات الخادم (service_role) أو المطوّر — لا وصول للزوار مباشرة
alter table public.complaints enable row level security;
alter table public.complaint_messages enable row level security;
drop policy if exists complaints_admin on public.complaints;
create policy complaints_admin on public.complaints for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists complaint_msgs_admin on public.complaint_messages;
create policy complaint_msgs_admin on public.complaint_messages for all
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.complaints from anon, authenticated;
revoke all on public.complaint_messages from anon, authenticated;
grant select, insert, update on public.complaints to service_role;
grant select, insert on public.complaint_messages to service_role;
grant select on public.complaints to authenticated;          -- للمطوّر عبر RLS فقط
grant select on public.complaint_messages to authenticated;  -- للمطوّر عبر RLS فقط

-- ---------------------------------------------------------------------------
-- 8) تدقيق العزل: RLS مفعّل على كل جدول + دالة فحص سريعة
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public'
       and tablename not in ('activity_logs')
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- تُرجع الجداول التي ينقصها RLS أو سياسة عزل (يجب أن تكون النتيجة فارغة)
create or replace function public.rls_audit()
returns table (table_name text, rls_enabled boolean, policy_count int)
language sql stable security definer set search_path = public, pg_catalog as $$
  select c.relname::text,
         c.relrowsecurity,
         (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (c.relrowsecurity = false
          or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) = 0);
$$;
revoke execute on function public.rls_audit() from public, anon;
grant execute on function public.rls_audit() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9) أقل امتياز (إعادة تأكيد)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------------------
-- 10) استثناءات ضرورية بعد التشديد (وإلا يفشل الزائر وصفحة الدخول بـ 401)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon;
grant select on public.app_settings to anon;
do $grants$
declare
  r record;
  fn text;
  wanted text[] := array[
    'register_company','is_admin','auth_company_id','is_company_active',
    'is_active_user','export_company_data','safe_text','log_activity',
    'gen_code','admin_update_app_settings','admin_set_company_status',
    'admin_set_subscription','admin_delete_company','admin_review_activation_request',
    'admin_set_profile_status','admin_set_profile_role','save_invoice','save_payroll'
  ];
begin
  foreach fn in array wanted loop
    for r in
      select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('grant execute on function %s to authenticated', r.sig);
    end loop;
  end loop;

  -- is_allowed_email يحتاجها الزائر أيضاً (تحقق البريد قبل التسجيل)
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_allowed_email'
  loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $grants$;

-- 2ب) دالة is_active_user مفقودة في بعض القواعد — ننشئها إن لم تكن موجودة
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.is_active from public.profiles p where p.id = auth.uid()),
    false
  );
$$;
grant execute on function public.is_active_user() to authenticated;

