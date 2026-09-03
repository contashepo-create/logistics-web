-- ============================================================================
-- v22 — إصلاح شامل: overloads + is_admin() مع service_role + فحص محدّث
--
-- المشاكل المُصلحة:
--   1) admin_database_health_v18 تستخدم to_regproc الذي يفشل مع overloads
--      (ظهور ✕ save_invoice() رغم وجود الدالة)
--   2) is_admin() لا تعيد true مع service_role، مما يمنع استخدام serviceClient
--      في مسارات الخادم (features/companies routes) ويسبب أخطاء 500
--   3) وجود overloads لـ save_invoice يربك PostgREST عند استدعاء RPC
--   4) نسخة v22 السابقة قارنت أسماء المعاملات بأنواعها فحذفت save_invoice
--      الصحيحة؛ هذه النسخة تقارن التوقيع الفعلي وتعيد إنشاء الدالة عند غيابها.
--
-- آمن لإعادة التشغيل بالكامل.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) إصلاح is_admin(): قبول service_role + فحص email للمصادقين
--     هذا يسمح للـ API routes باستخدام serviceClient (أكثر موثوقية من JWT)
--     مع الحفاظ على الأمان (service_role متاح فقط من الخادم).
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select (current_user in ('service_role', 'postgres'))
      or coalesce((auth.jwt() ->> 'email'), '') = 'conta.moha@gmail.com';
$$;

-- ---------------------------------------------------------------------------
-- (2) حذف overloads save_invoice القديمة (إن وُجدت)
--     نُبقي التوقيع الحالي (8 معاملات) ونحذف أي توقيع آخر.
-- ---------------------------------------------------------------------------
do $drop_overloads$
declare
  r record;
  v_current_args text := 'bigint, date, bigint, double precision, text, jsonb, jsonb, text';
begin
  for r in
    select p.oid::regprocedure as sig,
           -- pg_get_function_arguments يعيد أسماء المعاملات أيضاً، لذلك لا
           -- يصلح للمقارنة مع قائمة الأنواع وقد يحذف النسخة الصحيحة نفسها.
           pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'save_invoice'
  loop
    if r.identity_args is distinct from v_current_args then
      execute format('drop function if exists %s', r.sig);
      raise notice 'حُذفت نسخة قديمة من save_invoice: %', r.sig;
    end if;
  end loop;
end $drop_overloads$;



-- ---------------------------------------------------------------------------
-- (2.5) استعادة التوقيع canonical عند غيابه
--     قد تكون v22 القديمة قد حذفت الدالة الصحيحة بسبب مقارنة أسماء
--     المعاملات بدلاً من أنواعها. إعادة تعريفها هنا تجعل تشغيل هذا الإصلاح
--     يصلح قاعدة البيانات حتى لو لم تعد النسخة الصحيحة موجودة.
--     المنطق مطابق للنسخة النهائية في migration_trip_container_numbers_v17.sql.
-- ---------------------------------------------------------------------------
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

revoke execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (3) إصلاح admin_database_health_v18: pg_proc بدلاً من to_regproc
--     + إضافة admin_get_company_extras_v18 للقائمة
-- ---------------------------------------------------------------------------
create or replace function public.admin_database_health_v18()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_expected_tables text[] := array[
    'companies','profiles','feature_catalog','company_features','activity_logs',
    'financial_years','customers','employees','vehicles','cashboxes','banks',
    'invoices','invoice_trips','trip_expenses','receipt_vouchers','payment_vouchers',
    'credit_debit_notes','credit_note_trips','payrolls','advance_settlements','deduction_settlements','employee_deductions','year_snapshots',
    'activation_requests','suppliers','purchase_invoices','purchase_items','year_opening_balances',
    'support_messages','complaints','complaint_messages','app_settings','site_visitors'
  ];
  v_expected_functions text[] := array[
    'auth_company_id','is_company_active','register_company_with_year','save_invoice',
    'save_payroll','admin_set_company_feature','admin_get_company_extras_v18',
    'admin_reset_company_data_v18','admin_platform_stats_v18','record_site_visit_v18'
  ];
  v_tables jsonb; v_functions jsonb; v_healthy boolean;
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'name', expected.name,
      'exists', c.oid is not null,
      'rls_enabled', coalesce(c.relrowsecurity, false),
      'policy_count', (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = expected.name)
    ) order by expected.name), '[]'::jsonb),
    coalesce(bool_and(c.oid is not null and c.relrowsecurity), false)
    into v_tables, v_healthy
    from unnest(v_expected_tables) expected(name)
    left join pg_namespace n on n.nspname = 'public'
    left join pg_class c on c.relnamespace = n.oid and c.relname = expected.name and c.relkind = 'r';

  -- لا تستخدم to_regproc(name) هنا: يفشل عندما توجد أكثر من نسخة للدالة.
  -- save_invoice يحتاج توقيعه الذي تستعمله الواجهة تحديداً، أما بقية الدوال
  -- فيكفي التحقق من وجود الاسم في pg_proc.
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', expected.name,
      'exists', case
        when expected.name = 'save_invoice' then
          to_regprocedure('public.save_invoice(bigint,date,bigint,double precision,text,jsonb,jsonb,text)') is not null
        else exists(
          select 1 from pg_proc p
          join pg_namespace ns on ns.oid = p.pronamespace
          where ns.nspname = 'public' and p.proname = expected.name
        )
      end
    ) order by expected.name), '[]'::jsonb)
    into v_functions
    from unnest(v_expected_functions) expected(name);

  if exists(
    select 1 from unnest(v_expected_functions) f(name)
     where case
       when f.name = 'save_invoice' then
         to_regprocedure('public.save_invoice(bigint,date,bigint,double precision,text,jsonb,jsonb,text)') is null
       else not exists(
         select 1 from pg_proc p
         join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = f.name
       )
     end
  ) then v_healthy := false; end if;

  return jsonb_build_object(
    'healthy', v_healthy,
    'checked_at', now(),
    'database_time', clock_timestamp(),
    'postgres_version', current_setting('server_version'),
    'tables', v_tables,
    'functions', v_functions
  );
end $$;

revoke all on function public.admin_database_health_v18() from public, anon;
grant execute on function public.admin_database_health_v18() to authenticated, service_role;

-- ضمان ملكية الدوال المعدّلة لـ postgres
do $owner$
declare r record;
  fns text[] := array['is_admin', 'admin_database_health_v18'];
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    for r in
      select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.proname = any(fns)
    loop
      begin execute format('alter function %s owner to postgres', r.sig);
      exception when others then null; end;
    end loop;
  end if;
end $owner$;

-- ============================================================================
-- تحقّق بعد التنفيذ:
--
-- 1) is_admin() مع service_role:
--    set local role service_role;
--    select public.is_admin();  -- يجب أن تعيد true
--    set local role postgres;
--
-- 2) save_invoice overloads:
--    select p.proname, pg_get_function_identity_arguments(p.oid) as args
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'save_invoice';
--    -- يجب أن يعيد صفاً واحداً بالتوقيع canonical
--
-- 3) الفحص من لوحة المطوّر: يجب أن تظهر ✓ save_invoice()
-- ============================================================================
