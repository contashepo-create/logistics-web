// إعدادات التطبيق وبيانات المطوّر — مصدر واحد للحقيقة يُقرأ في كل الشاشات
// (الصفحة التعريفية، صفحة حول التطبيق، صفحة الاشتراك) ويُعدَّل من لوحة المطوّر.
// التخزين: جدول public.app_settings (صف واحد، عمود jsonb) — راجع
// supabase/migration_developer_info.sql

import { supabase, SUPABASE_CONFIGURED } from "./supabase";

export interface AppSettings {
  app_name: string;
  app_version: string;
  developer_name: string;
  developer_title: string;
  developer_country: string;
  phone: string;
  whatsapp: string;
  telegram: string;
  email: string;
  support_hours: string;
  about_text: string;
  payment_note: string;
  copyright: string;
}

/** القيم الافتراضية — تُستخدم قبل تنفيذ الترحيل أو عند تعذّر الاتصال. */
export const DEFAULT_SETTINGS: AppSettings = {
  app_name: "النظام المحاسبي المتكامل لشركة النقل",
  app_version: "2.0.0",
  developer_name: "محمد عبده",
  developer_title: "محاسب",
  developer_country: "مصري",
  phone: "00966542520544",
  whatsapp: "00966542520544",
  telegram: "00966542520544",
  email: "",
  support_hours: "يومياً من ٩ صباحاً حتى ٩ مساءً",
  about_text:
    "نظام محاسبي سحابي متكامل لشركات النقل والنولون: فواتير النقل، سندات القبض والدفع، الخزائن والبنوك، الرواتب، وتقارير الأرباح.",
  payment_note: "للتحويل أو الاستفسار عن الاشتراك تواصل مع المطوّر عبر واتساب أو تليجرام.",
  copyright: "جميع الحقوق محفوظة — محمد عبده",
};

/** ترتيب وعناوين الحقول في شاشة التحرير بلوحة المطوّر. */
export const SETTINGS_FIELDS: { key: keyof AppSettings; label: string; hint?: string; multiline?: boolean; ltr?: boolean }[] = [
  { key: "app_name", label: "اسم التطبيق" },
  { key: "app_version", label: "رقم الإصدار", ltr: true },
  { key: "developer_name", label: "اسم المطوّر" },
  { key: "developer_title", label: "الصفة / المسمى", hint: "مثال: محاسب" },
  { key: "developer_country", label: "الجنسية / الدولة", hint: "مثال: مصري" },
  { key: "phone", label: "رقم الاتصال", hint: "يُستخدم في زر الاتصال المباشر", ltr: true },
  { key: "whatsapp", label: "رقم واتساب", hint: "بصيغة دولية (يُنظَّف تلقائياً)", ltr: true },
  { key: "telegram", label: "تليجرام", hint: "رقم دولي أو اسم مستخدم مثل username@", ltr: true },
  { key: "email", label: "البريد الإلكتروني (اختياري)", ltr: true },
  { key: "support_hours", label: "مواعيد الدعم" },
  { key: "about_text", label: "نبذة عن التطبيق", multiline: true },
  { key: "payment_note", label: "ملاحظة الدفع (تظهر في صفحة الاشتراك)", multiline: true },
  { key: "copyright", label: "نص حقوق النشر" },
];

/** تحويل أي صيغة رقم (00، +، مسافات) إلى أرقام دولية صافية. */
export function digitsOnly(raw: string): string {
  const t = (raw || "").replace(/[^\d+]/g, "");
  if (t.startsWith("+")) return t.slice(1).replace(/\D/g, "");
  if (t.startsWith("00")) return t.slice(2).replace(/\D/g, "");
  return t.replace(/\D/g, "");
}

/** رابط الاتصال المباشر. */
export function telLink(phone: string): string {
  const d = digitsOnly(phone);
  return d ? `tel:+${d}` : "#";
}

/** رابط محادثة واتساب. */
export function whatsappLink(whatsapp: string, text?: string): string {
  const d = digitsOnly(whatsapp);
  if (!d) return "#";
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** رابط تليجرام: يقبل اسم مستخدم (username@ أو username) أو رقماً دولياً. */
export function telegramLink(telegram: string): string {
  const v = (telegram || "").trim();
  if (!v) return "#";
  if (v.startsWith("http")) return v;
  const username = v.replace(/^@/, "");
  if (/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(username)) return `https://t.me/${username}`;
  const d = digitsOnly(v);
  return d ? `https://t.me/+${d}` : "#";
}

/** رقم للعرض بصيغة دولية مقروءة. */
export function displayPhone(phone: string): string {
  const d = digitsOnly(phone);
  return d ? `+${d}` : "";
}

/** قراءة الإعدادات (مع دمج الافتراضيات لأي حقل ناقص). */
export async function getAppSettings(): Promise<AppSettings> {
  if (!SUPABASE_CONFIGURED) return { ...DEFAULT_SETTINGS };
  try {
    const { data, error } = await supabase.from("app_settings").select("data").eq("id", 1).maybeSingle();
    if (error || !data) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...((data.data ?? {}) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** تحديث الإعدادات — مسموح للمطوّر فقط (يُفرض في قاعدة البيانات). */
export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const { data, error } = await supabase.rpc("admin_update_app_settings", { p_patch: patch });
  if (error) throw new Error(error.message);
  return { ...DEFAULT_SETTINGS, ...((data ?? {}) as Partial<AppSettings>) };
}
