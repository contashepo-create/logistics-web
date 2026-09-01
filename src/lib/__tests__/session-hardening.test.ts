import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.ADMIN_2FA_SECRET = "test-secret-for-session-hardening";
});

async function mod() {
  return await import("@/lib/server/admin-session");
}

function req(headers: Record<string, string>) {
  return new Request("https://app.example.com/api/x", { method: "POST", headers });
}

describe("كوكي جلسة 2FA", () => {
  it("خيارات الكوكي محصّنة: httpOnly و SameSite=Strict و Path=/", async () => {
    const { COOKIE_OPTIONS } = await mod();
    expect(COOKIE_OPTIONS.httpOnly).toBe(true);
    expect(COOKIE_OPTIONS.sameSite).toBe("strict");
    expect(COOKIE_OPTIONS.path).toBe("/");
    expect(COOKIE_OPTIONS.maxAge).toBe(12 * 60 * 60);
  });

  it("اسم الكوكي بلا بادئة __Host- خارج الإنتاج (لأن Secure غير متاح على http)", async () => {
    const { COOKIE_NAME, COOKIE_OPTIONS } = await mod();
    // في بيئة الاختبار NODE_ENV=test
    expect(COOKIE_NAME).toBe("admin_2fa");
    expect(COOKIE_OPTIONS.secure).toBe(false);
  });

  it("الرمز موقّع ويُقبل لصاحبه فقط", async () => {
    const { createTwoFactorToken, verifyTwoFactorToken } = await mod();
    const t = createTwoFactorToken("dev@example.com");
    expect(verifyTwoFactorToken(t, "dev@example.com")).toBe(true);
    expect(verifyTwoFactorToken(t, "DEV@example.com")).toBe(true);
    expect(verifyTwoFactorToken(t, "other@example.com")).toBe(false);
  });

  it("يرفض رمزاً معدَّلاً أو مزوَّراً", async () => {
    const { createTwoFactorToken, verifyTwoFactorToken } = await mod();
    const t = createTwoFactorToken("dev@example.com");
    const [body, sig] = t.split(".");
    expect(verifyTwoFactorToken(`${body}.${"0".repeat(sig.length)}`)).toBe(false);
    expect(verifyTwoFactorToken(`${body}x.${sig}`)).toBe(false);
    expect(verifyTwoFactorToken("")).toBe(false);
    expect(verifyTwoFactorToken(undefined)).toBe(false);
    // محاولة صياغة حمولة جديدة بلا توقيع صحيح
    const forged = Buffer.from(
      JSON.stringify({ email: "dev@example.com", exp: Date.now() + 1e6, jti: "x" })
    ).toString("base64url");
    expect(verifyTwoFactorToken(`${forged}.deadbeef`)).toBe(false);
  });

  it("كل رمز فريد (jti) فلا يمكن تمييزه/إعادة توليده", async () => {
    const { createTwoFactorToken } = await mod();
    const a = createTwoFactorToken("dev@example.com");
    const b = createTwoFactorToken("dev@example.com");
    expect(a).not.toBe(b);
  });

  it("رمز منتهي الصلاحية يُرفض", async () => {
    const { verifyTwoFactorToken } = await mod();
    const { createHmac } = await import("crypto");
    const payload = Buffer.from(
      JSON.stringify({ email: "dev@example.com", exp: Date.now() - 1000, jti: "x" })
    ).toString("base64url");
    const sig = createHmac("sha256", process.env.ADMIN_2FA_SECRET!).update(payload).digest("hex");
    expect(verifyTwoFactorToken(`${payload}.${sig}`)).toBe(false);
  });

  it("OTP دائماً 6 أرقام", async () => {
    const { generateOtp } = await mod();
    for (let i = 0; i < 50; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });
});

describe("حماية CSRF (فحص الأصل)", () => {
  it("يقبل نفس المضيف من Origin أو Referer", async () => {
    const { sameOrigin } = await mod();
    expect(sameOrigin(req({ host: "app.example.com", origin: "https://app.example.com" }))).toBe(true);
    expect(
      sameOrigin(req({ host: "app.example.com", referer: "https://app.example.com/zerocold" }))
    ).toBe(true);
  });

  it("يرفض أصلاً خارجياً أو نطاقاً فرعياً مزوَّراً", async () => {
    const { sameOrigin } = await mod();
    expect(sameOrigin(req({ host: "app.example.com", origin: "https://evil.com" }))).toBe(false);
    expect(sameOrigin(req({ host: "app.example.com", origin: "https://app.example.com.evil.com" }))).toBe(false);
    expect(sameOrigin(req({ host: "app.example.com", origin: "null" }))).toBe(false);
  });
});
