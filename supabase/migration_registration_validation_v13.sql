-- ============================================================================
-- v13 — تسجيل ذري مع سنة مالية + تحقق أنواع/نصوص + منع تكرار الاتصال
-- شغّل بعد v11 و v12. لا يحذف أو يغيّر بيانات تاريخية؛ القيود NOT VALID
-- تمنع أي بيانات فاسدة جديدة حتى لو تم تجاوز الواجهة.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) أدوات التطبيع والتحقق الخادمي
-- ---------------------------------------------------------------------------
create or replace function public.safe_text(p_in text, p_max int default 2000)
returns text language sql immutable set search_path = public, pg_temp as $$
  select left(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_in, ''), '<[^>]*>', ' ', 'g'),
        '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]', '', 'g'
      )
    ), greatest(0, least(coalesce(p_max, 2000), 10000))
  );
$$;

create or replace function public.normalize_phone(p_in text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when regexp_replace(translate(coalesce(p_in, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g') like '00%' then substring(regexp_replace(translate(coalesce(p_in, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g') from 3)
    else regexp_replace(translate(coalesce(p_in, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g')
  end;
$$;

create or replace function public.is_allowed_email(p_email text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
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

create or replace function public.valid_phone(p_in text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v text := public.normalize_phone(p_in);
  d text := regexp_replace(v, '\D', '', 'g');
begin
  if coalesce(p_in, '') !~ '^\+?[0-9٠-٩۰-۹[:space:]().-]+$' then return false; end if;
  if length(d) < 8 or length(d) > 15 then return false; end if;
  if d ~ '^(.)\1+$' or d ~ '(0123456789|1234567890|9876543210|0987654321)' or d ~ '(.)\1{6,}$' then return false; end if;
  return true;
end $$;

create or replace function public.is_plausible_identity_text(p_in text, p_min int default 2)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v text := public.safe_text(p_in, 500);
  n text := lower(regexp_replace(public.safe_text(p_in, 500), '[[:space:]._/\\-]+', ' ', 'g'));
  compact text;
begin
  compact := regexp_replace(n, '[[:space:]]', '', 'g');
  if length(v) < greatest(1, p_min) then return false; end if;
  if n = any(array[
    'test','testing','demo','dummy','fake','sample','none','null','undefined','unknown','n/a','na','xxx','xxxx',
    'اختبار','تجربة','تجريبي','وهمي','غير معروف','بدون','لا يوجد','لايوجد','اسم','عنوان','عميل','مستخدم','مورد','شركة',
    'شركة وهمية','شركة تجريبية','customer','user','supplier','company'
  ]) then return false; end if;
  if length(compact) >= 3 and compact ~ '^(.)\1+$' then return false; end if;
  if compact ~ '^(1234567890|0123456789|9876543210|0987654321)+$' then return false; end if;
  return length(regexp_replace(v, '[^[:alpha:]]', '', 'g')) >= 2;
end $$;

create or replace function public.looks_malicious_text(p_in text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_in, '') ~* '(<[[:space:]]*script|javascript[[:space:]]*:|on(error|load|click|mouseover|focus)[[:space:]]*=|union[[:space:]]+select|insert[[:space:]]+into|delete[[:space:]]+from|drop[[:space:]]+table|truncate[[:space:]]+table|alter[[:space:]]+table|pg_sleep[[:space:]]*\(|xp_cmdshell|data:text/html|(\.\./){2,})';
$$;

-- يطبّق على أعمدة النصوص المحددة في TG_ARGV. الاستعلامات نفسها معلّمة من
-- Supabase؛ هذا الحارس يمنع أيضاً XSS/HTML ومحارف التحكم والإغراق النصي.
create or replace function public.guard_text_fields()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  j jsonb := to_jsonb(new);
  col text;
  raw text;
  clean text;
begin
  foreach col in array tg_argv loop
    if not (j ? col) or jsonb_typeof(j -> col) = 'null' then continue; end if;
    raw := j ->> col;
    if length(raw) > 4000 then raise exception 'الحقل % أطول من الحد المسموح (4000).', col; end if;
    if public.looks_malicious_text(raw) then raise exception 'المحتوى المُدخل في الحقل % غير مسموح به.', col; end if;
    clean := public.safe_text(raw, 4000);
    j := jsonb_set(j, array[col], to_jsonb(clean), false);
  end loop;
  new := jsonb_populate_record(new, j);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2) عنوان المسؤول ومنع تكرار البريد/الهاتف للحسابات والعملاء والموردين
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists address text not null default '';

create or replace function public.guard_unique_account_contact()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_phone text := public.normalize_phone(new.phone);
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
  if v_phone = '' or not public.valid_phone(new.phone) then raise exception 'رقم الهاتف مطلوب ويجب أن يكون حقيقياً وصحيحاً.'; end if;
  if v_email = '' then raise exception 'البريد الإلكتروني مطلوب.'; end if;
  new.phone := v_phone;
  new.email := v_email;
  perform pg_advisory_xact_lock(hashtextextended('account-phone:' || v_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('account-email:' || v_email, 0));

  if tg_table_name = 'companies' then
    if exists(select 1 from public.companies c where c.id <> new.id and public.normalize_phone(c.phone) = v_phone) or
       exists(select 1 from public.profiles p where public.normalize_phone(p.phone) = v_phone and (p.company_id is distinct from new.id or p.role <> 'owner'))
      then raise exception 'رقم الهاتف مستخدم بالفعل في حساب آخر.'; end if;
    if exists(select 1 from public.companies c where c.id <> new.id and lower(btrim(c.email)) = v_email) or
       exists(select 1 from public.profiles p where lower(btrim(p.email)) = v_email and (p.company_id is distinct from new.id or p.role <> 'owner'))
      then raise exception 'البريد الإلكتروني مستخدم بالفعل في حساب آخر.'; end if;
  else
    if exists(select 1 from public.profiles p where p.id <> new.id and public.normalize_phone(p.phone) = v_phone) or
       exists(select 1 from public.companies c where public.normalize_phone(c.phone) = v_phone and (new.role <> 'owner' or c.id is distinct from new.company_id))
      then raise exception 'رقم الهاتف مستخدم بالفعل في حساب آخر.'; end if;
    if exists(select 1 from public.profiles p where p.id <> new.id and lower(btrim(p.email)) = v_email) or
       exists(select 1 from public.companies c where lower(btrim(c.email)) = v_email and (new.role <> 'owner' or c.id is distinct from new.company_id))
      then raise exception 'البريد الإلكتروني مستخدم بالفعل في حساب آخر.'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_companies_unique_contact on public.companies;
create trigger trg_companies_unique_contact before insert or update of phone, email on public.companies
for each row execute function public.guard_unique_account_contact();
drop trigger if exists trg_profiles_unique_contact on public.profiles;
create trigger trg_profiles_unique_contact before insert or update of phone, email, company_id, role on public.profiles
for each row execute function public.guard_unique_account_contact();

create or replace function public.guard_party_unique_contact()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_phone text := public.normalize_phone(new.phone);
  v_email text := lower(btrim(coalesce(new.email, '')));
  found_duplicate boolean;
begin
  if coalesce(new.phone, '') <> '' then
    if not public.valid_phone(new.phone) then raise exception 'رقم الهاتف غير صحيح أو وهمي.'; end if;
    new.phone := v_phone;
    execute format('select exists(select 1 from public.%I x where x.company_id = $1 and x.id <> $2 and public.normalize_phone(x.phone) = $3)', tg_table_name)
      into found_duplicate using new.company_id, coalesce(new.id, -1), v_phone;
    if found_duplicate then raise exception 'رقم الهاتف مسجل لطرف آخر داخل الشركة.'; end if;
  end if;
  if v_email <> '' then
    new.email := v_email;
    execute format('select exists(select 1 from public.%I x where x.company_id = $1 and x.id <> $2 and lower(btrim(x.email)) = $3)', tg_table_name)
      into found_duplicate using new.company_id, coalesce(new.id, -1), v_email;
    if found_duplicate then raise exception 'البريد الإلكتروني مسجل لطرف آخر داخل الشركة.'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_customers_unique_contact on public.customers;
create trigger trg_customers_unique_contact before insert or update of phone, email on public.customers
for each row execute function public.guard_party_unique_contact();
drop trigger if exists trg_suppliers_unique_contact on public.suppliers;
create trigger trg_suppliers_unique_contact before insert or update of phone, email on public.suppliers
for each row execute function public.guard_party_unique_contact();

-- فهارس فريدة تمنع سباق طلبين متزامنين. إذا كانت هناك تكرارات تاريخية نترك
-- البيانات كما هي ويستمر المشغّل بمنع أي تكرار جديد إلى أن تُراجع يدوياً.
do $$
begin
  if not exists(select 1 from public.companies where phone <> '' group by public.normalize_phone(phone) having count(*) > 1) then
    create unique index if not exists uq_companies_phone_normalized on public.companies(public.normalize_phone(phone)) where phone <> '';
  end if;
  if not exists(select 1 from public.companies where email <> '' group by lower(btrim(email)) having count(*) > 1) then
    create unique index if not exists uq_companies_email_normalized on public.companies(lower(btrim(email))) where email <> '';
  end if;
  if not exists(select 1 from public.profiles where phone <> '' group by public.normalize_phone(phone) having count(*) > 1) then
    create unique index if not exists uq_profiles_phone_normalized on public.profiles(public.normalize_phone(phone)) where phone <> '';
  end if;
  if not exists(select 1 from public.profiles where email <> '' group by lower(btrim(email)) having count(*) > 1) then
    create unique index if not exists uq_profiles_email_normalized on public.profiles(lower(btrim(email))) where email <> '';
  end if;
  if not exists(select 1 from public.customers where phone <> '' group by company_id, public.normalize_phone(phone) having count(*) > 1) then
    create unique index if not exists uq_customers_company_phone_normalized on public.customers(company_id, public.normalize_phone(phone)) where phone <> '';
  end if;
  if not exists(select 1 from public.customers where email <> '' group by company_id, lower(btrim(email)) having count(*) > 1) then
    create unique index if not exists uq_customers_company_email_normalized on public.customers(company_id, lower(btrim(email))) where email <> '';
  end if;
  if not exists(select 1 from public.suppliers where phone <> '' group by company_id, public.normalize_phone(phone) having count(*) > 1) then
    create unique index if not exists uq_suppliers_company_phone_normalized on public.suppliers(company_id, public.normalize_phone(phone)) where phone <> '';
  end if;
  if not exists(select 1 from public.suppliers where email <> '' group by company_id, lower(btrim(email)) having count(*) > 1) then
    create unique index if not exists uq_suppliers_company_email_normalized on public.suppliers(company_id, lower(btrim(email))) where email <> '';
  end if;
end $$;

-- تحقق مبكر عند إنشاء auth.users من metadata؛ يمنع ترك حساب بلا شركة عند هاتف
-- مكرر. مستخدم المطوّر القديم مستثنى، والمستخدم الإضافي يحتاج الاسم والهاتف فقط.
create or replace function public.enforce_signup_metadata()
returns trigger language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  a jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  -- app metadata وحدها موثوقة؛ user metadata يستطيع المسجّل تزويرها.
  managed boolean := coalesce((a ->> 'managed_by_developer')::boolean, false);
  v_phone text := public.normalize_phone(m ->> 'phone');
begin
  if lower(coalesce(new.email, '')) = 'conta.moha@gmail.com' then return new; end if;
  if not public.is_allowed_email(new.email) then raise exception 'البريد الإلكتروني غير صالح أو وهمي أو غير مسموح.'; end if;
  if not public.valid_phone(m ->> 'phone') then raise exception 'رقم الهاتف مطلوب ويجب أن يكون حقيقياً وصحيحاً.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('signup-phone:' || v_phone, 0));
  if exists(select 1 from public.profiles p where public.normalize_phone(p.phone) = v_phone) or
     exists(select 1 from public.companies c where public.normalize_phone(c.phone) = v_phone)
    then raise exception 'رقم الهاتف مستخدم بالفعل في حساب آخر.'; end if;
  if not public.is_plausible_identity_text(m ->> 'name', 2) then raise exception 'اسم المسؤول مطلوب ويجب أن يكون حقيقياً.'; end if;
  if not managed then
    if not public.is_plausible_identity_text(m ->> 'company_name', 2) then raise exception 'اسم الشركة مطلوب ويجب أن يكون حقيقياً.'; end if;
    if not public.is_plausible_identity_text(m ->> 'owner_address', 5) then raise exception 'عنوان المسؤول مطلوب ويجب أن يكون حقيقياً.'; end if;
    begin
      if (m ->> 'financial_year_start')::date is null or (m ->> 'financial_year_end')::date is null then raise exception 'x'; end if;
    exception when others then raise exception 'تاريخا السنة المالية مطلوبان وصحيحان.'; end;
  end if;
  return new;
end $$;

do $$
begin
  execute 'drop trigger if exists trg_auth_users_signup_metadata on auth.users';
  execute 'create trigger trg_auth_users_signup_metadata before insert on auth.users for each row execute function public.enforce_signup_metadata()';
exception when insufficient_privilege then
  raise notice 'تعذّر إنشاء مشغّل metadata على auth.users؛ يبقى التحقق فعالاً في RPC وواجهة التطبيق.';
end $$;

-- ---------------------------------------------------------------------------
-- 3) إنشاء الشركة والسنة المالية في معاملة واحدة (RPC هي المعاملة)
-- ---------------------------------------------------------------------------
create or replace function public.register_company_with_year(
  p_company_name text,
  p_name text,
  p_phone text,
  p_address text,
  p_year_start date,
  p_year_end date
) returns uuid
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  v_email text;
  v_company_name text := public.safe_text(p_company_name, 120);
  v_owner_name text := public.safe_text(p_name, 120);
  v_owner_address text := public.safe_text(p_address, 300);
  v_phone text := public.normalize_phone(p_phone);
  duration_days integer;
begin
  if uid is null then raise exception 'يجب تسجيل الدخول أولاً.'; end if;
  select p.company_id into cid from public.profiles p where p.id = uid;
  if cid is not null then return cid; end if;

  v_email := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), (select u.email from auth.users u where u.id = uid), ''));
  if v_email = '' or not public.is_allowed_email(v_email) then raise exception 'البريد الإلكتروني غير صالح أو غير مسموح.'; end if;
  if not public.is_plausible_identity_text(v_company_name, 2) then raise exception 'اسم الشركة مطلوب ويجب أن يكون حقيقياً.'; end if;
  if not public.is_plausible_identity_text(v_owner_name, 2) then raise exception 'اسم المسؤول مطلوب ويجب أن يكون حقيقياً.'; end if;
  if not public.is_plausible_identity_text(v_owner_address, 5) then raise exception 'عنوان المسؤول مطلوب ويجب أن يكون حقيقياً.'; end if;
  if not public.valid_phone(p_phone) then raise exception 'رقم الهاتف مطلوب ويجب أن يكون حقيقياً وصحيحاً.'; end if;
  if p_year_start is null or p_year_end is null then raise exception 'تاريخا السنة المالية مطلوبان.'; end if;
  duration_days := (p_year_end - p_year_start) + 1;
  if p_year_start < date '1900-01-01' or p_year_end > date '2200-12-31' or duration_days < 180 or duration_days > 550 then
    raise exception 'نطاق السنة المالية غير صالح؛ المدة المسموحة من 180 إلى 550 يوماً.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('signup-phone:' || v_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('signup-email:' || v_email, 0));
  if exists(select 1 from public.companies c where public.normalize_phone(c.phone) = v_phone) or
     exists(select 1 from public.profiles p where public.normalize_phone(p.phone) = v_phone)
    then raise exception 'رقم الهاتف مستخدم بالفعل في حساب آخر.'; end if;
  if exists(select 1 from public.companies c where lower(btrim(c.email)) = v_email) or
     exists(select 1 from public.profiles p where lower(btrim(p.email)) = v_email and p.id <> uid)
    then raise exception 'البريد الإلكتروني مستخدم بالفعل في حساب آخر.'; end if;

  insert into public.companies(name, phone, email, address, currency, vat_rate)
  values(v_company_name, v_phone, v_email, v_owner_address, 'ر.س', 15)
  returning id into cid;

  insert into public.profiles(id, company_id, email, name, phone, address, role, is_active)
  values(uid, cid, v_email, v_owner_name, v_phone, v_owner_address, 'owner', true)
  on conflict(id) do update set
    company_id = excluded.company_id, email = excluded.email, name = excluded.name,
    phone = excluded.phone, address = excluded.address, role = 'owner', is_active = true;

  insert into public.financial_years(company_id, year, date_from, date_to, status, notes)
  values(cid, extract(year from p_year_start)::integer, p_year_start, p_year_end, 'open', 'السنة المالية الأولى');

  perform public.log_activity('company.register', 'company', cid::text, 'company + first financial year');
  return cid;
end $$;

revoke all on function public.register_company(text, text, text) from anon, authenticated;
revoke all on function public.register_company_with_year(text, text, text, text, date, date) from public, anon;
grant execute on function public.register_company_with_year(text, text, text, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) حراسة نصوص كل نقاط الكتابة التشغيلية
-- ---------------------------------------------------------------------------
drop trigger if exists trg_guard_text_companies on public.companies;
create trigger trg_guard_text_companies before insert or update on public.companies for each row execute function public.guard_text_fields(
  'name','name_en','phone','email','website','address','currency','vat_note','tax_number','commercial_reg','unified_number','entity_type','tax_status','country','region','city','district','street','building_no','postal_code','additional_no','address_note');
drop trigger if exists trg_guard_text_profiles on public.profiles;
create trigger trg_guard_text_profiles before insert or update on public.profiles for each row execute function public.guard_text_fields('email','name','phone','address','role');
drop trigger if exists trg_guard_text_years on public.financial_years;
create trigger trg_guard_text_years before insert or update on public.financial_years for each row execute function public.guard_text_fields('status','notes');
drop trigger if exists trg_guard_text_customers on public.customers;
create trigger trg_guard_text_customers before insert or update on public.customers for each row execute function public.guard_text_fields(
  'code','name','name_en','address','phone','email','contact_person','notes','tax_number','commercial_reg','entity_type','tax_status','country','region','city','district','street','building_no','postal_code','additional_no');
drop trigger if exists trg_guard_text_employees on public.employees;
create trigger trg_guard_text_employees before insert or update on public.employees for each row execute function public.guard_text_fields('code','name','nationality','phone','emp_type','notes');
drop trigger if exists trg_guard_text_vehicles on public.vehicles;
create trigger trg_guard_text_vehicles before insert or update on public.vehicles for each row execute function public.guard_text_fields('code','plate_number','vehicle_type','notes');
drop trigger if exists trg_guard_text_cashboxes on public.cashboxes;
create trigger trg_guard_text_cashboxes before insert or update on public.cashboxes for each row execute function public.guard_text_fields('code','name','notes');
drop trigger if exists trg_guard_text_banks on public.banks;
create trigger trg_guard_text_banks before insert or update on public.banks for each row execute function public.guard_text_fields('code','name','account_number','iban','notes');
drop trigger if exists trg_guard_text_invoices on public.invoices;
create trigger trg_guard_text_invoices before insert or update on public.invoices for each row execute function public.guard_text_fields('notes','container_number');
drop trigger if exists trg_guard_text_invoice_trips on public.invoice_trips;
create trigger trg_guard_text_invoice_trips before insert or update on public.invoice_trips for each row execute function public.guard_text_fields('from_loc','to_loc','notes');
drop trigger if exists trg_guard_text_trip_expenses on public.trip_expenses;
create trigger trg_guard_text_trip_expenses before insert or update on public.trip_expenses for each row execute function public.guard_text_fields('expense_type','source','account_kind','supplier_name','notes');
drop trigger if exists trg_guard_text_receipts on public.receipt_vouchers;
create trigger trg_guard_text_receipts before insert or update on public.receipt_vouchers for each row execute function public.guard_text_fields('account_kind','voucher_type','description');
drop trigger if exists trg_guard_text_payments on public.payment_vouchers;
create trigger trg_guard_text_payments before insert or update on public.payment_vouchers for each row execute function public.guard_text_fields('account_kind','voucher_type','vehicle_expense','description');
drop trigger if exists trg_guard_text_notes on public.credit_debit_notes;
create trigger trg_guard_text_notes before insert or update on public.credit_debit_notes for each row execute function public.guard_text_fields('note_type','reason');
drop trigger if exists trg_guard_text_payrolls on public.payrolls;
create trigger trg_guard_text_payrolls before insert or update on public.payrolls for each row execute function public.guard_text_fields('account_kind','additions_note','notes');
drop trigger if exists trg_guard_text_suppliers on public.suppliers;
create trigger trg_guard_text_suppliers before insert or update on public.suppliers for each row execute function public.guard_text_fields(
  'code','name','name_en','phone','email','contact_person','address','notes','tax_number','commercial_reg','entity_type','tax_status','country','region','city','district','street','building_no','postal_code','additional_no');
drop trigger if exists trg_guard_text_purchase_invoices on public.purchase_invoices;
create trigger trg_guard_text_purchase_invoices before insert or update on public.purchase_invoices for each row execute function public.guard_text_fields('supplier_ref','notes');
drop trigger if exists trg_guard_text_purchase_items on public.purchase_items;
create trigger trg_guard_text_purchase_items before insert or update on public.purchase_items for each row execute function public.guard_text_fields('item_name','unit','notes');
drop trigger if exists trg_guard_text_activation_requests on public.activation_requests;
create trigger trg_guard_text_activation_requests before insert or update on public.activation_requests for each row execute function public.guard_text_fields('plan_type','request_kind','status','receipt_url','notes','payer_name','payer_phone','pay_method','transfer_ref','admin_notes');
drop trigger if exists trg_guard_text_activity_logs on public.activity_logs;
create trigger trg_guard_text_activity_logs before insert or update on public.activity_logs for each row execute function public.guard_text_fields('actor_email','action','entity','entity_id','detail');
drop trigger if exists trg_guard_text_support_messages on public.support_messages;
create trigger trg_guard_text_support_messages before insert or update on public.support_messages for each row execute function public.guard_text_fields('sender','body');
drop trigger if exists trg_guard_text_complaints on public.complaints;
create trigger trg_guard_text_complaints before insert or update on public.complaints for each row execute function public.guard_text_fields('ticket','name','email','phone','subject','body','ip_hash','status');
drop trigger if exists trg_guard_text_complaint_messages on public.complaint_messages;
create trigger trg_guard_text_complaint_messages before insert or update on public.complaint_messages for each row execute function public.guard_text_fields('sender','body');

create or replace function public.guard_company_print_settings()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  k text;
  allowed text[] := array[
    'template','label_language','accent_color','paper','orientation','margin_mm','font_size_pt',
    'show_header','show_phone','show_address','show_logo','logo_url','header_note','show_date','show_count',
    'footer_text','show_signature','signature_label','zebra','grid_lines','header_color','watermark',
    'invoice_show_company_name','invoice_show_company_tax_number','invoice_show_company_cr','invoice_show_company_address',
    'invoice_show_company_phone','invoice_show_company_email','invoice_show_company_website','invoice_show_company_unified',
    'invoice_show_customer_name','invoice_show_customer_code','invoice_show_customer_tax_number','invoice_show_customer_cr',
    'invoice_show_customer_address','invoice_show_customer_phone','invoice_show_barcode','invoice_show_currency'
  ];
  bools text[] := array[
    'show_header','show_phone','show_address','show_logo','show_date','show_count','show_signature','zebra','grid_lines',
    'invoice_show_company_name','invoice_show_company_tax_number','invoice_show_company_cr','invoice_show_company_address',
    'invoice_show_company_phone','invoice_show_company_email','invoice_show_company_website','invoice_show_company_unified',
    'invoice_show_customer_name','invoice_show_customer_code','invoice_show_customer_tax_number','invoice_show_customer_cr',
    'invoice_show_customer_address','invoice_show_customer_phone','invoice_show_barcode','invoice_show_currency'
  ];
begin
  if jsonb_typeof(new.print_settings) <> 'object' or pg_column_size(new.print_settings) > 32768 then raise exception 'بنية إعدادات الطباعة أو حجمها غير صالح.'; end if;
  if exists(select 1 from jsonb_object_keys(new.print_settings) as keys(key) where key <> all(allowed)) then raise exception 'إعداد طباعة غير معروف.'; end if;
  foreach k in array bools loop
    if new.print_settings ? k and jsonb_typeof(new.print_settings -> k) <> 'boolean' then raise exception 'نوع إعداد الطباعة % غير صالح.', k; end if;
  end loop;
  foreach k in array array['logo_url','header_note','footer_text','signature_label','watermark','accent_color','header_color','template','label_language','paper','orientation'] loop
    if new.print_settings ? k and jsonb_typeof(new.print_settings -> k) <> 'string' then raise exception 'نوع إعداد الطباعة % يجب أن يكون نصاً.', k; end if;
    if length(coalesce(new.print_settings ->> k, '')) > 500 then raise exception 'إعداد الطباعة % أطول من الحد المسموح.', k; end if;
    if public.looks_malicious_text(new.print_settings ->> k) then raise exception 'إعداد الطباعة % يحتوي على محتوى غير مسموح.', k; end if;
  end loop;
  if new.print_settings ? 'template' and new.print_settings ->> 'template' not in ('modern','classic','compact','elegant','logistics','thermal','minimal') then raise exception 'قالب الطباعة غير صالح.'; end if;
  if new.print_settings ? 'label_language' and new.print_settings ->> 'label_language' not in ('ar','en') then raise exception 'لغة الطباعة غير صالحة.'; end if;
  if new.print_settings ? 'paper' and new.print_settings ->> 'paper' not in ('A4','A5','Letter') then raise exception 'حجم الورق غير صالح.'; end if;
  if new.print_settings ? 'orientation' and new.print_settings ->> 'orientation' not in ('portrait','landscape') then raise exception 'اتجاه الطباعة غير صالح.'; end if;
  if new.print_settings ? 'accent_color' and new.print_settings ->> 'accent_color' !~* '^#[0-9a-f]{6}$' then raise exception 'اللون الرئيسي غير صالح.'; end if;
  if new.print_settings ? 'header_color' and new.print_settings ->> 'header_color' !~* '^#[0-9a-f]{6}$' then raise exception 'لون رأس الجدول غير صالح.'; end if;
  if new.print_settings ? 'logo_url' and coalesce(new.print_settings ->> 'logo_url','') <> '' and new.print_settings ->> 'logo_url' !~* '^https?://' then raise exception 'رابط الشعار غير صالح.'; end if;
  if new.print_settings ? 'margin_mm' and (jsonb_typeof(new.print_settings -> 'margin_mm') <> 'number' or (new.print_settings ->> 'margin_mm')::numeric not between 0 and 40) then raise exception 'هامش الطباعة غير صالح.'; end if;
  if new.print_settings ? 'font_size_pt' and (jsonb_typeof(new.print_settings -> 'font_size_pt') <> 'number' or (new.print_settings ->> 'font_size_pt')::numeric not between 6 and 18) then raise exception 'حجم خط الطباعة غير صالح.'; end if;
  return new;
end $$;
drop trigger if exists trg_guard_company_print_settings on public.companies;
create trigger trg_guard_company_print_settings before insert or update of print_settings on public.companies for each row execute function public.guard_company_print_settings();

create or replace function public.guard_app_settings_json()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  k text;
  v text;
  item jsonb;
  text_keys text[] := array['app_name','app_version','developer_name','developer_title','developer_country','phone','whatsapp','telegram','email','support_hours','about_text','payment_note','copyright'];
  all_keys text[] := text_keys || array['visibility','custom_fields'];
begin
  if jsonb_typeof(new.data) <> 'object' or pg_column_size(new.data) > 32768 then raise exception 'بنية إعدادات التطبيق أو حجمها غير صالح.'; end if;
  if exists(select 1 from jsonb_object_keys(new.data) as keys(key) where key <> all(all_keys)) then raise exception 'إعداد تطبيق غير معروف.'; end if;
  if public.looks_malicious_text(new.data::text) then raise exception 'إعدادات التطبيق تحتوي على محتوى غير مسموح.'; end if;
  foreach k in array text_keys loop
    if new.data ? k and jsonb_typeof(new.data -> k) <> 'string' then raise exception 'نوع إعداد % يجب أن يكون نصاً.', k; end if;
    v := coalesce(new.data ->> k, '');
    if length(v) > (case when k = 'about_text' then 2000 when k = 'payment_note' then 1000 else 200 end) then raise exception 'إعداد % أطول من الحد المسموح.', k; end if;
  end loop;
  if new.data ? 'phone' and coalesce(new.data ->> 'phone','') <> '' and not public.valid_phone(new.data ->> 'phone') then raise exception 'رقم الاتصال غير صالح.'; end if;
  if new.data ? 'whatsapp' and coalesce(new.data ->> 'whatsapp','') <> '' and not public.valid_phone(new.data ->> 'whatsapp') then raise exception 'رقم واتساب غير صالح.'; end if;
  if new.data ? 'email' and coalesce(new.data ->> 'email','') <> '' and (length(new.data ->> 'email') > 254 or new.data ->> 'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'البريد الإلكتروني في الإعدادات غير صالح.'; end if;
  if new.data ? 'visibility' then
    if jsonb_typeof(new.data -> 'visibility') <> 'object' then raise exception 'visibility يجب أن يكون كائناً.'; end if;
    if exists(select 1 from jsonb_each(new.data -> 'visibility') as fields(key, value) where key <> all(text_keys) or jsonb_typeof(value) <> 'boolean') then raise exception 'قيم إظهار الحقول غير صالحة.'; end if;
  end if;
  if new.data ? 'custom_fields' then
    if jsonb_typeof(new.data -> 'custom_fields') <> 'array' or jsonb_array_length(new.data -> 'custom_fields') > 20 then raise exception 'قائمة الحقول الإضافية غير صالحة.'; end if;
    for item in select value from jsonb_array_elements(new.data -> 'custom_fields') loop
      if jsonb_typeof(item) <> 'object' or not (item ?& array['id','label','value','type','enabled']) or exists(select 1 from jsonb_object_keys(item) as keys(key) where key <> all(array['id','label','value','type','enabled'])) then raise exception 'بنية حقل إضافي غير صالحة.'; end if;
      if jsonb_typeof(item -> 'id') <> 'string' or item ->> 'id' !~* '^f_[a-z0-9]{4,40}$' then raise exception 'معرّف الحقل الإضافي غير صالح.'; end if;
      if jsonb_typeof(item -> 'label') <> 'string' or length(btrim(item ->> 'label')) not between 1 and 80 then raise exception 'مسمى الحقل الإضافي غير صالح.'; end if;
      if jsonb_typeof(item -> 'value') <> 'string' or length(item ->> 'value') > 500 then raise exception 'قيمة الحقل الإضافي غير صالحة.'; end if;
      if jsonb_typeof(item -> 'type') <> 'string' or item ->> 'type' not in ('text','phone','whatsapp','telegram','email','link') then raise exception 'نوع الحقل الإضافي غير صالح.'; end if;
      if jsonb_typeof(item -> 'enabled') <> 'boolean' then raise exception 'حالة الحقل الإضافي غير صالحة.'; end if;
      if item ->> 'type' in ('phone','whatsapp') and coalesce(item ->> 'value','') <> '' and not public.valid_phone(item ->> 'value') then raise exception 'هاتف الحقل الإضافي غير صالح.'; end if;
      if item ->> 'type' = 'email' and coalesce(item ->> 'value','') <> '' and item ->> 'value' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'بريد الحقل الإضافي غير صالح.'; end if;
      if item ->> 'type' = 'link' and coalesce(item ->> 'value','') <> '' and item ->> 'value' !~* '^https?://' then raise exception 'رابط الحقل الإضافي غير صالح.'; end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_app_settings_json on public.app_settings;
create trigger trg_guard_app_settings_json before insert or update of data on public.app_settings for each row execute function public.guard_app_settings_json();

-- كل حركة مؤرخة يجب أن تقع داخل سنة مالية مفتوحة حتى عند استدعاء REST/RPC مباشرة.
create or replace function public.guard_movement_open_year()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  -- لا نعتمد على new.company_id هنا: PostgreSQL ينفذ مشغلات BEFORE المتساوية
  -- حسب الاسم، ولذلك يعمل trg_open_year_* قبل trg_set_company_id عند الإدراج.
  v_company_id uuid := public.auth_company_id();
begin
  if v_company_id is null then raise exception 'لا توجد شركة مرتبطة بحسابك.'; end if;
  -- فرض شركة المستخدم هنا أيضاً يمنع الرفض الكاذب ويمنع تمرير شركة أخرى.
  new.company_id := v_company_id;
  if new.date is null or new.date < date '1900-01-01' or new.date > date '2200-12-31' then raise exception 'تاريخ الحركة غير صالح.'; end if;
  if not exists(select 1 from public.financial_years y where y.company_id = v_company_id and y.status = 'open' and new.date between y.date_from and y.date_to)
    then raise exception 'تاريخ الحركة خارج نطاق أي سنة مالية مفتوحة.'; end if;
  return new;
end $$;

drop trigger if exists trg_open_year_invoices on public.invoices;
create trigger trg_open_year_invoices before insert or update of date, company_id on public.invoices for each row execute function public.guard_movement_open_year();
drop trigger if exists trg_open_year_receipts on public.receipt_vouchers;
create trigger trg_open_year_receipts before insert or update of date, company_id on public.receipt_vouchers for each row execute function public.guard_movement_open_year();
drop trigger if exists trg_open_year_payments on public.payment_vouchers;
create trigger trg_open_year_payments before insert or update of date, company_id on public.payment_vouchers for each row execute function public.guard_movement_open_year();
drop trigger if exists trg_open_year_payrolls on public.payrolls;
create trigger trg_open_year_payrolls before insert or update of date, company_id on public.payrolls for each row execute function public.guard_movement_open_year();
drop trigger if exists trg_open_year_credit_debit on public.credit_debit_notes;
create trigger trg_open_year_credit_debit before insert or update of date, company_id on public.credit_debit_notes for each row execute function public.guard_movement_open_year();
drop trigger if exists trg_open_year_purchases on public.purchase_invoices;
create trigger trg_open_year_purchases before insert or update of date, company_id on public.purchase_invoices for each row execute function public.guard_movement_open_year();

-- ---------------------------------------------------------------------------
-- 5) حدود رقمية وبنيوية. NOT VALID يحمي الجديد دون تعطيل النشر بسبب سجل قديم.
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.companies add constraint ck_v13_companies_vat check (vat_rate between 0 and 100) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.financial_years add constraint ck_v13_years_range check (year between 1900 and 2200 and date_from < date_to and date_to - date_from <= 550) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.customers add constraint ck_v13_customers_numbers check (opening_balance between -999999999999 and 999999999999 and credit_limit between 0 and 999999999999 and payment_terms between 0 and 3650) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.employees add constraint ck_v13_employees_salary check (base_salary between 0 and 999999999999) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.cashboxes add constraint ck_v13_cashboxes_opening check (opening_balance between -999999999999 and 999999999999) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.banks add constraint ck_v13_banks_opening check (opening_balance between -999999999999 and 999999999999) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.invoices add constraint ck_v13_invoices_values check (number > 0 and vat_rate between 0 and 100 and jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.invoice_trips add constraint ck_v13_trip_values check (qty between 1 and 1000000 and unit_price between 0 and 999999999999 and price > 0 and price <= 999999999999) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trip_expenses add constraint ck_v13_expense_values check (qty > 0 and qty <= 1000000 and unit_amount >= 0 and unit_amount <= 999999999999 and amount > 0 and amount <= 999999999999) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.receipt_vouchers add constraint ck_v13_receipt_values check (number > 0 and amount > 0 and amount <= 999999999999) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.payment_vouchers add constraint ck_v13_payment_values check (number > 0 and quantity > 0 and quantity <= 1000000 and unit_amount > 0 and unit_amount <= 999999999999 and amount > 0 and amount <= 999999999999) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.credit_debit_notes add constraint ck_v13_note_values check (number > 0 and amount > 0 and amount <= 999999999999 and vat_rate between 0 and 100) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.payrolls add constraint ck_v13_payroll_values check (number > 0 and period_year between 1900 and 2200 and period_month between 1 and 12 and base_salary > 0 and base_salary <= 999999999999 and additions between 0 and 999999999999 and advance_deduction between 0 and 999999999999 and other_deductions between 0 and 999999999999 and net_salary between 0 and 999999999999) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.suppliers add constraint ck_v13_suppliers_numbers check (opening_balance between -999999999999 and 999999999999 and payment_terms between 0 and 3650) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.purchase_invoices add constraint ck_v13_purchase_header check (number > 0 and vat_rate between 0 and 100) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.purchase_items add constraint ck_v13_purchase_item check (qty > 0 and qty <= 1000000 and unit_price between 0 and 999999999999 and vat_rate between 0 and 100) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.companies add constraint ck_v13_print_settings_object check (jsonb_typeof(print_settings) = 'object' and pg_column_size(print_settings) <= 32768) not valid;
exception when duplicate_object then null; end $$;

-- صلاحيات الدوال المساعدة: لا حاجة لاستدعائها من الواجهة مباشرة.
revoke execute on function public.guard_text_fields() from public, anon, authenticated;
revoke execute on function public.guard_unique_account_contact() from public, anon, authenticated;
revoke execute on function public.guard_party_unique_contact() from public, anon, authenticated;
revoke execute on function public.enforce_signup_metadata() from public, anon, authenticated;
revoke execute on function public.guard_movement_open_year() from public, anon, authenticated;
revoke execute on function public.guard_app_settings_json() from public, anon, authenticated;
revoke execute on function public.guard_company_print_settings() from public, anon, authenticated;
