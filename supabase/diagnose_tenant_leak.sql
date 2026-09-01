-- ============================================================================
-- تشخيص: «ظهرت بيانات عميل شركة أخرى في حسابي»
-- للقراءة فقط — لا يعدّل أي شيء. نفّذه في Supabase > SQL Editor وأرسل النتائج.
-- ============================================================================

-- (1) الأهم: هل توجد سياسة admin_full_access على جداول التشغيل؟
--     وجودها يعني أن حساب المطوّر (conta.moha@gmail.com) يرى بيانات كل الشركات
--     مدمجة مع بيانات شركته الشخصية في نفس الشاشات.
select tablename, policyname, cmd, qual
  from pg_policies
 where schemaname = 'public'
   and policyname in ('admin_full_access', 'profiles_admin', 'companies_admin')
   and tablename not in ('companies','profiles','activation_requests',
                         'support_messages','complaints','complaint_messages',
                         'app_settings','activity_logs')
 order by tablename;

-- (2) هل حسابك الحالي هو حساب المطوّر؟ وما شركته؟
select auth.uid()                    as user_id,
       auth.jwt() ->> 'email'        as email,
       public.is_admin()             as is_admin,
       public.auth_company_id()      as company_id;

-- (3) جداول تحتوي company_id لكنها بلا سياسة عزل tenant_isolation
--     (أي جدول هنا = تسريب مؤكد بين الشركات)
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname='public' and p.tablename=c.relname) as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname='public' and c.relkind='r'
   and exists (select 1 from information_schema.columns col
                where col.table_schema='public' and col.table_name=c.relname
                  and col.column_name='company_id')
   and not exists (select 1 from pg_policies p
                    where p.schemaname='public' and p.tablename=c.relname
                      and p.policyname in ('tenant_isolation','notes_tenant','year_opening_tenant'))
 order by 1;

-- (4) جداول RLS معطّل عليها أصلاً
select c.relname
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
 order by 1;

-- (5) صفوف يتيمة بلا company_id (تظهر/تختفي عشوائياً حسب السياسة)
do $orphan$
declare t text; n bigint;
begin
  for t in
    select c.relname from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace
     where nsp.nspname='public' and c.relkind='r'
       and exists (select 1 from information_schema.columns col
                    where col.table_schema='public' and col.table_name=c.relname
                      and col.column_name='company_id')
  loop
    execute format('select count(*) from public.%I where company_id is null', t) into n;
    if n > 0 then raise notice 'صفوف بلا company_id في %: %', t, n; end if;
  end loop;
end $orphan$;

-- (6) هل يوجد أكثر من ملف شخصي مرتبط بنفس الشركة؟ (مشاركة غير مقصودة)
select company_id, count(*) as profiles, string_agg(email, ', ') as emails
  from public.profiles
 where company_id is not null
 group by company_id having count(*) > 1;

-- (7) توزيع العملاء على الشركات (لتحديد أي شركة يتبعها العميل الظاهر عندك)
select company_id, count(*) as customers
  from public.customers group by company_id order by 2 desc;
