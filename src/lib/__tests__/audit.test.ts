// ---------------------------------------------------------------------------
// تدقيق محاسبي شامل للمشروع (Full accounting audit)
//
// الفكرة: بناء "دفتر أستاذ مزدوج القيد" مستقل تماماً عن calc.ts، يُشتق مباشرة
// من الجداول الخام (فواتير/مصروفات/سندات/رواتب)، ثم مطابقة كل ما يعرضه التطبيق
// (أرصدة، كشوف حساب، تقارير، ربحية) على هذا الدفتر.
// أي خطأ في المنطق المحاسبي للتطبيق سيظهر كفرق بين المسارين.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table } from "./memory-supabase";
import * as calc from "@/lib/calc";
import * as repo from "@/lib/repo";

const r2 = (n: number): number => Math.round(n * 100) / 100;

function setupCompany(vatRate: number): void {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [
    {
      id: "c1", name: "شركة النقل", phone: "", email: "", address: "",
      currency: "ج.م", vat_rate: vatRate, vat_note: "", plan_type: "open",
      trial_end: null, subscription_start: null, subscription_end: null, is_active: true,
    },
  ]);
}

// ---------------------------------------------------------------------------
// دفتر الأستاذ المستقل
// ---------------------------------------------------------------------------
type Entry = { account: string; debit: number; credit: number; ref: string };

/**
 * السياسة المحاسبية المعتمدة في التطبيق:
 *  - الإيراد يُسجّل على أساس الاستحقاق عند إصدار الفاتورة (ذمم مدينة على العميل).
 *  - مصروفات النقلة تُسجّل عند التسجيل، ويكون الطرف الدائن بحسب مصدر التمويل:
 *      cash → نقدية (سند صرف تلقائي)، driver → عهدة السائق، supplier → دائنون.
 *      customer → ليس مصروفاً إطلاقاً، بل إيراد إضافي على الفاتورة.
 *  - باقي المصروفات (رواتب/سلف/صيانة/عامة/سندات نقلات يدوية) على أساس نقدي.
 */
function buildLedger(): Entry[] {
  const L: Entry[] = [];
  const dr = (account: string, amount: number, ref: string) => { if (amount) L.push({ account, debit: r2(amount), credit: 0, ref }); };
  const cr = (account: string, amount: number, ref: string) => { if (amount) L.push({ account, debit: 0, credit: r2(amount), ref }); };

  // 1) الأرصدة الافتتاحية (الطرف المقابل: حقوق الملكية)
  for (const c of table("customers")) {
    dr(`AR:${c.id}`, Number(c.opening_balance ?? 0), `opening-customer-${c.id}`);
    cr("EQUITY", Number(c.opening_balance ?? 0), `opening-customer-${c.id}`);
  }
  for (const kind of ["cashbox", "bank"] as const) {
    for (const a of table(kind === "cashbox" ? "cashboxes" : "banks")) {
      dr(`CASH:${kind}:${a.id}`, Number(a.opening_balance ?? 0), `opening-${kind}-${a.id}`);
      cr("EQUITY", Number(a.opening_balance ?? 0), `opening-${kind}-${a.id}`);
    }
  }

  // 2) الفواتير: مدين ذمم العميل / دائن إيراد النقل + الضريبة المستحقة
  const tripsByInv = new Map<number, any[]>();
  for (const t of table("invoice_trips")) {
    tripsByInv.set(t.invoice_id, [...(tripsByInv.get(t.invoice_id) ?? []), t]);
  }
  const expsByTrip = new Map<number, any[]>();
  for (const e of table("trip_expenses")) {
    expsByTrip.set(e.trip_id, [...(expsByTrip.get(e.trip_id) ?? []), e]);
  }

  for (const inv of table("invoices")) {
    const trips = tripsByInv.get(inv.id) ?? [];
    let revenue = 0;
    for (const t of trips) {
      revenue += Number(t.price ?? 0);
      for (const e of expsByTrip.get(t.id) ?? []) {
        if (e.source === "customer") revenue += Number(e.amount ?? 0); // يُعاد تحميله على العميل
      }
    }
    const vat = r2((revenue * Number(inv.vat_rate ?? 0)) / 100);
    dr(`AR:${inv.customer_id}`, revenue + vat, `invoice-${inv.id}`);
    cr("REV:transport", revenue, `invoice-${inv.id}`);
    cr("VAT:payable", vat, `invoice-${inv.id}`);
  }

  // 3) مصروفات النقلات بحسب مصدر التمويل
  for (const t of table("invoice_trips")) {
    for (const e of expsByTrip.get(t.id) ?? []) {
      const amt = Number(e.amount ?? 0);
      if (e.source === "customer") continue; // ليست تكلفة
      dr("EXP:direct", amt, `trip-expense-${e.id}`);
      if (e.source === "driver") cr(`CUSTODY:${t.driver_id}`, amt, `trip-expense-${e.id}`);
      else if (e.source === "supplier") cr("AP:suppliers", amt, `trip-expense-${e.id}`);
      else cr(`CASH:${e.account_kind}:${e.account_id}`, amt, `trip-expense-${e.id}`); // نقدي
    }
  }

  // 4) سندات القبض
  for (const v of table("receipt_vouchers")) {
    const amt = Number(v.amount ?? 0);
    dr(`CASH:${v.account_kind}:${v.account_id}`, amt, `receipt-${v.id}`);
    if (v.voucher_type === "customer") cr(`AR:${v.customer_id}`, amt, `receipt-${v.id}`);
    else cr("REV:other", amt, `receipt-${v.id}`);
  }

  // 5) سندات الصرف — السندات المتولّدة تلقائياً (source_expense_id != null)
  //    سبق قيدها ضمن الخطوة (3) فلا تُقيَّد مرة أخرى (منع الازدواج).
  const acctOf: Record<string, string> = {
    trip: "EXP:trip_vouchers", advance: "EXP:advances",
    vehicle: "EXP:maintenance", general: "EXP:general",
  };
  for (const v of table("payment_vouchers")) {
    if (v.source_expense_id != null) continue;
    const amt = Number(v.amount ?? 0);
    dr(acctOf[v.voucher_type] ?? "EXP:general", amt, `payment-${v.id}`);
    cr(`CASH:${v.account_kind}:${v.account_id}`, amt, `payment-${v.id}`);
  }

  // 6) الرواتب (الصافي المنصرف فقط — الخصومات تسويات داخلية)
  for (const p of table("payrolls")) {
    const net = Number(p.net_salary ?? 0);
    dr("EXP:salaries", net, `payroll-${p.id}`);
    cr(`CASH:${p.account_kind}:${p.account_id}`, net, `payroll-${p.id}`);
  }

  return L;
}

