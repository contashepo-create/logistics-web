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
grant execute on function public.register_company(text, text, text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.auth_company_id() to authenticated;
grant execute on function public.is_company_active() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.export_company_data() to authenticated;
grant execute on function public.is_allowed_email(text) to authenticated, anon;
grant execute on function public.safe_text(text, int) to authenticated;
grant execute on function public.log_activity(text, text, text, text) to authenticated;

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
