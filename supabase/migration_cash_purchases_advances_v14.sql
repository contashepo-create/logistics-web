-- ============================================================================
-- v14 — مشتريات نقدية بلا مورّد + توجيه P&L/سيارة + دفع ذري من خزينة/بنك
-- شغّل بعد migration_registration_validation_v13.sql.
-- ============================================================================

alter table public.purchase_invoices alter column supplier_id drop not null;
alter table public.purchase_invoices add column if not exists purchase_type text not null default 'credit';
alter table public.purchase_invoices add column if not exists expense_category text not null default 'other';
alter table public.purchase_invoices add column if not exists vehicle_id bigint references public.vehicles(id) on delete set null;
alter table public.purchase_invoices add column if not exists account_kind text;
alter table public.purchase_invoices add column if not exists account_id bigint;

alter table public.purchase_invoices drop constraint if exists purchase_invoices_purchase_type_check;
alter table public.purchase_invoices add constraint purchase_invoices_purchase_type_check
  check (purchase_type in ('credit', 'cash')) not valid;
alter table public.purchase_invoices drop constraint if exists purchase_invoices_expense_category_check;
alter table public.purchase_invoices add constraint purchase_invoices_expense_category_check
  check (expense_category in (
    'fuel','maintenance','spare_parts','tires','rent','utilities','communications',
    'insurance','government_fees','office','hospitality','professional_fees','other'
  )) not valid;
alter table public.purchase_invoices drop constraint if exists purchase_invoices_payment_route_check;
alter table public.purchase_invoices add constraint purchase_invoices_payment_route_check check (
  (purchase_type = 'credit' and supplier_id is not null and account_kind is null and account_id is null)
  or
  (purchase_type = 'cash' and supplier_id is null and account_kind in ('cashbox','bank') and account_id is not null)
) not valid;
create index if not exists idx_pinv_vehicle_date on public.purchase_invoices(vehicle_id, date) where vehicle_id is not null;
create index if not exists idx_pinv_expense_category_date on public.purchase_invoices(expense_category, date);
do $$ begin
  if not exists(select 1 from public.purchase_invoices group by company_id, number having count(*) > 1) then
    create unique index if not exists uq_purchase_invoices_company_number on public.purchase_invoices(company_id, number);
  end if;
end $$;

-- السند الناتج عن الفاتورة النقدية حركة خزينة فقط؛ المصروف نفسه يُحتسب من
-- فاتورة المشتريات حتى لا يتكرر في الأرباح والخسائر.
alter table public.payment_vouchers drop constraint if exists payment_vouchers_voucher_type_check;
alter table public.payment_vouchers add constraint payment_vouchers_voucher_type_check
  check (voucher_type in ('trip','advance','vehicle','general','supplier','owner','purchase'));
create unique index if not exists uq_payment_one_cash_purchase
  on public.payment_vouchers(purchase_invoice_id)
  where voucher_type = 'purchase' and purchase_invoice_id is not null;

create or replace function public.guard_purchase_invoice_route()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.purchase_type = 'credit' then
    if new.supplier_id is null then raise exception 'المورّد مطلوب للفاتورة الآجلة.'; end if;
    if not exists(select 1 from public.suppliers s where s.id = new.supplier_id and s.company_id = new.company_id) then raise exception 'المورّد غير موجود أو لا يخص الشركة.'; end if;
    new.account_kind := null;
    new.account_id := null;
  elsif new.purchase_type = 'cash' then
    if new.supplier_id is not null then raise exception 'الفاتورة النقدية المباشرة لا تُسجّل على مورّد.'; end if;
    if new.account_kind not in ('cashbox','bank') or new.account_id is null then raise exception 'اختر الخزينة أو البنك للفاتورة النقدية.'; end if;
    if new.account_kind = 'cashbox' and not exists(select 1 from public.cashboxes a where a.id = new.account_id and a.company_id = new.company_id) then raise exception 'الخزينة غير موجودة أو لا تخص الشركة.'; end if;
    if new.account_kind = 'bank' and not exists(select 1 from public.banks a where a.id = new.account_id and a.company_id = new.company_id) then raise exception 'البنك غير موجود أو لا يخص الشركة.'; end if;
  else
    raise exception 'نوع فاتورة المشتريات غير صالح.';
  end if;
  if new.expense_category not in (
    'fuel','maintenance','spare_parts','tires','rent','utilities','communications',
    'insurance','government_fees','office','hospitality','professional_fees','other'
  ) then raise exception 'بند الأرباح والخسائر غير صالح.'; end if;
  if new.vehicle_id is not null and not exists(select 1 from public.vehicles v where v.id = new.vehicle_id and v.company_id = new.company_id) then
    raise exception 'السيارة غير موجودة أو لا تخص الشركة.';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_purchase_invoice_route on public.purchase_invoices;
