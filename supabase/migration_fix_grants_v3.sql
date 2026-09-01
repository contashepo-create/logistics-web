-- ============================================================================
-- إصلاحات ما بعد v2 (آمن التكرار) — الصق كاملاً في Supabase SQL Editor > Run
--
--  1) إعادة صلاحية القراءة العامة لجدول إعدادات التطبيق (كان يعطي 401 للزوار)
--  2) صلاحيات تنفيذ الدوال العامة الضرورية للتسجيل والدخول
--  3) ضمان أن التسجيل الجديد لا يفشل بسبب حارس البريد أو الفهرس الفريد
-- ============================================================================

-- 1) الزائر (anon) يحتاج قراءة إعدادات التطبيق فقط — لا شيء غير ذلك
grant usage on schema public to anon;
grant select on public.app_settings to anon;

-- سياسة القراءة (تأكيد)
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to anon, authenticated using (true);

-- 2) دوال يحتاجها المستخدم المصادق (وقد أُلغيت صلاحياتها في التشديد)
--    نمنح ديناميكياً حسب الاسم مهما كان توقيع الدالة، ونتجاهل أي دالة غير موجودة
--    (بعض القواعد لم تُنفَّذ عليها كل الترحيلات القديمة).
do $grants$
declare
  r record;
  fn text;
  wanted text[] := array[
    'register_company','is_admin','auth_company_id','is_company_active',
    'is_active_user','export_company_data','safe_text','log_activity',
    'gen_code','admin_update_app_settings','admin_set_company_status',
    'admin_set_subscription','admin_delete_company','admin_review_activation_request',
    'admin_set_profile_status','admin_set_profile_role','save_invoice','save_payroll'
  ];
begin
  foreach fn in array wanted loop
    for r in
      select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('grant execute on function %s to authenticated', r.sig);
    end loop;
  end loop;

  -- is_allowed_email يحتاجها الزائر أيضاً (تحقق البريد قبل التسجيل)
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_allowed_email'
  loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $grants$;

-- 2ب) دالة is_active_user مفقودة في بعض القواعد — ننشئها إن لم تكن موجودة
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.is_active from public.profiles p where p.id = auth.uid()),
    false
  );
$$;
grant execute on function public.is_active_user() to authenticated;

-- 3) حارس الملف الشخصي: لا يمنع إنشاء ملف لمستخدم موجود مسبقاً ببريد مسموح
--    (نتحقق من البريد فقط عند وجوده، ونتجاهل الفراغ القادم من دوال داخلية)
create or replace function public.set_profile_guard() returns trigger
language plpgsql as $$
declare v_email text;
begin
  v_email := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), new.email, ''));
  if v_email <> '' and not public.is_allowed_email(v_email) then
    raise exception 'يُقبل التسجيل ببريد Gmail أو Yahoo أو Hotmail أو Outlook أو iCloud فقط.';
  end if;
  new.email := v_email;
  new.role := case when v_email = 'conta.moha@gmail.com' then 'admin' else 'user' end;
  new.is_active := coalesce(new.is_active, true);
  new.name := public.safe_text(new.name, 120);
  return new;
end $$;

-- 4) تشخيص سريع: هل المستخدم الحالي مطوّر؟ (يُستخدم من الواجهة عند فشل الدخول)
create or replace function public.whoami()
returns table (uid uuid, email text, is_admin boolean, company_id uuid)
language sql stable security definer set search_path = public as $$
  select auth.uid(),
         lower(coalesce(auth.jwt() ->> 'email', '')),
         public.is_admin(),
         (select p.company_id from public.profiles p where p.id = auth.uid());
$$;
revoke execute on function public.whoami() from public, anon;
grant execute on function public.whoami() to authenticated;
