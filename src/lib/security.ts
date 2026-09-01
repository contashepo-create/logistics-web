// ============================================================================
// طبقة الأمان المشتركة (تعمل على العميل والخادم معاً)
//   • قائمة مزوّدي البريد المسموح بهم + منع البريد الوهمي/المؤقت
//   • تعقيم النصوص ومنع الحقن (XSS / SQLi / HTML / تحكم)
//   • توليد معرّفات عشوائية غير قابلة للتخمين أو التتابع (رقم العميل/الشكوى)
// لا تضع هنا أي سر — هذا الملف يُحزم مع المتصفح.
// ============================================================================

/** مزوّدو البريد المسموح بهم فقط (جيميل/ياهو/هوتميل/أوتلوك/آيكلاود). */
export const ALLOWED_EMAIL_DOMAINS: readonly string[] = [
  // Google
  "gmail.com", "googlemail.com",
  // Yahoo (عالمي + نطاقات الدول الشائعة)
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.it", "yahoo.es",
  "yahoo.ca", "yahoo.com.au", "yahoo.co.in", "yahoo.co.jp", "ymail.com", "rocketmail.com",
  // Microsoft
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.it", "hotmail.es",
  "outlook.com", "outlook.sa", "outlook.fr", "outlook.de", "outlook.es", "outlook.com.au",
  "live.com", "live.co.uk", "msn.com",
  // Apple
  "icloud.com", "me.com", "mac.com",
];

