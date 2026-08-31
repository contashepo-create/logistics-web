// نظام الاشتراك: تجربة مجانية 7 أيام + شهري/سنوي (يظهران للعميل) + مفتوح (للمطوّر فقط)
// الأسعار بدون ضريبة القيمة المضافة (تُضاف لاحقاً عند الدفع/العرض).

import { supabase } from "./supabase";
import type { Company } from "./types";

/** الأسعار بالريال (غير شامل الضريبة). */
export const PRICING = {
  monthly: 100,
  yearly: 900,
  vatRate: 15, // نسبة الضريبة الافتراضية للعرض
} as const;

/** مدة التجربة المجانية بالأيام. */
export const TRIAL_DAYS = 7;

export type PlanType = "monthly" | "yearly" | "open";

/** الأنواع التي يراها العميل (المفتوح حصري للمطوّر). */
export const CUSTOMER_PLAN_TYPES: ("monthly" | "yearly")[] = ["monthly", "yearly"];

export function planLabel(p: PlanType): string {
  if (p === "monthly") return "اشتراك شهري";
  if (p === "yearly") return "اشتراك سنوي";
  return "اشتراك مفتوح";
}

export function planPrice(p: PlanType): number {
  if (p === "monthly") return PRICING.monthly;
  if (p === "yearly") return PRICING.yearly;
  return 0;
}

export type SubscriptionState =
  | "trial"
  | "active"
  | "expired"
  | "suspended"
  | "none";

function toDateOnly(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = toDateOnly(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** تاريخ انتهاء الاشتراك الناتج عن الموافقة على نوع معيّن. */
export function endDateForPlan(plan: PlanType, from: Date = new Date()): string | null {
  if (plan === "open") return null;
  const days = plan === "monthly" ? 30 : 365;
  return addDays(from, days).toISOString().slice(0, 10);
}

/** الحالة الفعلية للشركة (مع مراعاة التجربة المجانية). */
export function subscriptionState(c: Company | null): SubscriptionState {
  if (!c) return "none";
  if (!c.is_active) return "suspended";

  const today = toDateOnly(new Date());
  const trialEnd = c.trial_end ? new Date(c.trial_end) : null;

  // ما زال في التجربة المجانية؟
  if (trialEnd && toDateOnly(trialEnd) >= today) return "trial";

  // اشتراك مفتوح (بلا تحديد) أو ضمن المدة
  if (!c.subscription_end) return c.plan_type === "open" || trialEnd ? "active" : "expired";
  const end = toDateOnly(new Date(c.subscription_end));
  return end >= today ? "active" : "expired";
}

export function isExpired(c: Company | null): boolean {
  const s = subscriptionState(c);
  return s === "expired" || s === "suspended" || s === "none";
}

export function daysLeft(c: Company | null): number {
  if (!c) return 0;
  const today = toDateOnly(new Date());
  const end = c.subscription_end ? new Date(c.subscription_end) : null;
  const trialEnd = c.trial_end ? new Date(c.trial_end) : null;
  const ref = end ?? (trialEnd ?? today);
  return Math.max(0, Math.ceil((toDateOnly(ref).getTime() - today.getTime()) / 86400000));
}

export function stateLabel(c: Company | null): string {
  const s = subscriptionState(c);
  if (s === "trial") return `تجربة مجانية — متبقي ${daysLeft(c)} يوم`;
  if (s === "active") return c?.plan_type === "open" ? "اشتراك مفتوح" : planLabel(c?.plan_type ?? "monthly");
  if (s === "expired") return "الاشتراك منتهي";
  if (s === "suspended") return "الشركة موقوفة";
  return "بدون اشتراك";
}

/** هل يمكن للعميل طلب هذا النوع؟ (المفتوح لا يظهر ولا يُطلب). */
export function isRequestablePlan(p: string): p is "monthly" | "yearly" {
  return p === "monthly" || p === "yearly";
}

export interface ActivationRequest {
  id: string;
  company_id: string;
  plan_type: "monthly" | "yearly";
  status: "pending" | "approved" | "rejected";
  receipt_url: string | null;
  notes: string;
  admin_notes: string;
  created_at: string;
  reviewed_at: string | null;
  company_name?: string;
}

/** تقديم طلب اشتراك (إدراج مباشر — RLS + حارس company_id يضمن العزل). */
export async function submitActivationRequest(input: {
  plan_type: "monthly" | "yearly";
  receipt_url?: string | null;
  notes?: string;
}): Promise<ActivationRequest> {
  const { data, error } = await supabase
    .from("activation_requests")
    .insert({
      plan_type: input.plan_type,
      receipt_url: input.receipt_url ?? null,
      notes: input.notes ?? "",
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("لديك طلب معلق بالفعل. انتظر مراجعته أو ألغه أولاً.");
    throw new Error(error.message);
  }
  return data as ActivationRequest;
}

/** طلبات الشركة الحالية. */
export async function listMyActivationRequests(): Promise<ActivationRequest[]> {
  const { data, error } = await supabase
    .from("activation_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivationRequest[];
}

/** إلغاء طلب معلق (حذف ذاتي). */
export async function cancelMyActivationRequest(id: string): Promise<void> {
  const { error } = await supabase.from("activation_requests").delete().eq("id", id).eq("status", "pending");
  if (error) throw new Error(error.message);
}

/** رفع وصل إلى Storage وإرجاع رابط عام. */
export async function uploadReceipt(file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "png";
  const path = `receipts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { data, error } = await supabase.storage.from("receipts").upload(path, file, {
    contentType: file.type || "image/png",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { data: pub } = supabase.storage.from("receipts").getPublicUrl(data.path);
  return pub.publicUrl;
}

/** بيانات الشركة للتصدير (متاحة حتى بعد انتهاء الاشتراك). */
export async function exportCompanyData(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("export_company_data");
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}