function ledgerBalance(L: Entry[], account: string): number {
  return r2(L.filter((e) => e.account === account).reduce((a, e) => a + e.debit - e.credit, 0));
}
function ledgerGroup(L: Entry[], prefix: string): number {
  return r2(L.filter((e) => e.account.startsWith(prefix)).reduce((a, e) => a + e.debit - e.credit, 0));
}

// ---------------------------------------------------------------------------
// سيناريو تشغيلي كامل يغطي كل أنواع الحركات
// ---------------------------------------------------------------------------
async function seedFullScenario(vatRate = 14) {
  setupCompany(vatRate);
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31", notes: "" });

  const custA = await repo.saveCustomer({ name: "شركة الدلتا", opening_balance: 5000, notes: "" });
  const custB = await repo.saveCustomer({ name: "مصانع المنصورة", opening_balance: 0, notes: "" });
  const drv1 = await repo.saveEmployee({ name: "سائق ١", emp_type: "driver", notes: "" });
  const drv2 = await repo.saveEmployee({ name: "سائق ٢", emp_type: "driver", notes: "" });
  const adminEmp = await repo.saveEmployee({ name: "موظف إداري", emp_type: "admin", notes: "" });
  const veh1 = await repo.saveVehicle({ plate_number: "س ص ع 111", vehicle_type: "تريلا", default_driver_id: drv1, notes: "" });
  const veh2 = await repo.saveVehicle({ plate_number: "ق ر ش 222", vehicle_type: "قلاب", default_driver_id: drv2, notes: "" });
  const cb = await repo.saveAccount("cashbox", { name: "الخزينة", created_date: "2026-01-01", opening_balance: 50000, notes: "" });
  const bnk = await repo.saveAccount("bank", { name: "بنك مصر", created_date: "2026-01-01", opening_balance: 120000, notes: "" });

  // فاتورة (1): ٣ نقلات لنفس الوجهة + مصروفات بكل المصادر الأربعة
  const inv1 = await repo.saveInvoice({
    date: "2026-02-10", customer_id: custA, notes: "عقد شهري", attachments: [],
    trips: [
      {
        vehicle_id: veh1, driver_id: drv1, from_loc: "المنصورة", to_loc: "الإسكندرية",
        qty: 3, unit_price: 1500, notes: "",
        expenses: [
          { expense_type: "card", qty: 3, unit_amount: 120, source: "cash", account_kind: "cashbox", account_id: cb, notes: "كارتة" },
          { expense_type: "fuel", qty: 1, unit_amount: 800, source: "driver", notes: "سولار" },
          { expense_type: "trip", qty: 3, unit_amount: 200, source: "supplier", supplier_name: "محطة النور", notes: "تريب" },
          { expense_type: "other", qty: 1, unit_amount: 450, source: "customer", notes: "رسوم ميناء يتحمّلها العميل" },
        ],
      },
      {
        vehicle_id: veh2, driver_id: drv2, from_loc: "المنصورة", to_loc: "القاهرة",
        qty: 2, unit_price: 900, notes: "",
        expenses: [
          { expense_type: "fuel", qty: 2, unit_amount: 150, source: "cash", account_kind: "bank", account_id: bnk, notes: "" },
        ],
      },
    ],
  });

  // فاتورة (2): بلا مصروفات إطلاقاً
  const inv2 = await repo.saveInvoice({
    date: "2026-03-05", customer_id: custB, notes: "", attachments: [],
    trips: [{ vehicle_id: veh1, driver_id: drv1, from_loc: "طنطا", to_loc: "أسيوط", qty: 1, unit_price: 2600, notes: "", expenses: [] }],
  });

  // تحصيلات وإيرادات أخرى
  await repo.saveReceipt({ date: "2026-02-20", account_kind: "cashbox", account_id: cb, voucher_type: "customer", customer_id: custA, amount: 4000, description: "دفعة" });
  await repo.saveReceipt({ date: "2026-03-10", account_kind: "bank", account_id: bnk, voucher_type: "other", amount: 1750, description: "بيع خردة" });

  // سند صرف يدوي على نقلة (مصروف طارئ بعد التسجيل)
  const trip1 = table("invoice_trips").find((t) => t.invoice_id === inv1)!.id;
  await repo.savePayment({ date: "2026-02-25", account_kind: "cashbox", account_id: cb, voucher_type: "trip", trip_id: trip1, amount: 300, description: "غرامة وزن" });

  // سلفة + صيانة + مصاريف عامة
  const adv = await repo.savePayment({ date: "2026-03-01", account_kind: "cashbox", account_id: cb, voucher_type: "advance", employee_id: drv1, amount: 1200, description: "سلفة" });
  await repo.savePayment({ date: "2026-03-06", account_kind: "bank", account_id: bnk, voucher_type: "vehicle", vehicle_id: veh1, vehicle_expense: "maintenance", amount: 2400, description: "صيانة" });
  await repo.savePayment({ date: "2026-03-20", account_kind: "cashbox", account_id: cb, voucher_type: "general", amount: 1800, description: "إيجار" });

  // رواتب (مع تسوية جزء من السلفة)
  await repo.savePayroll({ date: "2026-03-28", employee_id: drv1, period_year: 2026, period_month: 3, account_kind: "cashbox", account_id: cb, base_salary: 4000, additions: 500, additions_note: "حافز", other_deductions: 100, settlements: [[adv, 700]], notes: "" });
  await repo.savePayroll({ date: "2026-03-28", employee_id: adminEmp, period_year: 2026, period_month: 3, account_kind: "bank", account_id: bnk, base_salary: 3000, additions: 0, other_deductions: 0, settlements: [], notes: "" });

  return { custA, custB, drv1, drv2, adminEmp, veh1, veh2, cb, bnk, inv1, inv2, adv, trip1 };
}

