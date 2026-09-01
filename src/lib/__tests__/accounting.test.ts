// اختبارات حقيقية لطبقة الحسابات (calc.ts) والعمليات (repo.ts) بمحرك ذاكرة
// النتائج المتوقعة مطابقة لنتائج التطبيق المكتبي الأصلي (المرجع المعتمد).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table } from "./memory-supabase";
import * as calc from "@/lib/calc";
import * as repo from "@/lib/repo";
import { RuleError } from "@/lib/rules";

function setupCompany(vatRate = 0): void {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [
    {
      id: "c1", name: "شركة اختبار", phone: "", email: "", address: "",
      currency: "ر.س", vat_rate: vatRate, vat_note: "", plan_type: "open",
      trial_end: null, subscription_start: null, subscription_end: null, is_active: true,
    },
  ]);
}

// تعبئة بيانات مطابقة لـ seed_demo.py (المرجع) — تُعيد المعرّفات
async function seedDemo(): Promise<Record<string, number>> {
  setupCompany(0);
  const y = 2026;
  await repo.saveYear({ year: y, date_from: `${y}-01-01`, date_to: `${y}-12-31`, notes: "" });
  const cust1 = await repo.saveCustomer({ name: "مؤسسة الرياض للإنشاءات", phone: "0551112222", address: "الرياض", opening_balance: 15000, notes: "" });
  const cust2 = await repo.saveCustomer({ name: "شركة مكة للمقاولات", phone: "0563334444", address: "مكة", opening_balance: 0, notes: "" });
  const drv1 = await repo.saveEmployee({ name: "أحمد الغامدي", nationality: "سعودي", phone: "0501234101", emp_type: "driver", notes: "" });
  const drv2 = await repo.saveEmployee({ name: "خالد المصري", nationality: "مصري", phone: "0502345202", emp_type: "driver", notes: "" });
  await repo.saveEmployee({ name: "سالم الحربي", nationality: "سعودي", phone: "0503456303", emp_type: "admin", notes: "" });
  const veh1 = await repo.saveVehicle({ plate_number: "أ ب ج 1234", vehicle_type: "تريلة", default_driver_id: drv1, notes: "" });
  const veh2 = await repo.saveVehicle({ plate_number: "د هـ و 5678", vehicle_type: "سطحة", default_driver_id: drv2, notes: "" });
  const cb = await repo.saveAccount("cashbox", { name: "الخزينة الرئيسية", created_date: `${y}-01-01`, opening_balance: 20000, notes: "" });
  const bnk = await repo.saveAccount("bank", { name: "بنك الراجحي", created_date: `${y}-01-01`, account_number: "002", iban: "SA0380000000608010167519", opening_balance: 80000, notes: "" });

  const d = (m: number, day: number) => `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const inv1 = await repo.saveInvoice({
    date: d(2, 10), customer_id: cust1, notes: "مشروع", attachments: [],
    trips: [
      { vehicle_id: veh1, driver_id: drv1, from_loc: "الرياض", to_loc: "الدمام", price: 4500, notes: "", expenses: [{ expense_type: "trip", source: "supplier", supplier_name: "محطة", amount: 350, notes: "" }, { expense_type: "fuel", source: "supplier", supplier_name: "محطة", amount: 260, notes: "" }, { expense_type: "card", source: "supplier", supplier_name: "محطة", amount: 90, notes: "" }] },
      { vehicle_id: veh2, driver_id: drv2, from_loc: "الرياض", to_loc: "القصيم", price: 3000, notes: "", expenses: [{ expense_type: "trip", source: "supplier", supplier_name: "محطة", amount: 250, notes: "" }, { expense_type: "fuel", source: "supplier", supplier_name: "محطة", amount: 180, notes: "" }] },
    ],
  });
  const inv2 = await repo.saveInvoice({
    date: d(3, 5), customer_id: cust2, notes: "", attachments: [],
    trips: [
      { vehicle_id: veh1, driver_id: drv1, from_loc: "جدة", to_loc: "مكة", price: 1800, notes: "", expenses: [{ expense_type: "trip", source: "supplier", supplier_name: "محطة", amount: 150, notes: "" }, { expense_type: "fuel", source: "supplier", supplier_name: "محطة", amount: 100, notes: "" }] },
    ],
  });
  await repo.saveReceipt({ date: d(2, 25), account_kind: "cashbox", account_id: cb, voucher_type: "customer", customer_id: cust1, amount: 5000, description: "دفعة تحت الحساب" });
  await repo.saveReceipt({ date: d(3, 12), account_kind: "bank", account_id: bnk, voucher_type: "other", amount: 750, description: "بيع خردة" });

  const trips = table("invoice_trips").filter((t) => t.invoice_id === inv1 || t.invoice_id === inv2).sort((a, b) => a.id - b.id);
  await repo.savePayment({ date: d(3, 1), account_kind: "cashbox", account_id: cb, voucher_type: "trip", trip_id: trips[0].id, amount: 220, description: "رسوم تفريغ" });
  const adv = await repo.savePayment({ date: d(3, 3), account_kind: "cashbox", account_id: cb, voucher_type: "advance", employee_id: drv1, amount: 1000, description: "سلفة" });
  await repo.savePayment({ date: d(3, 8), account_kind: "bank", account_id: bnk, voucher_type: "vehicle", vehicle_id: veh1, vehicle_expense: "maintenance", amount: 850, description: "صيانة" });
  await repo.savePayment({ date: d(3, 15), account_kind: "cashbox", account_id: cb, voucher_type: "general", amount: 1200, description: "إيجار" });
  await repo.savePayroll({ date: d(3, 28), employee_id: drv1, period_year: y, period_month: 3, account_kind: "cashbox", account_id: cb, base_salary: 3500, additions: 300, additions_note: "", other_deductions: 0, settlements: [[adv, 400]], notes: "" });
  await repo.savePayroll({ date: d(3, 28), employee_id: drv2, period_year: y, period_month: 3, account_kind: "cashbox", account_id: cb, base_salary: 3200, additions: 0, other_deductions: 150, settlements: [], notes: "" });

  return { cust1, cust2, drv1, drv2, veh1, veh2, cb, bnk, inv1, inv2, adv };
}

describe("الحسابات — مطابقة التطبيق المكتبي المرجعي", () => {
  let ids: Record<string, number>;

  beforeEach(async () => {
    ids = await seedDemo();
  });

  it("أرصدة العملاء", async () => {
    expect(await calc.customerBalance(ids.cust1)).toBeCloseTo(17500, 2);
    expect(await calc.customerBalance(ids.cust2)).toBeCloseTo(1800, 2);
  });

  it("أرصدة الخزائن والبنوك", async () => {
    expect(await calc.accountBalance("cashbox", ids.cb)).toBeCloseTo(16130, 2);
    expect(await calc.accountBalance("bank", ids.bnk)).toBeCloseTo(79900, 2);
  });

  it("إجماليات الفواتير", async () => {
    const t1 = await calc.invoiceTotals(ids.inv1);
    expect(t1.trips_total).toBeCloseTo(7500, 2);
    expect(t1.expenses_total).toBeCloseTo(1130, 2);
    expect(t1.expected_profit).toBeCloseTo(6370, 2);
    expect(t1.later_payments).toBeCloseTo(220, 2);
    expect(t1.actual_profit).toBeCloseTo(6150, 2);
    expect(t1.customer_total).toBeCloseTo(7500, 2);

    const t2 = await calc.invoiceTotals(ids.inv2);
    expect(t2.trips_total).toBeCloseTo(1800, 2);
    expect(t2.expenses_total).toBeCloseTo(250, 2);
    expect(t2.actual_profit).toBeCloseTo(1550, 2);
  });

  it("تقرير الأرباح والخسائر", async () => {
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    expect(p.transport_revenue).toBeCloseTo(9300, 2);
    expect(p.other_revenue).toBeCloseTo(750, 2);
    expect(p.total_revenue).toBeCloseTo(10050, 2);
    expect(p.direct_expenses).toBeCloseTo(1380, 2);
    // سندات الرحلات اليدوية صارت تُحتسب مصروفاً (كانت تخرج من الخزينة بلا قيد مصروف)
    expect(p.trip_payments).toBeCloseTo(220, 2);
    expect(p.salaries).toBeCloseTo(6450, 2);
    expect(p.advances).toBeCloseTo(1000, 2);
    expect(p.maintenance).toBeCloseTo(850, 2);
    expect(p.general_expenses).toBeCloseTo(1200, 2);
    expect(p.total_expenses).toBeCloseTo(11100, 2);
    expect(p.net).toBeCloseTo(-1050, 2);
    expect(p.vat_collected).toBeCloseTo(0, 2);
  });

  it("كشف حساب العميل", async () => {
    const st = await calc.customerStatement(ids.cust1, "1900-01-01", "2999-12-31");
    expect(st.opening).toBeCloseTo(15000, 2);
    expect(st.closing).toBeCloseTo(17500, 2);
    expect(st.rows).toHaveLength(2);
    expect(st.rows[0].debit).toBeCloseTo(7500, 2);
    expect(st.rows[1].credit).toBeCloseTo(5000, 2);
    expect(st.rows[st.rows.length - 1].balance).toBeCloseTo(17500, 2);
  });

  it("كشف حساب الخزينة", async () => {
    const st = await calc.accountStatement("cashbox", ids.cb, "1900-01-01", "2999-12-31");
    expect(st.opening).toBeCloseTo(20000, 2);
    expect(st.closing).toBeCloseTo(16130, 2);
    expect(st.rows).toHaveLength(6);
    expect(st.rows[st.rows.length - 1].balance).toBeCloseTo(16130, 2);
  });

  it("كشف حساب الموظف/السائق", async () => {
    const e = await calc.employeeStatement(ids.drv1);
    expect(e.totals.salaries_net).toBeCloseTo(3400, 2);
    expect(e.totals.salaries_additions).toBeCloseTo(300, 2);
    expect(e.totals.salaries_deductions).toBeCloseTo(400, 2);
    expect(e.totals.advances_total).toBeCloseTo(1000, 2);
    expect(e.totals.advances_remaining).toBeCloseTo(600, 2);
    expect(e.totals.allowances_total).toBeCloseTo(500, 2);
  });

  it("تقرير أداء السيارات", async () => {
    const r = await calc.vehicleReport("1900-01-01", "2999-12-31");
    const v1 = r.find((x) => x.vehicle_id === ids.veh1)!;
    const v2 = r.find((x) => x.vehicle_id === ids.veh2)!;
    expect(v1.revenue).toBeCloseTo(6300, 2);
    expect(v1.direct).toBeCloseTo(950, 2);
    expect(v1.maintenance).toBeCloseTo(850, 2);
    expect(v1.net).toBeCloseTo(4500, 2);
    expect(v2.revenue).toBeCloseTo(3000, 2);
    expect(v2.net).toBeCloseTo(2570, 2);
  });

  it("تقرير أرباح الرحلات", async () => {
    const r = await calc.tripProfitsReport("1900-01-01", "2999-12-31");
    expect(r).toHaveLength(3);
    const t1 = r.find((x) => x.trip_id === table("invoice_trips").find((t) => t.invoice_id === ids.inv1)?.id)!;
    expect(t1.revenue).toBeCloseTo(4500, 2);
    expect(t1.direct).toBeCloseTo(700, 2);
    expect(t1.later).toBeCloseTo(220, 2);
    expect(t1.net).toBeCloseTo(3580, 2);
  });

  it("معادلة ميزان المراجعة: صافي الربح − تغيّر الأصول = − المصروفات غير النقدية", async () => {
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    const assets =
      (await calc.customerBalance(ids.cust1)) +
      (await calc.customerBalance(ids.cust2)) +
      (await calc.accountBalance("cashbox", ids.cb)) +
      (await calc.accountBalance("bank", ids.bnk));
    const opened = 15000 + 0 + 20000 + 80000;
    const dAssets = assets - opened;
    // المصروفات المسجّلة داخل الفواتير هنا "آجلة على مورد" فلم تمس الأصول بعد
    const direct = table("trip_expenses").reduce((a, e) => a + e.amount, 0);
    expect(p.net - dAssets).toBeCloseTo(-direct, 2);
  });
});

describe("سحب نقدي لصاحب المنشأة", () => {
  it("يُسجَّل كسند دفع، يخصم من الخزينة، ويُخصم من أرباح تقرير P&L", async () => {
    setupCompany(0);
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "شركة العميل", opening_balance: 0 });
    const cb = await repo.saveAccount("cashbox", { name: "الخزينة", created_date: "2026-01-01", opening_balance: 10000 });
    const inv = await repo.saveInvoice({
      date: "2026-05-05", customer_id: cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", price: 2000, expenses: [] }],
    });
    expect(await calc.accountBalance("cashbox", cb)).toBeCloseTo(10000, 2);

    await repo.savePayment({
      date: "2026-05-06", account_kind: "cashbox", account_id: cb,
      voucher_type: "owner", amount: 500, description: "مصاريف شخصية لصاحب المنشأة",
    });

    // يخرج فعلياً من الخزينة
    expect(await calc.accountBalance("cashbox", cb)).toBeCloseTo(9500, 2);

    // يُحتسب ضمن مصروفات تقرير الأرباح والخسائر (خصم من الأرباح)
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    expect(p.transport_revenue).toBeCloseTo(2000, 2);
    expect(p.owner_withdrawals).toBeCloseTo(500, 2);
    expect(p.total_expenses).toBeCloseTo(500, 2);
    expect(p.net).toBeCloseTo(1500, 2);

    // يظهر في كشف حساب الخزينة كنوع سحب مالك
    const st = await calc.accountStatement("cashbox", cb, "1900-01-01", "2999-12-31");
    const last = st.rows[st.rows.length - 1];
    expect(last.kind).toBe("payment");
    expect(last.out).toBeCloseTo(500, 2);
    expect(last.desc).toContain("صاحب المنشأة");
  });

  it("يرفض سحب المالك بدون بيان", async () => {
    setupCompany(0);
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cb = await repo.saveAccount("cashbox", { name: "الخزينة", created_date: "2026-01-01", opening_balance: 10000 });
    await expect(
      repo.savePayment({ date: "2026-05-06", account_kind: "cashbox", account_id: cb, voucher_type: "owner", amount: 500, description: "" })
    ).rejects.toThrow(/بيان/);
  });
});

describe("ضريبة القيمة المضافة (مرجعية)", () => {
  it("تُضاف الضريبة لإجمالي العميل ولا تدخل في إيراد الربح", async () => {
    setupCompany(15);
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "شركة العميل", opening_balance: 0 });
    const inv = await repo.saveInvoice({
      date: "2026-05-05", customer_id: cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", price: 1000, expenses: [] }],
    });
    const t = await calc.invoiceTotals(inv);
    expect(t.trips_total).toBeCloseTo(1000, 2);
    expect(t.vat_amount).toBeCloseTo(150, 2);
    expect(t.customer_total).toBeCloseTo(1150, 2);

    expect(await calc.customerBalance(cust)).toBeCloseTo(1150, 2);

    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    expect(p.transport_revenue).toBeCloseTo(1000, 2);
    expect(p.vat_collected).toBeCloseTo(150, 2);
    expect(p.total_revenue).toBeCloseTo(1000, 2);
  });
});