/**
 * نطاقات البريد المؤقت/الوهمي الشائعة — تُرفض صراحةً حتى لو تشابهت مع مسموح.
 * (الحماية الأساسية هي قائمة السماح أعلاه؛ هذه طبقة ثانية ضد الخداع.)
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "sharklasers.com",
  "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org", "tempmail.net",
  "yopmail.com", "yopmail.fr", "throwawaymail.com", "getnada.com", "nada.email",
  "dispostable.com", "trashmail.com", "trashmail.de", "maildrop.cc", "mailnesia.com",
  "fakeinbox.com", "fakemail.net", "emailondeck.com", "moakt.com", "mohmal.com",
  "tempr.email", "discard.email", "spamgourmet.com", "mytemp.email", "burnermail.io",
  "inboxkitten.com", "tmpmail.org", "temp-mail.io", "minuteinbox.com", "1secmail.com",
  "harakirimail.com", "grr.la", "spam4.me", "mailcatch.com", "mail-temp.com",
];

/** صيغة بريد صارمة (RFC-lite): بلا مسافات ولا محارف تحكم ولا نقاط متتالية. */
const EMAIL_RE = /^[A-Za-z0-9]([A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export interface EmailCheck {
  ok: boolean;
  /** البريد بعد التطبيع (حروف صغيرة، بلا مسافات). */
  email: string;
  domain: string;
  message: string;
}

/** التحقق من بريد التسجيل: صيغة صحيحة + مزوّد مسموح + ليس مؤقتاً/وهمياً. */
export function checkSignupEmail(raw: string): EmailCheck {
  const trimmed = String(raw ?? "").trim();
  const email = trimmed.toLowerCase();
  const [local = "", domain = ""] = email.split("@");
  const fail = (message: string): EmailCheck => ({ ok: false, email, domain, message });

  if (!email) return fail("أدخل البريد الإلكتروني.");
  if (/\s/.test(trimmed)) return fail("البريد الإلكتروني لا يحتوي على مسافات.");
  if (email.length > 120) return fail("البريد الإلكتروني طويل بشكل غير منطقي.");
  if (email.includes("..")) return fail("صيغة البريد الإلكتروني غير صحيحة.");
  if (/[<>"'`\\;()\[\]{}]/.test(email)) return fail("البريد الإلكتروني يحتوي على رموز غير مسموح بها.");
  if (!EMAIL_RE.test(email)) return fail("صيغة البريد الإلكتروني غير صحيحة.");
  // منع الحيل: user+tag@ مسموح، لكن ليس أكثر من علامة @ أو نطاق فرعي مزيّف
  if ((email.match(/@/g) ?? []).length !== 1) return fail("صيغة البريد الإلكتروني غير صحيحة.");
  if (DISPOSABLE_EMAIL_DOMAINS.includes(domain)) {
    return fail("لا نقبل البريد المؤقت أو الوهمي. استخدم بريداً حقيقياً.");
  }
  const localBase = local.split("+")[0].replace(/[._-]/g, "");
  if (["test", "testing", "demo", "dummy", "fake", "example", "sample", "user", "unknown", "noreply", "noemail", "xxx"].includes(localBase) || /^(.)\1{3,}$/.test(localBase)) {
    return fail("لا نقبل بريداً وهمياً أو تجريبياً. استخدم بريدك الحقيقي.");
  }
  if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
    return fail("يُقبل التسجيل ببريد Gmail أو Yahoo أو Hotmail أو Outlook أو iCloud فقط.");
  }
  return { ok: true, email, domain, message: "" };
}

/** نص مختصر يُعرض للمستخدم بمزوّدي البريد المقبولين. */
export const ALLOWED_EMAIL_HINT = "Gmail · Yahoo · Hotmail · Outlook · iCloud";

// ---------------------------------------------------------------------------
// تعقيم المدخلات
// ---------------------------------------------------------------------------

/** حذف محارف التحكم وعلامات الاتجاه المخفية (تُستخدم في هجمات الانتحال). */
export function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
}

/**
 * تعقيم نص حر قبل تخزينه أو عرضه:
 * إزالة محارف التحكم، وتحويل وسوم HTML إلى نص، وقصّ الطول.
 */
export function sanitizeText(input: unknown, maxLen = 1000): string {
  let s = stripControlChars(typeof input === "string" ? input : String(input ?? ""));
  s = s.replace(/<[^>]*>/g, " ");             // لا وسوم HTML إطلاقاً
  s = s.replace(/&#?[a-z0-9]{2,8};/gi, " ");   // لا كيانات HTML مموّهة
  s = s.replace(/\r\n/g, "\n").replace(/[ \t]{3,}/g, "  ");
  s = s.replace(/\n{4,}/g, "\n\n\n");
  return s.trim().slice(0, maxLen);
}

/** ترميز نص للعرض داخل HTML (للمولّدات الخاصة بنا: الطباعة/تليجرام). */
export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** أنماط هجومية واضحة (حقن SQL/سكربت/أوامر) — للرفض المبكر وتسجيل المحاولة. */
const ATTACK_PATTERNS: RegExp[] = [
  /<\s*script\b/i,
  /javascript\s*:/i,
  /on(?:error|load|click|mouseover|focus)\s*=/i,
  /\b(?:union\s+select|select\s+.+\s+from\s+|insert\s+into\s+|update\s+\w+\s+set\s+|delete\s+from\s+|drop\s+table|truncate\s+table|alter\s+table)\b/i,
  /(?:--\s|\/\*|\*\/|;\s*shutdown|xp_cmdshell|pg_sleep\s*\(|benchmark\s*\()/i,
  /\$\{.*\}|\{\{.*\}\}/,             // قوالب/تعبيرات
  /\bdata:text\/html\b/i,
  /(?:\.\.\/){2,}/,                   // اجتياز مسارات
];

/** هل يحتوي النص على نمط هجومي صريح؟ */
export function looksMalicious(input: unknown): boolean {
  const s = String(input ?? "");
  return ATTACK_PATTERNS.some((re) => re.test(s));
}

export interface FieldRule {
  label: string;
  max?: number;
  min?: number;
  required?: boolean;
}

/**
 * تحقق + تعقيم لحقل نصي وارد من مستخدم/زائر.
 * يرمي خطأ عربياً واضحاً عند الرفض (يُستخدم في مسارات API).
 */
export function safeField(value: unknown, rule: FieldRule): string {
  const { label, max = 500, min = 0, required = false } = rule;
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  if (raw.length > max) throw new Error(`حقل «${label}» طويل جداً (الحد ${max} محرفاً).`);
  if (looksMalicious(raw)) throw new Error(`المحتوى المُدخل في «${label}» غير مسموح به.`);
  const s = sanitizeText(raw, max);
  if (required && s.length === 0) throw new Error(`حقل «${label}» مطلوب.`);
  if (s.length > 0 && s.length < min) throw new Error(`حقل «${label}» قصير جداً (${min} حرفاً على الأقل).`);
  return s;
}

const PLACEHOLDER_VALUES = new Set([
  "test", "testing", "demo", "dummy", "fake", "sample", "none", "null", "undefined", "unknown", "n/a", "na", "xxx", "xxxx",
  "اختبار", "تجربة", "تجريبي", "وهمي", "غير معروف", "بدون", "لا يوجد", "لايوجد", "اسم", "عنوان", "عميل", "مستخدم", "مورد", "شركة", "شركة وهمية", "شركة تجريبية",
  "customer", "user", "supplier", "company",
]);

function normalizedPlaceholder(value: string): string {
  return value.toLocaleLowerCase("en").replace(/[\s._\-/\\]+/g, " ").trim();
}

/** يرفض القيم الوهمية الشائعة والتكرار المصطنع في حقول الهوية. */
export function isPlausibleIdentityText(value: unknown): boolean {
  const s = sanitizeText(value, 500);
  const normalized = normalizedPlaceholder(s);
  if (!normalized || PLACEHOLDER_VALUES.has(normalized)) return false;
  const compact = normalized.replace(/\s/g, "");
  if (compact.length >= 3 && /^(.)\1+$/u.test(compact)) return false;
  if (/^(?:1234567890|0123456789|9876543210|0987654321)+$/.test(compact)) return false;
  return (s.match(/[A-Za-z\u0600-\u06FF]/g) ?? []).length >= 2;
}

/** اسم شخص حقيقي ظاهرياً؛ التحقق لا يدّعي إثبات الهوية. */
export function safePersonName(value: unknown, label = "الاسم"): string {
  const s = safeField(value, { label, min: 2, max: 120, required: true });
  if (!isPlausibleIdentityText(s)) throw new Error(`أدخل قيمة حقيقية وصحيحة في حقل «${label}».`);
  if (!/^[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s.'’-]*$/u.test(s)) {
    throw new Error(`حقل «${label}» يجب أن يحتوي على حروف الاسم فقط.`);
  }
  return s;
}

/** اسم شركة/منشأة غير فارغ أو وهمي. */
export function safeCompanyName(value: unknown): string {
  const s = safeField(value, { label: "اسم الشركة", min: 2, max: 120, required: true });
  if (!isPlausibleIdentityText(s)) throw new Error("أدخل اسماً حقيقياً وصحيحاً للشركة.");
  return s;
}

/** عنوان وصفي معقول، مع السماح بالأرقام وعلامات العنوان المعتادة. */
export function safeAddress(value: unknown, label = "العنوان"): string {
  const s = safeField(value, { label, min: 5, max: 300, required: true });
  if (!isPlausibleIdentityText(s) || s.replace(/\s/g, "").length < 5) {
    throw new Error(`أدخل قيمة حقيقية وكاملة في حقل «${label}».`);
  }
  return s;
}

function asciiDigits(value: unknown): string {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const eastern = "۰۱۲۳۴۵۶۷۸۹";
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(eastern.indexOf(d)));
}

/** تطبيع الهاتف إلى أرقام دولية/محلية ثابتة؛ + و00 لا يصنعان رقمين مختلفين. */
export function normalizePhone(value: unknown): string {
  const raw = asciiDigits(value).trim();
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("00") ? digits.slice(2) : digits;
}

/** تحقق صارم من الهاتف: لا يحذف الأحرف الخبيثة بصمت ولا يقبل الأرقام الوهمية. */
export function safePhone(value: unknown, required = false): string {
  const raw = stripControlChars(asciiDigits(value)).trim();
  if (!raw) {
    if (required) throw new Error("رقم الهاتف مطلوب.");
    return "";
  }
  if (looksMalicious(raw) || !/^\+?[\d\s().-]+$/.test(raw) || (raw.match(/\+/g) ?? []).length > 1) {
    throw new Error("رقم الهاتف يحتوي على رموز غير مسموح بها.");
  }
  const normalized = normalizePhone(raw);
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("رقم الهاتف يجب أن يتكون من 8 إلى 15 رقماً.");
  if (/^(\d)\1+$/.test(digits) || /(?:0123456789|1234567890|9876543210|0987654321)/.test(digits) || /(\d)\1{6,}$/.test(digits)) {
    throw new Error("رقم الهاتف يبدو وهمياً. أدخل رقماً حقيقياً.");
  }
  return normalized;
}

/** بريد عام لبيانات العملاء والموردين (بلا حصره في مزوّدي بريد التسجيل). */
export function safeEmail(value: unknown, required = false): string {
  const raw = stripControlChars(String(value ?? "")).trim();
  if (!raw) {
    if (required) throw new Error("البريد الإلكتروني مطلوب.");
    return "";
  }
  const email = raw.toLowerCase();
  if (looksMalicious(email) || email.length > 254 || email.includes("..") || !EMAIL_RE.test(email)) {
    throw new Error("صيغة البريد الإلكتروني غير صحيحة.");
  }
  return email;
}

/** رقم محدود وصريح؛ يرفض السلاسل الفارغة وNaN وInfinity بدلاً من تحويلها إلى صفر. */
export function safeNumber(
  value: unknown,
  options: { label: string; min?: number; max?: number; integer?: boolean },
): number {
  const { label, min = -1_000_000_000_000, max = 1_000_000_000_000, integer = false } = options;
  if (value === "" || value == null || typeof value === "boolean") throw new Error(`حقل «${label}» يجب أن يكون رقماً.`);
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
  if (!Number.isFinite(n)) throw new Error(`حقل «${label}» يجب أن يكون رقماً صالحاً.`);
  if (integer && !Number.isInteger(n)) throw new Error(`حقل «${label}» يجب أن يكون عدداً صحيحاً.`);
  if (n < min || n > max) throw new Error(`قيمة «${label}» خارج النطاق المسموح (${min} إلى ${max}).`);
  return n;
}

/** تاريخ ISO حقيقي (يرفض مثلاً 2026-02-31 ولا يعتمد على تطبيع Date التلقائي). */
export function safeIsoDate(value: unknown, label = "التاريخ"): string {
  const s = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) throw new Error(`حقل «${label}» يجب أن يكون تاريخاً صالحاً.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 || year > 2200 ||
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day
  ) throw new Error(`حقل «${label}» يجب أن يكون تاريخاً صالحاً.`);
  return s;
}

/** يتحقق من ترتيب ومدة سنة مالية معقولة. */
export function safeFinancialYear(dateFrom: unknown, dateTo: unknown): { dateFrom: string; dateTo: string; year: number } {
  const from = safeIsoDate(dateFrom, "بداية السنة المالية");
  const to = safeIsoDate(dateTo, "نهاية السنة المالية");
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days < 180 || days > 550) throw new Error("يجب أن تكون نهاية السنة المالية بعد بدايتها، وأن تكون مدتها بين 180 و550 يوماً.");
  return { dateFrom: from, dateTo: to, year: Number(from.slice(0, 4)) };
}

/** رابط ويب http/https فقط؛ يمنع javascript: وdata: والروابط المشوّهة. */
export function safeUrl(value: unknown, label = "الرابط", required = false): string {
  const raw = stripControlChars(String(value ?? "")).trim();
  if (!raw) {
    if (required) throw new Error(`حقل «${label}» مطلوب.`);
    return "";
  }
  if (looksMalicious(raw) || raw.length > 500) throw new Error(`حقل «${label}» غير صالح.`);
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    throw new Error(`حقل «${label}» يجب أن يكون رابط http أو https صالحاً.`);
  }
}

// ---------------------------------------------------------------------------
// معرّفات عشوائية غير متتابعة (رقم العميل / رقم الشكوى)
// ---------------------------------------------------------------------------

/** أبجدية Crockford بلا محارف ملتبسة (0/O و1/I/L) لتقليل الخطأ البشري. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomBytesSafe(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const g: any = globalThis as any;
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(out);
    return out;
  }
  // ارتداد (بيئة اختبار قديمة فقط)
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** توليد رمز عشوائي آمن بطول محدّد من أبجدية غير ملتبسة. */
export function randomCode(length: number): string {
  const bytes = randomBytesSafe(length * 2);
  let out = "";
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    const v = bytes[i];
    // رفض القيم التي تسبب انحيازاً (rejection sampling)
    if (v >= 256 - (256 % CODE_ALPHABET.length)) continue;
    out += CODE_ALPHABET[v % CODE_ALPHABET.length];
  }
  while (out.length < length) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** رقم العميل: 8 خانات أرقام وحروف، عشوائي تماماً وغير متتابع. */
export function generateClientCode(): string {
  return randomCode(8);
}

/** رقم الشكوى: بادئة + 10 خانات عشوائية (لا يمكن تخمين شكوى غيرك). */
export function generateTicketCode(): string {
  return `CT-${randomCode(10)}`;
}

export function isValidClientCode(v: unknown): boolean {
  return typeof v === "string" && new RegExp(`^[${CODE_ALPHABET}]{8}$`).test(v.trim().toUpperCase());
}

export function isValidTicketCode(v: unknown): boolean {
  return typeof v === "string" && new RegExp(`^CT-[${CODE_ALPHABET}]{10}$`).test(v.trim().toUpperCase());
}

/** تطبيع رمز مُدخل من المستخدم (حروف كبيرة، بلا مسافات/شرطات زائدة). */
export function normalizeCode(v: unknown): string {
  return String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// كلمات المرور
// ---------------------------------------------------------------------------

const WEAK_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "qwerty123",
  "11111111", "00000000", "abcd1234", "admin123", "iloveyou", "welcome1",
]);

/** سياسة كلمة المرور: 8 أحرف على الأقل، حرف ورقم، وليست من الشائعة. */
export function checkPassword(pw: string): { ok: boolean; message: string } {
  const s = String(pw ?? "");
  if (s.length < 8) return { ok: false, message: "كلمة المرور يجب ألا تقل عن 8 أحرف." };
  if (s.length > 72) return { ok: false, message: "كلمة المرور طويلة جداً (72 حرفاً كحد أقصى)." };
  if (!/[A-Za-z\u0600-\u06FF]/.test(s) || !/\d/.test(s)) {
    return { ok: false, message: "كلمة المرور يجب أن تحتوي على حروف وأرقام معاً." };
  }
  if (WEAK_PASSWORDS.has(s.toLowerCase())) return { ok: false, message: "كلمة المرور شائعة جداً — اختر كلمة أقوى." };
  return { ok: true, message: "" };
}
