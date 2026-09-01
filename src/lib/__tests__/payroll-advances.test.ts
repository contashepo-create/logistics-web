// منظومة السلفيات والرواتب: راتب الموظف الأساسي، الخصم الكلي/الجزئي، وأرشيف السلف
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as calc from "@/lib/calc";
import { payrollSlipHtml } from "@/lib/payrollPrint";

async function seed() {
  resetDb();
  setUser({ id: "u1", email: "o@t.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "o@t.com", name: "م" }]);
  seedTable("companies", [{ id: "c1", name: "شركة النقل", currency: "ج.م", vat_rate: 0, plan_type: "open", is_active: true }]);
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  const emp = await repo.saveEmployee({ name: "أحمد السائق", emp_type: "driver", phone: "01012345678", base_salary: 6000 });
  const cb = await repo.saveAccount("cashbox", { name: "الخزينة", created_date: "2026-01-01", opening_balance: 100000 });
  return { emp, cb };
}

const advance = (emp: number, cb: number, date: string, amount: number) =>
  repo.savePayment({ date, account_kind: "cashbox", account_id: cb, voucher_type: "advance", employee_id: emp, amount, description: "سلفة" });

describe("راتب الموظف الأساسي", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("يُحفظ راتب الموظف عند إنشائه ويُقرأ لاحقاً", async () => {
    const e = await repo.getEmployee(s.emp);
    expect(Number(e!.base_salary)).toBeCloseTo(6000, 2);
  });

  it("يمكن تعديل الراتب الأساسي ولا يقبل السالب", async () => {
    await repo.saveEmployee({ name: "أحمد السائق", emp_type: "driver", base_salary: 7500 }, s.emp);
    expect(Number((await repo.getEmployee(s.emp))!.base_salary)).toBeCloseTo(7500, 2);
    await expect(repo.saveEmployee({ name: "أحمد السائق", emp_type: "driver", base_salary: -100 }, s.emp)).rejects.toThrow();
  });
});

describe("خصم السلف من المسير", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("خصم جزئي يترك المتبقي مفتوحاً للشهر التالي", async () => {
    const adv = await advance(s.emp, s.cb, "2026-01-05", 3000);
    await repo.savePayroll({
      date: "2026-01-31", employee_id: s.emp, period_year: 2026, period_month: 1,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 0, other_deductions: 0,
      settlements: [{ payment_voucher_id: adv, amount: 1000 }],
    });
    const rows = await repo.employeeAdvances(s.emp, true);
    expect(rows[0].settled).toBeCloseTo(1000, 2);
    expect(rows[0].remaining).toBeCloseTo(2000, 2);
  });

  it("الخصم الكلي يغلق السلفة ويخرجها من غير المسدَّدة", async () => {
    const adv = await advance(s.emp, s.cb, "2026-01-05", 3000);
    await repo.savePayroll({
      date: "2026-01-31", employee_id: s.emp, period_year: 2026, period_month: 1,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 0, other_deductions: 0,
      settlements: [{ payment_voucher_id: adv, amount: 3000 }],
    });
    expect((await repo.employeeAdvances(s.emp, false)).length).toBe(0);
    expect((await repo.employeeAdvances(s.emp, true))[0].remaining).toBeCloseTo(0, 2);
  });

  it("لا يُقبل خصم أكبر من المتبقي من السلفة", async () => {
    const adv = await advance(s.emp, s.cb, "2026-01-05", 1000);
    await expect(repo.savePayroll({
      date: "2026-01-31", employee_id: s.emp, period_year: 2026, period_month: 1,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 0, other_deductions: 0,
      settlements: [{ payment_voucher_id: adv, amount: 1500 }],
    })).rejects.toThrow();
  });
});

