-- ============================================================================
-- v4 — تصحيح حالة الاشتراك (آمن التكرار)
--
-- المشكلة: عند فتح اشتراك لعميل (open) أو تفعيل شهري/سنوي، كان تاريخ
--          trial_end يبقى في المستقبل، فتُحسب الشركة «تجريبية» رغم اشتراكها.
-- الحل   : إنهاء التجربة تلقائياً عند أي باقة غير تجريبية، وترتيب الأولوية
--          في is_company_active بحيث تتقدّم الباقة المدفوعة/المفتوحة.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) تعديل اشتراك من لوحة المطوّر: الباقة غير التجريبية تُنهي التجربة فوراً
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_subscription(
  p_company_id uuid, p_plan_type text, p_end_date date default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  if p_plan_type not in ('trial', 'monthly', 'yearly', 'open') then
    raise exception 'نوع الاشتراك غير صالح.';
  end if;

  update public.companies
     set plan_type = p_plan_type,
         subscription_start = case
           when p_plan_type in ('monthly', 'yearly', 'open') then current_date
           else subscription_start end,
         subscription_end = case
           when p_plan_type in ('open', 'trial') then null
           else p_end_date end,
         -- التجربة تنتهي فوراً لأي باقة غير تجريبية (وإلا ظهرت الحالة «تجريبي»)
         trial_end = case
           when p_plan_type = 'trial' then coalesce(p_end_date, current_date + 7)
           else current_date - 1 end
   where id = p_company_id;

  perform public.log_activity('admin.set_subscription', 'company', p_company_id::text,
    p_plan_type || coalesce(' | ' || p_end_date::text, ''));
end $$;

-- ---------------------------------------------------------------------------
-- 2) الموافقة على طلب اشتراك: تنهي التجربة أيضاً (كانت تضع trial_end = اليوم
--    فتبقى الحالة «تجريبي» طوال ذلك اليوم)
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_activation_request(
  p_request_id uuid, p_approve boolean, p_admin_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req activation_requests%rowtype;
  v_from date;
begin
  if not public.is_admin() then raise exception 'غير مصرح لك بهذا الإجراء.'; end if;
  select * into v_req from public.activation_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود.'; end if;
  if v_req.status <> 'pending' then raise exception 'تمت مراجعة هذا الطلب مسبقاً.'; end if;

  if p_approve then
    select greatest(coalesce(subscription_end, current_date), current_date) into v_from
      from public.companies where id = v_req.company_id;

    update public.activation_requests
       set status = 'approved', admin_notes = public.safe_text(p_admin_notes, 500), reviewed_at = now()
     where id = p_request_id;

    update public.companies
       set plan_type = v_req.plan_type,
           subscription_start = current_date,
           subscription_end = v_from + (case when v_req.plan_type = 'yearly' then 365 else 30 end),
           trial_end = current_date - 1
     where id = v_req.company_id;
  else
    update public.activation_requests
       set status = 'rejected', admin_notes = public.safe_text(p_admin_notes, 500), reviewed_at = now()
     where id = p_request_id;
  end if;

  perform public.log_activity(
    case when p_approve then 'admin.approve_request' else 'admin.reject_request' end,
    'activation_request', p_request_id::text, v_req.plan_type || ' / ' || v_req.request_kind);
end $$;

-- ---------------------------------------------------------------------------
-- 3) فعالية الشركة: نفس ترتيب الأولوية المستخدم في الواجهة
-- ---------------------------------------------------------------------------
create or replace function public.is_company_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.is_active and (
            c.plan_type = 'open'
            or (c.subscription_end is not null and c.subscription_end >= current_date)
            or (c.subscription_end is null and c.trial_end is not null and c.trial_end >= current_date)
         )
     from public.companies c
     join public.profiles p on p.company_id = c.id
     where p.id = auth.uid()),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 4) تصحيح البيانات القائمة: كل شركة على باقة غير تجريبية تُنهى تجربتها
-- ---------------------------------------------------------------------------
update public.companies
   set trial_end = least(coalesce(trial_end, current_date - 1), current_date - 1)
 where plan_type in ('open', 'monthly', 'yearly')
   and (trial_end is null or trial_end >= current_date);

-- الاشتراك المفتوح لا يحمل تاريخ انتهاء
update public.companies
   set subscription_end = null
 where plan_type = 'open' and subscription_end is not null;

-- ============================================================================
-- للتأكد بعد التنفيذ:
--   select name, plan_type, trial_end, subscription_end, is_active
--     from public.companies order by created_at desc;
--   (شركة على باقة مفتوحة يجب أن يكون trial_end فيها = الأمس أو أقدم)
-- ============================================================================
