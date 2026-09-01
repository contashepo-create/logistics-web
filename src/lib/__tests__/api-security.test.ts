// اختبارات المسارات الجديدة: طلب الاشتراك (بلا تخزين صور) + الشكاوى العامة
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  userClient: vi.fn(),
  extractAccessToken: vi.fn(() => "tok"),
  serviceClient: vi.fn(),
  hasServiceKey: vi.fn(() => true),
  notifyAdmin: vi.fn(async () => true),
  escapeTelegramHtml: vi.fn((s: string) => String(s).replace(/</g, "&lt;")),
  sendPhotoToAdmin: vi.fn(async () => true),
  createComplaint: vi.fn(),
  trackComplaint: vi.fn(),
  replyToComplaint: vi.fn(),
}));

vi.mock("@/lib/server/supabase", () => ({
  requireUser: mocks.requireUser,
  requireAdmin: mocks.requireAdmin,
  userClient: mocks.userClient,
  extractAccessToken: mocks.extractAccessToken,
  serviceClient: mocks.serviceClient,
  hasServiceKey: mocks.hasServiceKey,
}));
vi.mock("@/lib/server/admin-session", () => ({
  sameOrigin: () => true,
  COOKIE_NAME: "admin_2fa",
  verifyTwoFactorToken: () => true,
  COOKIE_OPTIONS: { httpOnly: true, secure: false, sameSite: "strict", path: "/", maxAge: 1 },
}));
vi.mock("@/lib/server/telegram", () => ({
  notifyAdmin: mocks.notifyAdmin,
  escapeTelegramHtml: mocks.escapeTelegramHtml,
}));
vi.mock("@/lib/server/telegram-photo", () => ({
  sendPhotoToAdmin: mocks.sendPhotoToAdmin,
  detectImageMime: (b: Uint8Array) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg" : null),
  MAX_PHOTO_BYTES: 3 * 1024 * 1024,
}));
vi.mock("@/lib/server/complaints", () => ({
  createComplaint: mocks.createComplaint,
  trackComplaint: mocks.trackComplaint,
  replyToComplaint: mocks.replyToComplaint,
}));

import { POST as subRequest } from "@/app/api/subscription/request/route";
import { POST as complaints } from "@/app/api/complaints/route";

let ipCounter = 0;
function jsonReq(body: unknown): any {
  ipCounter += 1;
  return {
    method: "POST",
    headers: new Headers({ "content-type": "application/json", "x-forwarded-for": `10.0.0.${ipCounter % 250}` }),
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function formReq(fields: Record<string, string>, file?: { bytes: number[]; size?: number }): any {
  ipCounter += 1;
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) {
    const blob = new Blob([new Uint8Array(file.bytes)], { type: "image/jpeg" });
    Object.defineProperty(blob, "size", { value: file.size ?? file.bytes.length });
    fd.set("receipt", blob as any, "r.jpg");
  }
  return {
    method: "POST",
    headers: new Headers({ "x-forwarded-for": `10.1.0.${ipCounter % 250}`, authorization: "Bearer tok" }),
    formData: async () => fd,
  };
}

function sbStub(over: Record<string, any> = {}) {
  const q: any = {
    select: () => q, eq: () => q, insert: () => q, update: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: over.row ?? { company_id: "c1", name: "شركة", client_code: "AB23CD45" } }),
    single: async () => ({ data: over.inserted ?? { id: "r1" }, error: over.error ?? null }),
  };
  return { from: () => q };
}

const okFields = {
  plan_type: "monthly", request_kind: "renew", amount: "114",
  payer_name: "أحمد محمد", payer_phone: "01000000000", pay_method: "instapay",
  transfer_ref: "TX-1", notes: "تم التحويل",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasServiceKey.mockReturnValue(true);
  // مستخدم مختلف لكل نداء حتى لا يتداخل تقييد المعدل بين الاختبارات
  mocks.requireUser.mockImplementation(async () => ({ id: `u${++ipCounter}`, email: "u@gmail.com" }));
  mocks.userClient.mockReturnValue(sbStub());
});

