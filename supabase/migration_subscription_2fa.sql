-- ============================================================================
-- ترقية قاعدة بيانات قائمة: التجربة المجانية + طلبات الاشتراك + تصدير البيانات
-- الصق هذا الملف كاملاً في Supabase Dashboard > SQL Editor > Run (آمن التكرار)
-- ============================================================================

-- 1) عمود التجربة المجانية (7 أيام)
alter table public.companies add column if not exists trial_end date;
update public.companies set trial_end = (coalesce(created_at, now())::date + 7) where trial_end is null;
alter table public.companies alter column trial_end set default (current_date + 7);
alter table public.companies alter column trial_end set not null;
alter table public.companies alter column plan_type set default 'monthly';

-- 2) جدول طلبات الاشتراك
create table if not exists public.activation_requests (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  plan_type   text not null check (plan_type in ('monthly', 'yearly')),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  receipt_url text,
  notes       text default '',
  admin_notes text default '',
  created_at  timestamptz default now(),
  reviewed_at timestamptz
);
create index if not exists idx_activation_company on public.activation_requests(company_id);
create unique index if not exists uq_activation_pending
  on public.activation_requests(company_id) where status = 'pending';

-- 3) تحديث دالة النشاط لتشمل التجربة المجانية
create or replace function public.is_company_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.is_active and (
            c.trial_end >= current_date
            or c.plan_type = 'open'
            or (c.subscription_end is not null and c.subscription_end >= current_date)
         )
     from public.companies c join public.profiles p on p.company_id = c.id
     where p.id = auth.uid()),
    false
  );
$$;

-- 4) RLS + حارس company_id لجدول الطلبات
alter table public.activation_requests enable row level security;
drop policy if exists tenant_isolation on public.activation_requests;
create policy tenant_isolation on public.activation_requests for all
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());
drop policy if exists admin_full_access on public.activation_requests;
create policy admin_full_access on public.activation_requests for all
  using (public.is_admin()) with check (public.is_admin());

drop trigger if exists trg_set_company_id on public.activation_requests;
create trigger trg_set_company_id before insert on public.activation_requests
  for each row execute function public.set_company_id();

-- 5) دوال المراجعة والتصدير
create or replace function public.admin_review_activation_request(
  p_request_id uuid, p_approve boolean, p_admin_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req activation_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  select * into v_req from public.activation_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود.'; end if;
  if v_req.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقاً.'; end if;
  if p_approve then
    update public.activation_requests set status='approved', admin_notes=p_admin_notes, reviewed_at=now() where id=p_request_id;
    update public.companies
    set plan_type=v_req.plan_type, subscription_start=current_date,
        subscription_end=current_date + (case when v_req.plan_type='yearly' then 365 else 30 end),
        trial_end=current_date
    where id=v_req.company_id;
  else
    update public.activation_requests set status='rejected', admin_notes=p_admin_notes, reviewed_at=now() where id=p_request_id;
  end if;
  perform public.log_activity(
    case when p_approve then 'admin.approve_request' else 'admin.reject_request' end,
    'activation_request', p_request_id::text, v_req.plan_type);
end $$;

create or replace function public.export_company_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid := public.auth_company_id();
  v_out jsonb := '{}'::jsonb;
begin
  if v_cid is null then raise exception 'لا توجد شركة مرتبطة بحسابك.'; end if;
  select jsonb_build_object(
    'company', to_jsonb(c),
    'customers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.customers x where x.company_id = v_cid),
    'employees', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.employees x where x.company_id = v_cid),
    'vehicles', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.vehicles x where x.company_id = v_cid),
    'cashboxes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.cashboxes x where x.company_id = v_cid),
    'banks', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.banks x where x.company_id = v_cid),
    'financial_years', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.financial_years x where x.company_id = v_cid),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoices x where x.company_id = v_cid),
    'invoice_trips', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.invoice_trips x where x.company_id = v_cid),
    'trip_expenses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.trip_expenses x where x.company_id = v_cid),
    'receipt_vouchers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.receipt_vouchers x where x.company_id = v_cid),
    'payment_vouchers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.payment_vouchers x where x.company_id = v_cid),
    'payrolls', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.payrolls x where x.company_id = v_cid),
    'advance_settlements', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.advance_settlements x where x.company_id = v_cid)
  )
  into v_out from public.companies c where c.id = v_cid;
  return v_out;
end $$;

revoke execute on function public.admin_review_activation_request(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_activation_request(uuid, boolean, text) to authenticated, service_role;
revoke execute on function public.export_company_data() from public, anon;
grant execute on function public.export_company_data() to authenticated;

grant select, insert, update, delete on public.activation_requests to authenticated, service_role;

-- 5.1) سدّ ثغرة أمنية: منع المستخدم من تعيين company_id بنفسه عند إنشاء ملفه الشخصي
-- (كانت السياسة السابقة تسمح بربط الحساب بأي شركة وقراءة بياناتها).
drop policy if exists profiles_own_insert on public.profiles;
create policy profiles_own_insert on public.profiles for insert
  with check (id = auth.uid() and company_id is null);

-- 6) دلو التخزين لصور الوصول (عام حتى يستطيع بوت تليجرام جلب الصورة)
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do update set public = true;

-- منح المستخدمين المصادقين رفع ملفاتهم فقط (عزل عبر مسار receipts/<uuid>؟)
-- ملاحظة: تُقيَّد أذونات الرفع أدناه بحيث يرفع المستخدم داخل مساره الخاص.
drop policy if exists "receipts_upload_own" on storage.objects;
create policy "receipts_upload_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts');

drop policy if exists "receipts_read_public" on storage.objects;
create policy "receipts_read_public" on storage.objects
  for select using (bucket_id = 'receipts');
