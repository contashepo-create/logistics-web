-- ============================================================================
-- إصلاحان معماريان: (1) سباق أرقام المستندات (2) عدم ذرّية حفظ الفاتورة/الراتب
--
-- المشكلة 1: كانت أرقام المستندات تُحسب بـ MAX(number)+1 من طلبين منفصلين،
--   فيمكن أن يتولّد رقمان متطابقان عند التزامن (أو من تبويبين).
--   الحل: قيد فريد (company_id, number) + دوال خادمية تقفل صف الشركة (FOR UPDATE)
--   وتحسب الرقم وتُدرج في معاملة واحدة.
--
-- المشكلة 2: كان حفظ الفاتورة والراتب يتم عبر عدة طلبات (رأس + تفاصيل) بدون
--   معاملة، فأي فشل في المنتصف يترك حالة ناقصة.
--   الحل: دوال save_invoice / save_payroll تنفّذ كل العملية في معاملة واحدة.
--
-- الصق هذا الملف كاملاً في Supabase Dashboard > SQL Editor > Run (آمن التكرار).
-- ⚠️  إن كانت لديك أرقام مكررة مسبقاً (من النسخة القديمة) سيفشل إنشاء القيد
--     الفريد — راجع/وحّد الأرقام المكررة أولاً ثم أعد التشغيل.
-- ============================================================================

-- 0) حقل رقم الحاوية على الفاتورة (اختياري — يُدخل عند إصدار الفاتورة)
alter table public.invoices add column if not exists container_number text default '';

-- 1) قيود فريدة على (company_id, number) — ضمانة قاطعة ضد تكرار الأرقام
create unique index if not exists uq_invoices_company_number
  on public.invoices(company_id, number);
create unique index if not exists uq_receipts_company_number
  on public.receipt_vouchers(company_id, number);
create unique index if not exists uq_payments_company_number
  on public.payment_vouchers(company_id, number);
create unique index if not exists uq_payrolls_company_number
  on public.payrolls(company_id, number);

