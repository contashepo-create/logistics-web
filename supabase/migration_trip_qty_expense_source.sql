-- ============================================================================
-- تطوير نموذج فاتورة النقل:
--   1) كمية للنقلة (عدد النقلات × سعر الوحدة)
--   2) كمية للمصروف (عدد × قيمة الوحدة)
--   3) مصدر تمويل إلزامي لكل مصروف: نقدي / عهدة سائق / آجل على مورد / يتحمّله العميل
--   4) توليد سند دفع تلقائي للمصروف النقدي (يخصم من الخزينة/البنك) بلا ازدواج
-- الصق هذا الملف كاملاً في Supabase Dashboard > SQL Editor > Run (آمن التكرار)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) أعمدة الكمية في النقلة (price يبقى إجمالي السطر = qty × unit_price)
-- ---------------------------------------------------------------------------
alter table public.invoice_trips
  add column if not exists qty        integer          not null default 1,
  add column if not exists unit_price double precision not null default 0;

update public.invoice_trips set unit_price = price, qty = 1
 where unit_price = 0 and price > 0;

alter table public.invoice_trips
  add constraint invoice_trips_qty_positive check (qty >= 1) not valid;

-- ---------------------------------------------------------------------------
-- 2) أعمدة الكمية ومصدر التمويل في مصروف النقلة (amount = qty × unit_amount)
-- ---------------------------------------------------------------------------
alter table public.trip_expenses
  add column if not exists qty           double precision not null default 1,
  add column if not exists unit_amount   double precision not null default 0,
  add column if not exists source        text not null default 'cash',
  add column if not exists account_kind  text,
  add column if not exists account_id    bigint,
  add column if not exists supplier_name text default '';

update public.trip_expenses set unit_amount = amount, qty = 1
 where unit_amount = 0 and amount > 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_expenses_source_chk') then
    alter table public.trip_expenses
      add constraint trip_expenses_source_chk
      check (source in ('cash', 'driver', 'supplier', 'customer'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) ربط سند الدفع المتولّد تلقائياً بمصروف النقلة (لمنع الاحتساب مرتين)
-- ---------------------------------------------------------------------------
alter table public.payment_vouchers
  add column if not exists source_expense_id bigint
    references public.trip_expenses(id) on delete cascade;

create index if not exists idx_payments_source_expense
  on public.payment_vouchers(source_expense_id);

-- ---------------------------------------------------------------------------
-- 4) الحفظ الذرّي للفاتورة: كميات + مصادر تمويل + سندات تلقائية
-- ---------------------------------------------------------------------------
create or replace function public.save_invoice(
  p_invoice_id  bigint, p_date date, p_customer_id bigint, p_vat_rate double precision,
  p_notes text default '', p_attachments jsonb default '[]'::jsonb, p_trips jsonb default '[]'::jsonb
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
    insert into public.invoices (company_id, number, date, customer_id, vat_rate, notes, attachments)
    values (v_cid, v_number, p_date, p_customer_id, p_vat_rate, p_notes, p_attachments)
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
    update public.invoices set date = p_date, customer_id = p_customer_id, vat_rate = p_vat_rate, notes = p_notes, attachments = p_attachments
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
      -- حذف المصروفات القديمة؛ سنداتها التلقائية تُحذف تتابعياً (on delete cascade)
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

      -- المصروف النقدي يخرج فعلياً من الخزينة عبر سند دفع متولّد ومرتبط
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

-- حذف الفاتورة: تنظيف السندات التلقائية أولاً (إن وُجدت دالة حذف مخصّصة فهي تعتمد الحذف التتابعي)
comment on column public.payment_vouchers.source_expense_id is
  'إن كان غير فارغ فالسند متولّد تلقائياً من مصروف نقلة نقدي — لا يُحتسب مرتين في التقارير';
