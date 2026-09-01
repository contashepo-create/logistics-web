-- ============================================================================
-- المميزات الإضافية + المستخدم الإضافي (v11)
-- آمن عند إعادة التشغيل، وجميع المميزات غير مفعّلة افتراضياً لكل الشركات.
--
-- يشمل:
--   1) سجل مركزي للمميزات ومنحها لكل شركة (غياب الصف = غير مفعّلة)
--   2) ميزة الفاتورة الضريبية/QR وميزة المستخدم الإضافي
--   3) دور owner/additional للمستخدم، مع مستخدم إضافي واحد كحد أقصى
--   4) منع المستخدم الإضافي المعطّل من الوصول لبيانات الشركة على مستوى RLS
--   5) RPC محمي للمطوّر لتفعيل/إلغاء المميزات
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) أدوار مستخدمي الشركة
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists is_active boolean not null default true;

-- الحارس القديم يغيّر أي role إلى user/admin عند وجود العمود؛ نوقفه قبل ترحيل
-- القيم ثم نعيد إنشاء نسخة متوافقة مع owner/additional أدناه.
drop trigger if exists trg_profile_guard on public.profiles;
alter table public.profiles drop constraint if exists profiles_role_check;

-- كل الحسابات الموجودة هي owner للتوافق؛ حساب المطوّر بلا شركة فلا يؤثر دوره.
-- يشمل ذلك قواعد قديمة قد تحتوي القيمتين user/admin.
update public.profiles
   set role = 'owner'
 where role is null or role not in ('owner', 'additional');

alter table public.profiles alter column role set default 'owner';
alter table public.profiles alter column role set not null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'additional'));

-- إزالة القيد القديم الذي كان يفرض مستخدماً واحداً فقط لكل شركة.
drop index if exists public.uq_profiles_one_user_per_company;
-- مالك واحد ومستخدم إضافي واحد كحد أقصى لكل شركة.
create unique index if not exists uq_profiles_one_owner_per_company
  on public.profiles(company_id) where company_id is not null and role = 'owner';
create unique index if not exists uq_profiles_one_additional_per_company
  on public.profiles(company_id) where company_id is not null and role = 'additional';

-- إعادة تعريف الحارس: يحافظ على الدور الذي يعيّنه الخادم بدلاً من استبداله
-- بالقيمة القديمة user/admin، مع استمرار تطبيع البريد والاسم والهاتف.
create or replace function public.set_profile_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $guard$
declare
  v_email text;
begin
  v_email := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), new.email, ''));
  if v_email <> '' and not public.is_allowed_email(v_email) then
    raise exception 'يُقبل التسجيل ببريد Gmail أو Yahoo أو Hotmail أو Outlook أو iCloud فقط.';
  end if;

  new.email := v_email;
  new.name := coalesce(public.safe_text(new.name, 120), '');
  new.phone := regexp_replace(public.safe_text(new.phone, 24), '[^0-9+ -]', '', 'g');
  new.role := coalesce(new.role, 'owner');
  new.is_active := coalesce(new.is_active, true);
  return new;
end $guard$;

drop trigger if exists trg_profile_guard on public.profiles;
create trigger trg_profile_guard before insert or update on public.profiles
  for each row execute function public.set_profile_guard();

-- ---------------------------------------------------------------------------
-- 2) سجل المميزات ومنحها للشركات
-- ---------------------------------------------------------------------------
create table if not exists public.feature_catalog (
  feature_key text primary key,
  name_ar text not null,
  description_ar text not null default '',
  created_at timestamptz not null default now()
);

insert into public.feature_catalog (feature_key, name_ar, description_ar) values
  ('tax_invoice', 'الفاتورة الضريبية', 'تفعيل خصائص الفاتورة الضريبية والتحقق وطباعة رمز QR.'),
  ('additional_user', 'المستخدم الإضافي', 'السماح لحساب إضافي واحد بالدخول إلى بيانات الشركة نفسها.')
on conflict (feature_key) do update
  set name_ar = excluded.name_ar,
      description_ar = excluded.description_ar;

