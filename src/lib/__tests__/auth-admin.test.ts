// اختبارات المصادقة (auth.ts) ولوحة المطوّر (admin.ts) بواجهة Supabase مُحاكاة.
import { describe, it, expect, beforeEach, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const auth: Record<string, any> = {};
  const from = vi.fn();
  const rpc = vi.fn();
  return {
    supabaseMock: {
      auth,
      from,
      rpc,
    },
  };
});
vi.mock("@/lib/supabase", () => ({ supabase: supabaseMock }));

import * as authLib from "@/lib/auth";
import * as adminLib from "@/lib/admin";
import type { Company } from "@/lib/types";

// ---------------------------------------------------------------------------
// منشئ استعلام قابل للبرمجة (thenable) يعيد ما يحدّده resolve(state)
// ---------------------------------------------------------------------------
type QState = {
  table: string; op: string | null; cols: any; opts: any;
  filters: [string, any][]; order: [string, any] | null; limitN: number | null;
};
function makeFrom(resolve: (s: QState) => any) {
  return (table: string) => {
    const state: QState = { table, op: null, cols: null, opts: null, filters: [], order: null, limitN: null };
    const b: any = {
      select: (cols: any, opts?: any) => { state.cols = cols; state.opts = opts; return b; },
      insert: (p: any) => { state.op = "insert"; state.cols = p; return b; },
      update: (p: any) => { state.op = "update"; state.cols = p; return b; },
      delete: () => { state.op = "delete"; return b; },
      eq: (c: string, v: any) => { state.filters.push([c, v]); return b; },
      in: (c: string, v: any) => { state.filters.push([c, v]); return b; },
      order: (c: string, o?: any) => { state.order = [c, o]; return b; },
      limit: (n: number) => { state.limitN = n; return b; },
      single: () => b,
      maybeSingle: () => b,
      then: (fn: any, rej: any) => Promise.resolve(resolve(state)).then(fn, rej),
    };
    return b;
  };
}

function company(over: Partial<Company> = {}): Company {
  return {
    id: "c1", name: "شركة", phone: "", email: "", address: "", currency: "ر.س",
    vat_rate: 15, vat_note: "", plan_type: "monthly",
    trial_end: null, subscription_start: null, subscription_end: null,
    is_active: true, created_at: "",
    ...over,
  } as Company;
}

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
describe("auth.ts — الدوال الخالصة", () => {
  it("subscriptionStatus", () => {
    expect(authLib.subscriptionStatus(null)).toBe("expired");
    expect(authLib.subscriptionStatus(company({ is_active: false }))).toBe("suspended");
    expect(authLib.subscriptionStatus(company({ subscription_end: null }))).toBe("active");
    expect(authLib.subscriptionStatus(company({ subscription_end: "2099-01-01" }))).toBe("active");
    expect(authLib.subscriptionStatus(company({ subscription_end: "2000-01-01" }))).toBe("expired");
  });
  it("subscriptionLabel", () => {
    expect(authLib.subscriptionLabel(company({ plan_type: "open" }))).toBe("اشتراك مفتوح");
    expect(authLib.subscriptionLabel(company({ plan_type: "yearly" }))).toBe("اشتراك سنوي");
    expect(authLib.subscriptionLabel(company({ plan_type: "monthly" }))).toBe("اشتراك شهري");
    expect(authLib.subscriptionLabel(company({ is_active: false }))).toBe("الشركة موقوفة");
    expect(authLib.subscriptionLabel(company({ subscription_end: "2000-01-01" }))).toBe("الاشتراك منتهي");
  });
  it("ADMIN_EMAIL ثابت", () => {
    expect(authLib.ADMIN_EMAIL).toBe("conta.moha@gmail.com");
  });
});