// ---------------------------------------------------------------------------
describe("تدقيق محاسبي: توازن دفتر الأستاذ ومطابقة الأرصدة", () => {
  let s: Awaited<ReturnType<typeof seedFullScenario>>;
  let L: Entry[];

  beforeEach(async () => {
    s = await seedFullScenario(14);
    L = buildLedger();
  });

  it("مجموع المدين = مجموع الدائن (توازن القيد المزدوج)", () => {
    const debit = r2(L.reduce((a, e) => a + e.debit, 0));
    const credit = r2(L.reduce((a, e) => a + e.credit, 0));
    expect(debit).toBeGreaterThan(0);
    expect(debit).toBeCloseTo(credit, 2);
  });

  it("أرصدة الخزينة والبنك تطابق دفتر الأستاذ", async () => {
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(ledgerBalance(L, `CASH:cashbox:${s.cb}`), 2);
    expect(await calc.accountBalance("bank", s.bnk)).toBeCloseTo(ledgerBalance(L, `CASH:bank:${s.bnk}`), 2);
  });

  it("أرصدة العملاء تطابق دفتر الأستاذ", async () => {
    expect(await calc.customerBalance(s.custA)).toBeCloseTo(ledgerBalance(L, `AR:${s.custA}`), 2);
    expect(await calc.customerBalance(s.custB)).toBeCloseTo(ledgerBalance(L, `AR:${s.custB}`), 2);
  });

  it("صافي الربح في تقرير الأرباح والخسائر = إيرادات الأستاذ − مصروفاته", async () => {
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    const revenue = -ledgerGroup(L, "REV:");   // الإيراد رصيده دائن
    const expenses = ledgerGroup(L, "EXP:");   // المصروف رصيده مدين
    expect(p.total_revenue).toBeCloseTo(revenue, 2);
    expect(p.total_expenses).toBeCloseTo(expenses, 2);
    expect(p.net).toBeCloseTo(revenue - expenses, 2);
  });

  it("تفاصيل بنود تقرير الأرباح والخسائر تطابق حسابات الأستاذ بنداً بنداً", async () => {
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    expect(p.transport_revenue).toBeCloseTo(-ledgerBalance(L, "REV:transport"), 2);
    expect(p.other_revenue).toBeCloseTo(-ledgerBalance(L, "REV:other"), 2);
    expect(p.direct_expenses).toBeCloseTo(ledgerBalance(L, "EXP:direct"), 2);
    expect(p.trip_payments).toBeCloseTo(ledgerBalance(L, "EXP:trip_vouchers"), 2);
    expect(p.salaries).toBeCloseTo(ledgerBalance(L, "EXP:salaries"), 2);
    expect(p.advances).toBeCloseTo(ledgerBalance(L, "EXP:advances"), 2);
    expect(p.maintenance).toBeCloseTo(ledgerBalance(L, "EXP:maintenance"), 2);
    expect(p.general_expenses).toBeCloseTo(ledgerBalance(L, "EXP:general"), 2);
    expect(p.vat_collected).toBeCloseTo(-ledgerBalance(L, "VAT:payable"), 2);
  });

  it("معادلة الميزانية: الأصول = الالتزامات + حقوق الملكية + صافي الربح", async () => {
    const assets = ledgerGroup(L, "CASH:") + ledgerGroup(L, "AR:");
    const liabilities = -(ledgerGroup(L, "AP:") + ledgerGroup(L, "CUSTODY:") + ledgerBalance(L, "VAT:payable"));
    const equity = -ledgerBalance(L, "EQUITY");
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    expect(assets).toBeCloseTo(liabilities + equity + p.net, 2);
  });

  it("الضريبة لا تدخل في الربح لكنها تدخل في مديونية العميل", async () => {
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    const t1 = await calc.invoiceTotals(s.inv1);
    expect(p.vat_collected).toBeGreaterThan(0);
    expect(t1.vat_rate).toBeCloseTo(14, 2);
    expect(t1.customer_total).toBeCloseTo(t1.trips_total + t1.billable_total + t1.vat_amount, 2);
    // الإيراد في P&L بلا ضريبة
    expect(p.transport_revenue).toBeCloseTo(-ledgerBalance(L, "REV:transport"), 2);
  });
});

