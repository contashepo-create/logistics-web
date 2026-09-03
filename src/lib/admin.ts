// طبقة لوحة المطوّر: إدارة الشركات والاشتراكات والإحصاءات وسجل النشاط.
// كل دوال التعديل تمر عبر دوال خادمية محمية (SECURITY DEFINER + فحص is_admin).

import { supabase } from "./supabase";
import type { Company, Profile } from "./types";
import type { ActivationRequest } from "./subscription";
import { num } from "./calc";
import { authPostJson } from "./apiClient";
import type { FeatureKey } from "./features";

/** شركة مع بيانات مالكها (للوحة المطوّر). */
export interface CompanyRow extends Company {
  owner_id: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
}

/** قائمة كل الشركات مع أصحابها (للمطوّر فقط). */
export async function listCompanies(): Promise<CompanyRow[]> {
  const { data: companies, error } = await supabase
    .from("companies")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const { data: profiles } = await supabase.from("profiles").select("id, company_id, name, email, role, phone, is_active");
  // بعد السماح بمستخدم إضافي لا يجوز اختيار أول ملف عشوائياً بصفته المالك.
  // السجلات القديمة بلا role تُعامل كمالك للتوافق أثناء تطبيق الترحيلة.
  const owners = (profiles ?? []).filter((p: Partial<Profile>) => p.role !== "additional");
  const ownerMap = new Map(owners.map((p: Partial<Profile>) => [p.company_id, p]));

  return ((companies ?? []) as Company[]).map((c) => {
    const owner = ownerMap.get(c.id);
    return {
      ...c,
      owner_id: owner?.id ?? "",
      owner_name: owner?.name ?? "—",
      owner_email: owner?.email ?? "—",
      owner_phone: owner?.phone ?? "",
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

/** تعديل بيانات الشركة ومزامنة بريد/هاتف وكلمة مرور حساب المالك عبر Auth Admin. */
export async function updateCompanyIdentity(input: {
  companyId: string;
  name: string;
  phone: string;
  email: string;
  newPassword?: string;
}): Promise<void> {
  await authPostJson("/api/zerocold/companies", {
    action: "update",
    company_id: input.companyId,
    name: input.name,
    phone: input.phone,
    email: input.email,
    new_password: input.newPassword ?? "",
  });
}

/** تصفير بيانات العمل فقط؛ يتطلب اسم الشركة وكلمة مرور المطوّر. */
export async function resetCompanyData(input: {
  companyId: string;
  confirmName: string;
  developerPassword: string;
}): Promise<{ deleted_rows: number; new_financial_year: number }> {
  const out = await authPostJson<{
    success: true;
    result: { deleted_rows: number; new_financial_year: number };
  }>("/api/zerocold/companies", {
    action: "reset",
    company_id: input.companyId,
    confirm_name: input.confirmName,
    developer_password: input.developerPassword,
  });
  return out.result;
}

export interface CompanyUserRow {
  id: string;
  company_id: string;
  name: string;
  email: string;
  phone: string;
  role: "owner" | "additional";
  is_active: boolean;
  created_at?: string;
}

export interface CompanyExtras {
  features: Record<FeatureKey, boolean>;
  users: CompanyUserRow[];
}

/** قراءة المميزات والمستخدمين لشركة من مسار محمي بجلسة المطوّر و2FA. */
export async function getCompanyExtras(companyId: string): Promise<CompanyExtras> {
  const out = await authPostJson<{ success: true } & CompanyExtras>("/api/zerocold/features", {
    action: "get",
    company_id: companyId,
  });
  return { features: out.features, users: out.users };
}

/** تفعيل/إلغاء ميزة عن شركة بعينها. */
export async function setCompanyFeature(companyId: string, feature: FeatureKey, enabled: boolean): Promise<void> {
  await authPostJson("/api/zerocold/features", {
    action: "set",
    company_id: companyId,
    feature_key: feature,
    enabled,
  });
}

/** إنشاء مستخدم إضافي مؤكد البريد وربطه بالشركة. */
export async function createAdditionalUser(input: {
  companyId: string;
  name: string;
  email: string;
  phone: string;
  password: string;
}): Promise<CompanyUserRow> {
  const out = await authPostJson<{ success: true; user: CompanyUserRow }>("/api/zerocold/company-users", {
    action: "create",
    company_id: input.companyId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    password: input.password,
  });
  return out.user;
}

/** إيقاف أو إعادة تفعيل المستخدم الإضافي. */
export async function setAdditionalUserStatus(companyId: string, userId: string, active: boolean): Promise<void> {
  await authPostJson("/api/zerocold/company-users", {
    action: "status",
    company_id: companyId,
    user_id: userId,
    active,
  });
}

/** حذف المستخدم الإضافي من المصادقة والملف الشخصي. */
export async function deleteAdditionalUser(companyId: string, userId: string): Promise<void> {
  await authPostJson("/api/zerocold/company-users", {
    action: "delete",
    company_id: companyId,
    user_id: userId,
  });
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

/** قراءة أفعال حساب المطوّر الحالي فقط (الدفاع مزدوج: فلتر + سياسة RLS). */
export async function listActivityLogs(): Promise<ActivityLog[]> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!authData.user) return [];
  const { data, error } = await supabase
    .from("activity_logs")
    .select("*")
    .eq("actor_id", authData.user.id)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityLog[];
}

/** مؤشرات تشغيل المنصة نفسها فقط؛ لا أرقام فواتير/عملاء ولا أي مبالغ. */
export interface AdminPlatformStats {
  companies: number;
  active_companies: number;
  suspended_companies: number;
  trial_companies: number;
  subscribed_companies: number;
  expired_companies: number;
  new_companies_today: number;
  new_companies_30d: number;
  owner_accounts: number;
  additional_accounts: number;
  pending_requests: number;
  visitors: number;
  visitors_today: number;
  visitors_30d: number;
  page_views: number;
  last_visit_at: string | null;
}

export async function adminStats(): Promise<AdminPlatformStats> {
  const { data, error } = await supabase.rpc("admin_platform_stats_v18");
  if (error) throw new Error(error.message);
  const s = (data ?? {}) as Record<string, unknown>;
  const numericKeys = [
    "companies", "active_companies", "suspended_companies", "trial_companies",
    "subscribed_companies", "expired_companies", "new_companies_today",
    "new_companies_30d", "owner_accounts", "additional_accounts", "pending_requests",
    "visitors", "visitors_today", "visitors_30d", "page_views",
  ] as const;
  const out = Object.fromEntries(numericKeys.map((key) => [key, num(s[key])])) as Omit<AdminPlatformStats, "last_visit_at">;
  return { ...out, last_visit_at: typeof s.last_visit_at === "string" ? s.last_visit_at : null };
}

export interface SiteVisitorRow {
  ip_address: string;
  browser: string;
  operating_system: string;
  device_type: string;
  country: string;
  region: string;
  city: string;
  first_path: string;
  last_path: string;
  referrer: string;
  page_views: number;
  first_seen: string;
  last_seen: string;
}

export async function recentSiteVisitors(limit = 100): Promise<SiteVisitorRow[]> {
  const { data, error } = await supabase.rpc("admin_recent_visitors_v18", { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ip_address: String(row.ip_address ?? ""),
    browser: String(row.browser ?? ""),
    operating_system: String(row.operating_system ?? ""),
    device_type: String(row.device_type ?? ""),
    country: String(row.country ?? ""),
    region: String(row.region ?? ""),
    city: String(row.city ?? ""),
    first_path: String(row.first_path ?? ""),
    last_path: String(row.last_path ?? ""),
    referrer: String(row.referrer ?? ""),
    page_views: num(row.page_views),
    first_seen: String(row.first_seen ?? ""),
    last_seen: String(row.last_seen ?? ""),
  }));
}

export interface DatabaseObjectHealth {
  name: string;
  exists: boolean;
  rls_enabled?: boolean;
  policy_count?: number;
}

export interface DatabaseHealth {
  healthy: boolean;
  checked_at: string;
  database_time: string;
  postgres_version: string;
  tables: DatabaseObjectHealth[];
  functions: DatabaseObjectHealth[];
}

/** فحص بنية الاتصال فقط؛ RPC لا تقرأ صفوف أعمال أي شركة. */
export async function databaseHealth(): Promise<DatabaseHealth> {
  const { data, error } = await supabase.rpc("admin_database_health_v18");
  if (error) throw new Error(error.message);
  return data as DatabaseHealth;
}

/**
 * ملاحظة خصوصية: لوحة المطوّر لا تقرأ بيانات العملاء التشغيلية — الفواتير
 * والنقلات والسندات والأرصدة والرواتب. المعروض هو الاشتراك والهوية والمميزات
 * وصحة المنصة والزوار، والعزل مفروض أيضاً بسياسات RLS.
 */

