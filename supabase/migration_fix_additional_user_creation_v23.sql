-- ============================================================================
-- v23 — إصلاح خطأ «Database error creating new user» عند إضافة مستخدم إضافي
--
-- السبب الجذري:
--   المشغّل trg_auth_users_signup_metadata (من v13) يعمل قبل الإدراج في
--   auth.users ويطبّق تحققات تسجيل *صاحب الشركة* على كل الحسابات، ومنها
--   المستخدم الإضافي الذي ينشئه المطوّر عبر مفتاح الخدمة:
--
--     1) يرفض الهاتف إذا كان مطابقاً لهاتف الشركة أو أي ملف شخصي — وهذا
--        متوقع وطبيعي للمستخدم الإضافي (قد يشارك رقم المنشأة).
--     2) أي exception داخل مشغّل على auth.users تحوّله خدمة GoTrue إلى رسالة
--        عامة واحدة هي «Database error creating new user»، فتضيع الرسالة
--        العربية الحقيقية ولا يعرف المطوّر سبب الفشل.
--
-- الإصلاح:
--   • تخطّي تحققات تسجيل المالك للحسابات التي ينشئها المطوّر
--     (raw_app_meta_data.managed_by_developer = true) مع الإبقاء على تحقق
--     البريد والاسم والهاتف الشكلي فقط.
--   • عدم اعتبار تكرار الهاتف خطأً للمستخدم الإضافي.
--   • ضمان صلاحيات التنفيذ لدور supabase_auth_admin على دوال التحقق.
--
-- آمن لإعادة التشغيل بالكامل.
-- ============================================================================

begin;

create or replace function public.enforce_signup_metadata()
returns trigger language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  a jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  -- app metadata وحدها موثوقة؛ user metadata يستطيع المسجّل تزويرها.
  managed boolean := coalesce((a ->> 'managed_by_developer')::boolean, false);
  v_phone text := public.normalize_phone(m ->> 'phone');
begin
  if lower(coalesce(new.email, '')) = 'conta.moha@gmail.com' then return new; end if;
  if not public.is_allowed_email(new.email) then
    raise exception 'البريد الإلكتروني غير صالح أو وهمي أو غير مسموح.';
  end if;
  if not public.valid_phone(m ->> 'phone') then
    raise exception 'رقم الهاتف مطلوب ويجب أن يكون حقيقياً وصحيحاً.';
  end if;
  if not public.is_plausible_identity_text(m ->> 'name', 2) then
    raise exception 'اسم المسؤول مطلوب ويجب أن يكون حقيقياً.';
  end if;

  -- المستخدم الإضافي ينشئه المطوّر من الخادم بعد تحقق كامل، ولا يسجّل شركة
  -- جديدة؛ لذلك لا تنطبق عليه تحققات المالك ولا شرط تفرّد الهاتف عالمياً.
  if managed then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('signup-phone:' || v_phone, 0));
  if exists(select 1 from public.profiles p where public.normalize_phone(p.phone) = v_phone)
     or exists(select 1 from public.companies c where public.normalize_phone(c.phone) = v_phone)
    then raise exception 'رقم الهاتف مستخدم بالفعل في حساب آخر.'; end if;
  if not public.is_plausible_identity_text(m ->> 'company_name', 2) then
    raise exception 'اسم الشركة مطلوب ويجب أن يكون حقيقياً.';
  end if;
  if not public.is_plausible_identity_text(m ->> 'owner_address', 5) then
    raise exception 'عنوان المسؤول مطلوب ويجب أن يكون حقيقياً.';
  end if;
  begin
    if (m ->> 'financial_year_start')::date is null or (m ->> 'financial_year_end')::date is null then
      raise exception 'x';
    end if;
  exception when others then raise exception 'تاريخا السنة المالية مطلوبان وصحيحان.'; end;

  return new;
end $$;

-- دور خدمة المصادقة ينفّذ المشغّل، فيحتاج صلاحية التنفيذ على دوال التحقق.
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema public to supabase_auth_admin';
    execute 'grant execute on function public.enforce_signup_metadata() to supabase_auth_admin';
    execute 'grant execute on function public.enforce_allowed_email() to supabase_auth_admin';
    execute 'grant execute on function public.is_allowed_email(text) to supabase_auth_admin';
    execute 'grant execute on function public.valid_phone(text) to supabase_auth_admin';
    execute 'grant execute on function public.normalize_phone(text) to supabase_auth_admin';
    execute 'grant execute on function public.is_plausible_identity_text(text, int) to supabase_auth_admin';
    execute 'grant execute on function public.safe_text(text, int) to supabase_auth_admin';
  end if;
exception when others then
  raise notice 'تعذّر منح الصلاحيات لدور supabase_auth_admin: %', sqlerrm;
end $grants$;

-- إعادة تركيب المشغّل للتأكد من ارتباطه بالنسخة الجديدة.
do $trg$
begin
  execute 'drop trigger if exists trg_auth_users_signup_metadata on auth.users';
  execute 'create trigger trg_auth_users_signup_metadata before insert on auth.users for each row execute function public.enforce_signup_metadata()';
exception when insufficient_privilege then
  raise notice 'تعذّر إنشاء مشغّل metadata على auth.users؛ يبقى التحقق فعالاً في RPC وواجهة التطبيق.';
end $trg$;

commit;