// ---------------------------------------------------------------------------
describe("تدقيق محاسبي: مصادر تمويل المصروف والازدواج", () => {
  let s: Awaited<ReturnType<typeof seedFullScenario>>;

  beforeEach(async () => { s = await seedFullScenario(14); });

  it("كل مصروف نقدي يقابله سند صرف واحد بنفس المبلغ ونفس الحساب", () => {
    const cashExps = table("trip_expenses").filter((e) => e.source === "cash");
    expect(cashExps.length).toBe(2);
    for (const e of cashExps) {
      const vs = table("payment_vouchers").filter((v) => v.source_expense_id === e.id);
      expect(vs).toHaveLength(1);
      expect(vs[0].amount).toBeCloseTo(e.amount, 2);
      expect(vs[0].account_kind).toBe(e.account_kind);
      expect(vs[0].account_id).toBe(e.account_id);
      expect(vs[0].voucher_type).toBe("trip");
    }
  });

  it("المصروف النقدي يُحتسب مرة واحدة فقط في تكلفة النقلة", async () => {
    const p = await calc.tripProfit(s.trip1);
    // 360 كارتة نقدي + 800 عهدة سائق + 600 آجل = 1760 تكلفة، والسند اليدوي 300 منفصل
    expect(p.direct).toBeCloseTo(1760, 2);
    expect(p.later).toBeCloseTo(300, 2);
    expect(p.price).toBeCloseTo(4500 + 450, 2); // شامل بند العميل
    expect(p.net).toBeCloseTo(4950 - 1760 - 300, 2);
  });

  it("مصروف العميل ليس تكلفة ويرفع الإيراد والمديونية والضريبة", async () => {
    const t = await calc.invoiceTotals(s.inv1);
    expect(t.trips_total).toBeCloseTo(4500 + 1800, 2);
    expect(t.billable_total).toBeCloseTo(450, 2);
    expect(t.expenses_total).toBeCloseTo(360 + 800 + 600 + 300, 2);
    expect(t.vat_amount).toBeCloseTo(r2(((6300 + 450) * 14) / 100), 2);
    expect(t.customer_total).toBeCloseTo(6750 + t.vat_amount, 2);
    expect(t.expected_profit).toBeCloseTo(6750 - 2060, 2);
  });

  it("مصروف عهدة السائق التزام على الشركة ولا يمسّ النقدية", () => {
    const L = buildLedger();
    expect(ledgerBalance(L, `CUSTODY:${s.drv1}`)).toBeCloseTo(-800, 2); // دائن
    const cashMoves = table("payment_vouchers").filter((v) => v.description?.includes("سولار"));
    expect(cashMoves).toHaveLength(0);
  });

  it("المصروف الآجل التزام لمورد ولا يمسّ النقدية", () => {
    const L = buildLedger();
    expect(ledgerBalance(L, "AP:suppliers")).toBeCloseTo(-600, 2);
    const sup = table("trip_expenses").find((e) => e.source === "supplier")!;
    expect(sup.supplier_name).toBe("محطة النور");
    expect(table("payment_vouchers").filter((v) => v.source_expense_id === sup.id)).toHaveLength(0);
  });

  it("مجموع مصروفات الفاتورة = المصروفات المباشرة في تقرير P&L", async () => {
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    const raw = table("trip_expenses").filter((e) => e.source !== "customer").reduce((a, e) => a + e.amount, 0);
    expect(p.direct_expenses).toBeCloseTo(raw, 2);
  });
});

