// اختبارات تكشف أخطاءً حقيقية كانت كامنة في النسخة السابقة وتم إصلاحها.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table } from "./memory-supabase";
import * as calc from "@/lib/calc";
import * as repo from "@/lib/repo";

function setup(vatRate = 0): void {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة", vat_rate: vatRate, plan_type: "open", is_active: true }]);
}

describe("خصم السلف في الرواتب (شكل الكائنات كما ترسله الواجهة)", () => {
  it("يحفظ الراتب ويخصم السلفة بشكل صحيح عند إرسال settlements ككائنات", async () => {
    setup();
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const emp = await repo.saveEmployee({ name: "موظف", emp_type: "driver" });
    const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 100000 });
    const adv = await repo.savePayment({ date: "2026-02-01", account_kind: "cashbox", account_id: cb, voucher_type: "advance", employee_id: emp, amount: 1000, description: "سلفة" });

    // شكل الواجهة الفعلي: كائنات { payment_voucher_id, amount } (وليس صفوفاً)
    const pid = await repo.savePayroll({
      date: "2026-03-01", employee_id: emp, period_year: 2026, period_month: 3,
      account_kind: "cashbox", account_id: cb, base_salary: 5000, additions: 0,
      other_deductions: 0,
      settlements: [{ payment_voucher_id: adv, amount: 400 }],
      notes: "",
    });

    const p = await repo.getPayroll(pid);
    expect(p).not.toBeNull();
    expect(p!.net_salary).toBeCloseTo(4600, 2); // 5000 - 400
    expect(p!.advance_deduction).toBeCloseTo(400, 2);

    // المتبقي من السلفة أصبح 600
    const advances = await repo.employeeAdvances(emp);
    expect(advances.find((a) => a.id === adv)!.remaining).toBeCloseTo(600, 2);

    // سجل التسوية موجود
    const settlements = table("advance_settlements").filter((s) => s.payroll_id === pid);
    expect(settlements).toHaveLength(1);
    expect(settlements[0].amount).toBeCloseTo(400, 2);
  });

  it("يرفض خصم سلفة أكبر من المتبقي", async () => {
    setup();
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const emp = await repo.saveEmployee({ name: "موظف", emp_type: "driver" });
    const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 100000 });
    const adv = await repo.savePayment({ date: "2026-02-01", account_kind: "cashbox", account_id: cb, voucher_type: "advance", employee_id: emp, amount: 500, description: "سلفة" });

    await expect(
      repo.savePayroll({
        date: "2026-03-01", employee_id: emp, period_year: 2026, period_month: 3,
        account_kind: "cashbox", account_id: cb, base_salary: 5000, additions: 0, other_deductions: 0,
        settlements: [{ payment_voucher_id: adv, amount: 600 }],
        notes: "",
      })
    ).rejects.toThrow("أكبر من المتبقي");
  });
});

describe("ترتيب كشف حساب العميل (حركات بنفس التاريخ)", () => {
  it("يُرتب الفاتورة قبل السند بنفس التاريخ ويراكم الرصيد بشكل صحيح", async () => {
    setup();
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "شركة العميل", opening_balance: 0 });
    const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 0 });
    await repo.saveInvoice({ date: "2026-03-01", customer_id: cust, attachments: [], trips: [{ from_loc: "أ", to_loc: "ب", price: 1000, expenses: [] }] });
    await repo.saveReceipt({ date: "2026-03-01", account_kind: "cashbox", account_id: cb, voucher_type: "customer", customer_id: cust, amount: 400, description: "" });

    const st = await calc.customerStatement(cust, "2026-01-01", "2026-12-31");
    expect(st.rows).toHaveLength(2);
    expect(st.rows[0].kind).toBe("invoice");
    expect(st.rows[0].balance).toBeCloseTo(1000, 2);
    expect(st.rows[1].kind).toBe("receipt");
    expect(st.rows[1].balance).toBeCloseTo(600, 2);
    expect(st.closing).toBeCloseTo(600, 2);
  });
});

describe("فترات معكوسة / مستقبلية", () => {
  it("كشف بفترة معكوسة (من > إلى) لا يُرجع صفوفاً", async () => {
    setup();
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "شركة العميل", opening_balance: 0 });
    const st = await calc.customerStatement(cust, "2026-12-31", "2026-01-01");
    expect(st.rows).toHaveLength(0);
  });
});
