-- ============================================================================
-- v17: أرقام حاويات متعددة مرتبطة بكل نقلة
-- - كل نقلة تحمل مصفوفة container_numbers مستقلة.
-- - الحد الأقصى لعدد الأرقام يساوي qty الخاصة بالنقلة.
-- - يمنع القيم الفارغة والمكررة (دون حساسية لحالة الأحرف).
-- - save_invoice يعيد التحقق ويحفظ الرأس والنقلات والأرقام في معاملة واحدة.
-- آمن لإعادة التشغيل.
-- ============================================================================

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

alter table public.invoice_trips
  add column if not exists container_numbers jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoice_trips'::regclass
      and conname = 'invoice_trips_container_numbers_valid'
  ) then
    alter table public.invoice_trips
      add constraint invoice_trips_container_numbers_valid
      check (public.valid_trip_container_numbers(container_numbers, qty));
  end if;
end $$;

comment on column public.invoice_trips.container_numbers is
  'أرقام الحاويات المرتبطة بالنقلة؛ مصفوفة نصية لا يتجاوز عدد عناصرها qty';

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

revoke execute on function public.valid_trip_container_numbers(jsonb, integer) from public, anon;
grant execute on function public.valid_trip_container_numbers(jsonb, integer) to authenticated, service_role;
revoke execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text) to authenticated, service_role;
