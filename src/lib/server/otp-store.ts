// مخزن OTP للوحة المطوّر (in-memory): يحفظ بصمة الرمز + المحاولات + المهلة.
import "server-only";
import { createHash, timingSafeEqual } from "crypto";

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

interface OtpRecord {
  hash: string;
  expiresAt: number;
  attempts: number;
  lastResendAt: number;
  issuedAt: number;
}

const store = new Map<string, OtpRecord>();

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

export function issueOtp(email: string, code: string): void {
  store.set(email.toLowerCase(), {
    hash: sha256(code),
    expiresAt: Date.now() + TTL_MS,
    attempts: 0,
    lastResendAt: Date.now(),
    issuedAt: Date.now(),
  });
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "locked" | "missing"; remaining?: number };

export function verifyOtp(email: string, code: string): VerifyResult {
  const rec = store.get(email.toLowerCase());
  if (!rec) return { ok: false, reason: "missing" };
  if (Date.now() > rec.expiresAt) {
    store.delete(email.toLowerCase());
    return { ok: false, reason: "expired" };
  }
  if (rec.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  const a = Buffer.from(rec.hash);
  const b = Buffer.from(sha256(code));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    rec.attempts += 1;
    if (rec.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
    return { ok: false, reason: "invalid", remaining: MAX_ATTEMPTS - rec.attempts };
  }
  store.delete(email.toLowerCase());
  return { ok: true };
}

export function canResend(email: string): boolean {
  const rec = store.get(email.toLowerCase());
  if (!rec) return true;
  return Date.now() - rec.lastResendAt >= RESEND_COOLDOWN_MS;
}

export function clearOtp(email: string): void {
  store.delete(email.toLowerCase());
}
