-- ============================================================================
-- تعدّد المستخدمين الإضافيين لكل شركة (v25)
--
-- الوضع قبل هذا الملف:
--   v11 فرض «مستخدم إضافي واحد كحد أقصى» عبر فهرس فريد جزئي
--   uq_profiles_one_additional_per_company. هذا قيد مصطنع لا علاقة له بعزل
--   البيانات: كل سياسات RLS تعتمد على public.auth_company_id() التي تقرأ
--   company_id من profiles، فأي عدد من الصفوف بنفس الشركة يعمل بلا تعديل.
--
-- ما يفعله هذا الملف:
--   1) عمود companies.max_additional_users (افتراضي 1) = حد الباقة لكل شركة.
--   2) حذف الفهرس الفريد للمستخدم الإضافي، مع الإبقاء على «مالك واحد فقط».
--   3) مشغّل يمنع تجاوز الحد عند الإدراج/التحويل إلى دور additional،
--      مع قفل استشاري يمنع سباق طلبين متزامنين.
--   4) RPC للمطوّر لضبط الحد (1..10) مع رفض حد أقل من العدد الحالي.
--   5) تحديث admin_get_company_extras_v18 لإرجاع max_additional_users
--      وعدد المستخدمين الإضافيين النشطين.
--
-- لا يمسّ هذا الملف أي جدول تشغيلي (رحلات/فواتير/سندات)، ولا يحذف بيانات،
-- وآمن تماماً لإعادة التشغيل.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- (1) حد المستخدمين الإضافيين لكل شركة
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists max_additional_users int not null default 1;

alter table public.companies drop constraint if exists companies_max_additional_users_check;
alter table public.companies add constraint companies_max_additional_users_check
  check (max_additional_users between 0 and 10);

comment on column public.companies.max_additional_users is
  'أقصى عدد حسابات بدور additional مسموح بها لهذه الشركة (المالك غير محسوب).';

-- ---------------------------------------------------------------------------
-- (2) رفع القيد القديم: مالك واحد فقط يبقى، والمستخدم الإضافي يصبح متعدداً
-- ---------------------------------------------------------------------------
drop index if exists public.uq_profiles_one_additional_per_company;

-- الفهرس التالي موجود من v11؛ نضمن بقاءه لأنه شرط سلامة حقيقي.
create unique index if not exists uq_profiles_one_owner_per_company
  on public.profiles(company_id) where company_id is not null and role = 'owner';

-- فهرس العدّ السريع داخل المشغّل والـ RPC.
create index if not exists ix_profiles_company_role
  on public.profiles(company_id, role);

-- ---------------------------------------------------------------------------
-- (3) فرض الحد على مستوى القاعدة (بديل الفهرس الفريد)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_additional_user_limit()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_limit int;
  v_count int;
begin
  if new.role <> 'additional' or new.company_id is null then
    return new;
  end if;

  -- لا نعيد الفحص إن لم يتغيّر شيء ذو صلة عند UPDATE.
  if tg_op = 'UPDATE'
     and old.role = 'additional'
     and old.company_id is not distinct from new.company_id then
    return new;
  end if;

  -- يمنع تجاوز الحد عند وصول طلبَي إنشاء متزامنين لنفس الشركة.
  perform pg_advisory_xact_lock(hashtextextended('company-users:' || new.company_id::text, 0));

  select coalesce(c.max_additional_users, 1) into v_limit
    from public.companies c where c.id = new.company_id;
  if v_limit is null then v_limit := 1; end if;

  select count(*) into v_count
    from public.profiles p
   where p.company_id = new.company_id
     and p.role = 'additional'
     and p.id <> new.id;

  if v_count >= v_limit then
    raise exception 'بلغت هذه الشركة الحد المسموح به للمستخدمين الإضافيين (%).', v_limit;
  end if;

  return new;
end $$;

drop trigger if exists trg_profiles_additional_limit on public.profiles;
create trigger trg_profiles_additional_limit
  before insert or update of role, company_id on public.profiles
  for each row execute function public.enforce_additional_user_limit();

-- ---------------------------------------------------------------------------
-- (4) RPC المطوّر: ضبط حد المستخدمين لشركة
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_company_user_limit_v25(
  p_company_id uuid, p_max int
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_used int;
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if p_company_id is null or not exists(select 1 from public.companies where id = p_company_id) then
    raise exception 'الشركة غير موجودة.';
  end if;
  if p_max is null or p_max < 0 or p_max > 10 then
    raise exception 'الحد المسموح به بين 0 و10 مستخدمين إضافيين.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('company-users:' || p_company_id::text, 0));

  select count(*) into v_used
    from public.profiles p
   where p.company_id = p_company_id and p.role = 'additional';

  if p_max < v_used then
    raise exception 'يوجد % مستخدماً إضافياً بالفعل؛ احذف الزائد قبل خفض الحد إلى %.', v_used, p_max;
  end if;

  update public.companies set max_additional_users = p_max where id = p_company_id;

  insert into public.activity_logs(actor_id, actor_email, action, entity, entity_id, detail)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'admin.set_company_user_limit',
          'company', p_company_id::text, p_max::text);

  return jsonb_build_object('max_additional_users', p_max, 'used', v_used);
end $$;

revoke all on function public.admin_set_company_user_limit_v25(uuid, int) from public, anon;
grant execute on function public.admin_set_company_user_limit_v25(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (5) لقطة الشركة تعيد الحد والاستهلاك حتى تعرضهما لوحة المطوّر
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_company_extras_v18(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_features jsonb; v_users jsonb; v_limit int; v_used int; v_active int;
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if not exists(select 1 from public.companies where id = p_company_id) then
    raise exception 'الشركة غير موجودة.';
  end if;

  select coalesce(jsonb_object_agg(cf.feature_key, cf.enabled), '{}'::jsonb)
    into v_features
    from public.company_features cf
   where cf.company_id = p_company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'company_id', p.company_id, 'name', p.name, 'email', p.email,
    'phone', p.phone, 'role', p.role, 'is_active', p.is_active, 'created_at', p.created_at
  ) order by p.created_at), '[]'::jsonb)
    into v_users
    from public.profiles p
   where p.company_id = p_company_id;

  select coalesce(max_additional_users, 1) into v_limit
    from public.companies where id = p_company_id;

  select count(*) filter (where p.role = 'additional'),
         count(*) filter (where p.role = 'additional' and p.is_active)
    into v_used, v_active
    from public.profiles p
   where p.company_id = p_company_id;

  return jsonb_build_object(
    'features', v_features,
    'users', v_users,
    'max_additional_users', coalesce(v_limit, 1),
    'used_additional_users', coalesce(v_used, 0),
    'active_additional_users', coalesce(v_active, 0)
  );
end $$;

revoke all on function public.admin_get_company_extras_v18(uuid) from public, anon;
grant execute on function public.admin_get_company_extras_v18(uuid) to authenticated, service_role;

commit;

-- ============================================================================
-- ملاحظات التشغيل
-- • كل الشركات تبقى على حد = 1، فلا يتغيّر أي سلوك حتى يرفع المطوّر الحد يدوياً.
-- • ميزة additional_user تظل البوابة العامة في RLS: تُفعَّل ما دام هناك مستخدم
--   إضافي نشط واحد على الأقل، وتعطيل مستخدم بعينه يتم عبر profiles.is_active.
-- • للتحقق بعد التشغيل:
--     select id, name, max_additional_users from public.companies;
--     select company_id, role, count(*) from public.profiles group by 1,2;
-- ============================================================================
