// نظام الاشتراك: تجربة مجانية 7 أيام + شهري/سنوي (يظهران للعميل) + مفتوح (للمطوّر فقط)
// الأسعار بالجنيه المصري وغير شاملة ضريبة القيمة المضافة.

import { supabase } from "./supabase";
import type { Company } from "./types";

/** عملة العرض. */
export const CURRENCY = "ج.م";

/** الأسعار بالجنيه المصري (غير شاملة الضريبة). */
export const PRICING = {
  monthly: 100,
  /** السنوي 1000 بدلاً من 1200 (خصم 200 جنيه). */
  yearly: 1000,
  yearlyBefore: 1200,
  yearlyDiscount: 200,
  /** ضريبة القيمة المضافة في مصر. */
  vatRate: 14,
} as const;

/** قيمة الضريبة على سعر معيّن. */
export function vatOf(amount: number): number {
  return Math.round(amount * PRICING.vatRate) / 100;
}

/** الإجمالي شامل الضريبة. */
export function totalWithVat(amount: number): number {
  return Math.round((amount + vatOf(amount)) * 100) / 100;
}

/** مدة التجربة المجانية بالأيام. */
export const TRIAL_DAYS = 7;

export type PlanType = "trial" | "monthly" | "yearly" | "open";

/** الأنواع التي يراها العميل (المفتوح حصري للمطوّر). */
export const CUSTOMER_PLAN_TYPES: ("monthly" | "yearly")[] = ["monthly", "yearly"];

export function planLabel(p: PlanType): string {
  if (p === "trial") return "الباقة التجريبية";
  if (p === "monthly") return "اشتراك شهري";
  if (p === "yearly") return "اشتراك سنوي";
  return "اشتراك مفتوح";
}

export function planPrice(p: PlanType): number {
  if (p === "trial") return 0;
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
  const days = plan === "trial" ? TRIAL_DAYS : plan === "monthly" ? 30 : 365;
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

export type RequestKind = "new" | "upgrade" | "renew";

export function requestKindLabel(k: RequestKind): string {
  return k === "upgrade" ? "ترقية الباقة" : k === "renew" ? "تجديد الاشتراك" : "اشتراك جديد";
}

export interface ActivationRequest {
  id: string;
  company_id: string;
  plan_type: "monthly" | "yearly";
  request_kind: RequestKind;
  amount: number;
  payer_name: string;
  payer_phone: string;
  pay_method: string;
  transfer_ref: string;
  receipt_sent: boolean;
  status: "pending" | "approved" | "rejected";
  receipt_url: string | null;
  notes: string;
  admin_notes: string;
  created_at: string;
  reviewed_at: string | null;
  company_name?: string;
}

export interface SubscriptionRequestInput {
  plan_type: "monthly" | "yearly";
  request_kind: RequestKind;
  amount: number;
  payer_name: string;
  payer_phone: string;
  pay_method: string;
  transfer_ref: string;
  notes?: string;
  /** صورة الوصل — تُمرَّر إلى تليجرام المطوّر ولا تُخزَّن على الموقع إطلاقاً. */
  receipt?: File | null;
}

/**
 * تقديم طلب اشتراك/ترقية/تجديد عبر مسار خادمي محمي:
 * يتحقق من الجلسة، ويعقّم المدخلات، ويقيّد المعدل،
 * ويمرّر صورة الوصل مباشرة إلى تليجرام المطوّر دون تخزينها.
 */
export async function submitSubscriptionRequest(input: SubscriptionRequestInput): Promise<ActivationRequest> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? "";
  const fd = new FormData();
  fd.set("plan_type", input.plan_type);
  fd.set("request_kind", input.request_kind);
  fd.set("amount", String(input.amount));
  fd.set("payer_name", input.payer_name);
  fd.set("payer_phone", input.payer_phone);
  fd.set("pay_method", input.pay_method);
  fd.set("transfer_ref", input.transfer_ref);
  fd.set("notes", input.notes ?? "");
  if (input.receipt) fd.set("receipt", input.receipt);

  const res = await fetch("/api/subscription/request", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.success) throw new Error(out?.message || "تعذّر إرسال الطلب.");
  return out.request as ActivationRequest;
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

// ملاحظة أمنية: لا يوجد رفع صور على الموقع إطلاقاً (لا للعميل ولا للزائر).
// صورة الوصل تُرسل مباشرة إلى تليجرام المطوّر عبر /api/subscription/request
// دون تخزينها في الموقع أو في Storage.

/** بيانات الشركة للتصدير (متاحة حتى بعد انتهاء الاشتراك). */
export async function exportCompanyData(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("export_company_data");
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}
