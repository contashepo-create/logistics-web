-- ============================================================================
-- إصلاح: «permission denied for table companies» عند حفظ بيانات الشركة
-- أو أي إعدادات أخرى (الطباعة، البيانات الضريبية، العنوان الوطني…)
--
-- السبب: كان منح التحديث في جدول companies يسمح لصاحب الشركة ببعض الأعمدة فقط
--        (name, phone, address, currency, vat_rate, vat_note)، بينما الواجهة
--        تحفظ أيضاً: email, name_en, website, البيانات الضريبية، العنوان الوطني،
--        و print_settings ⇒ Supabase يرفض العملية برسالة «permission denied».
--
-- الحل: تأمين الأعمدة إن كانت مفقودة، ثم منح أعمدة التحديث التشغيلية كلها
--        لصاحب الشركة (authenticated) مع إبقاء أعمدة الاشتراك/الحالة/الرقم
--        للمطوّر فقط (service_role / is_admin).
--
-- التنفيذ: Supabase Dashboard > SQL Editor > New query > الصق الملف > Run
-- آمن التكرار (يمكن تشغيله أكثر من مرة بلا أثر جانبي).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) التأكد من وجود كل الأعمدة التي تحفظها شاشة الإعدادات
-- ---------------------------------------------------------------------------
alter table public.companies add column if not exists name_en          text default '';
alter table public.companies add column if not exists phone            text default '';
alter table public.companies add column if not exists email            text default '';
alter table public.companies add column if not exists website          text default '';
alter table public.companies add column if not exists address          text default '';
alter table public.companies add column if not exists currency         text default 'ر.س';
alter table public.companies add column if not exists vat_rate         double precision not null default 15;
alter table public.companies add column if not exists vat_note         text default 'فاتورة مرجعية — ضريبة القيمة المضافة 15%';
alter table public.companies add column if not exists tax_number       text default '';
alter table public.companies add column if not exists commercial_reg   text default '';
alter table public.companies add column if not exists unified_number   text default '';
alter table public.companies add column if not exists entity_type      text default 'establishment';
alter table public.companies add column if not exists tax_status       text default 'taxable';
alter table public.companies add column if not exists country          text default 'SA';
alter table public.companies add column if not exists region           text default '';
alter table public.companies add column if not exists city             text default '';
alter table public.companies add column if not exists district         text default '';
alter table public.companies add column if not exists street           text default '';
alter table public.companies add column if not exists building_no      text default '';
alter table public.companies add column if not exists postal_code      text default '';
alter table public.companies add column if not exists additional_no    text default '';
alter table public.companies add column if not exists address_note     text default '';
alter table public.companies add column if not exists print_settings   jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2) إزالة أي أعمدة قد يملكها authenticated حالياً ثم منح القائمة الصحيحة فقط
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select column_name
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'companies'
      and privilege_type = 'UPDATE'
      and grantee = 'authenticated'
  loop
    execute format('revoke update (%I) on public.companies from authenticated', r.column_name);
  end loop;
end $$;

revoke update on public.companies from authenticated;

grant update (
  name, name_en, phone, email, website, address, currency, vat_rate, vat_note,
  tax_number, commercial_reg, unified_number, entity_type, tax_status,
  country, region, city, district, street, building_no, postal_code,
  additional_no, address_note, print_settings
) on public.companies to authenticated;

-- service_role (لوحة المطوّر/الدوال الخلفية) يبقى بصلاحية كاملة
grant update on public.companies to service_role;

-- ---------------------------------------------------------------------------
-- تحقق سريع: يجب أن تعرض سجلاً واحداً بصلاحية UPDATE لـ authenticated
-- ---------------------------------------------------------------------------
-- select grantee, table_name, column_name, privilege_type
-- from information_schema.column_privileges
-- where table_schema = 'public' and table_name = 'companies' and privilege_type = 'UPDATE'
-- order by grantee, column_name;
-- ============================================================================