// ---------------------------------------------------------------------------
describe("تدقيق محاسبي: كشوف الحسابات والتقارير", () => {
  let s: Awaited<ReturnType<typeof seedFullScenario>>;

  beforeEach(async () => { s = await seedFullScenario(14); });

  it("كشف حساب العميل: الافتتاحي + الحركة = الرصيد الختامي = دالة الرصيد", async () => {
    const st = await calc.customerStatement(s.custA, "1900-01-01", "2999-12-31");
    const move = st.rows.reduce((a, r) => a + r.debit - r.credit, 0);
    expect(st.opening).toBeCloseTo(5000, 2);
    expect(r2(st.opening + move)).toBeCloseTo(st.closing, 2);
    expect(st.closing).toBeCloseTo(await calc.customerBalance(s.custA), 2);
    expect(st.rows[st.rows.length - 1].balance).toBeCloseTo(st.closing, 2);
  });

  it("كشف حساب الخزينة والبنك: الختامي = دالة الرصيد ومجموع الحركة متسق", async () => {
    for (const [kind, id] of [["cashbox", s.cb], ["bank", s.bnk]] as const) {
      const st = await calc.accountStatement(kind, id, "1900-01-01", "2999-12-31");
      const move = st.rows.reduce((a, r) => a + r.in - r.out, 0);
      expect(r2(st.opening + move)).toBeCloseTo(st.closing, 2);
      expect(st.closing).toBeCloseTo(await calc.accountBalance(kind, id), 2);
      // الرصيد التراكمي في آخر صف = الختامي
      expect(st.rows[st.rows.length - 1].balance).toBeCloseTo(st.closing, 2);
    }
  });

  it("كشف الخزينة يعرض سندات المصروفات النقدية التلقائية (شفافية الحركة)", async () => {
    const st = await calc.accountStatement("cashbox", s.cb, "1900-01-01", "2999-12-31");
    const auto = table("payment_vouchers").filter((v) => v.source_expense_id != null && v.account_kind === "cashbox");
    expect(auto.length).toBe(1);
    const total = st.rows.reduce((a, r) => a + r.out, 0);
    expect(total).toBeGreaterThanOrEqual(auto[0].amount);
  });

  it("تقرير ربحية النقلات: مجموع الأرباح = الإيراد − (المباشرة + سندات النقلات)", async () => {
    const rows = await calc.tripProfitsReport("1900-01-01", "2999-12-31");
    const totalNet = rows.reduce((a, r) => a + Number(r.net), 0);
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    expect(r2(totalNet)).toBeCloseTo(r2(p.transport_revenue - p.direct_expenses - p.trip_payments), 2);
  });

  it("تقرير أداء السيارات: الإيراد الكلي = إيراد النقلات المسندة للسيارات", async () => {
    const rows = await calc.vehicleReport("1900-01-01", "2999-12-31");
    const rev = rows.reduce((a, r) => a + Number(r.revenue), 0);
    const tripsRev = table("invoice_trips").reduce((a, t) => a + t.price, 0);
    expect(r2(rev)).toBeCloseTo(r2(tripsRev), 2);
    const maint = rows.reduce((a, r) => a + Number(r.maintenance), 0);
    expect(r2(maint)).toBeCloseTo(2400, 2);
  });

  it("كشف الموظف: صافي الرواتب والسلف والمتبقي منها صحيح", async () => {
    const e = await calc.employeeStatement(s.drv1);
    expect(e.totals.salaries_net).toBeCloseTo(4000 + 500 - 700 - 100, 2);
    expect(e.totals.salaries_additions).toBeCloseTo(500, 2);
    expect(e.totals.salaries_deductions).toBeCloseTo(800, 2);
    expect(e.totals.advances_total).toBeCloseTo(1200, 2);
    expect(e.totals.advances_remaining).toBeCloseTo(500, 2);
  });

  it("الرواتب المنصرفة في P&L = مجموع صافي الرواتب في الجدول", async () => {
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    const nets = table("payrolls").reduce((a, r) => a + r.net_salary, 0);
    expect(p.salaries).toBeCloseTo(nets, 2);
  });

  it("فلترة الفترات: تقرير مارس يستبعد حركات فبراير", async () => {
    const march = await calc.pnlReport("2026-03-01", "2026-03-31");
    const feb = await calc.pnlReport("2026-02-01", "2026-02-28");
    const all = await calc.pnlReport("1900-01-01", "2999-12-31");
    expect(r2(march.total_revenue + feb.total_revenue)).toBeCloseTo(all.total_revenue, 2);
    expect(r2(march.total_expenses + feb.total_expenses)).toBeCloseTo(all.total_expenses, 2);
    expect(r2(march.net + feb.net)).toBeCloseTo(all.net, 2);
  });
});

