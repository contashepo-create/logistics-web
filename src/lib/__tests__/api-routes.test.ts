// اختبارات مسارات API (2FA + إشعار المطوّر) مع محاكاة التبعيات الخادمية.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
  userClient: vi.fn(),
  extractAccessToken: vi.fn(),
  // admin-session
  COOKIE_NAME: "admin_2fa",
  createTwoFactorToken: vi.fn(),
  verifyTwoFactorToken: vi.fn(),
  generateOtp: vi.fn(),
  // telegram
  sendTelegramCode: vi.fn(),
  notifyAdmin: vi.fn(),
  notifyAdminWithPhoto: vi.fn(),
  escapeTelegramHtml: vi.fn((s: string) => String(s).replace(/</g, "&lt;")),
}));

vi.mock("@/lib/server/supabase", () => ({
  requireAdmin: mocks.requireAdmin,
  requireUser: mocks.requireUser,
  userClient: mocks.userClient,
  extractAccessToken: mocks.extractAccessToken,
}));
vi.mock("@/lib/server/admin-session", () => ({
  COOKIE_NAME: mocks.COOKIE_NAME,
  createTwoFactorToken: mocks.createTwoFactorToken,
  verifyTwoFactorToken: mocks.verifyTwoFactorToken,
  generateOtp: mocks.generateOtp,
}));
vi.mock("@/lib/server/telegram", () => ({
  sendTelegramCode: mocks.sendTelegramCode,
  notifyAdmin: mocks.notifyAdmin,
  notifyAdminWithPhoto: mocks.notifyAdminWithPhoto,
  escapeTelegramHtml: mocks.escapeTelegramHtml,
}));

import { POST as verifyPost } from "@/app/api/admin/2fa/verify/route";
import { POST as sendPost } from "@/app/api/admin/2fa/send/route";
import { GET as statusGet } from "@/app/api/admin/2fa/status/route";
import { POST as notifyPost } from "@/app/api/notify-admin/route";

function fakeReq(over: {
  headers?: Record<string, string>;
  body?: unknown;
  cookie?: string;
} = {}): any {
  const headers = over.headers ?? {};
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => over.body ?? {},
    cookies: { get: (name: string) => (name === mocks.COOKIE_NAME && over.cookie ? { value: over.cookie } : undefined) },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "a1", email: "conta.moha@gmail.com" });
  // تنظيف حالة otp-store (تهدئة إعادة الإرسال) بين الاختبارات
  const otp = await import("@/lib/server/otp-store");
  otp.clearOtp("conta.moha@gmail.com");
});

