// اختبارات وحدات الأمان الخادمية: تقييد المعدل، مخزن OTP، وجلسة 2FA.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// rate-limit.ts (وحدات خالصة — لا اعتماد على Next أو خادم)
// ---------------------------------------------------------------------------
import { sanitizeIp, clientIp, rateLimit } from "@/lib/server/rate-limit";

describe("sanitizeIp / clientIp", () => {
  it("يقبل عنوان IPv4 صالحاً", () => {
    expect(sanitizeIp("192.168.1.10")).toBe("192.168.1.10");
    expect(sanitizeIp(" 10.0.0.1 ")).toBe("10.0.0.1");
  });
  it("يرفض IPv4 بثمانيات خارجة عن النطاق", () => {
    expect(sanitizeIp("999.1.1.1")).toBe("unknown");
    expect(sanitizeIp("1.2.3.256")).toBe("unknown");
  });
  it("يقبل IPv6 صالحاً و ::ffff: المغلّف", () => {
    expect(sanitizeIp("::1")).toBe("::1");
    expect(sanitizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(sanitizeIp("::ffff:192.0.2.1")).toBe("::ffff:192.0.2.1");
  });
  it("يرفض أي صيغة قد تُحقن في الفلاتر", () => {
    expect(sanitizeIp("")).toBe("unknown");
    expect(sanitizeIp("unknown")).toBe("unknown");
    expect(sanitizeIp("abc' OR '1'='1")).toBe("unknown");
    expect(sanitizeIp("1.2.3.4; DROP TABLE")).toBe("unknown");
  });
  it("clientIp يقرأ x-forwarded-for ثم x-real-ip ثم مجهول", () => {
    const req = (headers: Record<string, string>) =>
      ({ headers: { get: (k: string) => headers[k] ?? null } }) as unknown as Request;
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(req({}))).toBe("unknown");
    expect(clientIp(req({ "x-forwarded-for": "evil" }))).toBe("unknown");
  });
});

describe("rateLimit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("يسمح حتى الحد ثم يرفض", () => {
    const key = "test:1.2.3.4";
    expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
  it("يعيد الضبط بعد انقضاء النافذة", () => {
    const key = "test2";
    expect(rateLimit(key, 1, 60_000).allowed).toBe(true);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(true);
  });
  it("يعزل المفاتيح عن بعضها", () => {
    expect(rateLimit("a", 1, 60_000).allowed).toBe(true);
    expect(rateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(rateLimit("b", 1, 60_000).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// otp-store.ts — بصمة hash + محاولات + مهلة + تهدئة
// ---------------------------------------------------------------------------
import {
  issueOtp, verifyOtp, canResend, clearOtp,
} from "@/lib/server/otp-store";

const EMAIL = "admin@test.com";

describe("otp-store", () => {
  beforeEach(() => {
    clearOtp(EMAIL);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("يتحقق من الرمز الصحيح مرة واحدة ثم يبطل", () => {
    issueOtp(EMAIL, "123456");
    expect(verifyOtp(EMAIL, "123456")).toEqual({ ok: true });
    expect(verifyOtp(EMAIL, "123456")).toEqual({ ok: false, reason: "missing" });
  });
  it("يرفض الرمز الخاطئ ويعيد عدد المحاولات المتبقية", () => {
    issueOtp(EMAIL, "123456");
    expect(verifyOtp(EMAIL, "000000")).toEqual({ ok: false, reason: "invalid", remaining: 4 });
    expect(verifyOtp(EMAIL, "000000")).toEqual({ ok: false, reason: "invalid", remaining: 3 });
    // الرمز الصحيح ما زال يعمل بعد محاولات خاطئة
    expect(verifyOtp(EMAIL, "123456")).toEqual({ ok: true });
  });
  it("يقفل بعد 5 محاولات خاطئة", () => {
    issueOtp(EMAIL, "123456");
    for (let i = 0; i < 5; i++) verifyOtp(EMAIL, "000000");
    expect(verifyOtp(EMAIL, "123456")).toEqual({ ok: false, reason: "locked" });
  });
  it("ينتهي بعد 5 دقائق", () => {
    issueOtp(EMAIL, "123456");
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(verifyOtp(EMAIL, "123456")).toEqual({ ok: false, reason: "expired" });
  });
  it("يدير تهدئة إعادة الإرسال (60 ثانية)", () => {
    expect(canResend(EMAIL)).toBe(true);
    issueOtp(EMAIL, "123456");
    expect(canResend(EMAIL)).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(canResend(EMAIL)).toBe(true);
  });
  it("يرفض عند عدم وجود رمز", () => {
    expect(verifyOtp(EMAIL, "123456")).toEqual({ ok: false, reason: "missing" });
  });
  it("يميّز بين الحروف الكبيرة والصغيرة في البريد", () => {
    issueOtp(EMAIL, "123456");
    expect(verifyOtp(EMAIL.toUpperCase(), "123456")).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// admin-session.ts — كوكي موقّع HMAC + توليد OTP آمن
// ---------------------------------------------------------------------------
describe("admin-session", () => {
  const OLD = process.env.ADMIN_2FA_SECRET;
  beforeEach(() => {
    process.env.ADMIN_2FA_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.ADMIN_2FA_SECRET;
    else process.env.ADMIN_2FA_SECRET = OLD;
  });

  it("generateOtp يعيد 6 أرقام دائماً", async () => {
    const { generateOtp } = await import("@/lib/server/admin-session");
    for (let i = 0; i < 50; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("token صالح خلال 12 ساعة ويتحقق من البريد", async () => {
    const m = await import("@/lib/server/admin-session");
    const tok = m.createTwoFactorToken("conta.moha@gmail.com");
    expect(m.verifyTwoFactorToken(tok, "conta.moha@gmail.com")).toBe(true);
    expect(m.verifyTwoFactorToken(tok, "other@test.com")).toBe(false);
    expect(m.verifyTwoFactorToken(undefined)).toBe(false);
    expect(m.verifyTwoFactorToken("junk.token")).toBe(false);
  });

  it("يرفض token المزوّر (توقيع غير مطابق)", async () => {
    const m = await import("@/lib/server/admin-session");
    const tok = m.createTwoFactorToken("conta.moha@gmail.com");
    const [body] = tok.split(".");
    expect(m.verifyTwoFactorToken(`${body}.deadbeef`)).toBe(false);
  });

  it("يرفض كل شيء عند غياب السر", async () => {
    delete process.env.ADMIN_2FA_SECRET;
    vi.resetModules();
    const m = await import("@/lib/server/admin-session");
    const tok = m.createTwoFactorToken("conta.moha@gmail.com");
    expect(m.verifyTwoFactorToken(tok)).toBe(false);
    vi.resetModules();
  });
});
