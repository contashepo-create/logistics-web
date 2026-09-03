-- ============================================================================
-- v20 — تحصين صلاحيات لوحة المطوّر وإصلاح «permission denied for table companies»
--
-- السبب الجذري المحتمل للرسالة:
--   دوال المطوّر SECURITY DEFINER تعمل بصلاحية مُنشئها (owner). في بعض قواعد
--   البيانات أُنشئت الدوال عبر دور محدود (أو بعد إصلاحات الأمان) فلم يكن
--   مالكها يملك صلاحيات على جدول companies، فكان أي إجراء (تفعيل ميزة أو
--   تصفير شركة) يفشل بـ «permission denied for table companies».
--
-- الحل (آمن لإعادة التشغيل بالكامل):
--   1) منح صريح وكامل للأدوار على كل الجداول والمتسلسلات (يشمل الجداول
--      الجديدة في v19: employee_deductions / deduction_settlements).
--   2) إعادة إنشاء دوال المطوّر مع ضبط مالكها وصلاحيات تنفيذها صراحةً.
--   3) ضمّ جداول v19 إلى دالة تصفير بيانات الشركة.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) منح صريح شامل — يجبر أي منح ناقص/ساقط في قواعد قديمة
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant usage, select on all sequences in schema public
  to authenticated, service_role;

-- الجداول الاختيارية من ميزات لاحقة (to_regclass تحمي من غيابها)
do $$
declare t text;
begin
  foreach t in array array[
    'company_features','feature_catalog','activity_logs','profiles','companies',
    'suppliers','purchase_invoices','purchase_items','year_opening_balances',
    'support_messages','complaints','complaint_messages','app_settings','site_visitors',
    'employee_deductions','deduction_settlements'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    end if;
  end loop;
end $$;

-- ضمان ملكية الدوال الخادمية لدور قاعدة البيانات صاحب الجداول (postgres عادةً).
-- لا يُستخدم مباشرةً كدور اتصال؛ الهدف فقط ضمان امتلاك SECURITY DEFINER
-- لصلاحيات كاملة على الجداول. يُتجاوز القسم بأمان إن لم يوجد الدور.
do $$
declare f text;
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    foreach f in array array[
      'admin_set_company_feature(uuid,text,boolean)',
      'admin_set_company_status(uuid,boolean)',
      'admin_set_subscription(uuid,text,date)',
      'admin_delete_company(uuid)',
      'admin_review_activation_request(uuid,boolean,text)',
      'admin_get_company_extras_v18(uuid)',
      'admin_reset_company_data_v18(uuid)',
      'admin_platform_stats_v18()',
      'admin_recent_visitors_v18(integer)',
      'admin_database_health_v18()',
      'has_company_feature(text)',
      'save_payroll(bigint,date,bigint,int,int,text,bigint,double precision,double precision,text,double precision,double precision,text,jsonb,jsonb,double precision)',
      'save_invoice(bigint,date,bigint,double precision,text,jsonb,jsonb,text)',
      'register_company_with_year(text,text,text,text,date,date)',
      'export_company_data()'
    ]
    loop
      begin
        execute format('alter function public.%s owner to postgres', f);
      exception when others then null; end;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- (2) إعادة إنشاء دوال المطوّر الأساسية (نفس منطقها مع ضمان البحث والصلاحيات)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_company_feature(
  p_company_id uuid, p_feature_key text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'الشركة غير موجودة.';
  end if;
  if not exists (select 1 from public.feature_catalog where feature_key = p_feature_key) then
    raise exception 'الميزة غير معروفة.';
  end if;
  insert into public.company_features (company_id, feature_key, enabled, updated_by, updated_at)
  values (p_company_id, p_feature_key, coalesce(p_enabled, false), auth.uid(), now())
  on conflict (company_id, feature_key) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  perform public.log_activity(
    case when p_enabled then 'admin.enable_feature' else 'admin.disable_feature' end,
    'company_feature', p_company_id::text, p_feature_key);
end $$;

create or replace function public.admin_set_company_status(p_company_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  update public.companies set is_active = p_active where id = p_company_id;
  perform public.log_activity(
    case when p_active then 'admin.activate_company' else 'admin.deactivate_company' end,
    'company', p_company_id::text, '');
end $$;

revoke all on function public.admin_set_company_feature(uuid,text,boolean) from public, anon;
revoke all on function public.admin_set_company_status(uuid,boolean) from public, anon;
grant execute on function public.admin_set_company_feature(uuid,text,boolean) to authenticated, service_role;
grant execute on function public.admin_set_company_status(uuid,boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (3) تصفير بيانات الشركة: يشمل جداول v19 (الخصومات وتسوياتها)
-- ---------------------------------------------------------------------------
create or replace function public.admin_reset_company_data_v18(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_table text; v_count bigint; v_total bigint := 0;
  v_counts jsonb := '{}'::jsonb; v_year_id bigint; v_year int;
  v_tables text[] := array[
    'credit_note_trips', 'credit_debit_notes', 'advance_settlements', 'deduction_settlements',
    'employee_deductions',
    'purchase_items', 'payment_vouchers', 'receipt_vouchers', 'payrolls',
    'trip_expenses', 'invoice_trips', 'invoices',
    'purchase_invoices', 'suppliers',
    'year_opening_balances', 'year_snapshots', 'financial_years',
    'vehicles', 'employees', 'cashboxes', 'banks', 'customers'
  ];
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if p_company_id is null or not exists(select 1 from public.companies where id = p_company_id) then
    raise exception 'الشركة غير موجودة.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reset-company:' || p_company_id::text, 0));

  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      execute format('delete from public.%I where company_id = $1', v_table) using p_company_id;
      get diagnostics v_count = row_count;
      v_total := v_total + v_count;
      v_counts := v_counts || jsonb_build_object(v_table, v_count);
    end if;
  end loop;

  v_year := extract(year from current_date)::int;
  insert into public.financial_years(company_id, year, date_from, date_to, status, notes)
  values(
    p_company_id, v_year, make_date(v_year, 1, 1), make_date(v_year, 12, 31),
    'open', 'سنة جديدة أُنشئت تلقائياً بعد إعادة ضبط بيانات الشركة'
  ) returning id into v_year_id;

  perform public.log_activity(
    'admin.reset_company_data', 'company', p_company_id::text,
    'deleted_rows=' || v_total::text || '; new_year=' || v_year::text
  );
  return jsonb_build_object(
    'deleted_rows', v_total,
    'new_financial_year', v_year,
    'new_financial_year_id', v_year_id,
    'tables', v_counts
  );
end $$;

revoke all on function public.admin_reset_company_data_v18(uuid) from public, anon;
grant execute on function public.admin_reset_company_data_v18(uuid) to authenticated, service_role;
