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
  const domain = email.split("@")[1] ?? "";
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
  if (looksMalicious(raw)) throw new Error(`المحتوى المُدخل في «${label}» غير مسموح به.`);
  const s = sanitizeText(raw, max);
  if (required && s.length === 0) throw new Error(`حقل «${label}» مطلوب.`);
  if (s.length > 0 && s.length < min) throw new Error(`حقل «${label}» قصير جداً (${min} حرفاً على الأقل).`);
  return s;
}

/** تحقق من رقم هاتف بسيط (أرقام ومسافات و + فقط). */
export function safePhone(value: unknown, required = false): string {
  const s = sanitizeText(value, 24).replace(/[^\d+\s-]/g, "").trim();
  if (required && s.replace(/\D/g, "").length < 7) throw new Error("رقم الهاتف غير صحيح.");
  return s;
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
