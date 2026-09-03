-- ============================================================================
-- v15 — إصلاح رفض سندات الدفع والقبض الصحيحة باعتبارها خارج السنة المالية
--
-- السبب الجذري:
-- PostgreSQL ينفذ مشغلات BEFORE المتساوية أبجدياً. لذلك كان
-- trg_open_year_receipts / trg_open_year_payments يعملان قبل
-- trg_set_company_id عند INSERT، فيكون new.company_id فارغاً وقت فحص السنة.
--
-- هذه الترحيلة آمنة لإعادة التشغيل ولا تعدّل أي بيانات أو أرصدة.
-- ============================================================================

create or replace function public.guard_movement_open_year()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- شركة الجلسة هي المرجع الآمن. لا نعتمد على قيمة company_id المرسلة من
  -- العميل، ولا على مشغّل آخر قد يعمل بعد هذا المشغّل.
  v_company_id uuid := public.auth_company_id();
begin
  if v_company_id is null then
    raise exception 'لا توجد شركة مرتبطة بحسابك.';
  end if;

  -- يضمن أن فحص السنة وبقية مشغلات الإدراج يستخدمان الشركة نفسها، كما يمنع
  -- تمرير company_id لشركة أخرى من REST مباشرةً.
  new.company_id := v_company_id;

  if new.date is null
     or new.date < date '1900-01-01'
     or new.date > date '2200-12-31' then
    raise exception 'تاريخ الحركة غير صالح.';
  end if;

  if not exists (
    select 1
      from public.financial_years y
     where y.company_id = v_company_id
       and y.status = 'open'
       and new.date between y.date_from and y.date_to
  ) then
    raise exception 'تاريخ الحركة خارج نطاق أي سنة مالية مفتوحة.';
  end if;

  return new;
end
$$;

-- الدالة تُستدعى عبر المشغلات فقط.
revoke execute on function public.guard_movement_open_year()
  from public, anon, authenticated;

comment on function public.guard_movement_open_year() is
  'يفرض شركة الجلسة ويتحقق من وقوع تاريخ الحركة داخل سنة مالية مفتوحة؛ v15 يصلح ترتيب مشغلات INSERT.';
