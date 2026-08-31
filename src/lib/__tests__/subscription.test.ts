// اختبارات نظام الاشتراك: الدوال الخالصة (الحالة/الأسعار/التواريخ) + التفاعل مع Supabase.
import { describe, it, expect, beforeEach, vi } from "vitest";

// supabase مُعطّل هنا؛ نتحكم في سلوكه يدوياً (vi.hoisted لأن vi.mock يُرفع لأعلى الملف)
const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
    storage: { from: vi.fn() },
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: supabaseMock }));

import {
  PRICING, TRIAL_DAYS, CUSTOMER_PLAN_TYPES,
  planLabel, planPrice, endDateForPlan, subscriptionState, isExpired,
  daysLeft, stateLabel, isRequestablePlan,
  submitActivationRequest, listMyActivationRequests, cancelMyActivationRequest,
  uploadReceipt, exportCompanyData,
} from "@/lib/subscription";
import type { Company } from "@/lib/types";

function company(over: Partial<Company> = {}): Company {
  return {
    id: "c1", name: "شركة", phone: "", email: "", address: "", currency: "ر.س",
    vat_rate: 15, vat_note: "", plan_type: "monthly",
    trial_end: null, subscription_start: null, subscription_end: null,
    is_active: true, created_at: "",
    ...over,
  } as Company;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}

describe("ثوابت وأسعار", () => {
  it("يعرض شهري/سنوي فقط للعميل", () => {
    expect(PRICING.monthly).toBe(100);
    expect(PRICING.yearly).toBe(900);
    expect(TRIAL_DAYS).toBe(7);
    expect(CUSTOMER_PLAN_TYPES).toEqual(["monthly", "yearly"]);
  });
  it("planLabel و planPrice", () => {
    expect(planLabel("monthly")).toBe("اشتراك شهري");
    expect(planLabel("yearly")).toBe("اشتراك سنوي");
    expect(planLabel("open")).toBe("اشتراك مفتوح");
    expect(planPrice("monthly")).toBe(100);
    expect(planPrice("yearly")).toBe(900);
    expect(planPrice("open")).toBe(0);
  });
  it("isRequestablePlan يرفض المفتوح", () => {
    expect(isRequestablePlan("monthly")).toBe(true);
    expect(isRequestablePlan("yearly")).toBe(true);
    expect(isRequestablePlan("open")).toBe(false);
    expect(isRequestablePlan("x")).toBe(false);
  });
});

describe("endDateForPlan", () => {
  it("شهري = 30 يوم، سنوي = 365 يوم، مفتوح = null", () => {
    const from = new Date("2026-01-15T00:00:00Z");
    expect(endDateForPlan("monthly", from)).toBe("2026-02-14");
    expect(endDateForPlan("yearly", from)).toBe("2027-01-15");
    expect(endDateForPlan("open", from)).toBeNull();
  });
});

describe("subscriptionState", () => {
  it("none عند غياب الشركة", () => {
    expect(subscriptionState(null)).toBe("none");
  });
  it("suspended عند إيقاف الشركة (له الأولوية على كل شيء)", () => {
    expect(subscriptionState(company({ is_active: false, subscription_end: daysFromNow(30) }))).toBe("suspended");
  });
  it("trial ضمن التجربة المجانية", () => {
    expect(subscriptionState(company({ trial_end: daysFromNow(3), subscription_end: null, plan_type: "monthly" }))).toBe("trial");
  });
  it("active لاشتراك ساري", () => {
    expect(subscriptionState(company({ subscription_end: daysFromNow(10) }))).toBe("active");
  });
  it("active لاشتراك مفتوح بلا تحديد", () => {
    expect(subscriptionState(company({ plan_type: "open", subscription_end: null, trial_end: daysFromNow(-1) }))).toBe("active");
  });
  it("expired بعد انتهاء الاشتراك", () => {
    expect(subscriptionState(company({ subscription_end: daysFromNow(-1), trial_end: daysFromNow(-2) }))).toBe("expired");
  });
  it("expired لخطة محددة بلا مدة انتهاء ولا تجربة", () => {
    expect(subscriptionState(company({ plan_type: "monthly", subscription_end: null, trial_end: null }))).toBe("expired");
  });
  it("isExpired يشمل suspended و none", () => {
    expect(isExpired(company({ is_active: false }))).toBe(true);
    expect(isExpired(null)).toBe(true);
    expect(isExpired(company({ subscription_end: daysFromNow(10) }))).toBe(false);
  });
});