create trigger trg_guard_purchase_invoice_route before insert or update of purchase_type, supplier_id, expense_category, vehicle_id, account_kind, account_id, company_id
on public.purchase_invoices for each row execute function public.guard_purchase_invoice_route();

-- لا يجوز إنشاء/تعديل/حذف سند الفاتورة النقدية منفرداً؛ حياته مرتبطة بالفاتورة.
create or replace function public.guard_auto_purchase_payment()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (case when tg_op = 'INSERT' then new.voucher_type else old.voucher_type end) = 'purchase'
     and coalesce(current_setting('app.purchase_write', true), '') <> 'on' then
    raise exception 'سند الفاتورة النقدية يُدار من فاتورة المشتريات ولا يُعدّل منفرداً.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_guard_auto_purchase_payment on public.payment_vouchers;
create trigger trg_guard_auto_purchase_payment before insert or update or delete on public.payment_vouchers
for each row execute function public.guard_auto_purchase_payment();

create or replace function public.save_purchase_invoice_v14(
  p_invoice_id bigint,
  p_date date,
  p_purchase_type text,
  p_supplier_id bigint,
  p_supplier_ref text,
  p_expense_category text,
  p_vehicle_id bigint,
  p_account_kind text,
  p_account_id bigint,
  p_vat_rate double precision,
  p_vat_included boolean,
  p_notes text,
  p_items jsonb
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cid uuid := public.auth_company_id();
  v_id bigint := p_invoice_id;
  v_num integer;
  v_payment_id bigint;
  v_payment_num integer;
  v_total numeric := 0;
  v_gross numeric;
  v_rate numeric;
  v_qty numeric;
  v_price numeric;
  v_available numeric := 0;
  v_opening numeric := 0;
  v_in numeric := 0;
  v_out numeric := 0;
  v_payroll numeric := 0;
  it jsonb;
begin
  if v_cid is null then raise exception 'جلسة غير صالحة.'; end if;
  if p_date is null or not exists(select 1 from public.financial_years y where y.company_id = v_cid and y.status = 'open' and p_date between y.date_from and y.date_to) then
    raise exception 'تاريخ الفاتورة خارج سنة مالية مفتوحة.';
  end if;
  if p_purchase_type not in ('credit','cash') then raise exception 'نوع فاتورة المشتريات غير صالح.'; end if;
  if p_expense_category not in (
    'fuel','maintenance','spare_parts','tires','rent','utilities','communications',
    'insurance','government_fees','office','hospitality','professional_fees','other'
  ) then raise exception 'اختر بنداً صحيحاً من الأرباح والخسائر.'; end if;
  if p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then raise exception 'نسبة الضريبة غير صالحة.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 1000 then
    raise exception 'أضف من بند واحد إلى 1000 بند للفاتورة.';
  end if;
  if p_vehicle_id is not null and not exists(select 1 from public.vehicles v where v.id = p_vehicle_id and v.company_id = v_cid) then raise exception 'السيارة غير موجودة.'; end if;

  if p_purchase_type = 'credit' then
    if p_supplier_id is null or not exists(select 1 from public.suppliers s where s.id = p_supplier_id and s.company_id = v_cid) then raise exception 'اختر مورّداً صحيحاً للفاتورة الآجلة.'; end if;
  else
    if p_supplier_id is not null then raise exception 'الفاتورة النقدية المباشرة لا تحتاج مورّداً.'; end if;
    if p_account_kind not in ('cashbox','bank') or p_account_id is null then raise exception 'اختر الخزينة أو البنك للدفع المباشر.'; end if;
    if p_account_kind = 'cashbox' and not exists(select 1 from public.cashboxes a where a.id = p_account_id and a.company_id = v_cid) then raise exception 'الخزينة غير موجودة.'; end if;
    if p_account_kind = 'bank' and not exists(select 1 from public.banks a where a.id = p_account_id and a.company_id = v_cid) then raise exception 'البنك غير موجود.'; end if;
  end if;

  for it in select value from jsonb_array_elements(p_items) loop
    begin
      if jsonb_typeof(it) <> 'object' or length(btrim(coalesce(it ->> 'item_name',''))) < 1 or length(it ->> 'item_name') > 160 then raise exception 'x'; end if;
      v_qty := (it ->> 'qty')::numeric;
      v_price := (it ->> 'unit_price')::numeric;
      v_rate := coalesce((it ->> 'vat_rate')::numeric, p_vat_rate::numeric);
      if v_qty <= 0 or v_qty > 1000000 or v_price < 0 or v_price > 999999999999 or v_rate < 0 or v_rate > 100 then raise exception 'x'; end if;
    exception when others then
      raise exception 'أحد بنود فاتورة المشتريات يحتوي على اسم أو كمية أو سعر أو ضريبة غير صالحة.';
    end;
    v_gross := round(v_qty * v_price, 2);
    if p_vat_included then v_total := v_total + v_gross;
    else v_total := v_total + round(v_gross * (1 + v_rate / 100), 2);
    end if;
  end loop;
  v_total := round(v_total, 2);
  if v_total <= 0 or v_total > 999999999999 then raise exception 'إجمالي فاتورة المشتريات يجب أن يكون أكبر من صفر وداخل الحد المسموح.'; end if;

  if v_id is not null then
    if not exists(select 1 from public.purchase_invoices p where p.id = v_id and p.company_id = v_cid) then raise exception 'فاتورة المشتريات غير موجودة.'; end if;
    if exists(select 1 from public.payment_vouchers p where p.purchase_invoice_id = v_id and p.company_id = v_cid and p.voucher_type <> 'purchase') then
      raise exception 'لا يمكن تعديل فاتورة مشتريات مرتبطة بسداد مورّد؛ احذف سند السداد أولاً.';
    end if;
    update public.purchase_invoices set
      date = p_date, purchase_type = p_purchase_type, supplier_id = case when p_purchase_type = 'credit' then p_supplier_id else null end,
      supplier_ref = public.safe_text(p_supplier_ref, 80), expense_category = p_expense_category, vehicle_id = p_vehicle_id,
      account_kind = case when p_purchase_type = 'cash' then p_account_kind else null end,
      account_id = case when p_purchase_type = 'cash' then p_account_id else null end,
      vat_rate = p_vat_rate, vat_included = coalesce(p_vat_included, false), notes = public.safe_text(p_notes, 1000)
    where id = v_id and company_id = v_cid;
    delete from public.purchase_items where invoice_id = v_id and company_id = v_cid;
  else
    perform pg_advisory_xact_lock(hashtextextended('purchase-number:' || v_cid::text, 0));
    select coalesce(max(number), 0) + 1 into v_num from public.purchase_invoices where company_id = v_cid;
    insert into public.purchase_invoices(
      company_id, number, date, purchase_type, supplier_id, supplier_ref, expense_category, vehicle_id,
      account_kind, account_id, vat_rate, vat_included, notes
    ) values (
      v_cid, v_num, p_date, p_purchase_type, case when p_purchase_type = 'credit' then p_supplier_id else null end,
      public.safe_text(p_supplier_ref, 80), p_expense_category, p_vehicle_id,
      case when p_purchase_type = 'cash' then p_account_kind else null end,
      case when p_purchase_type = 'cash' then p_account_id else null end,
      p_vat_rate, coalesce(p_vat_included, false), public.safe_text(p_notes, 1000)
    ) returning id into v_id;
  end if;

  for it in select value from jsonb_array_elements(p_items) loop
    insert into public.purchase_items(company_id, invoice_id, item_name, unit, qty, unit_price, vat_rate, notes)
    values(
      v_cid, v_id, public.safe_text(it ->> 'item_name', 160), public.safe_text(it ->> 'unit', 30),
      (it ->> 'qty')::double precision, (it ->> 'unit_price')::double precision,
      coalesce((it ->> 'vat_rate')::double precision, p_vat_rate), public.safe_text(it ->> 'notes', 500)
    );
  end loop;

  perform set_config('app.purchase_write', 'on', true);
  select p.id into v_payment_id from public.payment_vouchers p
   where p.company_id = v_cid and p.purchase_invoice_id = v_id and p.voucher_type = 'purchase';

  if p_purchase_type = 'cash' then
    perform pg_advisory_xact_lock(hashtextextended('cash-balance:' || p_account_kind || ':' || p_account_id::text, 0));
    if p_account_kind = 'cashbox' then select opening_balance into v_opening from public.cashboxes where id = p_account_id and company_id = v_cid;
    else select opening_balance into v_opening from public.banks where id = p_account_id and company_id = v_cid;
    end if;
    select coalesce(sum(amount),0) into v_in from public.receipt_vouchers where company_id = v_cid and account_kind = p_account_kind and account_id = p_account_id;
    select coalesce(sum(amount),0) into v_out from public.payment_vouchers where company_id = v_cid and account_kind = p_account_kind and account_id = p_account_id and id is distinct from v_payment_id;
    select coalesce(sum(net_salary),0) into v_payroll from public.payrolls where company_id = v_cid and account_kind = p_account_kind and account_id = p_account_id;
    v_available := coalesce(v_opening,0) + v_in - v_out - v_payroll;
    if v_total > v_available + 0.0001 then raise exception 'رصيد الخزينة/البنك لا يكفي لدفع الفاتورة النقدية. المتاح: %، المطلوب: %', round(v_available,2), v_total; end if;

    if v_payment_id is null then
      perform pg_advisory_xact_lock(hashtextextended('payment_vouchers:' || v_cid::text, 0));
      select coalesce(max(number),0)+1 into v_payment_num from public.payment_vouchers where company_id = v_cid;
      insert into public.payment_vouchers(
        company_id, number, date, account_kind, account_id, voucher_type, purchase_invoice_id, vehicle_id,
        quantity, unit_amount, amount, description
      ) values (
        v_cid, v_payment_num, p_date, p_account_kind, p_account_id, 'purchase', v_id, p_vehicle_id,
        1, v_total::double precision, v_total::double precision, 'دفع مباشر لفاتورة مشتريات نقدية'
      );
    else
      update public.payment_vouchers set
        date = p_date, account_kind = p_account_kind, account_id = p_account_id, vehicle_id = p_vehicle_id,
        supplier_id = null, trip_id = null, employee_id = null, quantity = 1,
        unit_amount = v_total::double precision, amount = v_total::double precision,
        description = 'دفع مباشر لفاتورة مشتريات نقدية'
      where id = v_payment_id and company_id = v_cid;
    end if;
  elsif v_payment_id is not null then
    delete from public.payment_vouchers where id = v_payment_id and company_id = v_cid;
  end if;

  perform public.log_activity('purchase.save', 'purchase_invoice', v_id::text, p_purchase_type || ':' || p_expense_category);
  return v_id;
end $$;

create or replace function public.delete_purchase_invoice_v14(p_invoice_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cid uuid := public.auth_company_id();
  v_date date;
begin
  select p.date into v_date from public.purchase_invoices p where p.id = p_invoice_id and p.company_id = v_cid;
  if v_date is null then raise exception 'فاتورة المشتريات غير موجودة.'; end if;
  if not exists(select 1 from public.financial_years y where y.company_id = v_cid and y.status = 'open' and v_date between y.date_from and y.date_to) then
    raise exception 'لا يمكن حذف فاتورة من سنة مالية مغلقة.';
  end if;
  if exists(select 1 from public.payment_vouchers p where p.purchase_invoice_id = p_invoice_id and p.company_id = v_cid and p.voucher_type <> 'purchase') then
    raise exception 'لا يمكن حذف الفاتورة لوجود سندات سداد مورّد مرتبطة بها.';
  end if;
  perform set_config('app.purchase_write', 'on', true);
  delete from public.payment_vouchers where purchase_invoice_id = p_invoice_id and company_id = v_cid and voucher_type = 'purchase';
  delete from public.purchase_invoices where id = p_invoice_id and company_id = v_cid;
  perform public.log_activity('purchase.delete', 'purchase_invoice', p_invoice_id::text, '');
end $$;

-- كل الكتابات تمر بالدالتين الذريتين؛ القراءة تبقى خاضعة لعزل الشركة.
revoke insert, update, delete on public.purchase_invoices from authenticated;
revoke insert, update, delete on public.purchase_items from authenticated;
-- إيقاف RPC القديم حتى لا يتجاوز اختيار بند P&L ومسار الدفع الجديد.
revoke all on function public.save_purchase_invoice(bigint,date,bigint,text,double precision,boolean,text,jsonb) from public, anon, authenticated;
revoke all on function public.save_purchase_invoice_v14(bigint,date,text,bigint,text,text,bigint,text,bigint,double precision,boolean,text,jsonb) from public, anon;
grant execute on function public.save_purchase_invoice_v14(bigint,date,text,bigint,text,text,bigint,text,bigint,double precision,boolean,text,jsonb) to authenticated;
revoke all on function public.delete_purchase_invoice_v14(bigint) from public, anon;
grant execute on function public.delete_purchase_invoice_v14(bigint) to authenticated;
revoke execute on function public.guard_purchase_invoice_route() from public, anon, authenticated;
revoke execute on function public.guard_auto_purchase_payment() from public, anon, authenticated;