describe("POST /api/admin/2fa/verify", () => {
  it("يرفض غير المطوّر (403)", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    const res = await verifyPost(fakeReq({ body: { code: "123456" } }));
    expect(res.status).toBe(403);
  });
  it("يرفض رمزاً بغير 6 أرقام (400)", async () => {
    const res = await verifyPost(fakeReq({ body: { code: "12" } }));
    expect(res.status).toBe(400);
  });
  it("يرفض جسماً غير JSON (400)", async () => {
    const r = fakeReq();
    r.json = async () => { throw new Error("bad"); };
    expect((await verifyPost(r)).status).toBe(400);
  });
  it("يثبّت كوكي 2FA عند التحقق الناجح", async () => {
    mocks.createTwoFactorToken.mockReturnValue("signed-token");
    // verifyOtp (الحقيقي) يحتاج رمزاً صادراً — نحقن عبر otp-store الحقيقي
    const otp = await import("@/lib/server/otp-store");
    otp.issueOtp("conta.moha@gmail.com", "123456");
    const res = await verifyPost(fakeReq({ body: { code: "123456" } }));
    expect(res.status).toBe(200);
    const setCookie = res.cookies.get(mocks.COOKIE_NAME);
    expect(setCookie).toBeDefined();
    expect(setCookie!.httpOnly).toBe(true);
    expect(setCookie!.sameSite).toBe("strict");
  });
  it("يرفض رمزاً خاطئاً (401)", async () => {
    const otp = await import("@/lib/server/otp-store");
    otp.issueOtp("conta.moha@gmail.com", "999999");
    const res = await verifyPost(fakeReq({ body: { code: "000000" } }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/2fa/send", () => {
  it("يرفض غير المطوّر (403)", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    expect((await sendPost(fakeReq())).status).toBe(403);
  });
  it("يعيد 503 عند فشل إرسال تليجرام", async () => {
    mocks.generateOtp.mockReturnValue("654321");
    mocks.sendTelegramCode.mockResolvedValue(false);
    const res = await sendPost(fakeReq());
    expect(res.status).toBe(503);
  });
  it("يصدر OTP عند نجاح الإرسال", async () => {
    mocks.generateOtp.mockReturnValue("111222");
    mocks.sendTelegramCode.mockResolvedValue(true);
    const res = await sendPost(fakeReq());
    expect(res.status).toBe(200);
    expect(mocks.sendTelegramCode).toHaveBeenCalledWith("111222");
    // الرمز أصبح قابل للتحقق
    const otp = await import("@/lib/server/otp-store");
    expect(otp.verifyOtp("conta.moha@gmail.com", "111222")).toEqual({ ok: true });
  });
});

describe("GET /api/admin/2fa/status", () => {
  it("يرفض غير المطوّر (403)", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    expect((await statusGet(fakeReq())).status).toBe(403);
  });
  it("يعيد verified حسب الرمز في الكوكي", async () => {
    mocks.verifyTwoFactorToken.mockReturnValue(true);
    const res = await statusGet(fakeReq({ cookie: "tok" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, verified: true });
    expect(mocks.verifyTwoFactorToken).toHaveBeenCalledWith("tok", "conta.moha@gmail.com");
  });
  it("يعيد verified=false عند غياب الكوكي", async () => {
    mocks.verifyTwoFactorToken.mockReturnValue(false);
    const res = await statusGet(fakeReq());
    expect((await res.json()).verified).toBe(false);
  });
});

describe("POST /api/notify-admin", () => {
  beforeEach(() => {
    mocks.requireUser.mockResolvedValue({ id: "u1", email: "owner@x.com" });
    mocks.extractAccessToken.mockReturnValue("jwt");
  });

  it("يرفض غير المسجّل (401)", async () => {
    mocks.requireUser.mockResolvedValue(null);
    expect((await notifyPost(fakeReq({ body: { request_id: "00000000-0000-0000-0000-000000000001" } }))).status).toBe(401);
  });
  it("يرفض معرّفاً بغير صيغة UUID (400)", async () => {
    expect((await notifyPost(fakeReq({ body: { request_id: "not-a-uuid" } }))).status).toBe(400);
  });
  it("يرفض جسماً غير JSON (400)", async () => {
    const r = fakeReq();
    r.json = async () => { throw new Error("bad"); };
    expect((await notifyPost(r)).status).toBe(400);
  });
  it("يعيد 404 لطلب غير موجود", async () => {
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    mocks.userClient.mockReturnValue(client);
    const res = await notifyPost(fakeReq({ body: { request_id: "00000000-0000-0000-0000-000000000001" } }));
    expect(res.status).toBe(404);
  });
  it("يقرأ تفاصيل الطلب من قاعدة البيانات ويرسل الإشعار", async () => {
    const reqRow = { id: "00000000-0000-0000-0000-000000000001", company_id: "c1", plan_type: "yearly", status: "pending", receipt_url: null, notes: "note", created_at: "2026-08-31T00:00:00" };
    const from = vi.fn((table: string) => {
      if (table === "activation_requests") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: reqRow, error: null }) }) }) };
      }
      if (table === "companies") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "شركتي" }, error: null }) }) }) };
      }
      return {};
    });
    mocks.userClient.mockReturnValue({ from });
    mocks.notifyAdmin.mockResolvedValue(true);
    const res = await notifyPost(fakeReq({ body: { request_id: reqRow.id } }));
    expect(res.status).toBe(200);
    expect(mocks.notifyAdmin).toHaveBeenCalledWith(expect.stringContaining("شركتي"));
    expect(mocks.notifyAdmin).toHaveBeenCalledWith(expect.stringContaining("سنوي"));
  });
  it("يرسل الصورة عند وجود وصل", async () => {
    const reqRow = { id: "00000000-0000-0000-0000-000000000001", company_id: "c1", plan_type: "monthly", status: "pending", receipt_url: "https://x/r.png", notes: null, created_at: "2026-08-31" };
    mocks.userClient.mockReturnValue({
      from: (table: string) => {
        if (table === "activation_requests") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: reqRow, error: null }) }) }) };
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "س" }, error: null }) }) }) };
      },
    });
    mocks.notifyAdminWithPhoto.mockResolvedValue(true);
    const res = await notifyPost(fakeReq({ body: { request_id: reqRow.id } }));
    expect(res.status).toBe(200);
    expect(mocks.notifyAdminWithPhoto).toHaveBeenCalledWith(expect.any(String), "https://x/r.png");
  });
});