describe("daysLeft / stateLabel", () => {
  it("daysLeft يحسب المتبقي ويفرض حداً أدنى صفراً", () => {
    expect(daysLeft(null)).toBe(0);
    expect(daysLeft(company({ subscription_end: daysFromNow(5) }))).toBeGreaterThanOrEqual(4);
    expect(daysLeft(company({ subscription_end: daysFromNow(-5) }))).toBe(0);
  });
  it("stateLabel يعرض وصفاً مناسباً لكل حالة", () => {
    expect(stateLabel(company({ trial_end: daysFromNow(2), subscription_end: null }))).toContain("تجربة مجانية");
    expect(stateLabel(company({ plan_type: "open", trial_end: daysFromNow(-1) }))).toBe("اشتراك مفتوح");
    expect(stateLabel(company({ subscription_end: daysFromNow(-1) }))).toBe("الاشتراك منتهي");
    expect(stateLabel(company({ is_active: false }))).toBe("الشركة موقوفة");
    expect(stateLabel(null)).toBe("بدون اشتراك");
  });
});

// ---------------------------------------------------------------------------
// التفاعل مع Supabase (mock)
// ---------------------------------------------------------------------------
function chain(over: Record<string, any> = {}) {
  const c: Record<string, any> = {
    select: vi.fn(() => c), insert: vi.fn(() => c), update: vi.fn(() => c),
    delete: vi.fn(() => c), upsert: vi.fn(() => c), eq: vi.fn(() => c),
    neq: vi.fn(() => c), in: vi.fn(() => c), order: vi.fn(() => c),
    limit: vi.fn(() => c), single: vi.fn(() => c), maybeSingle: vi.fn(() => c),
    ...over,
  };
  return c;
}

describe("submitActivationRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("يُدرج الطلب ويعيده", async () => {
    const q = chain({ single: vi.fn(async () => ({ data: { id: "r1", plan_type: "monthly" }, error: null })) });
    supabaseMock.from.mockReturnValue(q);
    const r = await submitActivationRequest({ plan_type: "monthly", notes: "n" });
    expect(r.id).toBe("r1");
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ plan_type: "monthly", notes: "n", receipt_url: null }));
  });
  it("يحوّل 23505 إلى رسالة ودّية", async () => {
    const q = chain({ single: vi.fn(async () => ({ data: null, error: { code: "23505", message: "dup" } })) });
    supabaseMock.from.mockReturnValue(q);
    await expect(submitActivationRequest({ plan_type: "yearly" })).rejects.toThrow("لديك طلب معلق");
  });
  it("يمرر أخطاء أخرى كما هي", async () => {
    const q = chain({ single: vi.fn(async () => ({ data: null, error: { code: "X", message: "boom" } })) });
    supabaseMock.from.mockReturnValue(q);
    await expect(submitActivationRequest({ plan_type: "yearly" })).rejects.toThrow("boom");
  });
});

describe("listMyActivationRequests / cancelMyActivationRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("list يعيد القائمة مرتبة", async () => {
    const q = chain();
    q.order = vi.fn(() => q); q.limit = vi.fn(async () => ({ data: [{ id: "r1" }], error: null }));
    supabaseMock.from.mockReturnValue(q);
    expect(await listMyActivationRequests()).toHaveLength(1);
    expect(q.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(q.limit).toHaveBeenCalledWith(50);
  });
  it("cancel يحذف بشرط pending", async () => {
    const eq = vi.fn();
    const del = vi.fn();
    const q: any = {
      delete: () => { del(); return q; },
      eq: (...a: any[]) => { eq(...a); return q; },
      then: (fn: any) => fn({ error: null }),
    };
    supabaseMock.from.mockReturnValue(q);
    await cancelMyActivationRequest("r1");
    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", "r1");
    expect(eq).toHaveBeenCalledWith("status", "pending");
  });
});

describe("uploadReceipt / exportCompanyData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploadReceipt يرفع ويعيد رابطاً عاماً", async () => {
    const file = { name: "وصل.png", type: "image/png" } as unknown as File;
    const upload = vi.fn(async () => ({ data: { path: "receipts/x.png" }, error: null }));
    const getPublicUrl = vi.fn(() => ({ data: { publicUrl: "https://supa/storage/v1/receipts/x.png" } }));
    const bucket = { upload, getPublicUrl };
    supabaseMock.storage.from.mockReturnValue(bucket);
    const url = await uploadReceipt(file);
    expect(url).toContain("receipts/x.png");
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^receipts\//), file, expect.any(Object));
  });
  it("uploadReceipt يمرر الخطأ", async () => {
    const file = { name: "a.png", type: "image/png" } as unknown as File;
    supabaseMock.storage.from.mockReturnValue({
      upload: vi.fn(async () => ({ data: null, error: { message: "full" } })),
      getPublicUrl: vi.fn(),
    });
    await expect(uploadReceipt(file)).rejects.toThrow("full");
  });
  it("exportCompanyData يستدعي RPC ويعيد الناتج", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { company: { name: "x" } }, error: null });
    expect(await exportCompanyData()).toEqual({ company: { name: "x" } });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("export_company_data");
  });
  it("exportCompanyData يمرر الخطأ", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: "no" } });
    await expect(exportCompanyData()).rejects.toThrow("no");
  });
});