describe("POST /api/subscription/request", () => {
  it("يرفض غير المسجّل", async () => {
    mocks.requireUser.mockResolvedValue(null);
    const res = await subRequest(formReq(okFields));
    expect(res.status).toBe(401);
  });

  it("يقبل طلباً صحيحاً ويُشعر المطوّر", async () => {
    const res = await subRequest(formReq(okFields));
    expect(res.status).toBe(200);
    expect(mocks.notifyAdmin).toHaveBeenCalled();
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("يرفض الباقة أو نوع الطلب غير الصالحين", async () => {
    expect((await subRequest(formReq({ ...okFields, plan_type: "open" }))).status).toBe(400);
    expect((await subRequest(formReq({ ...okFields, request_kind: "hack" }))).status).toBe(400);
    expect((await subRequest(formReq({ ...okFields, pay_method: "'; drop table" }))).status).toBe(400);
  });

  it("يرفض المبالغ غير المنطقية", async () => {
    expect((await subRequest(formReq({ ...okFields, amount: "-5" }))).status).toBe(400);
    expect((await subRequest(formReq({ ...okFields, amount: "99999999" }))).status).toBe(400);
    expect((await subRequest(formReq({ ...okFields, amount: "abc" }))).status).toBe(400);
  });

  it("يرفض محاولات الحقن في الحقول النصية", async () => {
    const res = await subRequest(formReq({ ...okFields, payer_name: "<script>alert(1)</script>" }));
    expect(res.status).toBe(400);
    const res2 = await subRequest(formReq({ ...okFields, notes: "1 UNION SELECT password FROM profiles" }));
    expect(res2.status).toBe(400);
  });

  it("يمرّر الصورة إلى تليجرام ولا يخزّنها", async () => {
    const res = await subRequest(formReq(okFields, { bytes: [0xff, 0xd8, 0xff, 0x00, 1, 2, 3] }));
    expect(res.status).toBe(200);
    expect(mocks.sendPhotoToAdmin).toHaveBeenCalled();
  });

  it("يرفض الملفات غير الصور (بالبصمة لا بالامتداد)", async () => {
    const res = await subRequest(formReq(okFields, { bytes: [0x4d, 0x5a, 0x90, 0x00] })); // ملف تنفيذي
    expect(res.status).toBe(400);
    expect(mocks.sendPhotoToAdmin).not.toHaveBeenCalled();
  });

  it("يرفض الصور الأكبر من الحد", async () => {
    const res = await subRequest(formReq(okFields, { bytes: [0xff, 0xd8, 0xff], size: 9_000_000 }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/complaints", () => {
  it("ينشئ شكوى ويعيد رقم تتبّع", async () => {
    mocks.createComplaint.mockResolvedValue({ ticket: "CT-ABCDEFGHJK" });
    const res = await complaints(jsonReq({ action: "create", name: "زائر", email: "v@gmail.com", subject: "مشكلة", body: "تفاصيل كافية جداً" }));
    const out = await res.json();
    expect(out.success).toBe(true);
    expect(out.ticket).toBe("CT-ABCDEFGHJK");
    expect(mocks.notifyAdmin).toHaveBeenCalled();
  });

  it("يتجاهل الروبوتات عبر حقل الفخّ دون كتابة شيء", async () => {
    const res = await complaints(jsonReq({ action: "create", website: "http://spam", name: "x", email: "a@b.co" }));
    expect((await res.json()).success).toBe(true);
    expect(mocks.createComplaint).not.toHaveBeenCalled();
  });

  it("يتتبّع الشكوى بالرقم والبريد", async () => {
    mocks.trackComplaint.mockResolvedValue({ ticket: "CT-ABCDEFGHJK", subject: "س", status: "open", created_at: "", messages: [] });
    const res = await complaints(jsonReq({ action: "track", ticket: "CT-ABCDEFGHJK", email: "v@gmail.com" }));
    expect((await res.json()).complaint.ticket).toBe("CT-ABCDEFGHJK");
  });

  it("يعيد خطأ موحّداً عند رقم/بريد غير مطابقين", async () => {
    mocks.trackComplaint.mockRejectedValue(new Error("لا توجد شكوى بهذا الرقم مع هذا البريد."));
    const res = await complaints(jsonReq({ action: "track", ticket: "CT-2222222222", email: "x@gmail.com" }));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("لا توجد شكوى");
  });

  it("يرفض الأجسام الضخمة والصيغ غير JSON", async () => {
    const huge: any = {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }),
      text: async () => "x".repeat(30_000),
    };
    expect((await complaints(huge)).status).toBe(400);
    const notJson: any = {
      method: "POST", headers: new Headers({ "content-type": "text/plain", "x-forwarded-for": "10.9.9.8" }),
      text: async () => "hi",
    };
    expect((await complaints(notJson)).status).toBe(400);
  });

  it("يرفض الإجراءات المجهولة", async () => {
    const res = await complaints(jsonReq({ action: "delete_all" }));
    expect(res.status).toBe(400);
  });

  it("يقيّد إنشاء الشكاوى بثلاث في الساعة لكل IP", async () => {
    mocks.createComplaint.mockResolvedValue({ ticket: "CT-1111111111" });
    const ip = "77.77.77.77";
    const mk = () => ({
      method: "POST",
      headers: new Headers({ "content-type": "application/json", "x-forwarded-for": ip }),
      text: async () => JSON.stringify({ action: "create", name: "زائر", email: "v@gmail.com", subject: "س", body: "تفاصيل كافية" }),
    }) as any;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await complaints(mk())).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(2);
  });
});
