// منظومة الخصومات: تسجيل خصم على موظف، اقتطاعه كلياً/جزئياً من الراتب، وتتبعه في الأرشيف
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
  seedTable("companies", [{ id: "c1", name: "شركة النقل", currency: "ر.س", vat_rate: 15, plan_type: "open", is_active: true }]);
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  const emp = await repo.saveEmployee({ name: "سالم المُقتطَع", emp_type: "driver", phone: "0551234567", base_salary: 6000 });
  const cb = await repo.saveAccount("cashbox", { name: "الخزينة", created_date: "2026-01-01", opening_balance: 100000 });
  return { emp, cb };
}

const deduction = (emp: number, date: string, amount: number, reason = "غياب بدون إذن") =>
  repo.saveDeduction({ date, employee_id: emp, amount, reason, notes: "" });

const payroll = (emp: number, cb: number, date: string, month: number, extra: Record<string, unknown> = {}) =>
  repo.savePayroll({
    date, employee_id: emp, period_year: 2026, period_month: month,
    account_kind: "cashbox", account_id: cb, base_salary: 6000, additions: 0, other_deductions: 0,
    ...extra,
  });

describe("تسجيل الخصم على الموظف", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("يُحفظ الخصم بترقيم DED ويُقرأ ضمن قائمة الموظف", async () => {
    const id = await deduction(s.emp, "2026-01-10", 1500);
    const rows = await repo.employeeDeductions(s.emp);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].number).toBe(1);
    expect(rows[0].amount).toBeCloseTo(1500, 2);
    expect(rows[0].remaining).toBeCloseTo(1500, 2);
    expect(rows[0].settled).toBeCloseTo(0, 2);
  });

  it("السبب إلزامي والمبلغ يجب أن يكون موجباً", async () => {
    await expect(repo.saveDeduction({ date: "2026-01-10", employee_id: s.emp, amount: 100, reason: "  " })).rejects.toThrow();
    await expect(repo.saveDeduction({ date: "2026-01-10", employee_id: s.emp, amount: 0, reason: "خصم" })).rejects.toThrow();
    await expect(repo.saveDeduction({ date: "2026-01-10", employee_id: 9999, amount: 100, reason: "خصم" })).rejects.toThrow();
  });

  it("لا يُحذف بند خصم سبق اقتطاعه في راتب", async () => {
    const id = await deduction(s.emp, "2026-01-10", 500);
    await payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 500 }],
    });
    await expect(repo.deleteDeduction(id)).rejects.toThrow();
  });
});

describe("اقتطاع الخصم من المسير (كلي وجزئي)", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("اقتطاع جزئي يترك المتبقي للشهر التالي ويخفض الصافي", async () => {
    const id = await deduction(s.emp, "2026-01-10", 3000);
    const payId = await payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 1000 }],
    });
    const rows = await repo.employeeDeductions(s.emp, true);
    expect(rows[0].settled).toBeCloseTo(1000, 2);
    expect(rows[0].remaining).toBeCloseTo(2000, 2);
    // الصافي = 6000 - 1000 = 5000 (لا يخصم من الخزينة إلا الصافي)
    const p = await repo.getPayroll(payId);
    expect(p!.net_salary).toBeCloseTo(5000, 2);
    expect(p!.deduction_deduction).toBeCloseTo(1000, 2);
  });

  it("اقتطاع كلي يغلق البند ويخرجه من غير المسددة", async () => {
    const id = await deduction(s.emp, "2026-01-10", 1500);
    await payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 1500 }],
    });
    expect((await repo.employeeDeductions(s.emp, false)).length).toBe(0);
    expect((await repo.employeeDeductions(s.emp, true))[0].remaining).toBeCloseTo(0, 2);
  });

  it("لا يُقبل اقتطاع أكبر من المتبقي من البند", async () => {
    const id = await deduction(s.emp, "2026-01-10", 1000);
    await expect(payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 1500 }],
    })).rejects.toThrow();
  });

  it("لا يُقبل بند خصم يخص موظفاً آخر", async () => {
    const other = await repo.saveEmployee({ name: "موظف آخر", emp_type: "admin", base_salary: 4000 });
    const id = await deduction(other, "2026-01-10", 500);
    await expect(payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 500 }],
    })).rejects.toThrow();
  });

  it("اقتطاع جزئي على شهرين يغلق البند في الثاني", async () => {
    const id = await deduction(s.emp, "2026-01-10", 3000, "تلف عهدة");
    await payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 1000 }],
    });
    await payroll(s.emp, s.cb, "2026-02-28", 2, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 2000 }],
    });
    const rows = await repo.employeeDeductions(s.emp, true);
    expect(rows[0].settled).toBeCloseTo(3000, 2);
    expect(rows[0].remaining).toBeCloseTo(0, 2);
  });

  it("الصافي لا يشمل الخصومات المقتطعة إلا بالقدر المخصوم هذا الشهر", async () => {
    const id = await deduction(s.emp, "2026-01-10", 3000);
    // راتب 6000، اقتطاع 1000 فقط ⇒ صافي 5000 ⇒ الخصم من الخزينة = سلف 0 + 5000
    await payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 1000 }],
    });
    const bal = await calc.accountBalance("cashbox", s.cb);
    expect(Number(bal)).toBeCloseTo(100000 - 5000, 2);
  });
});

