-- ============================================================================
-- v6 — بيانات ضريبية وعنوان وطني تفصيلي (السعودية / زاتكا) — آمن التكرار
--
--  • الشركة (المنشأة): الرقم الضريبي، السجل التجاري، الرقم الموحّد، نوع المنشأة،
--    الحالة الضريبية، والعنوان الوطني الكامل.
--  • العميل: نفس الحزمة (مطلوبة في الفاتورة الضريبية لعميل خاضع للضريبة).
--  • المورّد: الجداول تُنشأ في ترحيل الموردين (v7).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) أعمدة المنشأة
-- ---------------------------------------------------------------------------
alter table public.companies add column if not exists name_en          text default '';
alter table public.companies add column if not exists tax_number       text default '';  -- الرقم الضريبي (15 رقماً)
alter table public.companies add column if not exists commercial_reg   text default '';  -- السجل التجاري (10 أرقام)
alter table public.companies add column if not exists unified_number   text default '';  -- الرقم الموحّد للمنشأة (700…)
alter table public.companies add column if not exists entity_type      text default 'establishment';
alter table public.companies add column if not exists tax_status       text default 'taxable';
alter table public.companies add column if not exists country          text default 'SA';
alter table public.companies add column if not exists region           text default '';  -- المنطقة/المحافظة
alter table public.companies add column if not exists city             text default '';
alter table public.companies add column if not exists district         text default '';  -- الحي
alter table public.companies add column if not exists street           text default '';
alter table public.companies add column if not exists building_no      text default '';  -- رقم المبنى (4 أرقام)
alter table public.companies add column if not exists postal_code      text default '';  -- الرمز البريدي (5 أرقام)
alter table public.companies add column if not exists additional_no    text default '';  -- الرقم الإضافي (4 أرقام)
alter table public.companies add column if not exists address_note     text default '';
alter table public.companies add column if not exists website          text default '';

alter table public.companies drop constraint if exists companies_entity_type_check;
alter table public.companies add constraint companies_entity_type_check
  check (entity_type in ('establishment', 'company', 'individual', 'nonprofit', 'government'));

alter table public.companies drop constraint if exists companies_tax_status_check;
alter table public.companies add constraint companies_tax_status_check
  check (tax_status in ('taxable', 'exempt', 'not_registered'));

-- ---------------------------------------------------------------------------
-- 2) أعمدة العميل
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists name_en          text default '';
alter table public.customers add column if not exists tax_number       text default '';
alter table public.customers add column if not exists commercial_reg   text default '';
alter table public.customers add column if not exists entity_type      text default 'company';
alter table public.customers add column if not exists tax_status       text default 'taxable';
alter table public.customers add column if not exists email            text default '';
alter table public.customers add column if not exists contact_person   text default '';
alter table public.customers add column if not exists country          text default 'SA';
alter table public.customers add column if not exists region           text default '';
alter table public.customers add column if not exists city             text default '';
alter table public.customers add column if not exists district         text default '';
alter table public.customers add column if not exists street           text default '';
alter table public.customers add column if not exists building_no      text default '';
alter table public.customers add column if not exists postal_code      text default '';
alter table public.customers add column if not exists additional_no    text default '';
alter table public.customers add column if not exists credit_limit     double precision not null default 0;
alter table public.customers add column if not exists payment_terms    int not null default 0;  -- مهلة السداد بالأيام

alter table public.customers drop constraint if exists customers_entity_type_check;
alter table public.customers add constraint customers_entity_type_check
  check (entity_type in ('establishment', 'company', 'individual', 'nonprofit', 'government'));

alter table public.customers drop constraint if exists customers_tax_status_check;
alter table public.customers add constraint customers_tax_status_check
  check (tax_status in ('taxable', 'exempt', 'not_registered'));

-- ---------------------------------------------------------------------------
-- 3) تحقّق قاعدي من صيغة الأرقام الرسمية (يُقبل الفراغ = غير مُدخل)
--    الرقم الضريبي السعودي: 15 رقماً يبدأ وينتهي بالرقم 3.
-- ---------------------------------------------------------------------------
create or replace function public.check_tax_identifiers() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare j jsonb;
begin
  j := to_jsonb(new);

  if coalesce(j ->> 'tax_number', '') <> '' and (j ->> 'tax_number') !~ '^3[0-9]{13}3$' then
    raise exception 'الرقم الضريبي يجب أن يكون 15 رقماً يبدأ وينتهي بالرقم 3.';
  end if;

  if coalesce(j ->> 'commercial_reg', '') <> '' and (j ->> 'commercial_reg') !~ '^[0-9]{10}$' then
    raise exception 'رقم السجل التجاري يجب أن يكون 10 أرقام.';
  end if;

  if coalesce(j ->> 'postal_code', '') <> '' and (j ->> 'postal_code') !~ '^[0-9]{5}$' then
    raise exception 'الرمز البريدي يجب أن يكون 5 أرقام.';
  end if;

  if coalesce(j ->> 'building_no', '') <> '' and (j ->> 'building_no') !~ '^[0-9]{4}$' then
    raise exception 'رقم المبنى يجب أن يكون 4 أرقام.';
  end if;

  if coalesce(j ->> 'additional_no', '') <> '' and (j ->> 'additional_no') !~ '^[0-9]{4}$' then
    raise exception 'الرقم الإضافي يجب أن يكون 4 أرقام.';
  end if;

  return new;
end $$;

drop trigger if exists trg_check_tax_companies on public.companies;
create trigger trg_check_tax_companies before insert or update on public.companies
  for each row execute function public.check_tax_identifiers();

drop trigger if exists trg_check_tax_customers on public.customers;
create trigger trg_check_tax_customers before insert or update on public.customers
  for each row execute function public.check_tax_identifiers();

-- ---------------------------------------------------------------------------
-- صلاحية التحديث: أعمدة الشركة التشغيلية (بدونها يعطي Supabase
-- «permission denied for table companies» عند حفظ بيانات الشركة)
-- ---------------------------------------------------------------------------
revoke update on public.companies from authenticated;
grant update (
  name, name_en, phone, email, website, address, currency, vat_rate, vat_note,
  tax_number, commercial_reg, unified_number, entity_type, tax_status,
  country, region, city, district, street, building_no, postal_code,
  additional_no, address_note
) on public.companies to authenticated;

-- ============================================================================
-- بعد التنفيذ: أكمل بيانات منشأتك من «الإعدادات ← بيانات الشركة»،
-- وبيانات كل عميل من شاشة العملاء. الفاتورة الضريبية تعتمد عليها.
-- ============================================================================
