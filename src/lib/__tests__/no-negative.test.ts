// قاعدة: لا يُسمح بجعل رصيد الخزينة أو البنك سالباً في أي مسار صرف
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as calc from "@/lib/calc";

async function seed(opening = 1000) {
  resetDb();
  setUser({ id: "u1", email: "o@t.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "o@t.com", name: "م" }]);
  seedTable("companies", [{ id: "c1", name: "شركة", currency: "ج.م", vat_rate: 0, plan_type: "open", is_active: true }]);
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  const cust = await repo.saveCustomer({ name: "شركة العميل", opening_balance: 0 });
  const emp = await repo.saveEmployee({ name: "موظف", emp_type: "admin" });
  const cb = await repo.saveAccount("cashbox", { name: "الخزينة", created_date: "2026-01-01", opening_balance: opening });
  const bnk = await repo.saveAccount("bank", { name: "البنك", created_date: "2026-01-01", opening_balance: 0 });
  return { cust, emp, cb, bnk };
}

describe("منع الرصيد السالب", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(1000); });

  it("سند صرف أكبر من الرصيد مرفوض", async () => {
    await expect(repo.savePayment({
      date: "2026-02-01", account_kind: "cashbox", account_id: s.cb,
      voucher_type: "general", amount: 1500, description: "إيجار",
    })).rejects.toThrow(/الرصيد لا يكفي/);
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(1000, 2);
  });

  it("سند صرف مساوٍ للرصيد مسموح (الرصيد صفر)", async () => {
    await repo.savePayment({
      date: "2026-02-01", account_kind: "cashbox", account_id: s.cb,
      voucher_type: "general", amount: 1000, description: "إيجار",
    });
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(0, 2);
  });

  it("يحسب إجمالي سند الصرف من العدد × قيمة الوحدة ويحفظهما", async () => {
    const id = await repo.savePayment({
      date: "2026-02-01", account_kind: "cashbox", account_id: s.cb,
      voucher_type: "general", quantity: 2, unit_amount: 200, amount: 999,
      description: "بنزين",
    });
    const voucher = await repo.getPayment(id);
    expect(voucher).toMatchObject({ quantity: 2, unit_amount: 200, amount: 400 });
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(600, 2);
  });

  it("الصرف من حساب رصيده صفر مرفوض", async () => {
    await expect(repo.savePayment({
      date: "2026-02-01", account_kind: "bank", account_id: s.bnk,
      voucher_type: "general", amount: 1, description: "x",
    })).rejects.toThrow(/الرصيد لا يكفي/);
  });

  it("تعديل سند لمبلغ أكبر من المتاح مرفوض، والمساوي مقبول", async () => {
    const v = await repo.savePayment({
      date: "2026-02-01", account_kind: "cashbox", account_id: s.cb,
      voucher_type: "general", amount: 400, description: "x",
    });
    await expect(repo.savePayment({
      date: "2026-02-01", account_kind: "cashbox", account_id: s.cb,
      voucher_type: "general", amount: 1200, description: "x",
    }, v)).rejects.toThrow(/الرصيد لا يكفي/);
    await repo.savePayment({
      date: "2026-02-01", account_kind: "cashbox", account_id: s.cb,
      voucher_type: "general", amount: 900, description: "x",
    }, v);
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(100, 2);
  });

  it("مصروف نقدي في الفاتورة أكبر من الرصيد مرفوض ولا تُحفظ الفاتورة", async () => {
    await expect(repo.saveInvoice({
      date: "2026-02-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 5000,
        expenses: [{ expense_type: "fuel", qty: 1, unit_amount: 1500, source: "cash", account_kind: "cashbox", account_id: s.cb }] }],
    })).rejects.toThrow(/الرصيد لا يكفي/);
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(1000, 2);
    expect(await calc.invoiceList()).toHaveLength(0);
  });

  it("مجموع مصروفات الفاتورة النقدية يُفحص مجتمعاً لا فرادى", async () => {
    await expect(repo.saveInvoice({
      date: "2026-02-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 5000, expenses: [
        { expense_type: "fuel", qty: 1, unit_amount: 600, source: "cash", account_kind: "cashbox", account_id: s.cb },
        { expense_type: "card", qty: 1, unit_amount: 600, source: "cash", account_kind: "cashbox", account_id: s.cb },
      ] }],
    })).rejects.toThrow(/الرصيد لا يكفي/);
  });

  it("تعديل الفاتورة ممنوع بعد الإصدار", async () => {
    const s = await seed();
    await expect(repo.saveInvoice({ date: "2026-02-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 5000, expenses: [] }] }, 1))
      .rejects.toThrow(/لا تقبل التعديل/);
  });

  it("مسير الراتب أكبر من الرصيد مرفوض", async () => {
    await expect(repo.savePayroll({
      date: "2026-02-28", employee_id: s.emp, period_year: 2026, period_month: 2,
      account_kind: "cashbox", account_id: s.cb, base_salary: 3000, additions: 0,
      other_deductions: 0, settlements: [], notes: "",
    })).rejects.toThrow(/الرصيد لا يكفي/);
  });

  it("الأرصدة لا تصبح سالبة أبداً بعد سلسلة عمليات", async () => {
    await repo.saveReceipt({ date: "2026-02-01", account_kind: "cashbox", account_id: s.cb, voucher_type: "other", amount: 500, description: "إيداع" });
    await repo.savePayment({ date: "2026-02-02", account_kind: "cashbox", account_id: s.cb, voucher_type: "general", amount: 1400, description: "x" });
    await expect(repo.savePayment({ date: "2026-02-03", account_kind: "cashbox", account_id: s.cb, voucher_type: "general", amount: 200, description: "y" }))
      .rejects.toThrow(/الرصيد لا يكفي/);
    expect(await calc.accountBalance("cashbox", s.cb)).toBeGreaterThanOrEqual(0);
  });
});