-- 2) حفظ الفاتورة ذرّياً (رأس + نقلات + مصروفات في معاملة واحدة مع ترقيم مُقفَل)
create or replace function public.save_invoice(
  p_invoice_id  bigint,               -- null = إنشاء جديد
  p_date        date,
  p_customer_id bigint,
  p_vat_rate    double precision,
  p_notes       text default '',
  p_attachments jsonb default '[]'::jsonb,
  p_trips       jsonb default '[]'::jsonb,
  p_container_number text default ''
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cid        uuid := public.auth_company_id();
  v_invoice_id bigint := p_invoice_id;
  v_number     int;
  v_old_date   date;
  v_trip       jsonb;
  v_trip_id    bigint;
  v_kept       bigint[] := '{}'::bigint[];
  v_linked     int;
  v_exp        jsonb;
begin
  if v_cid is null then raise exception 'لا توجد شركة مرتبطة بحسابك.'; end if;
  if not public.is_company_active() then
    raise exception 'الوصول غير متاح: اشتراك منتهي أو شركة موقوفة.';
  end if;
  if p_customer_id is null then raise exception 'اختر العميل.'; end if;
  if jsonb_array_length(p_trips) = 0 then raise exception 'أضف نقلة واحدة على الأقل للفاتورة.'; end if;

  -- تسلسل الترقيم: قفل صف الشركة يجعل كل عمليات الحفظ لنفس الشركة متسلسلة
  perform 1 from public.companies where id = v_cid for update;

  if not exists (select 1 from public.customers where id = p_customer_id and company_id = v_cid) then
    raise exception 'العميل المحدد غير موجود.';
  end if;

  if p_invoice_id is null then
    if not exists (
      select 1 from public.financial_years
      where company_id = v_cid and status = 'open' and date_from <= p_date and date_to >= p_date
    ) then
      raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
    end if;
    select coalesce(max(number), 0) + 1 into v_number
      from public.invoices where company_id = v_cid;
    insert into public.invoices (company_id, number, date, customer_id, vat_rate, notes, attachments, container_number)
    values (v_cid, v_number, p_date, p_customer_id, p_vat_rate, p_notes, p_attachments, coalesce(p_container_number, ''))
    returning id into v_invoice_id;
  else
    select date into v_old_date from public.invoices
      where id = p_invoice_id and company_id = v_cid for update;
    if v_old_date is null then raise exception 'الفاتورة غير موجودة.'; end if;
    if not exists (
      select 1 from public.financial_years
      where company_id = v_cid and status = 'open' and date_from <= v_old_date and date_to >= v_old_date
    ) then
      raise exception 'لا يمكن تعديل حركة بتاريخ قديم خارج السنة المالية المفتوحة.';
    end if;
    if not exists (
      select 1 from public.financial_years
      where company_id = v_cid and status = 'open' and date_from <= p_date and date_to >= p_date
    ) then
      raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
    end if;
    update public.invoices
    set date = p_date, customer_id = p_customer_id, vat_rate = p_vat_rate,
        notes = p_notes, attachments = p_attachments,
        container_number = coalesce(p_container_number, '')
    where id = v_invoice_id;
  end if;

  -- تحديد النقلات المبقاة
  for v_trip in select * from jsonb_array_elements(p_trips) loop
    if (v_trip->>'id') is not null then
      v_kept := array_append(v_kept, (v_trip->>'id')::bigint);
    end if;
  end loop;

  -- حذف النقلات المحذوفة (مع منع حذف المرتبطة بسندات دفع)
  for v_trip_id in
    select id from public.invoice_trips
    where invoice_id = v_invoice_id and not (id = any(v_kept))
  loop
    select count(*) into v_linked from public.payment_vouchers
      where voucher_type = 'trip' and trip_id = v_trip_id;
    if v_linked > 0 then
      raise exception 'لا يمكن حذف نقلة مرتبطة بسندات دفع (مصروف يخص الرحلة). احذف السندات المرتبطة أولاً.';
    end if;
    delete from public.invoice_trips where id = v_trip_id;
  end loop;

  -- إدراج/تحديث النقلات والمصروفات
  for v_trip in select * from jsonb_array_elements(p_trips) loop
    if coalesce((v_trip->>'price')::double precision, 0) <= 0 then
      raise exception 'سعر النقلة يجب أن يكون أكبر من صفر.';
    end if;
    if (v_trip->>'id') is not null then
      v_trip_id := (v_trip->>'id')::bigint;
      update public.invoice_trips
      set vehicle_id = nullif(v_trip->>'vehicle_id', '')::bigint,
          driver_id  = nullif(v_trip->>'driver_id', '')::bigint,
          from_loc   = coalesce(v_trip->>'from_loc', ''),
          to_loc     = coalesce(v_trip->>'to_loc', ''),
          price      = (v_trip->>'price')::double precision,
          notes      = coalesce(v_trip->>'notes', '')
      where id = v_trip_id and invoice_id = v_invoice_id;
      if not found then raise exception 'النقلة غير موجودة ضمن هذه الفاتورة.'; end if;
      delete from public.trip_expenses where trip_id = v_trip_id;
    else
      insert into public.invoice_trips (company_id, invoice_id, vehicle_id, driver_id, from_loc, to_loc, price, notes)
      values (v_cid, v_invoice_id, nullif(v_trip->>'vehicle_id', '')::bigint, nullif(v_trip->>'driver_id', '')::bigint,
              coalesce(v_trip->>'from_loc', ''), coalesce(v_trip->>'to_loc', ''),
              (v_trip->>'price')::double precision, coalesce(v_trip->>'notes', ''))
      returning id into v_trip_id;
    end if;

    for v_exp in select * from jsonb_array_elements(coalesce(v_trip->'expenses', '[]'::jsonb)) loop
      if coalesce((v_exp->>'amount')::double precision, 0) <= 0 then
        raise exception 'مبلغ مصروف النقلة يجب أن يكون أكبر من صفر.';
      end if;
      insert into public.trip_expenses (company_id, trip_id, expense_type, amount, notes)
      values (v_cid, v_trip_id, coalesce(v_exp->>'expense_type', 'other'),
              (v_exp->>'amount')::double precision, coalesce(v_exp->>'notes', ''));
    end loop;
  end loop;

  perform public.log_activity('invoice.save', 'invoice', v_invoice_id::text, '');
  return v_invoice_id;
end $$;

-- 3) حفظ الراتب ذرّياً (صف الراتب + تسويات السلف في معاملة واحدة مع ترقيم مُقفَل)
create or replace function public.save_payroll(
  p_payroll_id       bigint,          -- null = إنشاء جديد
  p_date             date,
  p_employee_id      bigint,
  p_period_year      int,
  p_period_month     int,
  p_account_kind     text,
  p_account_id       bigint,
  p_base_salary      double precision,
  p_additions        double precision,
  p_additions_note   text default '',
  p_advance_deduction double precision default 0,
  p_other_deductions double precision default 0,
  p_notes            text default '',
  p_settlements      jsonb default '[]'::jsonb   -- [[voucher_id, amount], ...]
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cid       uuid := public.auth_company_id();
  v_payroll_id bigint := p_payroll_id;
  v_number    int;
  v_old_date  date;
  v_pair      jsonb;
  v_vid       bigint;
  v_amt       double precision;
  v_settled   double precision;
  v_adv_amount double precision;
  v_total     double precision := 0;
  v_net       double precision;
begin
  if v_cid is null then raise exception 'لا توجد شركة مرتبطة بحسابك.'; end if;
  if not public.is_company_active() then
    raise exception 'الوصول غير متاح: اشتراك منتهي أو شركة موقوفة.';
  end if;
  if p_employee_id is null then raise exception 'اختر الموظف/السائق.'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and company_id = v_cid) then
    raise exception 'الموظف المحدد غير موجود.';
  end if;
  if p_account_kind = 'cashbox' then
    if not exists (select 1 from public.cashboxes where id = p_account_id and company_id = v_cid) then
      raise exception 'الخزينة المحددة غير موجودة.';
    end if;
  elsif p_account_kind = 'bank' then
    if not exists (select 1 from public.banks where id = p_account_id and company_id = v_cid) then
      raise exception 'البنك المحدد غير موجود.';
    end if;
  else
    raise exception 'جهة الصرف غير صالحة.';
  end if;

  if p_period_month < 1 or p_period_month > 12 then raise exception 'شهر الراتب يجب أن يكون بين 1 و 12.'; end if;
  if p_period_year < 1900 or p_period_year > 2200 then raise exception 'سنة الراتب غير منطقية.'; end if;
  if p_base_salary <= 0 then raise exception 'الراتب الأساسي يجب أن يكون أكبر من صفر.'; end if;

  -- مجموع التسويات يجب أن يطابق قيمة الخصم من السلف
  for v_pair in select * from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb)) loop
    v_total := v_total + coalesce((v_pair->>1)::double precision, 0);
  end loop;
  if abs(v_total - p_advance_deduction) > 0.001 then
    raise exception 'مجموع خصومات السلف الموزعة لا يطابق قيمة الخصم من السلف.';
  end if;

  v_net := round((p_base_salary + p_additions - p_advance_deduction - p_other_deductions)::numeric, 2);
  if v_net < 0 then raise exception 'صافي الراتب سالب: راجع الإضافات والخصومات.'; end if;

  -- تسلسل الترقيم
  perform 1 from public.companies where id = v_cid for update;

  if p_payroll_id is null then
    if not exists (
      select 1 from public.financial_years
      where company_id = v_cid and status = 'open' and date_from <= p_date and date_to >= p_date
    ) then
      raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
    end if;
    select coalesce(max(number), 0) + 1 into v_number
      from public.payrolls where company_id = v_cid;
    insert into public.payrolls (company_id, number, date, employee_id, period_year, period_month,
      account_kind, account_id, base_salary, additions, additions_note, advance_deduction,
      other_deductions, net_salary, notes)
    values (v_cid, v_number, p_date, p_employee_id, p_period_year, p_period_month,
      p_account_kind, p_account_id, p_base_salary, p_additions, p_additions_note, p_advance_deduction,
      p_other_deductions, v_net, p_notes)
    returning id into v_payroll_id;
  else
    select date into v_old_date from public.payrolls
      where id = p_payroll_id and company_id = v_cid for update;
    if v_old_date is null then raise exception 'الراتب غير موجود.'; end if;
    if not exists (
      select 1 from public.financial_years
      where company_id = v_cid and status = 'open' and date_from <= v_old_date and date_to >= v_old_date
    ) then
      raise exception 'لا يمكن تعديل حركة بتاريخ قديم خارج السنة المالية المفتوحة.';
    end if;
    if not exists (
      select 1 from public.financial_years
      where company_id = v_cid and status = 'open' and date_from <= p_date and date_to >= p_date
    ) then
      raise exception 'لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.';
    end if;
    update public.payrolls
    set date = p_date, employee_id = p_employee_id, period_year = p_period_year, period_month = p_period_month,
        account_kind = p_account_kind, account_id = p_account_id, base_salary = p_base_salary,
        additions = p_additions, additions_note = p_additions_note, advance_deduction = p_advance_deduction,
        other_deductions = p_other_deductions, net_salary = v_net, notes = p_notes
    where id = v_payroll_id;
    delete from public.advance_settlements where payroll_id = v_payroll_id;
  end if;

  -- التسويات: منع تجاوز المتبقي من كل سلفة (قفل الشركة يمنع السباق)
  for v_pair in select * from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb)) loop
    v_vid := (v_pair->>0)::bigint;
    v_amt := coalesce((v_pair->>1)::double precision, 0);
    if v_amt <= 0 then continue; end if;
    if not exists (
      select 1 from public.payment_vouchers
      where id = v_vid and voucher_type = 'advance' and employee_id = p_employee_id and company_id = v_cid
    ) then
      raise exception 'سلفة غير موجودة أو لا تخص هذا الموظف.';
    end if;
    select amount into v_adv_amount from public.payment_vouchers where id = v_vid;
    select coalesce(sum(amount), 0) into v_settled from public.advance_settlements where payment_voucher_id = v_vid;
    if v_amt > (v_adv_amount - v_settled) + 0.001 then
      raise exception 'قيمة الخصم من إحدى السلف أكبر من المتبقي منها.';
    end if;
    insert into public.advance_settlements (company_id, payment_voucher_id, payroll_id, amount)
    values (v_cid, v_vid, v_payroll_id, v_amt);
  end loop;

  perform public.log_activity('payroll.save', 'payroll', v_payroll_id::text, '');
  return v_payroll_id;
end $$;

-- 4) أقل امتياز للدوال الجديدة
revoke execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text) from public, anon;
revoke execute on function public.save_payroll(bigint, date, bigint, int, int, text, bigint, double precision, double precision, text, double precision, double precision, text, jsonb) from public, anon;
grant execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text) to authenticated, service_role;
grant execute on function public.save_payroll(bigint, date, bigint, int, int, text, bigint, double precision, double precision, text, double precision, double precision, text, jsonb) to authenticated, service_role;
