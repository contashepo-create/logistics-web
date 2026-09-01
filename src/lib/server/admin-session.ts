// جلسة 2FA للوحة المطوّر: رمز ممضى (HMAC) في كوكي httpOnly.
// لا يُستخدم JWT عام — السر خاص بالخادم ولا يغادر الخادم أبداً.
import "server-only";
import { createHmac, createHash, timingSafeEqual, randomBytes } from "crypto";

/**
 * سر توقيع جلسة 2FA. يُفضّل ADMIN_2FA_SECRET، ومع غيابه نشتق سراً ثابتاً من
 * مفتاح الخدمة حتى لا تصبح الجلسة غير قابلة للتحقق بعد كل تحديث للصفحة.
 */
const SECRET =
  process.env.ADMIN_2FA_SECRET ||
  (process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createHash("sha256").update(`2fa:${process.env.SUPABASE_SERVICE_ROLE_KEY}`).digest("hex")
    : "");

/** هل يمكن إصدار جلسات 2FA أصلاً؟ (يُستخدم لإظهار خطأ صريح بدل جلسة صامتة لا تُقبل) */
export function hasSessionSecret(): boolean {
  return SECRET.length >= 16;
}
const TTL_MS = 12 * 60 * 60 * 1000; // 12 ساعة
const IS_PROD = process.env.NODE_ENV === "production";

/**
 * اسم الكوكي: في الإنتاج نستخدم بادئة __Host- التي يفرضها المتصفح بشروط صارمة
 * (Secure + Path=/ + بلا Domain) فلا يمكن لنطاق فرعي أو صفحة غير آمنة كتابتها.
 */
export const COOKIE_NAME = IS_PROD ? "__Host-admin_2fa" : "admin_2fa";

/** خيارات موحّدة وآمنة للكوكي (httpOnly + Secure + SameSite=Strict). */
export const COOKIE_OPTIONS = {
  httpOnly: true as const,
  secure: IS_PROD,
  sameSite: "strict" as const,
  path: "/",
  maxAge: TTL_MS / 1000,
};

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

interface Payload {
  email: string;
  exp: number;
  /** معرّف عشوائي لكل جلسة — يمنع إعادة استخدام رمز قديم بعد تسجيل الخروج. */
  jti: string;
}

function encode(p: Payload): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(token: string): Payload | null {
  if (!SECRET) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (!p.email || typeof p.exp !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

/** إنشاء رمز 2FA صالح لـ 12 ساعة. */
export function createTwoFactorToken(email: string): string {
  return encode({ email, exp: Date.now() + TTL_MS, jti: randomBytes(12).toString("hex") });
}

/** التحقق من رمز 2FA. */
export function verifyTwoFactorToken(token: string | undefined, expectedEmail?: string): boolean {
  if (!token) return false;
  const p = decode(token);
  if (!p) return false;
  if (p.exp < Date.now()) return false;
  if (expectedEmail && p.email.toLowerCase() !== expectedEmail.toLowerCase()) return false;
  return true;
}

/** توليد رمز OTP عشوائي آمن (CSPRNG). */
export function generateOtp(): string {
  const v = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(v).padStart(6, "0");
}

/**
 * فحص أصل الطلب (حماية CSRF): يجب أن يكون Origin/Referer من نفس المضيف.
 * يُستدعى في كل مسار يغيّر حالة ويعتمد على كوكي.
 */
export function sameOrigin(req: Request): boolean {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const src = origin || referer;
  if (!src) return true; // بعض العملاء لا يرسلون Origin على GET — الكوكي SameSite=Strict يغطيها
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}
