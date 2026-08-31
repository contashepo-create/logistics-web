// جلسة 2FA للوحة المطوّر: رمز ممضى (HMAC) في كوكي httpOnly.
// لا يُستخدم JWT عام — السر خاص بالخادم ولا يغادر الخادم أبداً.
import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";

const SECRET = process.env.ADMIN_2FA_SECRET || "";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 ساعة
export const COOKIE_NAME = "admin_2fa";

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

interface Payload {
  email: string;
  exp: number;
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
  return encode({ email, exp: Date.now() + TTL_MS });
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