create table if not exists public.company_features (
  company_id uuid not null references public.companies(id) on delete cascade,
  feature_key text not null references public.feature_catalog(feature_key) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, feature_key)
);
create index if not exists idx_company_features_lookup
  on public.company_features(company_id, feature_key, enabled);

alter table public.feature_catalog enable row level security;
alter table public.company_features enable row level security;

drop policy if exists feature_catalog_authenticated_read on public.feature_catalog;
create policy feature_catalog_authenticated_read on public.feature_catalog
  for select to authenticated using (true);

drop policy if exists company_features_own_read on public.company_features;
create policy company_features_own_read on public.company_features
  for select to authenticated
  using (company_id = public.auth_company_id() or public.is_admin());

drop policy if exists company_features_admin_write on public.company_features;
create policy company_features_admin_write on public.company_features
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- غياب الصف أو enabled=false يعني أن الميزة متوقفة.
create or replace function public.has_company_feature(p_feature_key text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    exists (
      select 1
        from public.company_features cf
       where cf.company_id = public.auth_company_id()
         and cf.feature_key = p_feature_key
         and cf.enabled
    ),
    false
  );
$$;

create or replace function public.admin_set_company_feature(
  p_company_id uuid,
  p_feature_key text,
  p_enabled boolean
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح لك بهذا الإجراء.';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'الشركة غير موجودة.';
  end if;
  if not exists (select 1 from public.feature_catalog where feature_key = p_feature_key) then
    raise exception 'الميزة غير معروفة.';
  end if;

  insert into public.company_features (company_id, feature_key, enabled, updated_by, updated_at)
  values (p_company_id, p_feature_key, coalesce(p_enabled, false), auth.uid(), now())
  on conflict (company_id, feature_key) do update
     set enabled = excluded.enabled,
         updated_by = excluded.updated_by,
         updated_at = now();

  perform public.log_activity(
    case when p_enabled then 'admin.enable_feature' else 'admin.disable_feature' end,
    'company_feature', p_company_id::text, p_feature_key
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3) حارس العزل والاشتراك: المالك كالمعتاد، والمستخدم الإضافي لا يحصل حتى على
--    company_id داخل سياسات RLS إلا إذا كان نشطاً والميزة مفعّلة.
-- ---------------------------------------------------------------------------
create or replace function public.auth_company_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select p.company_id
    from public.profiles p
   where p.id = auth.uid()
     and (
       p.role = 'owner'
       or (
         p.role = 'additional'
         and p.is_active
         and exists (
           select 1 from public.company_features cf
            where cf.company_id = p.company_id
              and cf.feature_key = 'additional_user'
              and cf.enabled
         )
       )
     );
$$;

create or replace function public.is_company_active() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (
      select c.is_active
         and p.is_active
         and (
           p.role = 'owner'
           or (
             p.role = 'additional'
             and exists (
               select 1 from public.company_features cf
                where cf.company_id = c.id
                  and cf.feature_key = 'additional_user'
                  and cf.enabled
             )
           )
         )
         and (
           c.trial_end >= current_date
           or c.plan_type = 'open'
           or (c.subscription_end is not null and c.subscription_end >= current_date)
         )
        from public.companies c
        join public.profiles p on p.company_id = c.id
       where p.id = auth.uid()
    ),
    false
  );
$$;

-- أقل امتياز: المستخدم العادي لا يستطيع تغيير الدور/الهاتف/الحالة.
revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;

grant select on public.feature_catalog, public.company_features to authenticated, service_role;
grant insert, update, delete on public.company_features to service_role;

revoke execute on function public.has_company_feature(text) from public, anon;
grant execute on function public.has_company_feature(text) to authenticated, service_role;
revoke execute on function public.admin_set_company_feature(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_company_feature(uuid, text, boolean) to authenticated, service_role;
-- الدالتان مستخدمتان داخل RLS ويجب أن يستطيع authenticated تنفيذهما.
grant execute on function public.auth_company_id() to authenticated, service_role;
grant execute on function public.is_company_active() to authenticated, service_role;

commit;

-- ملاحظات:
-- • لا تُضاف أي منح للشركات الموجودة، لذلك tax_invoice وadditional_user متوقفتان.
-- • إنشاء حساب المصادقة المؤكد يتم من API الخادم باستخدام service_role، وليس SQL.
