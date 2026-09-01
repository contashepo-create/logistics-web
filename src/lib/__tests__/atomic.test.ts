// اختبارات الحفظ الذري (RPC save_invoice / save_payroll) وإعادة المحاولة عند تصادم الترقيم.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table, forceCollision } from "./memory-supabase";
import * as repo from "@/lib/repo";

function setup(): void {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة", vat_rate: 0, plan_type: "open", is_active: true }]);
}

async function seedBasics() {
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  const cust = await repo.saveCustomer({ name: "شركة العميل", opening_balance: 0 });
  const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 100000 });
  return { cust, cb };
}

describe("الحفظ الذري للفواتير عبر save_invoice", () => {
  it("يحفظ رأس الفاتورة ونقلاتها ومصروفاتها ويولّد رقمها تلقائياً", async () => {
    setup();
    const { cust } = await seedBasics();
    const id = await repo.saveInvoice({
      date: "2026-03-01",
      customer_id: cust,
      attachments: [],
      trips: [
        { from_loc: "أ", to_loc: "ب", price: 1000, expenses: [{ expense_type: "fuel", source: "supplier", supplier_name: "محطة", amount: 100 }] },
        { from_loc: "ب", to_loc: "ج", price: 500, expenses: [] },
      ],
    });

    const inv = table("invoices").find((r) => r.id === id);
    expect(inv).toBeDefined();
    expect(inv!.number).toBe(1);
    expect(inv!.company_id).toBe("c1");

    const trips = table("invoice_trips").filter((t) => t.invoice_id === id);
    expect(trips).toHaveLength(2);
    const exp = table("trip_expenses").filter((e) => e.trip_id === trips[0].id);
    expect(exp).toHaveLength(1);
    expect(exp[0].amount).toBeCloseTo(100, 2);
  });

  it("يرفض فاتورة بعميل غير موجود (تحقق خادمي)", async () => {
    setup();
    await seedBasics();
    await expect(
      repo.saveInvoice({ date: "2026-03-01", customer_id: 99999, attachments: [], trips: [{ from_loc: "أ", to_loc: "ب", price: 100, expenses: [] }] })
    ).rejects.toThrow("العميل المحدد غير موجود");
  });

  it("يرفض حذف نقلة مرتبطة بسند دفع (مصروف رحلة)", async () => {
    setup();
    const { cust, cb } = await seedBasics();
    const invId = await repo.saveInvoice({
      date: "2026-03-01", customer_id: cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", price: 1000, expenses: [] }],
    });
    const tripId = table("invoice_trips").find((t) => t.invoice_id === invId)!.id;
    await repo.savePayment({ date: "2026-03-02", account_kind: "cashbox", account_id: cb, voucher_type: "trip", trip_id: tripId, amount: 50, description: "وقود" });

    // تعديل الفاتورة بحذف النقلة المرتبطة
    await expect(
      repo.saveInvoice({ date: "2026-03-01", customer_id: cust, attachments: [], trips: [] }, invId)
    ).rejects.toThrow("لا تقبل التعديل");
    // محاولة أخرى: إبقاء نقلة أخرى لكن حذف المرتبطة
    await expect(
      repo.saveInvoice({ date: "2026-03-01", customer_id: cust, attachments: [], trips: [{ id: 999, from_loc: "س", to_loc: "ص", price: 100, expenses: [] }] }, invId)
    ).rejects.toThrow();
  });
});

describe("إعادة المحاولة عند تصادم ترقيم السندات", () => {
  it("saveReceipt يعيد الحساب عند تصادم الرقم (23505)", async () => {
    setup();
    const { cust, cb } = await seedBasics();
    // نجبر أول محاولة إدراج على الاصطدام برقم مكرر
    forceCollision("receipt_vouchers", 1);
    const id = await repo.saveReceipt({ date: "2026-03-01", account_kind: "cashbox", account_id: cb, voucher_type: "customer", customer_id: cust, amount: 400, description: "" });

    const v = table("receipt_vouchers").find((r) => r.id === id);
    expect(v).toBeDefined();
    expect(v!.number).toBe(1);
    // محاولة ثانية بدون اصطدام تحصل على رقم تالٍ
    const id2 = await repo.saveReceipt({ date: "2026-03-02", account_kind: "cashbox", account_id: cb, voucher_type: "customer", customer_id: cust, amount: 100, description: "" });
    expect(table("receipt_vouchers").find((r) => r.id === id2)!.number).toBe(2);
  });

  it("savePayment يعيد الحساب عند تصادم الرقم (23505)", async () => {
    setup();
    const { cb } = await seedBasics();
    forceCollision("payment_vouchers", 2); // اصطدامان متتاليان
    const id = await repo.savePayment({ date: "2026-03-01", account_kind: "cashbox", account_id: cb, voucher_type: "general", amount: 200, description: "مصروف عام" });
    expect(table("payment_vouchers").find((r) => r.id === id)!.number).toBe(1);
  });
});

describe("الحفظ الذري للرواتب عبر save_payroll", () => {
  it("يرفض عندما لا يطابق مجموع التسويات قيمة الخصم", async () => {
    setup();
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const emp = await repo.saveEmployee({ name: "موظف", emp_type: "driver" });
    const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 100000 });
    const adv = await repo.savePayment({ date: "2026-02-01", account_kind: "cashbox", account_id: cb, voucher_type: "advance", employee_id: emp, amount: 1000, description: "سلفة" });

    await expect(
      repo.savePayroll({
        date: "2026-03-01", employee_id: emp, period_year: 2026, period_month: 3,
        account_kind: "cashbox", account_id: cb, base_salary: 5000, additions: 0, other_deductions: 0,
        advance_deduction: 400,
        settlements: [{ payment_voucher_id: adv, amount: 300 }], // مجموع 300 ≠ 400
        notes: "",
      })
    ).rejects.toThrow("لا يطابق");
  });

  it("يرفض الخصم من سلفة لا تخص الموظف", async () => {
    setup();
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const empA = await repo.saveEmployee({ name: "موظف أ", emp_type: "driver" });
    const empB = await repo.saveEmployee({ name: "موظف ب", emp_type: "driver" });
    const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 100000 });
    const advB = await repo.savePayment({ date: "2026-02-01", account_kind: "cashbox", account_id: cb, voucher_type: "advance", employee_id: empB, amount: 1000, description: "سلفة" });

    await expect(
      repo.savePayroll({
        date: "2026-03-01", employee_id: empA, period_year: 2026, period_month: 3,
        account_kind: "cashbox", account_id: cb, base_salary: 5000, additions: 0, other_deductions: 0,
        settlements: [{ payment_voucher_id: advB, amount: 400 }],
        notes: "",
      })
    ).rejects.toThrow("لا تخص هذا الموظف");
  });
});