// ---------------------------------------------------------------------------
describe("تدقيق محاسبي: عكس القيود عند التعديل والحذف", () => {
  it("حذف الفاتورة يعيد كل الأرصدة إلى ما كانت عليه بالضبط", async () => {
    const s = await seedFullScenario(14);
    const before = {
      cash: await calc.accountBalance("cashbox", s.cb),
      bank: await calc.accountBalance("bank", s.bnk),
      cust: await calc.customerBalance(s.custB),
      pnl: (await calc.pnlReport("1900-01-01", "2999-12-31")).net,
    };
    const inv = await repo.saveInvoice({
      date: "2026-04-01", customer_id: s.custB, attachments: [],
      trips: [{
        driver_id: s.drv2, from_loc: "أ", to_loc: "ب", qty: 2, unit_price: 1000,
        expenses: [
          { expense_type: "fuel", qty: 1, unit_amount: 400, source: "cash", account_kind: "cashbox", account_id: s.cb },
          { expense_type: "trip", qty: 1, unit_amount: 250, source: "supplier", supplier_name: "محطة" },
        ],
      }],
    });
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(before.cash - 400, 2);

    await repo.deleteInvoice(inv);
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(before.cash, 2);
    expect(await calc.accountBalance("bank", s.bnk)).toBeCloseTo(before.bank, 2);
    expect(await calc.customerBalance(s.custB)).toBeCloseTo(before.cust, 2);
    expect((await calc.pnlReport("1900-01-01", "2999-12-31")).net).toBeCloseTo(before.pnl, 2);
    // لا سندات يتيمة
    const orphan = table("payment_vouchers").filter((v) => v.source_expense_id != null && !table("trip_expenses").some((e) => e.id === v.source_expense_id));
    expect(orphan).toHaveLength(0);
  });

  it("تعديل الفاتورة يعدّل النقدية بفرق المبلغ فقط (بلا تكرار سندات)", async () => {
    const s = await seedFullScenario(0);
    const cashBefore = await calc.accountBalance("cashbox", s.cb);
    const full = await calc.getInvoiceFull(s.inv1);
    const trips = full!.trips.map((t) => ({
      id: t.id, vehicle_id: t.vehicle_id, driver_id: t.driver_id,
      from_loc: t.from_loc, to_loc: t.to_loc, qty: t.qty, unit_price: t.unit_price, notes: t.notes,
      expenses: t.expenses.map((e) => ({
        id: e.id, expense_type: e.expense_type, qty: e.qty,
        unit_amount: e.expense_type === "card" ? 200 : e.unit_amount, // 3×120 → 3×200 (+240)
        source: e.source, account_kind: e.account_kind, account_id: e.account_id,
        supplier_name: e.supplier_name, notes: e.notes,
      })),
    }));
    await repo.saveInvoice({ date: full!.date, customer_id: full!.customer_id, notes: full!.notes, attachments: [], trips }, s.inv1);

    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(cashBefore - 240, 2);
    const autos = table("payment_vouchers").filter((v) => v.source_expense_id != null);
    expect(autos).toHaveLength(2); // ما زالا اثنين فقط
    const L = buildLedger();
    expect(r2(L.reduce((a, e) => a + e.debit, 0))).toBeCloseTo(r2(L.reduce((a, e) => a + e.credit, 0)), 2);
  });

  it("حذف سند الصرف اليدوي يعيد رصيد الخزينة وربحية النقلة", async () => {
    const s = await seedFullScenario(0);
    const v = table("payment_vouchers").find((x) => x.description === "غرامة وزن")!;
    const cashBefore = await calc.accountBalance("cashbox", s.cb);
    const profitBefore = (await calc.tripProfit(s.trip1)).net;
    await repo.deletePayment(v.id);
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(cashBefore + 300, 2);
    expect((await calc.tripProfit(s.trip1)).net).toBeCloseTo(profitBefore + 300, 2);
  });

  it("حذف سند القبض يعيد مديونية العميل", async () => {
    const s = await seedFullScenario(0);
    const v = table("receipt_vouchers").find((x) => x.voucher_type === "customer")!;
    const balBefore = await calc.customerBalance(s.custA);
    await repo.deleteReceipt(v.id);
    expect(await calc.customerBalance(s.custA)).toBeCloseTo(balBefore + 4000, 2);
  });
});

