-- ============================================================================
-- إصلاح عزل/اختفاء البيانات بعد تشغيل migration_company_id.sql أكثر من مرة
--
-- السبب الذي يعالجه هذا الملف:
-- النسخة القديمة من migration_company_id كانت تنشئ شركة جديدة لكل profile في
-- كل تشغيل، ثم تغيّر profiles.company_id. وبقيت الصفوف القديمة على company_id
-- السابق، فأصبحت غير مرئية للمستخدم (وقد تبدو كأنها اختفت).
--
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor بعد أخذ نسخة احتياطية.
-- لا يحذف أي شركة أو سجل؛ يعيد ربط السجلات القديمة بالمستخدم صاحبها اعتماداً
-- على user_id الموجود في قاعدة البيانات القديمة.
-- ============================================================================

begin;

-- منع تكرار المشكلة عند إعادة تشغيل ترحيلة الشركة الأصلية.
-- (الجزء الأساسي موجود أيضاً في migration_company_id.sql للمشاريع الجديدة.)

do $$
declare
  t text;
begin
  -- في النسخ القديمة كان user_id هو مصدر الحقيقة. نستخدمه لإعادة التصحيح
  -- حتى لو كان company_id غير null لكنه يشير إلى شركة قديمة/خاطئة.
  foreach t in array array[
    'financial_years','customers','employees','vehicles','cashboxes','banks',
    'invoices','invoice_trips','trip_expenses','receipt_vouchers',
    'payment_vouchers','payrolls','advance_settlements','year_snapshots'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      execute format(
        'update public.%I d
            set company_id = p.company_id
           from public.profiles p
          where d.user_id = p.id
            and p.company_id is not null
            and d.company_id is distinct from p.company_id', t
      );
    end if;
  end loop;
end $$;

-- كشف سريع بعد الإصلاح: يجب أن تكون النتيجة صفراً.
-- لا نستخدم raise exception حتى لا نمنع قواعد بيانات جديدة لا تحتوي user_id.
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'financial_years','customers','employees','vehicles','cashboxes','banks',
    'invoices','invoice_trips','trip_expenses','receipt_vouchers',
    'payment_vouchers','payrolls','advance_settlements','year_snapshots'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      execute format(
        'select count(*) from public.%I d
          where exists (select 1 from public.profiles p
                         where p.id = d.user_id
                           and p.company_id is not null
                           and d.company_id is distinct from p.company_id)', t
      ) into n;
      if n > 0 then
        raise exception 'Tenant repair failed for table %: % rows remain mismatched', t, n;
      end if;
    end if;
  end loop;
end $$;

commit;

-- ملاحظة استعادة مهمة:
-- إذا كانت نسخة قديمة قد حذفت user_id أو حُذفت الشركات القديمة يدوياً، فلا يمكن
-- استنتاج مالك السجل بأمان من التطبيق. عندها يلزم استرجاع نسخة Supabase الاحتياطية
-- قبل تشغيل الترحيلة، ثم تشغيل هذا الإصلاح، وعدم دمج الشركات تلقائياً بالتخمين.
