-- ============================================================================
-- تعدّد المستخدمين الإضافيين لكل شركة (v25)
--
-- الوضع قبل هذا الملف:
--   v11 فرض «مستخدم إضافي واحد كحد أقصى» عبر فهرس فريد جزئي
--   uq_profiles_one_additional_per_company. هذا قيد مصطنع لا علاقة له بعزل
--   البيانات: كل سياسات RLS تعتمد على public.auth_company_id() التي تقرأ
--   company_id من profiles، فأي عدد من الصفوف بنفس الشركة يعمل بلا تعديل.
--
-- ⚠️ ملاحظة تشغيلية مهمة — لماذا لا توجد معاملة واحدة هنا؟
--   النسخة الأولى غلّفت كل شيء بـ begin/commit، فكانت تحتفظ بـ
--   AccessExclusiveLock على companies ثم على profiles طوال الترحيلة، بينما
--   التطبيق الحيّ (PostgREST) يقرأ الجدولين بالترتيب المعاكس، فينشأ:
--       ERROR: 40P01: deadlock detected
--   الحل: كل عبارة DDL تُنفَّذ في معاملتها الضمنية القصيرة، مع lock_timeout
--   قصير وإعادة محاولة، فلا يبقى أي قفل حصري محجوزاً أثناء انتظار قفل آخر.
--
-- ما يفعله هذا الملف:
--   1) عمود companies.max_additional_users (افتراضي 1) = حد الباقة لكل شركة.
--   2) حذف الفهرس الفريد للمستخدم الإضافي، مع الإبقاء على «مالك واحد فقط».
--   3) مشغّل يمنع تجاوز الحد عند الإدراج/التحويل إلى دور additional.
--   4) RPC للمطوّر لضبط الحد (0..10) مع رفض حد أقل من العدد الحالي.
--   5) تحديث admin_get_company_extras_v18 لإرجاع الحد والاستهلاك.
--
-- لا يمسّ هذا الملف أي جدول تشغيلي (رحلات/فواتير/سندات)، ولا يحذف بيانات،
-- وآمن تماماً لإعادة التشغيل، ويمكن تنفيذه مجدداً إن توقف في المنتصف.
-- ============================================================================

-- لا تنتظر الأقفال طويلاً: الفشل السريع أفضل من الجمود المتبادل.
set lock_timeout = '4s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- (0) مساعد إعادة المحاولة: ينفّذ عبارة DDL ويعيد المحاولة عند تعذّر القفل.
--     كل استدعاء معاملة مستقلة قصيرة، فلا تتراكم الأقفال الحصرية.
-- ---------------------------------------------------------------------------
create or replace function public.v25_try_ddl(p_sql text, p_tries int default 8)
returns void language plpgsql as $v25$
declare
  i int := 0;
begin
  loop
    i := i + 1;
    begin
      execute p_sql;
      return;
    exception
      when lock_not_available or deadlock_detected then
        if i >= p_tries then
          raise notice 'تعذّر الحصول على القفل بعد % محاولة: %', i, p_sql;
          raise;
        end if;
        -- مهلة تصاعدية بسيطة تفسح المجال لمعاملات التطبيق الجارية.
        perform pg_sleep(0.5 * i);
    end;
  end loop;
end $v25$;

-- ---------------------------------------------------------------------------
-- (1) حد المستخدمين الإضافيين لكل شركة
--     ADD COLUMN بقيمة افتراضية ثابتة لا يعيد كتابة الجدول في PG 11+،
--     فالقفل الحصري لحظي.
-- ---------------------------------------------------------------------------
select public.v25_try_ddl($ddl$
  alter table public.companies
    add column if not exists max_additional_users int not null default 1
$ddl$);

select public.v25_try_ddl($ddl$
  alter table public.companies
    drop constraint if exists companies_max_additional_users_check
$ddl$);

-- NOT VALID ثم VALIDATE: الأولى لا تفحص الصفوف القائمة (قفل قصير)،
-- والثانية تفحصها بقفل أضعف لا يمنع القراءة والكتابة.
select public.v25_try_ddl($ddl$
  alter table public.companies
    add constraint companies_max_additional_users_check
    check (max_additional_users between 0 and 10) not valid
$ddl$);

select public.v25_try_ddl($ddl$
  alter table public.companies
    validate constraint companies_max_additional_users_check
$ddl$);

comment on column public.companies.max_additional_users is
  'أقصى عدد حسابات بدور additional مسموح بها لهذه الشركة (المالك غير محسوب).';

-- ---------------------------------------------------------------------------
-- (2) رفع القيد القديم: مالك واحد فقط يبقى، والمستخدم الإضافي يصبح متعدداً
-- ---------------------------------------------------------------------------
select public.v25_try_ddl($ddl$
  drop index if exists public.uq_profiles_one_additional_per_company
$ddl$);

-- الفهارس تُبنى بالطريقة العادية عمداً، لا CONCURRENTLY: محرّر SQL في
-- Supabase قد يغلّف العبارات بمعاملة، و CREATE INDEX CONCURRENTLY ممنوع
-- داخل المعاملات. وجدول profiles صغير (صفوف قليلة لكل شركة) فالقفل لحظي،
-- و lock_timeout أعلاه يمنع أي انتظار طويل.
select public.v25_try_ddl($ddl$
  create unique index if not exists uq_profiles_one_owner_per_company
    on public.profiles(company_id) where company_id is not null and role = 'owner'
$ddl$);

select public.v25_try_ddl($ddl$
  create index if not exists ix_profiles_company_role
    on public.profiles(company_id, role)
$ddl$);

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

  -- قفل استشاري على الشركة فقط: يمنع تجاوز الحد عند وصول طلبَي إنشاء
  -- متزامنين، ولا يقفل أي جدول فلا يشارك في أي جمود.
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

select public.v25_try_ddl($ddl$
  drop trigger if exists trg_profiles_additional_limit on public.profiles
$ddl$);

select public.v25_try_ddl($ddl$
  create trigger trg_profiles_additional_limit
    before insert or update of role, company_id on public.profiles
    for each row execute function public.enforce_additional_user_limit()
$ddl$);

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

-- ---------------------------------------------------------------------------
-- (6) تنظيف المساعد المؤقت
-- ---------------------------------------------------------------------------
drop function if exists public.v25_try_ddl(text, int);

reset lock_timeout;
reset statement_timeout;

-- ============================================================================
-- التحقق بعد التشغيل
--
--   -- العمود والحد:
--   select id, name, max_additional_users from public.companies;
--
--   -- المشغّل موجود:
--   select tgname from pg_trigger where tgname = 'trg_profiles_additional_limit';
--
--   -- كل الفهارس صالحة (يجب ألا يظهر أي صف):
--   select c.relname from pg_class c join pg_index i on i.indexrelid = c.oid
--    where not i.indisvalid and c.relname like '%profiles%';
--
--   -- القيد القديم مرفوع (يجب ألا يظهر أي صف):
--   select indexname from pg_indexes
--    where indexname = 'uq_profiles_one_additional_per_company';
--
-- ملاحظات:
-- • كل الشركات تبقى على حد = 1، فلا يتغيّر أي سلوك حتى يرفع المطوّر الحد.
-- • إن ظهر «تعذّر الحصول على القفل» فهناك معاملة طويلة جارية؛ نفّذ:
--     select pid, state, query from pg_stat_activity where state <> 'idle';
--   ثم أعد تشغيل الملف — فهو آمن للتكرار بالكامل.
-- ============================================================================