describe("auth.ts — الجلسة والمصادقة", () => {
  it("getSession يعيد الجلسة", async () => {
    supabaseMock.auth.getSession = vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } }));
    const s = await authLib.getSession();
    expect((s as any).user.id).toBe("u1");
  });
  it("getCurrentUser يعيد null عند غياب المستخدم", async () => {
    supabaseMock.auth.getUser = vi.fn(async () => ({ data: { user: null } }));
    expect(await authLib.getCurrentUser()).toBeNull();
  });
  it("signIn ناجح", async () => {
    supabaseMock.auth.signInWithPassword = vi.fn(async () => ({ data: { session: { user: {} } }, error: null }));
    expect(await authLib.signIn("a@b.c", "pass")).toEqual({ ok: true, session: { user: {} } });
  });
  it("signIn فاشل", async () => {
    supabaseMock.auth.signInWithPassword = vi.fn(async () => ({ data: null, error: { message: "bad" } }));
    expect(await authLib.signIn("a@b.c", "pass")).toEqual({ ok: false, message: "bad" });
  });

  it("signUp بلا جلسة يطلب التحقق", async () => {
    supabaseMock.auth.signUp = vi.fn(async () => ({ data: { session: null }, error: null }));
    const r = await authLib.signUp({ email: "user@gmail.com", password: "Pass1234", name: "n", companyName: "c" });
    expect(r).toEqual({ ok: true, session: null, needsVerification: true });
  });

  it("signUp بجلسة ينشئ الشركة فوراً", async () => {
    supabaseMock.auth.signUp = vi.fn(async () => ({ data: { session: { user: {} } }, error: null }));
    supabaseMock.rpc.mockResolvedValue({ data: "c1", error: null });
    const r = await authLib.signUp({ email: "user@gmail.com", password: "Pass1234", name: "n", companyName: "c", phone: "1" });
    expect(r).toEqual({ ok: true, session: { user: {} } });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("register_company", expect.objectContaining({ p_company_name: "c" }));
  });

  it("signUp يرفض البريد الوهمي/غير المسموح", async () => {
    supabaseMock.auth.signUp = vi.fn();
    const r1 = await authLib.signUp({ email: "x@mailinator.com", password: "Pass1234", name: "n", companyName: "c" });
    expect(r1.ok).toBe(false);
    const r2 = await authLib.signUp({ email: "x@my-company.io", password: "Pass1234", name: "n", companyName: "c" });
    expect(r2.ok).toBe(false);
    const r3 = await authLib.signUp({ email: "x@gmail.com", password: "12345678", name: "n", companyName: "c" });
    expect(r3.ok).toBe(false);
    expect(supabaseMock.auth.signUp).not.toHaveBeenCalled();
  });

  it("registerCurrentCompany يعيد معرّف الشركة", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: "c9", error: null });
    expect(await authLib.registerCurrentCompany({ companyName: "x" })).toBe("c9");
  });

  it("registerCurrentCompany يمرر الخطأ", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: "no" } });
    await expect(authLib.registerCurrentCompany({ companyName: "x" })).rejects.toThrow("no");
  });

  it("isAdmin يقارن البريد (تجاهل حالة الأحرف)", async () => {
    supabaseMock.auth.getUser = vi.fn(async () => ({ data: { user: { email: "CONTA.MOHA@gmail.com" } } }));
    expect(await authLib.isAdmin()).toBe(true);
    supabaseMock.auth.getUser = vi.fn(async () => ({ data: { user: { email: "other@x.com" } } }));
    expect(await authLib.isAdmin()).toBe(false);
    supabaseMock.auth.getUser = vi.fn(async () => ({ data: { user: null } }));
    expect(await authLib.isAdmin()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("admin.ts", () => {
  it("listCompanies يدمج بيانات المالك", async () => {
    supabaseMock.from.mockImplementation(makeFrom((s) => {
      if (s.table === "companies") return { data: [{ id: "c1", name: "شركة" }], error: null };
      if (s.table === "profiles") return { data: [{ company_id: "c1", name: "مالك", email: "o@x.com" }], error: null };
      return { data: [], error: null };
    }));
    const rows = await adminLib.listCompanies();
    expect(rows).toHaveLength(1);
    expect(rows[0].owner_name).toBe("مالك");
    expect(rows[0].owner_email).toBe("o@x.com");
  });

  it("setCompanyStatus يستدعي RPC", async () => {
    supabaseMock.rpc.mockResolvedValue({ error: null });
    await adminLib.setCompanyStatus("c1", false);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("admin_set_company_status", { p_company_id: "c1", p_active: false });
  });

  it("setSubscription للمفتوح يمرر نهاية فارغة", async () => {
    supabaseMock.rpc.mockResolvedValue({ error: null });
    await adminLib.setSubscription("c1", "open", "2027-01-01");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("admin_set_subscription", { p_company_id: "c1", p_plan_type: "open", p_end_date: null });
    await adminLib.setSubscription("c1", "monthly", "2027-01-01");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("admin_set_subscription", { p_company_id: "c1", p_plan_type: "monthly", p_end_date: "2027-01-01" });
  });

  it("grantOpenSubscription يفوض للمفتوح", async () => {
    supabaseMock.rpc.mockResolvedValue({ error: null });
    await adminLib.grantOpenSubscription("c1");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("admin_set_subscription", expect.objectContaining({ p_plan_type: "open", p_end_date: null }));
  });

  it("reviewActivationRequest", async () => {
    supabaseMock.rpc.mockResolvedValue({ error: null });
    await adminLib.reviewActivationRequest("r1", true, "ok");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("admin_review_activation_request", { p_request_id: "r1", p_approve: true, p_admin_notes: "ok" });
  });

  it("deleteCompany", async () => {
    supabaseMock.rpc.mockResolvedValue({ error: null });
    await adminLib.deleteCompany("c1");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("admin_delete_company", { p_company_id: "c1" });
  });

  it("listActivationRequests يدمج اسم الشركة", async () => {
    supabaseMock.from.mockImplementation(makeFrom((s) => {
      if (s.table === "activation_requests") return { data: [{ id: "r1", company_id: "c1", plan_type: "monthly" }], error: null };
      if (s.table === "companies") return { data: [{ id: "c1", name: "شركتي" }], error: null };
      return { data: [], error: null };
    }));
    const rows = await adminLib.listActivationRequests();
    expect(rows[0].company_name).toBe("شركتي");
  });

  it("listActivityLogs يحدّ 1000 سجل", async () => {
    const order = vi.fn();
    const limit = vi.fn(async () => ({ data: [{ id: 1 }], error: null }));
    supabaseMock.from.mockReturnValue({ select: () => ({ order: () => ({ limit }) }) });
    const rows = await adminLib.listActivityLogs();
    expect(rows).toHaveLength(1);
  });

  it("adminStats يجمع الأرقام من كل الجداول", async () => {
    const counts: Record<string, number> = {
      companies: 3, customers: 10, invoices: 20, receipt_vouchers: 5,
      payment_vouchers: 7, payrolls: 4, invoice_trips: 40,
    };
    const sums: Record<string, number> = {
      "invoice_trips:price": 1000, "receipt_vouchers:amount": 500,
      "payment_vouchers:amount": 300, "payrolls:net_salary": 200,
    };
    supabaseMock.from.mockImplementation(makeFrom((s) => {
      // استعلام count (head)
      if (s.opts?.head && s.opts?.count === "exact") {
        const base = counts[s.table] ?? 0;
        const isActive = s.filters.some(([c, v]) => c === "is_active" && v === true);
        return { count: s.table === "companies" && isActive ? 2 : base };
      }
      // استعلام sum
      if (s.table === "invoice_trips" && s.cols === "price") return { data: [{ price: 1000 }], error: null };
      if (s.table === "receipt_vouchers" && s.cols === "amount") return { data: [{ amount: 500 }], error: null };
      if (s.table === "payment_vouchers" && s.cols === "amount") return { data: [{ amount: 300 }], error: null };
      if (s.table === "payrolls" && s.cols === "net_salary") return { data: [{ net_salary: 200 }], error: null };
      return { data: [], error: null };
    }));
    const st = await adminLib.adminStats();
    expect(st.companies).toBe(3);
    expect(st.active_companies).toBe(2);
    expect(st.customers).toBe(10);
    expect(st.invoices).toBe(20);
    expect(st.revenue).toBe(1000);
    expect(st.collected).toBe(500);
    expect(st.spent).toBe(300);
    expect(st.salaries).toBe(200);
  });

  it("companySummary يفلتر بمعرّف الشركة", async () => {
    supabaseMock.from.mockImplementation(makeFrom((s) => {
      const companyFiltered = s.filters.some(([c]) => c === "company_id");
      const base: Record<string, number> = { customers: 5, invoices: 3, invoice_trips: 12, receipt_vouchers: 2, payment_vouchers: 4, payrolls: 1 };
      if (s.opts?.head && s.opts?.count === "exact") {
        // أي عدد يخص الشركة فقط عندما يوجد فلتر company_id
        return { count: companyFiltered ? (base[s.table] ?? 0) : 0 };
      }
      if (s.table === "invoice_trips" && s.cols === "price") return { data: companyFiltered ? [{ price: 900 }] : [], error: null };
      return { data: [], error: null };
    }));
    const s = await adminLib.companySummary("c1");
    expect(s.customers).toBe(5);
    expect(s.invoices).toBe(3);
    expect(s.trips).toBe(12);
    expect(s.revenue).toBe(900);
  });
});
