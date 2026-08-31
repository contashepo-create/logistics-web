-- ============================================================================
-- بيانات المطوّر ومعلومات التطبيق (قابلة للتعديل من لوحة المطوّر /zerocold)
-- الصق هذا الملف كاملاً في Supabase Dashboard > SQL Editor > Run (آمن التكرار)
-- ============================================================================

-- جدول إعدادات عام بصف واحد (data كـ jsonb ليقبل أي حقول مستقبلية بلا ترحيل جديد)
create table if not exists public.app_settings (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- الصف الوحيد + القيم الافتراضية
insert into public.app_settings (id, data)
values (1, jsonb_build_object(
  'app_name',          'النظام المحاسبي المتكامل لشركة النقل',
  'app_version',       '2.0.0',
  'developer_name',    'محمد عبده',
  'developer_title',   'محاسب',
  'developer_country', 'مصري',
  'phone',             '00966542520544',
  'whatsapp',          '00966542520544',
  'telegram',          '00966542520544',
  'email',             '',
  'support_hours',     'يومياً من ٩ صباحاً حتى ٩ مساءً',
  'about_text',        'نظام محاسبي سحابي متكامل لشركات النقل والنولون: فواتير النقل، سندات القبض والدفع، الخزائن والبنوك، الرواتب، وتقارير الأرباح.',
  'payment_note',      'للتحويل أو الاستفسار عن الاشتراك تواصل مع المطوّر عبر واتساب أو تليجرام.',
  'copyright',         'جميع الحقوق محفوظة — محمد عبده'
))
on conflict (id) do nothing;

-- RLS: القراءة متاحة للجميع (تظهر في الصفحة التعريفية قبل تسجيل الدخول)
-- والتعديل للمطوّر فقط عبر دالة is_admin().
alter table public.app_settings enable row level security;

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to anon, authenticated using (true);

drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- دالة تحديث محمية: تدمج الحقول المرسلة فقط مع الموجودة (merge)
create or replace function public.admin_update_app_settings(p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_data jsonb;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح لك بتعديل إعدادات التطبيق';
  end if;

  insert into public.app_settings (id, data) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

  update public.app_settings
     set data = data || coalesce(p_patch, '{}'::jsonb),
         updated_at = now()
   where id = 1
   returning data into v_data;

  return v_data;
end;
$$;

grant execute on function public.admin_update_app_settings(jsonb) to authenticated;
