// طبقة لوحة المطوّر: إدارة الشركات والاشتراكات والإحصاءات وسجل النشاط.
// كل دوال التعديل تمر عبر دوال خادمية محمية (SECURITY DEFINER + فحص is_admin).

import { supabase } from "./supabase";
import type { Company, Profile } from "./types";
import type { ActivationRequest } from "./subscription";
import { num } from "./calc";

/** شركة مع بيانات مالكها (للوحة المطوّر). */
export interface CompanyRow extends Company {
  owner_name: string;
  owner_email: string;
}

/** قائمة كل الشركات مع أصحابها (للمطوّر فقط). */
export async function listCompanies(): Promise<CompanyRow[]> {
  const { data: companies, error } = await supabase
    .from("companies")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const { data: profiles } = await supabase.from("profiles").select("id, company_id, name, email");
  const ownerMap = new Map((profiles ?? []).map((p: Profile) => [p.company_id, p]));

  return ((companies ?? []) as Company[]).map((c) => {
    const owner = ownerMap.get(c.id);
    return {
      ...c,
      owner_name: owner?.name ?? "—",
      owner_email: owner?.email ?? "—",
    };
  });
}

/** تفعيل/إيقاف شركة. */
export async function setCompanyStatus(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.rpc("admin_set_company_status", { p_company_id: id, p_active: isActive });
  if (error) throw new Error(error.message);
}

/** تعيين الاشتراك (monthly/yearly/open) ومدة انتهائه. */
export async function setSubscription(id: string, planType: Company["plan_type"], endDate: string | null): Promise<void> {
  const { error } = await supabase.rpc("admin_set_subscription", {
    p_company_id: id,
    p_plan_type: planType,
    p_end_date: planType === "open" ? null : endDate,
  });
  if (error) throw new Error(error.message);
}

/** منح اشتراك مفتوح بلا تحديد (للمطوّر فقط). */
export async function grantOpenSubscription(id: string): Promise<void> {
  await setSubscription(id, "open", null);
}

/** قائمة طلبات الاشتراك (الكل للمطوّر). */
export async function listActivationRequests(): Promise<(ActivationRequest & { company_name: string })[]> {
  const { data: reqs, error } = await supabase
    .from("activation_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const { data: companies } = await supabase.from("companies").select("id, name");
  const nameMap = new Map((companies ?? []).map((c) => [c.id, c.name]));

  return ((reqs ?? []) as ActivationRequest[]).map((r) => ({
    ...r,
    company_name: nameMap.get(r.company_id) ?? "—",
  }));
}

/** مراجعة طلب (موافقة/رفض). */
export async function reviewActivationRequest(id: string, approve: boolean, adminNotes = ""): Promise<void> {
  const { error } = await supabase.rpc("admin_review_activation_request", {
    p_request_id: id,
    p_approve: approve,
    p_admin_notes: adminNotes,
  });
  if (error) throw new Error(error.message);
}

/** حذف كامل لبيانات شركة. */
export async function deleteCompany(id: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_company", { p_company_id: id });
  if (error) throw new Error(error.message);
}

export interface ActivityLog {
  id: number;
  actor_id: string | null;
  actor_email: string;
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
  created_at: string;
}

/** قراءة سجل النشاط (آخر 1000 حدث). */
export async function listActivityLogs(): Promise<ActivityLog[]> {
  const { data, error } = await supabase
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityLog[];
}

/**
 * إحصاءات عامة لكل النظام (أرقام مجمّعة فقط).
 *
 * تمر عبر `admin_platform_stats()` — دالة SECURITY DEFINER محمية بفحص is_admin().
 * سابقاً كانت هذه الدالة تَعُدّ صفوف customers/invoices/... مباشرة من الجداول،
 * وهو ما كان ينجح فقط بسبب سياسة `admin_full_access` التي كانت تُسرّب بيانات
 * كل الشركات إلى حساب المطوّر (انظر supabase/fix_tenant_leak_v9.sql).
 * بعد إغلاق تلك الثغرة لم يعد للمطوّر وصول لصفوف بيانات العملاء — فقط أعداد
 * ومجاميع لا تكشف أي تفصيل تشغيلي.
 */
export async function adminStats(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("admin_platform_stats");
  if (error) throw new Error(error.message);
  const s = (data ?? {}) as Record<string, unknown>;
  const keys = [
    "companies", "active_companies", "customers", "invoices", "trips",
    "receipts", "payments", "payrolls",
    "revenue", "collected", "spent", "salaries",
  ];
  return Object.fromEntries(keys.map((k) => [k, num(s[k])]));
}

/**
 * ملاحظة خصوصية: لا توجد هنا (ولا في أي مكان بلوحة المطوّر) دالة تقرأ بيانات
 * العملاء التشغيلية — الفواتير والنقلات والسندات والأرصدة والرواتب.
 * لوحة المطوّر مقصورة على: بيانات الاشتراك، والسجل التجاري/الضريبي، والعنوان،
 * وطلبات التفعيل، والرسائل والشكاوى. العزل مفروض أيضاً على مستوى RLS.
 */

