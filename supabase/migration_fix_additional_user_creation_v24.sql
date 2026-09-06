-- ============================================================================
-- v24 — الإصلاح الفعلي لخطأ «Database error creating new user»
--        عند إنشاء مستخدم إضافي من «المميزات الإضافية» للشركة.
--
-- لماذا لم تكفِ v23؟
--   v23 اعتمدت على raw_app_meta_data.managed_by_developer داخل مشغّل
--   BEFORE INSERT على auth.users. لكن خدمة GoTrue (Supabase Auth) لا تكتب
--   app_metadata أثناء الإدراج: تُدرج الصف أولاً بـ
--   raw_app_meta_data = {"provider":"email","providers":["email"]} ثم تُنفّذ
--   UPDATE لاحقاً لإضافة المفاتيح المخصّصة.
--   (supabase/auth#975 — «Security definer's new object only has app_metadata
--    after update not after insert»)
--
--   النتيجة: managed تساوي false دائماً داخل المشغّل، فتُطبَّق تحققات تسجيل
--   *صاحب الشركة* على المستخدم الإضافي (تفرّد الهاتف عالمياً + اسم الشركة +
--   عنوان المسؤول + السنة المالية)، فيفشل الإدراج، وتحوّل GoTrue أي استثناء
--   إلى الرسالة العامة «Database error creating new user».
--
-- الإصلاح في هذا الملف:
--   1) «تذكرة إنشاء» موقّعة من الخادم: جدول public.managed_signups يكتب فيه
--      مسار /api/zerocold/company-users بمفتاح الخدمة قبل استدعاء
--      auth.admin.createUser. المشغّل يقرأ التذكرة بالبريد — وهي قيمة متوفّرة
--      فعلاً وقت الإدراج — فيعرف أن الحساب يُنشئه المطوّر.
--      التذكرة تُستهلك مرة واحدة وتنتهي صلاحيتها خلال 15 دقيقة، ولا يستطيع
--      anon/authenticated الكتابة فيها (RLS بلا سياسات + سحب الصلاحيات)،
--      فلا يمكن تزويرها من المتصفح بعكس user_metadata.
--   2) الإبقاء على قراءة raw_app_meta_data كمسار احتياطي (لو غيّرت GoTrue
--      سلوكها مستقبلاً أو أُنشئ الحساب بـ SQL مباشرة).
--   3) السماح للمستخدم الإضافي بمشاركة هاتف/بريد شركته نفسها في
--      guard_unique_account_contact — منعها سابقاً كان يُفشل إدراج الملف
--      الشخصي حتى بعد نجاح إنشاء الحساب.
--   4) إعادة منح EXECUTE لدور supabase_auth_admin على دوال المشغّل، لأن
--      v21 تسحب الصلاحيات من public وتشمل هذه الدوال.
--
-- آمن لإعادة التشغيل بالكامل، ويُنفَّذ بعد v21 وv22 وv23.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- (1) تذاكر الإنشاء الخادمية — المصدر الوحيد الموثوق لتمييز المستخدم الإضافي
-- ---------------------------------------------------------------------------
create table if not exists public.managed_signups (
  email        text primary key,
  company_id   uuid references public.companies(id) on delete cascade,
  requested_by uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '15 minutes',
  consumed_at  timestamptz
);

create index if not exists ix_managed_signups_expires on public.managed_signups(expires_at);

alter table public.managed_signups enable row level security;

-- بلا أي سياسة: anon/authenticated لا يريان الجدول إطلاقاً،
-- و service_role (الخادم فقط) يتجاوز RLS.
revoke all on table public.managed_signups from public, anon, authenticated;
grant select, insert, update, delete on public.managed_signups to service_role;

-- ---------------------------------------------------------------------------
-- (2) المشغّل: يتعرّف على المستخدم الإضافي من التذكرة لا من app_metadata
-- ---------------------------------------------------------------------------
create or replace function public.enforce_signup_metadata()
returns trigger language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  a jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_email text := lower(btrim(coalesce(new.email, '')));
  v_phone text := public.normalize_phone(m ->> 'phone');
  managed boolean;
begin
  if v_email = 'conta.moha@gmail.com' then return new; end if;

  -- ⚠️ لا تعتمد على raw_app_meta_data وحدها: GoTrue تكتبها بعد الإدراج بـ UPDATE
  -- منفصل، فتكون هنا دائماً {"provider":"email","providers":["email"]}.
  -- تبقى كمسار احتياطي فقط.
  managed := coalesce((a ->> 'managed_by_developer')::boolean, false);

  -- التذكرة الخادمية: تُستهلك مرة واحدة فقط وتنتهي صلاحيتها بعد 15 دقيقة.
  if not managed then
    update public.managed_signups s
       set consumed_at = now()
     where s.email = v_email
       and s.consumed_at is null
       and s.expires_at > now();
    if found then managed := true; end if;
  end if;

  -- تحققات تسري على الجميع (مالكاً كان أو مستخدماً إضافياً)
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
  -- جديدة؛ فلا تنطبق عليه تحققات المالك ولا تفرّد الهاتف عالمياً (قد يشارك
  -- رقم المنشأة نفسه).
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