describe("أرشيف السلفيات", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("يسجل لكل سلفة متى صُرفت ومن أي مسير/شهر خُصمت", async () => {
    const adv = await advance(s.emp, s.cb, "2026-01-05", 3000);
    await repo.savePayroll({
      date: "2026-01-31", employee_id: s.emp, period_year: 2026, period_month: 1,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 0, other_deductions: 0,
      settlements: [{ payment_voucher_id: adv, amount: 1000 }],
    });
    await repo.savePayroll({
      date: "2026-02-28", employee_id: s.emp, period_year: 2026, period_month: 2,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 0, other_deductions: 0,
      settlements: [{ payment_voucher_id: adv, amount: 2000 }],
    });

    const arc = await calc.advanceArchive(s.emp);
    expect(arc.length).toBe(1);
    const a = arc[0];
    expect(a.date).toBe("2026-01-05");
    expect(a.amount).toBeCloseTo(3000, 2);
    expect(a.settled).toBeCloseTo(3000, 2);
    expect(a.remaining).toBeCloseTo(0, 2);
    expect(a.status).toBe("closed");
    expect(a.account_label).toContain("الخزينة");
    expect(a.settlements.length).toBe(2);
    expect(a.settlements[0].amount).toBeCloseTo(1000, 2);
    expect(a.settlements[0].period_label).toContain("2026");
    expect(a.settlements[0].payroll_date).toBe("2026-01-31");
    expect(a.settlements[1].period_month).toBe(2);
    expect(a.last_settled_date).toBe("2026-02-28");
  });

  it("تجمع شاشة المتابعة المرجعية كل السلف وتفلترها بالحالة", async () => {
    const a1 = await advance(s.emp, s.cb, "2026-01-05", 2000);
    await advance(s.emp, s.cb, "2026-02-05", 1000);
    await repo.savePayroll({
      date: "2026-01-31", employee_id: s.emp, period_year: 2026, period_month: 1,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 0, other_deductions: 0,
      settlements: [{ payment_voucher_id: a1, amount: 500 }],
    });
    const all = await calc.listAdvanceTracking({ dFrom: "2026-01-01", dTo: "2026-12-31" });
    expect(all).toHaveLength(2);
    expect(all.map((row) => row.status).sort()).toEqual(["open", "partial"]);
    expect(all.find((row) => row.id === a1)?.settlement_details).toContain("PAY-");
    expect((await calc.listAdvanceTracking({ status: "partial" })).map((row) => row.id)).toEqual([a1]);
  });

  it("يميّز السلف المفتوحة والمخصومة جزئياً ويجمع الإجماليات", async () => {
    const a1 = await advance(s.emp, s.cb, "2026-01-05", 2000);
    await advance(s.emp, s.cb, "2026-02-05", 1000);
    await repo.savePayroll({
      date: "2026-01-31", employee_id: s.emp, period_year: 2026, period_month: 1,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 0, other_deductions: 0,
      settlements: [{ payment_voucher_id: a1, amount: 500 }],
    });
    const arc = await calc.advanceArchive(s.emp);
    expect(arc.map((x) => x.status)).toEqual(["partial", "open"]);
    const t = calc.advanceArchiveTotals(arc);
    expect(t.total).toBeCloseTo(3000, 2);
    expect(t.settled).toBeCloseTo(500, 2);
    expect(t.remaining).toBeCloseTo(2500, 2);
    expect(t.open_count).toBe(2);
  });
});

describe("طباعة مسير راتب مستقل", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("ينشئ مستنداً خاصاً بالموظف والشهر مع الاستحقاقات والاستقطاعات", async () => {
    const advanceId = await advance(s.emp, s.cb, "2026-03-05", 1000);
    const payrollId = await repo.savePayroll({
      date: "2026-03-31", employee_id: s.emp, period_year: 2026, period_month: 3,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 500,
      additions_note: "حافز انتظام", other_deductions: 200,
      settlements: [{ payment_voucher_id: advanceId, amount: 300 }],
    });
    const slip = await payrollSlipHtml(payrollId);
    expect(slip).not.toBeNull();
    expect(slip!.html).toContain("أحمد السائق");
    expect(slip!.html).toContain("مارس 2026");
    expect(slip!.html).toContain("حافز انتظام");
    expect(slip!.html).toContain("PV-");
    expect(slip!.html).toContain("6,000.00");
    expect(slip!.css).toContain("@media print");
  });
});

describe("سلامة صرف المسير", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("صرف المسير يخصم الصافي فقط من الحساب المختار", async () => {
    const adv = await advance(s.emp, s.cb, "2026-01-05", 1000); // الرصيد: 99000
    await repo.savePayroll({
      date: "2026-01-31", employee_id: s.emp, period_year: 2026, period_month: 1,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 500, other_deductions: 200,
      settlements: [{ payment_voucher_id: adv, amount: 1000 }],
    });
    // الصافي = 6000 + 500 - 1000 - 200 = 5300
    const bal = await calc.accountBalance("cashbox", s.cb);
    expect(Number(bal)).toBeCloseTo(100000 - 1000 - 5300, 2);
  });

  it("لا يُقبل مسير يجعل رصيد الخزينة سالباً", async () => {
    const cb2 = await repo.saveAccount("cashbox", { name: "خزينة صغيرة", created_date: "2026-01-01", opening_balance: 1000 });
    await expect(repo.savePayroll({
      date: "2026-01-31", employee_id: s.emp, period_year: 2026, period_month: 1,
      account_kind: "cashbox", account_id: cb2, base_salary: 6000, additions: 0, other_deductions: 0,
      settlements: [],
    })).rejects.toThrow();
  });
});
