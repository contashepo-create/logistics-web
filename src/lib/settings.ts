// إعدادات التطبيق وبيانات المطوّر — مصدر واحد للحقيقة يُقرأ في كل الشاشات
// (الصفحة التعريفية، صفحة حول التطبيق، صفحة الاشتراك) ويُعدَّل من لوحة المطوّر.
// التخزين: جدول public.app_settings (صف واحد، عمود jsonb) — راجع
// supabase/migration_developer_info.sql

import { supabase, SUPABASE_CONFIGURED } from "./supabase";
import { safeEmail, safeField, safePhone, safeUrl } from "./security";

/** أنواع الحقول الإضافية: تحدد شكل العرض والرابط الناتج. */
export type CustomFieldType = "text" | "phone" | "whatsapp" | "telegram" | "email" | "link";

export interface CustomField {
  id: string;
  label: string;
  value: string;
  type: CustomFieldType;
  enabled: boolean;
}

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
  /** تفعيل/تعطيل ظهور كل حقل أساسي (المفتاح غير الموجود = مفعّل). */
  visibility: Record<string, boolean>;
  /** حقول إضافية يضيفها المطوّر بمسميات حرة. */
  custom_fields: CustomField[];
}

/** القيم الافتراضية — تُستخدم قبل تنفيذ الترحيل أو عند تعذّر الاتصال. */
export const DEFAULT_SETTINGS: AppSettings = {
  app_name: "النظام المحاسبي المتكامل لشركة النقل",
  app_version: "2.0.0",
  developer_name: "محمد عبده",
  developer_title: "محاسب",
  developer_country: "",
  phone: "00966542520544",
  whatsapp: "00966542520544",
  telegram: "00966542520544",
  email: "conta.shepo@gmail.com",
  support_hours: "يومياً من ٩ صباحاً حتى ٩ مساءً",
  about_text:
    "نظام محاسبي سحابي متكامل لشركات النقل والنولون: فواتير النقل، سندات القبض والدفع، الخزائن والبنوك، الرواتب، وتقارير الأرباح.",
  payment_note: "للتحويل أو الاستفسار عن الاشتراك تواصل مع المطوّر عبر واتساب أو تليجرام.",
  copyright: "جميع الحقوق محفوظة — محمد عبده",
  visibility: { developer_country: false },
  custom_fields: [],
};

/** الحقول الأساسية القابلة للتحرير والتعطيل من لوحة المطوّر. */
export const SETTINGS_FIELDS: {
  key: Exclude<keyof AppSettings, "visibility" | "custom_fields">;
  label: string;
  hint?: string;
  multiline?: boolean;
  ltr?: boolean;
  /** حقول لا معنى لتعطيلها (اسم التطبيق مثلاً). */
  alwaysOn?: boolean;
}[] = [
  { key: "app_name", label: "اسم التطبيق", alwaysOn: true },
  { key: "app_version", label: "رقم الإصدار", ltr: true },
  { key: "developer_name", label: "اسم المطوّر", alwaysOn: true },
  { key: "developer_title", label: "الصفة / المسمى", hint: "مثال: محاسب" },
  { key: "developer_country", label: "الجنسية / الدولة", hint: "معطّل افتراضياً" },
  { key: "phone", label: "رقم الاتصال", hint: "زر الاتصال المباشر", ltr: true },
  { key: "whatsapp", label: "رقم واتساب", hint: "بصيغة دولية (يُنظَّف تلقائياً)", ltr: true },
  { key: "telegram", label: "تليجرام", hint: "رقم دولي أو اسم مستخدم", ltr: true },
  { key: "email", label: "البريد الإلكتروني", ltr: true },
  { key: "support_hours", label: "مواعيد الدعم" },
  { key: "about_text", label: "نبذة عن التطبيق", multiline: true, alwaysOn: true },
  { key: "payment_note", label: "ملاحظة الدفع (صفحة الاشتراك)", multiline: true },
  { key: "copyright", label: "نص حقوق النشر", alwaysOn: true },
];

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "نص عادي" },
  { value: "phone", label: "رقم هاتف (زر اتصال)" },
  { value: "whatsapp", label: "واتساب" },
  { value: "telegram", label: "تليجرام" },
  { value: "email", label: "بريد إلكتروني" },
  { value: "link", label: "رابط خارجي" },
];

/** هل الحقل مفعّل للعرض؟ (الافتراضي: مفعّل ما لم يُعطَّل صراحةً وله قيمة). */
export function isEnabled(s: AppSettings, key: string): boolean {
  const v = s.visibility?.[key];
  return v !== false;
}

/** هل نعرض الحقل فعلاً؟ (مفعّل + له قيمة). */
export function showField(s: AppSettings, key: Exclude<keyof AppSettings, "visibility" | "custom_fields">): boolean {
  return isEnabled(s, key) && Boolean((s[key] as string)?.trim?.());
}

/** الحقول الإضافية الجاهزة للعرض. */
export function activeCustomFields(s: AppSettings): CustomField[] {
  return (s.custom_fields ?? []).filter((f) => f.enabled !== false && f.label?.trim() && f.value?.trim());
}

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