-- ---------------------------------------------------------------------------
-- (3) الملف الشخصي: المستخدم الإضافي يشارك بيانات اتصال شركته نفسها
--     (الشرط القديم كان يقارن بالدور، فيرفض role = 'additional' دائماً)
-- ---------------------------------------------------------------------------
create or replace function public.guard_unique_account_contact()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_phone text := public.normalize_phone(new.phone);
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
  if v_phone = '' or not public.valid_phone(new.phone) then raise exception 'رقم الهاتف مطلوب ويجب أن يكون حقيقياً وصحيحاً.'; end if;
  if v_email = '' then raise exception 'البريد الإلكتروني مطلوب.'; end if;
  new.phone := v_phone;
  new.email := v_email;
  perform pg_advisory_xact_lock(hashtextextended('account-phone:' || v_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('account-email:' || v_email, 0));

  if tg_table_name = 'companies' then
    -- ملفات الشركة نفسها (المالك والمستخدم الإضافي) لا تتعارض مع بياناتها.
    if exists(select 1 from public.companies c where c.id <> new.id and public.normalize_phone(c.phone) = v_phone)
       or exists(select 1 from public.profiles p where public.normalize_phone(p.phone) = v_phone and p.company_id is distinct from new.id)
      then raise exception 'رقم الهاتف مستخدم بالفعل في حساب آخر.'; end if;
    if exists(select 1 from public.companies c where c.id <> new.id and lower(btrim(c.email)) = v_email)
       or exists(select 1 from public.profiles p where lower(btrim(p.email)) = v_email and p.company_id is distinct from new.id)
      then raise exception 'البريد الإلكتروني مستخدم بالفعل في حساب آخر.'; end if;
  else
    -- تفرّد الهاتف والبريد بين الحسابات يبقى صارماً…
    if exists(select 1 from public.profiles p where p.id <> new.id and public.normalize_phone(p.phone) = v_phone)
      then raise exception 'رقم الهاتف مستخدم بالفعل في حساب آخر.'; end if;
    if exists(select 1 from public.profiles p where p.id <> new.id and lower(btrim(p.email)) = v_email)
      then raise exception 'البريد الإلكتروني مستخدم بالفعل في حساب آخر.'; end if;
    -- …أما مقارنة بيانات الشركة فتستثني شركة المستخدم نفسه بأي دور،
    -- حتى يستطيع المستخدم الإضافي استخدام رقم المنشأة وبريدها.
    if exists(select 1 from public.companies c where public.normalize_phone(c.phone) = v_phone and c.id is distinct from new.company_id)
      then raise exception 'رقم الهاتف مستخدم بالفعل في حساب آخر.'; end if;
    if exists(select 1 from public.companies c where lower(btrim(c.email)) = v_email and c.id is distinct from new.company_id)
      then raise exception 'البريد الإلكتروني مستخدم بالفعل في حساب آخر.'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_companies_unique_contact on public.companies;
create trigger trg_companies_unique_contact before insert or update of phone, email on public.companies
for each row execute function public.guard_unique_account_contact();
drop trigger if exists trg_profiles_unique_contact on public.profiles;
create trigger trg_profiles_unique_contact before insert or update of phone, email, company_id, role on public.profiles
for each row execute function public.guard_unique_account_contact();

-- ---------------------------------------------------------------------------
-- (4) صلاحيات وملكية دوال المشغّل
--     دور خدمة المصادقة هو من ينفّذ المشغّل، و v21 تسحب EXECUTE من public.
--     كما أن SECURITY DEFINER يجب أن تملكها postgres لتقرأ managed_signups.
-- ---------------------------------------------------------------------------
do $owner$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    begin
      execute 'alter function public.enforce_signup_metadata() owner to postgres';
    exception when others then
      raise notice 'تعذّر تغيير مالك enforce_signup_metadata: %', sqlerrm;
    end;
  end if;
end $owner$;

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

-- ============================================================================
-- تحقّق بعد التنفيذ:
--   select to_regclass('public.managed_signups');                    -- ليس null
--   select relrowsecurity from pg_class where oid = 'public.managed_signups'::regclass;  -- true
--   select has_function_privilege('supabase_auth_admin',
--            'public.enforce_signup_metadata()', 'execute');         -- true
-- ثم أعد محاولة إنشاء المستخدم الإضافي من: المميزات الإضافية ← المستخدم الإضافي
-- ============================================================================