describe("أرشيف ومتابعة الخصومات", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("يسجل لكل بند متى سُجّل ومن أي مسير/شهر اقتُطع", async () => {
    const id = await deduction(s.emp, "2026-01-10", 3000, "مخالفة");
    await payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 1000 }],
    });
    await payroll(s.emp, s.cb, "2026-02-28", 2, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 2000 }],
    });
    const arc = await calc.deductionArchive(s.emp);
    expect(arc).toHaveLength(1);
    const d = arc[0];
    expect(d.date).toBe("2026-01-10");
    expect(d.amount).toBeCloseTo(3000, 2);
    expect(d.settled).toBeCloseTo(3000, 2);
    expect(d.remaining).toBeCloseTo(0, 2);
    expect(d.status).toBe("closed");
    expect(d.reason).toBe("مخالفة");
    expect(d.settlements).toHaveLength(2);
    expect(d.settlements[0].amount).toBeCloseTo(1000, 2);
    expect(d.settlements[0].payroll_date).toBe("2026-01-31");
    expect(d.settlements[1].period_month).toBe(2);
    expect(d.last_settled_date).toBe("2026-02-28");
  });

  it("شاشة المتابعة المجمّعة تُظهر البنود وتفلتر بالحالة والموظف", async () => {
    const d1 = await deduction(s.emp, "2026-01-10", 2000);
    await deduction(s.emp, "2026-02-10", 1000, "سلفة نثرية");
    await payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: d1, amount: 500 }],
    });
    const all = await calc.listDeductionTracking({ dFrom: "2026-01-01", dTo: "2026-12-31" });
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.status).sort()).toEqual(["open", "partial"]);
    expect(all.find((r) => r.id === d1)?.settlement_details).toContain("PAY-");
    const partial = await calc.listDeductionTracking({ status: "partial" });
    expect(partial.map((r) => r.id)).toEqual([d1]);
    const totals = calc.deductionArchiveTotals(await calc.deductionArchive(s.emp));
    expect(totals.total).toBeCloseTo(3000, 2);
    expect(totals.settled).toBeCloseTo(500, 2);
    expect(totals.remaining).toBeCloseTo(2500, 2);
    expect(totals.open_count).toBe(2);
  });

  it("كشف حساب الموظف يتضمن بنود الخصومات وتسوياتها", async () => {
    const id = await deduction(s.emp, "2026-01-10", 1500);
    await payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 600 }],
    });
    const st = await calc.employeeStatement(s.emp);
    expect(st.deductions).toHaveLength(1);
    expect(st.deductions[0].remaining).toBeCloseTo(900, 2);
    expect(st.deductions[0].settlements[0].pnum).toBe(1);
    expect(st.totals.deductions_total).toBeCloseTo(1500, 2);
    expect(st.totals.deductions_remaining).toBeCloseTo(900, 2);
  });

  it("طباعة المسير تُظهر سطر خصم الخصومات وتفاصيل البنود", async () => {
    const id = await deduction(s.emp, "2026-03-10", 1200, "تلف جهاز");
    const payId = await payroll(s.emp, s.cb, "2026-03-31", 3, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 1200 }],
    });
    const slip = await payrollSlipHtml(payId);
    expect(slip).not.toBeNull();
    expect(slip!.html).toContain("خصم الخصومات");
    expect(slip!.html).toContain("DED-");
    expect(slip!.html).toContain("تلف جهاز");
  });
});

describe("تعديل الرواتب والخصومات معاً", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("تعديل مسير قائم يقرأ تسويات الخصومات السابقة ويعيد حسابها", async () => {
    const id = await deduction(s.emp, "2026-01-10", 2000);
    const payId = await payroll(s.emp, s.cb, "2026-01-31", 1, {
      deduction_settlements: [{ employee_deduction_id: id, amount: 2000 }],
    });
    // تعديل: خصم 800 فقط بدل 2000 (الباقي يبقى للشهر التالي)
    await repo.savePayroll({
      date: "2026-01-31", employee_id: s.emp, period_year: 2026, period_month: 1,
      account_kind: "cashbox", account_id: s.cb, base_salary: 6000, additions: 0, other_deductions: 0,
      deduction_settlements: [{ employee_deduction_id: id, amount: 800 }],
    }, payId);
    const p = await repo.getPayroll(payId);
    expect(p!.deduction_deduction).toBeCloseTo(800, 2);
    expect(p!.net_salary).toBeCloseTo(5200, 2);
    const rows = await repo.employeeDeductions(s.emp);
    expect(rows[0].remaining).toBeCloseTo(1200, 2);
  });
});