/** رابط حقل إضافي حسب نوعه (يُعيد null للنص العادي). */
export function customFieldHref(f: CustomField): string | null {
  try {
    switch (f.type) {
      case "phone": return telLink(safePhone(f.value, true));
      case "whatsapp": return whatsappLink(safePhone(f.value, true));
      case "telegram": return telegramLink(safeField(f.value, { label: "تليجرام", max: 120, required: true }));
      case "email": return `mailto:${safeEmail(f.value, true)}`;
      case "link": {
        const raw = f.value.trim();
        return safeUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`, "الرابط", true);
      }
      default: return null;
    }
  } catch {
    return "#";
  }
}

/** أيقونة الحقل الإضافي حسب نوعه. */
export function customFieldIcon(type: CustomFieldType): string {
  return { text: "•", phone: "📞", whatsapp: "💬", telegram: "✈️", email: "✉️", link: "🔗" }[type] ?? "•";
}

/** توليد معرّف بسيط لحقل جديد. */
export function newCustomField(): CustomField {
  return { id: `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: "", value: "", type: "text", enabled: true };
}

const CUSTOM_TYPES = new Set<CustomFieldType>(CUSTOM_FIELD_TYPES.map((item) => item.value));

function normalize(raw: Partial<AppSettings>, strict = false): AppSettings {
  const text = (key: keyof AppSettings, max: number): string => {
    const fallback = String(DEFAULT_SETTINGS[key] ?? "");
    try { return safeField(raw[key] ?? fallback, { label: String(key), max }); }
    catch (error) { if (strict) throw error; return fallback; }
  };
  const contact = (key: "phone" | "whatsapp"): string => {
    const fallback = DEFAULT_SETTINGS[key];
    try { return safePhone(raw[key] ?? fallback, Boolean(raw[key] ?? fallback)); }
    catch (error) { if (strict) throw error; return fallback; }
  };
  let email = DEFAULT_SETTINGS.email;
  try { email = safeEmail(raw.email ?? email, true); }
  catch (error) { if (strict) throw error; }

  const visibility: Record<string, boolean> = { ...DEFAULT_SETTINGS.visibility };
  if (raw.visibility && typeof raw.visibility === "object" && !Array.isArray(raw.visibility)) {
    for (const field of SETTINGS_FIELDS) {
      const value = raw.visibility[field.key];
      if (typeof value === "boolean") visibility[field.key] = value;
      else if (strict && value != null) throw new Error(`قيمة إظهار الحقل ${field.key} غير صالحة.`);
    }
  } else if (strict && raw.visibility != null) throw new Error("إعدادات إظهار الحقول غير صالحة.");

  const customFields: CustomField[] = [];
  if (Array.isArray(raw.custom_fields)) {
    if (raw.custom_fields.length > 20) {
      if (strict) throw new Error("الحد الأقصى للحقول الإضافية هو 20 حقلاً.");
    }
    for (const item of raw.custom_fields.slice(0, 20)) {
      try {
        if (!item || typeof item !== "object") throw new Error("حقل إضافي غير صالح.");
        const id = String(item.id ?? "");
        if (!/^f_[a-z0-9]{4,40}$/i.test(id)) throw new Error("معرّف الحقل الإضافي غير صالح.");
        if (!CUSTOM_TYPES.has(item.type)) throw new Error("نوع الحقل الإضافي غير صالح.");
        if (typeof item.enabled !== "boolean") throw new Error("حالة الحقل الإضافي غير صالحة.");
        const label = safeField(item.label, { label: "مسمى الحقل الإضافي", max: 80, required: true });
        let value = safeField(item.value, { label, max: 500 });
        if (value) {
          if (item.type === "phone" || item.type === "whatsapp") value = safePhone(value, true);
          else if (item.type === "email") value = safeEmail(value, true);
          else if (item.type === "link") value = safeUrl(/^https?:\/\//i.test(value) ? value : `https://${value}`, label, true);
        }
        customFields.push({ id, label, value, type: item.type, enabled: item.enabled });
      } catch (error) {
        if (strict) throw error;
      }
    }
  } else if (strict && raw.custom_fields != null) throw new Error("الحقول الإضافية يجب أن تكون قائمة صالحة.");

  const telegram = text("telegram", 120);
  if (strict && telegram && !/^@?[A-Za-z][A-Za-z0-9_]{3,}$/.test(telegram) && !/^https:\/\/t\.me\//i.test(telegram)) {
    safePhone(telegram, true); // يرمي رسالة واضحة إذا لم يكن رقماً صالحاً
  }

  return {
    app_name: text("app_name", 120),
    app_version: text("app_version", 30),
    developer_name: text("developer_name", 120),
    developer_title: text("developer_title", 100),
    developer_country: text("developer_country", 100),
    phone: contact("phone"),
    whatsapp: contact("whatsapp"),
    telegram,
    email,
    support_hours: text("support_hours", 200),
    about_text: text("about_text", 2000),
    payment_note: text("payment_note", 1000),
    copyright: text("copyright", 200),
    visibility,
    custom_fields: customFields,
  };
}

/** قراءة الإعدادات (مع دمج الافتراضيات لأي حقل ناقص). */
export async function getAppSettings(): Promise<AppSettings> {
  if (!SUPABASE_CONFIGURED) return normalize({});
  try {
    const { data, error } = await supabase.from("app_settings").select("data").eq("id", 1).maybeSingle();
    if (error || !data) return normalize({});
    return normalize((data.data ?? {}) as Partial<AppSettings>);
  } catch {
    return normalize({});
  }
}

/** تحديث الإعدادات — مسموح للمطوّر فقط (يُفرض في قاعدة البيانات). */
export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("تحديث الإعدادات غير صالح.");
  const clean = normalize({ ...(await getAppSettings()), ...patch }, true);
  const { data, error } = await supabase.rpc("admin_update_app_settings", { p_patch: clean });
  if (error) throw new Error(error.message);
  return normalize((data ?? {}) as Partial<AppSettings>);
}
