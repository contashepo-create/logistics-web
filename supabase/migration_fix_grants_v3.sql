-- ============================================================================
-- إصلاحات ما بعد v2 — آمن التكرار وآمن التنفيذ على أي قاعدة
-- الصق الملف كاملاً في: Supabase > SQL Editor > New query > Run
--
--  0) حذف النسخ القديمة المتعارضة من الدوال (اختلاف أسماء المعاملات يعطي 42P13)
--  1) إعادة صلاحية القراءة العامة لجدول إعدادات التطبيق (401 للزوار)
--  2) إنشاء الدوال الأساسية إن كانت مفقودة
--  3) منح صلاحيات التنفيذ ديناميكياً (يتجاهل أي دالة غير موجودة)
--  4) حارس الملف الشخصي حتى لا يفشل التسجيل الجديد
--  5) دالة تشخيص whoami()
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) حذف أي نسخة قديمة من whoami فقط (قد يختلف نوع الإرجاع فيفشل REPLACE).
--    باقي الدوال لا تُلمس إن كانت موجودة — تُنشأ فقط عند غيابها (بند 2).
-- ---------------------------------------------------------------------------
do $drops$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'whoami'
  loop
    begin
      execute format('drop function %s', r.sig);
    exception when others then
      raise notice 'تعذّر حذف % (مستخدمة في كائن آخر) — سنُبقي عليها: %', r.sig, sqlerrm;
    end;
  end loop;
end $drops$;

-- ---------------------------------------------------------------------------
-- 1) الزائر (anon) يحتاج قراءة إعدادات التطبيق فقط — لا شيء غير ذلك
-- ---------------------------------------------------------------------------
grant usage on schema public to anon;

do $settings$
begin
  if to_regclass('public.app_settings') is not null then
    execute 'grant select on public.app_settings to anon, authenticated';
    execute 'alter table public.app_settings enable row level security';
    execute 'drop policy if exists app_settings_read on public.app_settings';
    execute 'create policy app_settings_read on public.app_settings
               for select to anon, authenticated using (true)';
  end if;
end $settings$;

-- ---------------------------------------------------------------------------
-- 2) إنشاء الدوال الأساسية إن لم تكن موجودة (بعد محاولة الحذف أعلاه)
-- ---------------------------------------------------------------------------
do $fns$
begin
  -- البريد المسموح به: جيميل / ياهو / هوتميل / أوتلوك / آيكلاود فقط
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_allowed_email'
  ) then
    execute $f1$
      create function public.is_allowed_email(p_email text)
      returns boolean
      language sql immutable as $body$
        select lower(coalesce(p_email, '')) ~
          '^[a-z0-9._%+-]+@(gmail\.com|googlemail\.com|yahoo\.(com|co\.uk)|ymail\.com|hotmail\.(com|co\.uk)|outlook\.com|live\.com|msn\.com|icloud\.com|me\.com|mac\.com)$';
      $body$;
    $f1$;
  end if;

  -- تنظيف نص من الوسوم ومحارف التحكم مع تحديد الطول
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'safe_text'
  ) then
    execute $f2$
      create function public.safe_text(p_in text, p_max int default 2000)
      returns text
      language sql immutable as $body$
        select nullif(
          left(
            btrim(
              regexp_replace(
                regexp_replace(coalesce(p_in, ''), '<[^>]*>', ' ', 'g'),
                '[\x00-\x1F\x7F]', '', 'g'
              )
            ),
            greatest(coalesce(p_max, 2000), 1)
          ),
          ''
        );
      $body$;
    $f2$;
  end if;

  -- هل المستخدم الحالي مفعّل؟
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_active_user'
  ) then
    execute $f3$
      create function public.is_active_user()
      returns boolean
      language sql stable security definer set search_path = public as $body$
        select coalesce(
          (select p.is_active from public.profiles p where p.id = auth.uid()),
          false
        );
      $body$;
    $f3$;
  end if;

  -- تشخيص: من أنا؟
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'whoami'
  ) then
    execute $f4$
      create function public.whoami()
      returns table (uid uuid, email text, is_admin boolean, company_id uuid)
      language sql stable security definer set search_path = public as $body$
        select auth.uid(),
               lower(coalesce(auth.jwt() ->> 'email', '')),
               coalesce(public.is_admin(), false),
               (select p.company_id from public.profiles p where p.id = auth.uid());
      $body$;
    $f4$;
  end if;
end $fns$;

-- ---------------------------------------------------------------------------
-- 3) منح صلاحيات التنفيذ ديناميكياً حسب الاسم مهما كان توقيع الدالة،
--    مع تجاهل أي دالة غير موجودة (لا يتوقف السكربت).
-- ---------------------------------------------------------------------------
do $grants$
declare
  r  record;
  fn text;
  wanted text[] := array[
    'register_company','is_admin','auth_company_id','is_company_active',
    'is_active_user','export_company_data','safe_text','log_activity',
    'gen_code','admin_update_app_settings','admin_set_company_status',
    'admin_set_subscription','admin_delete_company','admin_review_activation_request',
    'admin_set_profile_status','admin_set_profile_role','save_invoice','save_payroll',
    'whoami'
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
      if fn = 'whoami' then
        execute format('revoke execute on function %s from public, anon', r.sig);
      end if;
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

-- ---------------------------------------------------------------------------
-- 4) حارس الملف الشخصي: يتحقق من البريد عند وجوده فقط، ولا يعطّل التسجيل
--    (دالة trigger بلا معاملات — CREATE OR REPLACE آمن هنا)
-- ---------------------------------------------------------------------------
create or replace function public.set_profile_guard() returns trigger
language plpgsql as $guard$
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
end $guard$;

-- ============================================================================
-- بعد التنفيذ شغّل للتأكد:
--   select * from public.rls_audit();   -- يجب أن تعود فارغة
--   select * from public.whoami();      -- يجب أن يظهر بريدك و is_admin
-- ============================================================================
