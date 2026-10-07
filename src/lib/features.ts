// المميزات الإضافية لكل شركة.
// القاعدة الأساسية: غياب سجل التفعيل أو حدوث خطأ في القراءة = الميزة متوقفة.

import { supabase } from "./supabase";
import { getProfile } from "./auth";

export const FEATURE_KEYS = ["tax_invoice", "additional_user"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, { name: string; description: string }> = {
  tax_invoice: {
    name: "الفاتورة الضريبية",
    description: "خصائص الفاتورة الضريبية والتحقق وطباعة رمز QR.",
  },
  additional_user: {
    name: "المستخدمون الإضافيون",
    description: "حسابات إضافية تعمل على بيانات الشركة نفسها، بعدد يحدده المطوّر لكل شركة.",
  },
};

export const TAX_INVOICE_WARNING =
  "تنبيه: هذه الفاتورة تحسب قيمة الضريبة، لكنها لا تطابق معايير هيئة الزكاة والضريبة والجمارك (زاتكا).";

const CACHE_MS = 15_000;
const featureCache = new Map<string, { at: number; enabled: boolean }>();

/** إبطال كاش المميزات، ويُستخدم عند تبدّل الجلسة أو بعد تعديل المطوّر. */
export function clearFeatureCache(): void {
  featureCache.clear();
}

/** هل الميزة مفعّلة للشركة الحالية؟ الافتراضي الآمن دائماً false. */
export async function hasFeature(feature: FeatureKey, force = false): Promise<boolean> {
  const profile = await getProfile(force).catch(() => null);
  if (!profile?.company_id) return false;

  const cacheKey = `${profile.company_id}:${feature}`;
  const cached = featureCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.enabled;

  const { data, error } = await supabase
    .from("company_features")
    .select("enabled")
    .eq("company_id", profile.company_id)
    .eq("feature_key", feature)
    .maybeSingle();

  const enabled = !error && data?.enabled === true;
  featureCache.set(cacheKey, { at: Date.now(), enabled });
  return enabled;
}

/** هل الملف الشخصي هو صاحب الشركة؟ يدعم السجلات القديمة باعتبارها مالكاً. */
export function isCompanyOwner(profile: { role?: string } | null | undefined): boolean {
  return Boolean(profile) && profile?.role !== "additional";
}

/**
 * هل تُستخدم إشعارات المدين/الدائن في هذه الشركة؟
 * القاعدة: الإشعارات بديل التعديل والحذف، ولا معنى لها إلا مع الفاتورة الضريبية
 * بالباركود؛ فعند إيقاف الميزة تُمنع الإشعارات (وتبقى القديمة للعرض) ويُتاح
 * للمستخدم تعديل الفاتورة أو حذفها.
 */
export async function usesCreditDebitNotes(force = false): Promise<boolean> {
  return hasFeature("tax_invoice", force);
}

/** رسالة موحدة تُعرض للمستخدم عند تعطّل مسار الإشعارات. */
export const NOTES_REQUIRE_TAX_FEATURE_MESSAGE =
  "إشعارات المدين والدائن متاحة فقط عند تفعيل الفاتورة الضريبية بالباركود — التصحيح حالياً يكون بتعديل الفاتورة أو حذفها.";

/** رسالة موحدة تُعرض عند تعطّل تعديل/حذف الفاتورة. */
export const INVOICE_LOCKED_MESSAGE =
  "الفاتورة الضريبية بالباركود مفعّلة لهذه الشركة: لا يُسمح بتعديل الفاتورة أو حذفها بعد الإصدار، والتصحيح يكون بإشعار مدين أو دائن.";

/** هل يلزم عرض تحذير عدم مطابقة زاتكا لهذا المستخدم؟ */
export function shouldWarnTaxInvoice(input: {
  featureEnabled: boolean;
  vatRate: number;
  profile?: { role?: string } | null;
}): boolean {
  return !input.featureEnabled && input.vatRate > 0 && isCompanyOwner(input.profile);
}