// ---------------------------------------------------------------------------
describe("تدقيق محاسبي: سلامة القيم والتقريب والحالات الحدّية", () => {
  it("التقريب لخانتين لا يسرّب فروقاً في الإجماليات", async () => {
    setupCompany(14);
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "عميل", opening_balance: 0 });
    const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 1000 });
    const inv = await repo.saveInvoice({
      date: "2026-05-01", customer_id: cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 3, unit_price: 333.33, expenses: [{ expense_type: "fuel", qty: 3, unit_amount: 33.33, source: "cash", account_kind: "cashbox", account_id: cb }] }],
    });
    const t = await calc.invoiceTotals(inv);
    expect(t.trips_total).toBeCloseTo(999.99, 2);
    expect(t.expenses_total).toBeCloseTo(99.99, 2);
    expect(t.vat_amount).toBeCloseTo(140, 2);
    expect(t.customer_total).toBeCloseTo(1139.99, 2);
    expect(await calc.customerBalance(cust)).toBeCloseTo(1139.99, 2);
    expect(await calc.accountBalance("cashbox", cb)).toBeCloseTo(900.01, 2);
    const L = buildLedger();
    expect(r2(L.reduce((a, e) => a + e.debit, 0))).toBeCloseTo(r2(L.reduce((a, e) => a + e.credit, 0)), 2);
  });

  it("لا يقبل مبالغ سالبة أو صفرية في النقلات والمصروفات", async () => {
    setupCompany(0);
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "عميل", opening_balance: 0 });
    await expect(repo.saveInvoice({
      date: "2026-05-01", customer_id: cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 0, expenses: [] }],
    })).rejects.toThrow();
    await expect(repo.saveInvoice({
      date: "2026-05-01", customer_id: cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 100, expenses: [{ expense_type: "fuel", qty: 1, unit_amount: -50, source: "supplier", supplier_name: "م" }] }],
    })).rejects.toThrow();
  });

  it("لا يمكن صرف سند بمصدر تمويل غير معروف", async () => {
    setupCompany(0);
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "عميل", opening_balance: 0 });
    await expect(repo.saveInvoice({
      date: "2026-05-01", customer_id: cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 100, expenses: [{ expense_type: "fuel", qty: 1, unit_amount: 50, source: "loan" }] }],
    })).rejects.toThrow();
  });

  it("شركة بلا حركة: كل التقارير أصفار متسقة", async () => {
    setupCompany(0);
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    expect(p.total_revenue).toBe(0);
    expect(p.total_expenses).toBe(0);
    expect(p.net).toBe(0);
    expect(await calc.tripProfitsReport("1900-01-01", "2999-12-31")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("تدقيق محاسبي: الدورة المالية وحماية سلامة البيانات", () => {
  it("لقطة إغلاق السنة تطابق الأرصدة الفعلية وتقرير الأرباح", async () => {
    const s = await seedFullScenario(14);
    const year = table("financial_years")[0];
    const snap = await calc.yearSnapshotData(year.id);
    const pnl = await calc.pnlReport(year.date_from, year.date_to);

    const cashes = snap.cashboxes as { balance: number }[];
    const banks = snap.banks as { balance: number }[];
    const custs = snap.customers as { balance: number }[];
    expect(cashes[0].balance).toBeCloseTo(await calc.accountBalance("cashbox", s.cb), 2);
    expect(banks[0].balance).toBeCloseTo(await calc.accountBalance("bank", s.bnk), 2);
    expect(r2(custs.reduce((a, c) => a + c.balance, 0)))
      .toBeCloseTo(r2((await calc.customerBalance(s.custA)) + (await calc.customerBalance(s.custB))), 2);
    expect((snap.pnl as Record<string, number>).net).toBeCloseTo(pnl.net, 2);
  });

  it("لا تُسجَّل أي حركة خارج سنة مالية مفتوحة", async () => {
    const s = await seedFullScenario(0);
    await expect(repo.saveInvoice({
      date: "2025-12-31", customer_id: s.custA, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 100, expenses: [] }],
    })).rejects.toThrow();
    await expect(repo.saveReceipt({
      date: "2027-01-05", account_kind: "cashbox", account_id: s.cb,
      voucher_type: "other", amount: 100, description: "خارج السنة",
    })).rejects.toThrow();
  });

  it("إقفال السنة يمنع التعديل والحذف على حركاتها", async () => {
    const s = await seedFullScenario(0);
    const year = table("financial_years")[0];
    await repo.setYearStatus(year.id, "closed");
    await expect(repo.deleteInvoice(s.inv2)).rejects.toThrow();
    await expect(repo.savePayment({
      date: "2026-04-01", account_kind: "cashbox", account_id: s.cb,
      voucher_type: "general", amount: 100, description: "بعد الإقفال",
    })).rejects.toThrow();
  });

  it("لا يُحذف عميل أو حساب عليه حركات مالية", async () => {
    const s = await seedFullScenario(0);
    await expect(repo.deleteCustomer(s.custA)).rejects.toThrow();
    await expect(repo.deleteAccount("cashbox", s.cb)).rejects.toThrow();
  });

  it("منع حذف الحساب يميّز بين الخزينة والبنك بنفس المعرّف", async () => {
    setupCompany(0);
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 0 });
    const bnk = await repo.saveAccount("bank", { name: "بنك", created_date: "2026-01-01", opening_balance: 0 });
    expect(cb).toBe(bnk); // ترقيم مستقل لكل جدول
    await repo.saveReceipt({ date: "2026-02-01", account_kind: "cashbox", account_id: cb, voucher_type: "other", amount: 500, description: "إيراد" });
    // الخزينة عليها حركة ⇒ ممنوع الحذف، والبنك نظيف ⇒ يُحذف
    await expect(repo.deleteAccount("cashbox", cb)).rejects.toThrow();
    await expect(repo.deleteAccount("bank", bnk)).resolves.toBeUndefined();
  });

  it("لا يمكن حذف فاتورة عليها سند صرف يدوي (حماية من فقد المصروف)", async () => {
    const s = await seedFullScenario(0);
    await expect(repo.deleteInvoice(s.inv1)).rejects.toThrow(/سندات دفع/);
  });

  it("أرقام المستندات متسلسلة وفريدة داخل كل دفتر", async () => {
    await seedFullScenario(0);
    for (const t of ["invoices", "receipt_vouchers", "payment_vouchers", "payrolls"]) {
      const nums = table(t).map((r) => r.number).sort((a, b) => a - b);
      expect(new Set(nums).size).toBe(nums.length);
      expect(nums[0]).toBe(1);
      expect(nums[nums.length - 1]).toBe(nums.length);
    }
  });

  it("تسوية السلفة لا تتجاوز المتبقي منها", async () => {
    const s = await seedFullScenario(0);
    await expect(repo.savePayroll({
      date: "2026-04-28", employee_id: s.drv1, period_year: 2026, period_month: 4,
      account_kind: "cashbox", account_id: s.cb, base_salary: 4000, additions: 0,
      other_deductions: 0, settlements: [[s.adv, 900]], notes: "",
    })).rejects.toThrow();
  });

  it("لا يظهر ربح وهمي: مجموع أرباح النقلات + الإيرادات الأخرى − المصاريف غير التشغيلية = صافي الربح", async () => {
    await seedFullScenario(14);
    const p = await calc.pnlReport("1900-01-01", "2999-12-31");
    const trips = await calc.tripProfitsReport("1900-01-01", "2999-12-31");
    const tripsNet = r2(trips.reduce((a, t) => a + Number(t.net), 0));
    const overhead = r2(p.salaries + p.advances + p.maintenance + p.general_expenses);
    expect(r2(tripsNet + p.other_revenue - overhead)).toBeCloseTo(p.net, 2);
  });
});
