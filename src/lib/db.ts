// ترجمة أخطاء قاعدة البيانات (Supabase/PostgreSQL) الشائعة إلى رسائل عربية مفهومة.

/** هل الخطأ من صلاحيات الجدول/RLS؟ */
export function isPermissionError(msg: string): boolean {
  const m = (msg || "").toLowerCase();
  return m.includes("permission denied") || m.includes("row-level security");
}

/** ترجم الأخطاء الشائعة إلى رسائل تساعد المطوّر/المستخدم على الإصلاح. */
export function translateDbError(msg: string): string {
  const m = (msg || "").toLowerCase();

  if (m.includes("uq_profiles_one_user_per_company")) return "لا يُسمح بأكثر من مستخدم واحد لكل شركة.";
  if (m.includes("uq_customers_company_phone")) return "رقم الهاتف مسجل لعميل آخر.";
  if (m.includes("uq_customers_company_email")) return "البريد الإلكتروني مسجل لعميل آخر.";
  if (m.includes("uq_suppliers_company_phone")) return "رقم الهاتف مسجل لمورّد آخر.";
  if (m.includes("uq_suppliers_company_email")) return "البريد الإلكتروني مسجل لمورّد آخر.";
  if (m.includes("uq_companies_phone") || m.includes("uq_profiles_phone")) return "رقم الهاتف مستخدم بالفعل في حساب آخر.";
  if (m.includes("uq_companies_email") || m.includes("uq_profiles_email")) return "البريد الإلكتروني مستخدم بالفعل في حساب آخر.";

  if (isPermissionError(m)) {
    return "صلاحيات قاعدة البيانات غير مكتملة — نفّذ ملف الصلاحيات " +
      "`supabase/migration_fix_admin_rpc_grants_v21.sql` أو `supabase/migration_fix_company_updates.sql` في Supabase SQL Editor ثم أعد المحاولة.";
  }

  if ((m.includes("column") || m.includes("relation")) && m.includes("does not exist")) {
    return "قاعدة البيانات غير محدّثة (جداول أو أعمدة ناقصة) — نفّذ ملفات الترحيل في Supabase SQL Editor ثم أعد المحاولة.";
  }

  if (m.includes("save_invoice") && m.includes("function") && m.includes("does not exist")) {
    return "دالة حفظ الفواتير غير موجودة — نفّذ migration_trip_container_numbers_v17.sql ثم migration_admin_platform_tools_v18.sql ثم migration_fix_database_health_v22.sql في Supabase SQL Editor وأعد المحاولة.";
  }

  if (m.includes("function") && m.includes("does not exist")) {
    return "قاعدة البيانات غير محدّثة — نفّذ ملفات الترحيل في Supabase SQL Editor.";
  }

  return msg;
}
