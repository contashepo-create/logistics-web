# 🚀 تشغيل النظام لأول مرة على Supabase — الدليل الكامل

هذا الدليل يأخذك من الصفر حتى تشغيل التطبيق كاملاً على Supabase محلياً، خطوة بخطوة، مع الكود الجاهز للنسخ.

---

## 0) المتطلبات

- حساب على [Supabase](https://supabase.com).
- Node.js 18+ (مُختبر على 22).
- حساب Telegram (اختياري لكن **مطلوب** لتفعيل 2FA للوحة المطوّر وإشعارات الاشتراك).

---

## 1) إنشاء مشروع Supabase

1. ادخل إلى [Supabase Dashboard](https://supabase.com/dashboard) → **New project**.
2. اختر اسم المشروع + كلمة مرور قوية لقاعدة البيانات + أقرب منطقة لك.
3. انتظر اكتمال التهيئة (دقيقة تقريباً).
4. من **Project Settings → API** انسخ:
   - **Project URL** (مثل `https://xxxx.supabase.co`)
   - **anon public key** (مفتاح عام مخصص للمتصفح)

> ⚠️ لا تنسخ `service_role` هنا — يبقى فارغاً إلا عند الحاجة الفعلية.

---

## 2) تشغيل مخطط قاعدة البيانات (الكود الكامل)

افتح **Supabase Dashboard → SQL Editor → New query**، ثم الصق **محتوى الملف كاملاً**:

📄 **`supabase/schema.sql`**

واضغط **Run**.

> هذا الملف (722 سطراً) هو **المخطط الكامل** ويشمل كل شيء: 18 جدولاً، دوال الصلاحيات (`is_admin`، `auth_company_id`، `is_company_active`)، حارس العزل `set_company_id`، سياسات RLS لكل جدول، القيود الفريدة على أرقام المستندات، دوال الحفظ الذري `save_invoice` / `save_payroll`، دوال المطوّر (`register_company`، `admin_*`، `export_company_data`)، ودلو تخزين `receipts`.
>
> **تثبيت جديد** = هذا الملف وحده يكفي. ملفات `migration_*.sql` مخصصة فقط للترقية من نسخ أقدم.

بعد التنفيذ الناجح، تأكد من ظهور الجداول في **Table Editor** (مثل `companies`, `invoices`, `payrolls`...).

---

## 3) إعدادات المصادقة (خطوة أمان حرجة)

1. **Project Settings → Authentication → Email**:
   - فعّل **Confirm email** (إلزامي — بدونه يمكن لأي شخص التسجيل بالبريد `conta.moha@gmail.com` وبلوغ لوحة المطوّر).
2. (اختياري) **Authentication → Providers → Email** حدّد مدة صلاحية الرابط.

> بريد المطوّر مُرمَّز في مكانين ويجب أن يظلا متطابقين:
> - `supabase/schema.sql` داخل دالة `is_admin()`
> - `src/lib/server/supabase.ts` و `src/lib/auth.ts` → `ADMIN_EMAIL = "conta.moha@gmail.com"`

---

## 4) ملف البيئة `.env.local`

أنشئ ملف باسم `.env.local` في جذر المشروع والصق فيه التالي، مع تعبئة القيم:

```bash
# ==================== Supabase (من Project Settings → API) ====================
# الأسماء المعتمدة في النشر (Vercel). يجسرها next.config.ts تلقائياً إلى
# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY وقت البناء.
NEXT_SUPABASE_URL=https://مشروعك.supabase.co
NEXT_SUPABASE_ANON_KEY=المفتاح-العام-anon-الخاص-بك

# ==================== تليجرام (أسرار — لا تُنشر أبداً) ====================
# أنشئ البوت من @BotFather ثم انسخ التوكن هنا
TELEGRAM_BOT_TOKEN=123456789:YOUR_BOT_TOKEN
# معرّف دردشة المطوّر (احصل عليه من @userinfobot)
TELEGRAM_ADMIN_CHAT_ID=123456789
# دردشة احتياطية (اختياري)
TELEGRAM_BACKUP_CHAT_ID=

# سر توقيع جلسة 2FA للوحة المطوّر — أنشئه بالأمر التالي:
#   openssl rand -hex 32
ADMIN_2FA_SECRET=

# اختياري: مفتاح service_role (اتركه فارغاً ما لم تحتجه فعلاً)
SUPABASE_SERVICE_ROLE_KEY=
```

**لتوليد سر 2FA:**
```bash
openssl rand -hex 32
```

> الملف `.env.local` مُستثنى من Git (`.gitignore`) — لن يُرفع مع الكود.

---

## 5) إعداد بوت تليجرام (لـ 2FA وإشعارات الاشتراك)

1. من Telegram افتح **@BotFather** → `/newbot` → انسخ **التوكن** إلى `TELEGRAM_BOT_TOKEN`.
2. افتح **@userinfobot** وأرسل `/start` → انسخ رقم **id** إلى `TELEGRAM_ADMIN_CHAT_ID`.
3. أرسل رسالة أولى من حسابك للبوت الجديد (حتى يسمح Telegram للبوت بالرد عليك).

---

## 6) التثبيت والتشغيل محلياً

```bash
cd logistics-web

# تثبيت الحزم
npm install

# تشغيل في وضع التطوير
npm run dev
```

افتح المتصفح على `http://localhost:3000`.

### البناء للإنتاج
```bash
npm run build
npm start
```

---

## 7) بيانات تجريبية (اختياري)

```bash
npm run seed
```

> يملأ بيانات واقعية (عملاء/فواتير/سندات/رواتب) في شركة تجريبية معزولة.
> **ملاحظة:** السكربت يحتاج تعطيل «Confirm email» أو تأكيد البريد `demo@example.com` أولاً (انظر التعليقات داخل `scripts/seed.mjs`). **لا** تعطّل تأكيد البريد في الإنتاج — افعل ذلك فقط في بيئة تجريبية ثم أعد تفعيله.

---

## 8) أول تسجيل دخول

### المطوّر (أنت)
1. من صفحة `/register` سجّل حساباً بالبريد **`conta.moha@gmail.com`** (يجب تأكيد البريد).
2. سيُعاد توجيهك تلقائياً إلى لوحة المطوّر `/admin` (لأن بريدك = `ADMIN_EMAIL`).
3. أول مرة سيتطلب **رمز 2FA** يُرسل إلى تليجرام — أدخله ثم تُفتح اللوحة.

### العميل العادي
1. `/register` → أنشئ حساباً بأي بريد آخر.
2. صفحة تأسيس الشركة `/onboarding` → أدخل اسم الشركة.
3. يحصل على **تجربة مجانية 7 أيام**، ثم بعد انتهائها يُحوَّل إلى صفحة الاشتراك لطلب الاشتراك من المطوّر.

---

## 9) قائمة تحقق قبل الإنتاج

| البند | الحالة |
|---|---|
| تنفيذ `supabase/schema.sql` بنجاح | ☐ |
| تفعيل **Confirm email** في Supabase | ☐ |
| تعبئة `.env.local` (URL + anon + توكن تليجرام + `ADMIN_2FA_SECRET`) | ☐ |
| بوت تليجرام يعمل (رمز 2FA يصل) | ☐ |
| `npm run dev` يعمل و `/register` تسجّل بنجاح | ☐ |
| `npm run test` → 51 اختباراً أخضر | ☐ |

---

## استكشاف الأخطاء الشائعة

- **«supabaseUrl is required»:** تأكد من وجود `NEXT_SUPABASE_URL` و`NEXT_SUPABASE_ANON_KEY` (أو نسختيهما بالبادئة `NEXT_PUBLIC_`) في `.env.local` أو في متغيّرات بيئة Vercel، **ولكل البيئات** (Production + Preview)، ثم أعد النشر — القيم تُحقن وقت البناء وليس وقت التشغيل.
- **2FA لا يصل إلى تليجرام:** تأكد من التوكن/chat_id، ومن أنك أرسلت رسالة أولى للبوت، ومن وصول الخادم إلى `api.telegram.org`.
- **العميل لا يستطيع التسجيل بعد إغلاق سنة:** تأكد من وجود سنة مالية **مفتوحة** تشمل التاريخ قبل تسجيل أي حركة.
- **خطأ `23505` (رقم مكرر):** لا يحدث عادةً — النظام يعيد المحاولة تلقائياً، والقيود الفريدة تحميه.

## ترقية قاعدة قديمة من user_id إلى company_id

- لا تستخدم `migration_company_id.sql` على قاعدة موجودة إلا بعد أخذ نسخة احتياطية.
- الملف أصبح قابلاً لإعادة التشغيل: لا ينشئ شركة جديدة إذا كان `profiles.company_id` موجوداً.
- إذا تم تشغيل النسخة القديمة وظهرت بيانات عميل داخل حساب آخر أو اختفت من صاحبها، نفّذ مرة واحدة:
  `supabase/migration_repair_tenant_data.sql`
  لإعادة ربط كل سجل بـ `profiles.company_id` المطابق لـ `user_id`.
- إذا كان `user_id` قد حُذف من الجداول أو حُذفت الشركات القديمة، لا تحاول التخمين؛ استرجع نسخة احتياطية أولاً.

## تحديث SaaS + التحصين الأمني (v2)

1. نفّذ في Supabase SQL Editor بالترتيب:
   - `supabase/migration_employee_salary.sql`
   - `supabase/migration_saas_security_v2.sql`
2. تأكد من وجود متغيّر البيئة `SUPABASE_SERVICE_ROLE_KEY` على Vercel (تحتاجه صفحة الشكاوى العامة).
3. للتحقق من عزل الشركات بعد الترحيل، شغّل في SQL Editor:
   ```sql
   select * from public.rls_audit();  -- يجب أن تكون النتيجة فارغة
   ```
4. الأسعار: شهري 100 ج.م، سنوي 1000 ج.م (بخصم 200)، غير شاملة ض.ق.م 14%، والتجربة 7 أيام.
5. لا يوجد أي رفع صور على الموقع؛ صورة الوصل تُمرَّر إلى تليجرام المطوّر ولا تُخزَّن (دلو `receipts` صار مغلقاً).

## إصلاحات ما بعد النشر (v3) — مهم

1. **نفّذ في Supabase SQL Editor**: `supabase/migration_fix_grants_v3.sql`
   (يعيد صلاحية القراءة العامة لـ `app_settings` بعد التشديد، ويمنح `execute` لدوال التسجيل،
   ويضيف دالة تشخيص `select * from public.whoami();`).
   بدونه: الزوار يحصلون على **401** عند `GET /rest/v1/app_settings`.
2. **بريد المطوّر** أصبح قابلاً للضبط بمتغيّر البيئة `ADMIN_EMAIL` (أو `NEXT_PUBLIC_ADMIN_EMAIL`).
   الافتراضي `conta.moha@gmail.com`. إن دخلت بلوحة `/zerocold` ببريد آخر ستظهر شاشة
   «غير مصرح بالدخول» موضِّحة البريد الحالي بدل تحويل صامت.
3. **الكوكيز**: كوكي 2FA يستخدم في الإنتاج البادئة `__Host-admin_2fa`
   (httpOnly + Secure + SameSite=Strict + Path=/ + بلا Domain، صلاحية 12 ساعة)،
   وكل مسار يغيّر حالة يفحص الأصل (CSRF). تسجيل الخروج من اللوحة يمسح الكوكي عبر
   `POST /api/zerocold/2fa/logout`.
4. **التوكينز**: جلسة Supabase في المتصفح تُرسَل يدوياً كـ `Authorization: Bearer`
   عبر `authFetch`؛ لا مسار API يعتمد على الكوكي وحده للهوية.

## v4 — تصحيح حالة الاشتراك

نفّذ `supabase/migration_subscription_state_v4.sql` بعد v3.
يُنهي التجربة تلقائياً عند أي باقة غير تجريبية (كان العميل يظهر «تجريبي» رغم فتح
اشتراكه)، ويصحّح بيانات الشركات القائمة، ويوحّد أولوية الحالة:
موقوف ← مفتوح ← مدفوع ساري ← تجربة ← منتهي.

## v5 — خصوصية بيانات العملاء

نفّذ `supabase/migration_admin_privacy_v5.sql`.
يحذف سياسة `admin_full_access` عن كل جداول التشغيل (الفواتير، النقلات، السندات،
العملاء، الرواتب…) فلا يستطيع المطوّر الاطّلاع عليها إطلاقاً، ويُبقي وصوله على:
`companies, profiles, activation_requests, support_messages, complaints,
complaint_messages, app_settings, activity_logs` فقط.
كما أُزيلت من الواجهة كل عناصر عرض ملخّص بيانات العميل التشغيلية.

## v6 — البيانات الضريبية والعنوان الوطني

نفّذ `supabase/migration_tax_address_v6.sql`.
يضيف للمنشأة والعملاء: الرقم الضريبي (15 رقماً)، السجل التجاري (10)، الرقم الموحّد،
نوع الجهة، الحالة الضريبية، والعنوان الوطني (الدولة/المنطقة/المدينة/الحي/الشارع/
رقم المبنى/الرمز البريدي/الرقم الإضافي)، مع تحقّق على مستوى قاعدة البيانات.
تُدخل بيانات المنشأة من «الإعدادات ← بيانات الشركة»، وبيانات العميل من نافذة العميل.

## v7 — الموردون والمشتريات وفاتورة زاتكا

نفّذ `supabase/migration_suppliers_v7.sql` بعد v6.

يضيف:
- جداول `suppliers` و`purchase_invoices` و`purchase_items` مع RLS وعزل `company_id`.
- عمودَي `supplier_id` و`purchase_invoice_id` في `payment_vouchers`، وتوسيع
  `voucher_type` بالنوع `'supplier'` (سداد لمورّد).
- الدالة `save_purchase_invoice(...)` للحفظ الذرّي للفاتورة وبنودها مع ترقيم تلقائي
  لكل شركة، وحارس `guard_supplier_delete` يمنع حذف مورّد له حركة.

الشاشات الجديدة: **الموردون**، **فواتير المشتريات**، **كشف حساب مورّد**،
**أعمار ديون الموردين** (شرائح 0–30 / 31–60 / 61–90 / أكثر من 90 بتوزيع FIFO للسداد).

### فاتورة زاتكا
تطبع فاتورة العميل الآن وفق متطلبات المرحلة الأولى للفوترة الإلكترونية (السعودية):
- رمز QR بصيغة TLV مرمّزة Base64 (اسم البائع، الرقم الضريبي، الطابع الزمني ISO 8601،
  الإجمالي شامل الضريبة، مبلغ الضريبة) — `src/lib/zatca.ts`.
- تمييز تلقائي بين **فاتورة ضريبية** (المشتري خاضع وله رقم ضريبي من 15 رقماً)
  و**فاتورة ضريبية مبسّطة**.
- حقول ثنائية اللغة عربي/إنجليزي في الترويسة والبنود والإجماليات، بالريال السعودي
  ونسبة الضريبة المضبوطة في الإعدادات (15% افتراضياً).
- تنبيه أحمر على الفاتورة يسرد أي بيانات إلزامية ناقصة قبل الاعتماد.

تأكد من تعبئة الرقم الضريبي والعنوان الوطني للمنشأة من «الإعدادات ← بيانات الشركة»،
وإلا ظهر التنبيه على المطبوعة.

## إصلاح «permission denied for table companies» عند حفظ الإعدادات

إذا ظهرت هذه الرسالة عند حفظ بيانات الشركة أو إعدادات الطباعة، فتأكد من أن المالك
لديه صلاحية التحديث على كل أعمدة الإعدادات التشغيلية في جدول `companies` وليس فقط
`(name, phone, address, currency, vat_rate, vat_note)`.

نفّذ مرة واحدة وأعد المحاولة:

📄 **`supabase/migration_fix_company_updates.sql`**

الملف يضيف الأعمدة الناقصة (البيانات الضريبية، العنوان الوطني، `print_settings`) ثم
يمنح `authenticated` صلاحية تحديث أعمدة الإعدادات التشغيلية فقط، ويُبقي أعمدة
الاشتراك والحالة و`client_code` تحت إشراف المطوّر (`service_role` / `is_admin`).

## v8 — معالجة تنبيهات مدقّق أمان Supabase

نفّذ `supabase/migration_linter_hardening_v8.sql` بعد v7 (آمن التكرار).

يعالج تنبيهات Database Linter:
- **0011 search_path متغيّر**: يثبّت `search_path = public, pg_temp` لكل دوال المخطط
  `public` (بما فيها `is_admin`, `safe_text`, `set_company_id`, `gen_code`,
  `is_allowed_email`, `check_tax_identifiers`, `set_profile_guard`،
  `clean_activation_request`, `guard_supplier_delete`, `set_client_code`).
  كما حُدِّثت ملفات الترحيل الأصلية حتى لا يعود التنبيه عند إعادة تنفيذها.
- **0025 دلو عام يسمح بالسرد**: تُحذف سياسة `receipts_read_public` على
  `storage.objects`. الدلو عام، لذا روابط الملفات تبقى تعمل، لكن لم يعد بإمكان
  أي عميل سرد محتويات الدلو.
- **0028 / 0029 دوال SECURITY DEFINER مكشوفة**: سحب `EXECUTE` من `public/anon/authenticated`
  عن كل الدوال، ثم منحه فقط لِـ:
  - `anon`: `is_allowed_email` (تحقق البريد قبل التسجيل).
  - `authenticated`: دوال RPC التي تستدعيها الواجهة فعلاً
    (`register_company`, `export_company_data`, `create_next_financial_year`,
    `save_invoice`, `save_payroll`, `save_purchase_invoice`, ودوال `admin_*`، `whoami`).
  - دوال الـ trigger والدوال الداخلية (`auth_company_id`, `is_company_active`,
    `is_active_user`, `log_activity`, `rls_audit`, `gen_code`, `safe_text`)
    لم تعد قابلة للاستدعاء عبر REST؛ تعمل داخلياً عبر السياسات والمشغّلات.

### إعداد يدوي مطلوب (لا يُضبط بـ SQL)
**حماية كلمات المرور المسرّبة**: من Supabase Dashboard →
Authentication → Policies (Password) → فعّل *Leaked password protection*
(فحص HaveIBeenPwned)، ويُنصح بحدّ أدنى 8 محارف مع شروط تعقيد.

## v9 — إصلاح عاجل: ظهور بيانات شركة أخرى داخل الحساب

**السبب الجذري:** كانت `schema.sql` و`migration_company_id.sql` و`migration_auth_vat.sql`
تنشئ على كل جداول التشغيل سياسة ثانية باسم `admin_full_access`:

```sql
create policy admin_full_access on public.<table> for all
  using (public.is_admin()) with check (public.is_admin());
```

سياسات RLS في PostgreSQL **تُجمَع بـ OR**، فالصف يظهر إذا حقّق أي سياسة. لذلك على
حساب المطوّر (`conta.moha@gmail.com`) كان الشرط `company_id = auth_company_id()`
يُتجاوز، وتظهر بيانات **كل الشركات** مدمجة داخل الشاشات العادية (العملاء، الفواتير،
السندات…) وكأنها بيانات شركته.

كان `migration_admin_privacy_v5.sql` يحذف هذه السياسات، لكن إعادة تشغيل أي ملف أقدم
(`schema.sql` مثلاً بعد v5) يعيد إنشاءها فيعود التسريب.

### الخطوات
1. **التشخيص أولاً** — نفّذ `supabase/diagnose_tenant_leak.sql` (قراءة فقط).
   استعلام (1) يؤكد وجود `admin_full_access`؛ (2) يبيّن هل حسابك هو حساب المطوّر؛
   (3) يكشف أي جدول فيه `company_id` بلا سياسة عزل؛ (5) يكشف صفوفاً بلا `company_id`؛
   (6) يكشف وجود أكثر من مستخدم مرتبط بنفس الشركة.
2. **الإصلاح** — نفّذ `supabase/fix_tenant_leak_v9.sql` (آمن التكرار، داخل transaction):
   - يحذف `admin_full_access` وأي سياسة إدارية أخرى من جداول التشغيل.
   - يعيد بناء `tenant_isolation` على **كل** جدول فيه `company_id`
     (بما فيها `suppliers`, `purchase_invoices`, `purchase_items`,
     `credit_debit_notes`, `year_opening_balances`) مع
     `force row level security` و`to authenticated` وشرط `company_id is not null`.
   - يحذف أي سياسة مكرّرة أخرى على تلك الجداول (منعاً لتجميع OR).
   - يعيد ربط حارس `set_company_id` قبل الإدراج.
   - يفرض `company_id NOT NULL` حيث لا توجد صفوف يتيمة.
3. بعد التنفيذ سجّل خروجاً ثم دخولاً (يوجد كاش هوية 60 ثانية في المتصفح).

**تم التأكيد على قاعدتك الفعلية:** الاستعلام (1) أرجع 14 جدول تشغيل عليها
`admin_full_access ... using (is_admin())` — وهذا هو السبب المؤكد.
والاستعلام (7) يُظهر شركتين مختلفتين لكل منهما عميل واحد، فكان حساب المطوّر
يرى العميلين معاً في شاشة واحدة.

### أثر جانبي عولج مع الإصلاح
`adminStats()` في `src/lib/admin.ts` كانت تَعُدّ صفوف
`customers/invoices/receipt_vouchers/...` مباشرة، وهو ما كان ينجح **فقط** بفضل
الثغرة. بعد إغلاقها كانت ستعرض أصفاراً. لذلك:
- أضاف `fix_tenant_leak_v9.sql` دالة `admin_platform_stats()`
  (SECURITY DEFINER + فحص `is_admin()`) تُرجع **أرقاماً مجمّعة فقط** — أعداداً
  ومجاميع لا تكشف أي صف أو تفصيل تشغيلي لأي عميل.
- حُدّثت `adminStats()` لتستدعيها عبر RPC بدل قراءة الجداول، مع اختبارين
  يضمنان أنها لا تلمس الجداول مباشرة أبداً.

> بيانات العميل الآخر لم تُنسخ إلى شركتك — كانت تُقرأ فقط عبر السياسة المتساهلة.
> إن ظهرت صفوف بلا `company_id` في الاستعلام (5) فراجعها يدوياً قبل فرض NOT NULL،
> ولا تدمج شركات بالتخمين (انظر `migration_repair_tenant_data.sql`).

### احتمال ثانٍ (إن لم يكن حسابك حساب المطوّر)
استعلاما (3) و(6) في ملف التشخيص يغطّيانه: جدول جديد بلا `tenant_isolation`،
أو ملفّان شخصيان مرتبطان بنفس `company_id`.

## v10 — إصلاح عاجل: 403 على companies وحلقة «أنشئ شركة جديدة»

**السبب: خطأ في `migration_linter_hardening_v8.sql`.**

v8 سحبت `EXECUTE` من الدور `authenticated` عن دوال SECURITY DEFINER الداخلية
اعتماداً على افتراض خاطئ بأنها «لا تُستدعى عبر REST». الحقيقة أن **تعبيرات
سياسات RLS تُقيَّم بصلاحيات الدور المستدعي** (`authenticated`) لا بصلاحيات مالك
الجدول. فحين فقد الدور صلاحية تنفيذ:

```
auth_company_id() · is_company_active() · is_admin() · is_active_user()
```

صارت كل سياسة تستدعيها ترمي `permission denied for function`، فأعاد PostgREST
**403** على `companies` وعلى كل جداول التشغيل.

**كيف تحوّل ذلك إلى حلقة لا نهائية:** `getCompany()` كانت تتجاهل حقل `error`
وتُرجع `null`، و`AppLayout` يقرأ `null` على أنه «لا توجد شركة» فيحوّل إلى
`/onboarding`. المستخدم ينشئ شركة، و`register_company` تنجح فعلاً لأنها
SECURITY DEFINER وتعمل بصلاحيات مالكها — لكن القراءة التالية تفشل بـ 403 مجدداً
فيعود إلى `/onboarding`. النتيجة: شركات مكرّرة وحلقة لا تنتهي.

### الخطوات
1. نفّذ `supabase/fix_policy_functions_v10.sql` — يعيد `EXECUTE` للدوال الأربع
   وللمساعدات التي تستدعيها المُشغّلات (`safe_text`, `is_allowed_email`,
   `gen_code`, `log_activity`)، ويتحقق من سياسات `companies`/`profiles`.
2. سجّل خروجاً ثم دخولاً.
3. **راجع الشركات المكرّرة** التي أُنشئت أثناء الحلقة:
   ```sql
   select c.id, c.name, c.created_at,
          (select count(*) from public.customers x where x.company_id = c.id) as customers
     from public.companies c order by c.created_at desc;
   ```
   احذف الفارغة عبر لوحة المطوّر أو `admin_delete_company(id)` — **لا تحذف أي
   شركة عليها بيانات.** ملفك الشخصي مرتبط بشركة واحدة فقط
   (`select company_id from public.profiles where id = auth.uid()`).

> **ملاحظة أمنية:** إعادة هذه الصلاحيات لا تفتح أي ثغرة. الدوال لا تكشف بيانات —
> كلها تُرجع قيمة عن المستخدم المتصل نفسه (معرّف شركته، هل هو مطوّر، هل اشتراكه
> فعّال). تنبيهات المدقّق 0028/0029 عليها **مقبولة ومقصودة** لأنها شرط تشغيل RLS.
> العزل الفعلي تفرضه سياسات `tenant_isolation` وليس حجب هذه الدوال.

### تحصين الواجهة (حتى لا تتكرر الحلقة أبداً)
- `getProfile()` و`getCompany()` صارتا **ترميان** عند خطأ الاستعلام بدل ابتلاعه.
- `AppLayout` وصفحة `/onboarding` تميّزان «لا توجد شركة» عن «فشل الطلب»، وتعرضان
  شاشة خطأ واضحة مع «إعادة المحاولة» و«تسجيل الخروج» بدل إعادة التوجيه في حلقة.
- صفحة `/onboarding` تحذّر صراحة من إنشاء شركة قبل حلّ المشكلة.
- 3 اختبارات انحدار جديدة تضمن عدم عودة السلوك (المجموع 389 اختباراً).

---

## v11 — المميزات الإضافية والمستخدم الإضافي

لترقية قاعدة بيانات موجودة نفّذ:

`supabase/migration_extra_features_users_v11.sql`

ثم اضبط `SUPABASE_SERVICE_ROLE_KEY` ضمن أسرار **الخادم فقط** وأعد النشر؛ يحتاجه
إنشاء المستخدم المؤكد عبر Supabase Auth Admin API. لا تضع المفتاح في متغيّر يبدأ
بـ `NEXT_PUBLIC_`. راجع `docs/extra-features.md` للتفاصيل.

بعد الترحيل تبقى كل المميزات متوقفة لجميع الشركات إلى أن يفعّلها المطوّر من
صفحة **لوحة المطوّر ← مميزات إضافية**.

---

## v12 — كمية وسعر وحدة سند الصرف

بعد v11 نفّذ:

`supabase/migration_payment_voucher_quantity_v12.sql`

تضيف الترحيلة `quantity` و`unit_amount` إلى سندات الصرف، وتحوّل السجلات القديمة
تلقائياً إلى وحدة واحدة (`quantity = 1`) مع إبقاء إجماليها السابق كما هو. كما
تضيف حارساً في قاعدة البيانات يضمن دائماً أن `amount = quantity × unit_amount`.

---

## v13 — التسجيل الإلزامي والتحقق الشامل

بعد v12 نفّذ:

`supabase/migration_registration_validation_v13.sql`

هذه الترحيلة مطلوبة قبل نشر واجهة التسجيل الجديدة، وتقوم بالآتي:
- تستبدل مسار التسجيل القديم بـ `register_company_with_year`، فيُنشئ الشركة
  والملف الشخصي والسنة المالية المفتوحة داخل **معاملة واحدة**؛ لا يمكن أن يبقى
  ملف شركة بلا سنة مالية.
- تجعل اسم المسؤول وعنوانه وهاتفه بيانات تسجيل مطلوبة، وتتحقق خادمياً من القيم
  الوهمية ومن صحة نطاق السنة المالية.
- تطبّع البريد والهاتف وتمنع تكرارهما بين الحسابات، وتمنع تكرار بريد/هاتف العميل
  أو المورد داخل الشركة نفسها، مع فهارس فريدة عندما تسمح البيانات التاريخية.
- تضيف حراس PostgreSQL للنصوص والأنواع والحدود الرقمية والتواريخ وJSON، وتفرض أن
  الحركات الجديدة تقع داخل سنة مالية مفتوحة حتى لو تم تجاوز الواجهة.

> الترحيلة لا تحذف التكرارات أو القيم القديمة. القيود الرقمية تستخدم `NOT VALID`
> فتحمي كل كتابة جديدة دون تعطيل النشر بسبب سجل تاريخي يحتاج مراجعة. إذا وُجد
> تكرار قديم يتعذر معه إنشاء فهرس فريد، يبقى مشغّل قاعدة البيانات مانعاً للتكرار
> الجديد، ثم تُراجع السجلات القديمة يدوياً قبل إنشاء الفهرس لاحقاً.

قبل التنفيذ على الإنتاج خذ نسخة احتياطية، وشغّل الترحيلة أولاً على نسخة تجريبية
من قاعدة البيانات. بعد التنفيذ تحقّق من الدالة والحراس والفهارس (قد تتجاوز
الترحيلة إنشاء فهرس بعينه إذا وجدت تكراراً تاريخياً يحتاج معالجة يدوية):

```sql
select to_regprocedure('public.register_company_with_year(text,text,text,text,date,date)');
select tgname from pg_trigger
 where not tgisinternal
   and tgname in ('trg_auth_users_signup_metadata','trg_companies_unique_contact',
                  'trg_guard_company_print_settings','trg_guard_app_settings_json');
select indexname from pg_indexes
 where schemaname = 'public' and indexname like 'uq_%_normalized';
```

---

## v14 — المشتريات النقدية المباشرة وتوجيه المصروف

بعد v13 نفّذ:

`supabase/migration_cash_purchases_advances_v14.sql`

تضيف الترحيلة ما يلي:
- فاتورة مشتريات **نقدية** بلا مورّد، تُدفع فوراً من خزينة أو بنك، مع إنشاء سند دفع آلي ذري بقيمة الإجمالي شاملاً VAT.
- الإبقاء على المشتريات **الآجلة** مرتبطة بمورّد، ومنع خلط مساري النقدي والآجل بقيود ومشغّلات قاعدة البيانات.
- اختيار بند الأرباح والخسائر لكل فاتورة، وربط الفاتورة بسيارة اختيارياً؛ يُحتسب المصروف بصافي المشتريات قبل ضريبة المدخلات، ولا يُكرر سند الدفع الآلي المصروف.
- حماية سند الشراء الآلي من التعديل أو الحذف منفرداً؛ تحديثه وحذفه يتمان فقط مع فاتورة المشتريات داخل RPC ذري.
- التحقق من السنة المالية المفتوحة، وعزل الشركة للمورّد والحساب والسيارة، وكفاية رصيد الخزينة/البنك قبل الحفظ.

الترحيلة آمنة لإعادة التشغيل. خذ نسخة احتياطية، وشغّلها أولاً على نسخة تجريبية، ثم تحقق من الدالتين والفهرس:

```sql
select to_regprocedure(
  'public.save_purchase_invoice_v14(bigint,date,text,bigint,text,text,bigint,text,bigint,double precision,boolean,text,jsonb)'
);
select to_regprocedure('public.delete_purchase_invoice_v14(bigint)');
select indexname from pg_indexes
 where schemaname = 'public'
   and indexname in ('uq_payment_one_cash_purchase', 'uq_purchase_invoices_company_number');
```

> سند الدفع من النوع `purchase` داخلي وآلي، لذلك لا يظهر ضمن سندات الدفع اليدوية. تابع الفاتورة والسند الناتج عنها من شاشة **المشتريات**.

---

## v15 — إصلاح رفض سندات الدفع والقبض داخل السنة المفتوحة

بعد v14 نفّذ:

`supabase/migration_fix_voucher_open_year_v15.sql`

تعالج هذه الترحيلة رفض سند جديد برسالة «خارج نطاق أي سنة مالية مفتوحة» رغم أن
تاريخه داخل السنة. كان حارس السنة يعمل قبل مشغّل تعيين `company_id` عند الإدراج
المباشر لسندات الدفع والقبض، فيفحص السنة باستخدام شركة فارغة. أصبح الحارس الآن
يستخرج شركة الجلسة الموثوقة أولاً، يفرضها على الصف، ثم يتحقق من نطاق التاريخ.

الترحيلة آمنة لإعادة التشغيل ولا تعدّل أي سندات أو أرصدة قائمة. بعد تنفيذها تحقق
من تحديث الدالة:

```sql
select pg_get_functiondef('public.guard_movement_open_year()'::regprocedure);
```

يجب أن يظهر داخلها `v_company_id := public.auth_company_id()` وأن تتم مقارنة
`financial_years.company_id` مع `v_company_id`.

---

## v16 — إشعار دائن بمرتجع نقلة من فاتورة العميل

بعد v15 نفّذ:

`supabase/migration_credit_note_trip_returns_v16.sql`

تضيف هذه الترحيلة اختيار نقلة أو أكثر من الفاتورة عند إصدار الإشعار الدائن. قيمة
الإشعار ونسبة الضريبة تُقرأان خادمياً من النقلات والفاتورة داخل معاملة واحدة، ولا
يمكن للمتصفح تغييرهما. كما تمنع إصدار مرتجع ثانٍ للنقلة نفسها؛ حذف الإشعار يعيد
إتاحة النقلة للاختيار بفضل الحذف المتسلسل لروابطها.

الترحيلة لا تغيّر مبالغ الفواتير الأصلية أو السندات القائمة. يبقى المستند الأصلي
ثابتاً، ويظهر التخفيض في رصيد الفاتورة والعميل والتقارير من خلال الإشعار الدائن.
للتحقق بعد التنفيذ:

```sql
select to_regclass('public.credit_note_trips');
select to_regprocedure('public.save_credit_note_for_trips_v16(bigint,date,text,bigint[])');
select indexname from pg_indexes
 where schemaname = 'public'
   and indexname = 'uq_credit_note_trips_one_return_per_trip';
```

---

## v17 — أرقام حاويات متعددة لكل نقلة

بعد v16 نفّذ:

`supabase/migration_trip_container_numbers_v17.sql`

تضيف هذه الترحيلة حقل `container_numbers` إلى كل سجل في `invoice_trips`. لكل نقلة
قائمتها المستقلة، ولا يمكن أن يزيد عدد أرقامها على قيمة `qty` الخاصة بها. تتحقق
قاعدة البيانات أيضاً من أن القيم نصية وغير فارغة وغير مكررة، وتعيد دالة
`save_invoice` التحقق من عدم تكرار الرقم بين جميع نقلات الفاتورة قبل حفظ الرأس
والنقلات والأرقام في معاملة واحدة.

القيمة الافتراضية للنقلات السابقة قائمة فارغة، لذلك لا تتغير مبالغ أو بيانات
الفواتير القائمة. الترحيلة آمنة لإعادة التشغيل. للتحقق بعد التنفيذ:

```sql
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'invoice_trips'
   and column_name = 'container_numbers';
select conname from pg_constraint
 where conrelid = 'public.invoice_trips'::regclass
   and conname = 'invoice_trips_container_numbers_valid';
select to_regprocedure(
  'public.save_invoice(bigint,date,bigint,double precision,text,jsonb,jsonb,text)'
);
```

---

## v18 — أدوات منصة المطوّر، تشخيص Supabase، والزوار الفريدون

بعد v17 نفّذ في **Supabase SQL Editor**:

`supabase/migration_admin_platform_tools_v18.sql`

> خذ نسخة احتياطية قبل الترحيل واختبره أولاً على مشروع تجريبي، خصوصاً قبل استخدام
> زر «تصفير البيانات». الترحيلة نفسها لا تحذف بيانات أي شركة؛ الحذف لا يبدأ إلا
> من لوحة المطوّر بعد جلسة 2FA وإعادة إدخال كلمة مرور المطوّر واسم الشركة.

تضيف الترحيلة:
- RPC ذرّية لتصفير بيانات العمل لشركة واحدة مع إبقاء الشركة وحساباتها واشتراكها
  ومميزاتها وطلبات التفعيل ورسائل الدعم والشكاوى، ثم إنشاء سنة مالية حالية فارغة.
- RPC محمية لصفحة المميزات، فتحل خطأ `permission denied for table companies`
  من دون فتح جداول أعمال العملاء للمطوّر.
- مؤشرات إدارة المنصة والزوار فقط، بلا فواتير العملاء أو مبالغهم.
- تشخيص وجود الجداول وRLS والسياسات والدوال من دون قراءة محتوى الجداول أو أعداد صفوفها.
- جدول زوار لا يستقبل كتابة مباشرة من المتصفح؛ يُخزّن HMAC لمعرّف Cookie لا
  المعرّف الخام. الانتقال داخل التطبيق لا ينشئ زائراً جديداً.
- سياسة تجعل سجل النشاط المرئي مقصوراً على أفعال حساب المطوّر الحالي.

تحتاج مسارات تعديل حساب العميل وتسجيل الزيارة إلى المتغير الخادمي الموجود:

```env
SUPABASE_SERVICE_ROLE_KEY=...
```

ويُنصح بشدة بإضافة سر مستقل طويل (32 بايت عشوائية أو أكثر) لتجزئة معرّفات الزوار:

```env
VISITOR_HASH_SECRET=replace-with-a-long-random-secret
```

عند غيابه يُستخدم `SUPABASE_SERVICE_ROLE_KEY` لاشتقاق التجزئة، ولا يخرج أي منهما
إلى المتصفح. تحديد الموقع تقريبي فقط من رؤوس Vercel/Cloudflare إذا كانت متاحة؛
لا يستخدم النظام GPS أو خدمة تحديد موقع خارجية.

للتحقق بعد التنفيذ:

```sql
select to_regclass('public.site_visitors');
select to_regprocedure('public.admin_reset_company_data_v18(uuid)');
select to_regprocedure('public.admin_get_company_extras_v18(uuid)');
select to_regprocedure('public.admin_platform_stats_v18()');
select to_regprocedure('public.admin_recent_visitors_v18(integer)');
select to_regprocedure('public.admin_database_health_v18()');
select to_regprocedure(
  'public.record_site_visit_v18(text,text,text,text,text,text,text,text,text,text,text)'
);
select policyname, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'activity_logs';
```

بعد النشر افتح **لوحة المطوّر ← صحة Supabase**. يجب أن يظهر الاتصال ناجحاً،
والجداول موجودة وRLS مفعلاً، والدوال الأساسية بعلامة نجاح. صفحة التشخيص لا تعرض
صفوف العملاء أو أعدادها.

---

## v21 — إصلاح «permission denied for function admin_reset_company_data_v18» عند تصفير شركة

### السبب

رسالة `permission denied for function …` عند الضغط على «تصفير البيانات» لا تعني
خطأ في كود الدالة — الدالة ومنحها في ملفات الترحيل سليمة. تعني أن صلاحية تنفيذ
الوظيفة (`EXECUTE`) للدور `authenticated` **ناقصة في قاعدة البيانات الفعلية**،
والدور `authenticated` هو ما يستخدمه التطبيق عند استدعاء RPC بجلسة المطوّر
(JWT)، بينما يعمل SQL Editor بحساب المالك فيبدو الكود «سليماً».

أشهر سبب للنقص: `migration_linter_hardening_v8.sql` يسحب `EXECUTE` من
`authenticated` عن **كل** دوال `public` ثم يعيده من قائمة كُتبت وقت إصداره.
أي إعادة تشغيل له على قاعدة تحتوي دوال أحدث (v14/v16/v18/v20) تُفقد هذه الدوال
صلاحيتها — ومنها `admin_reset_company_data_v18`.

### الحل

نفّذ في Supabase SQL Editor:

📄 **`supabase/migration_fix_admin_rpc_grants_v21.sql`**

الملف يعيد ضبط صلاحيات `EXECUTE` بالكامل بقوائم محدَّثة (اسم الدالة لا توقيعها)،
ويضمن ملكية دوال المطوّر لدور مالك الجداول، ويُبقي المنع قائماً عن `anon`
والدوال الداخلية. آمن التكرار.

> إن كانت الدالة نفسها غير موجودة أصلاً (رسالة `function does not exist`):
> نفّذ أولاً `supabase/migration_admin_platform_tools_v18.sql` ثم أعِد تشغيل v21.

للتحقق بعد التنفيذ — يجب أن يعيد صفاً بـ `authenticated_ok = true`:

```sql
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'admin_reset_company_data_v18';
```

ثم أعد المحاولة من لوحة المطوّر ← الشركات ← «تصفير البيانات».

### ملاحظة لمنع تكرار المشكلة

`supabase/migration_linter_hardening_v8.sql` حُدِّثت قوائمه لتشمل دوال v14–v20
(راجع `migration_fix_admin_rpc_grants_v21.sql`)، فلا تعِد تشغيل نسخة قديمة منه
بعد تطبيق v21.
