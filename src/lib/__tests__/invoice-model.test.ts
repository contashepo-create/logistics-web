// اختبارات نموذج الفاتورة الجديد: كميات النقلات والمصروفات + مصادر تمويل المصروف
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table } from "./memory-supabase";
import * as calc from "@/lib/calc";
import * as repo from "@/lib/repo";

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

async function seed() {
  setupCompany(0);
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31", notes: "" });
  const cust = await repo.saveCustomer({ name: "عميل", opening_balance: 0, notes: "" });
  const cb = await repo.saveAccount("cashbox", { name: "الخزينة الرئيسية", created_date: "2026-01-01", opening_balance: 10000, notes: "" });
  const drv = await repo.saveEmployee({ name: "سائق", emp_type: "driver", notes: "" });
  return { cust, cb, drv };
}
describe("كمية النقلات والمصروفات", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("يحسب إجمالي النقلة = العدد × سعر الوحدة", async () => {
    const id = await repo.saveInvoice({
      date: "2026-03-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "القاهرة", to_loc: "الإسكندرية", qty: 3, unit_price: 1500, expenses: [] }],
    });
    const inv = await calc.getInvoiceFull(id);
    expect(inv!.trips[0].qty).toBe(3);
    expect(inv!.trips[0].price).toBeCloseTo(4500, 2);
    expect(inv!.trips_total).toBeCloseTo(4500, 2);
  });

  it("يحسب إجمالي المصروف = العدد × قيمة الوحدة", async () => {
    const id = await repo.saveInvoice({
      date: "2026-03-01", customer_id: s.cust, attachments: [],
      trips: [{
        from_loc: "أ", to_loc: "ب", qty: 3, unit_price: 1000, driver_id: s.drv,
        expenses: [{ expense_type: "card", qty: 3, unit_amount: 120, source: "driver" }],
      }],
    });
    const inv = await calc.getInvoiceFull(id);
    expect(inv!.trips[0].expenses[0].amount).toBeCloseTo(360, 2);
    expect(inv!.expenses_total).toBeCloseTo(360, 2);
    expect(inv!.expected_profit).toBeCloseTo(2640, 2);
  });
});

describe("مصادر تمويل مصروف النقلة", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("النقدي يولّد سند دفع ويخصم من الخزينة بلا احتساب مزدوج", async () => {
    await repo.saveInvoice({
      date: "2026-03-01", customer_id: s.cust, attachments: [],
      trips: [{
        from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 2000, driver_id: s.drv,
        expenses: [{ expense_type: "fuel", qty: 1, unit_amount: 500, source: "cash", account_kind: "cashbox", account_id: s.cb }],
      }],
    });
    const auto = table("payment_vouchers").filter((v) => v.source_expense_id != null);
    expect(auto).toHaveLength(1);
    expect(auto[0].amount).toBeCloseTo(500, 2);
    // الخزينة نقصت فعلياً
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(9500, 2);
    // ولا تُحتسب التكلفة مرتين
    const tripId = table("invoice_trips")[0].id;
    const p = await calc.tripProfit(tripId);
    expect(p.direct).toBeCloseTo(500, 2);
    expect(p.later).toBeCloseTo(0, 2);
    expect(p.net).toBeCloseTo(1500, 2);
  });

  it("يرفض المصروف النقدي بلا خزينة/بنك", async () => {
    await expect(repo.saveInvoice({
      date: "2026-03-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 1000, expenses: [{ expense_type: "fuel", qty: 1, unit_amount: 100, source: "cash" }] }],
    })).rejects.toThrow("اختر الخزينة أو البنك");
  });

  it("يرفض مصروف عهدة السائق بلا تحديد سائق", async () => {
    await expect(repo.saveInvoice({
      date: "2026-03-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 1000, expenses: [{ expense_type: "fuel", qty: 1, unit_amount: 100, source: "driver" }] }],
    })).rejects.toThrow("حدّد السائق");
  });

  it("مصروف عهدة السائق لا يمسّ الخزينة ويُحتسب تكلفة", async () => {
    await repo.saveInvoice({
      date: "2026-03-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 1000, driver_id: s.drv,
        expenses: [{ expense_type: "fuel", qty: 1, unit_amount: 300, source: "driver" }] }],
    });
    expect(table("payment_vouchers")).toHaveLength(0);
    expect(await calc.accountBalance("cashbox", s.cb)).toBeCloseTo(10000, 2);
    const t = await calc.tripProfit(table("invoice_trips")[0].id);
    expect(t.direct).toBeCloseTo(300, 2);
  });

  it("المصروف الذي يتحمّله العميل يزيد الفاتورة ولا يُعد تكلفة", async () => {
    const id = await repo.saveInvoice({
      date: "2026-03-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 2, unit_price: 1000,
        expenses: [{ expense_type: "other", qty: 1, unit_amount: 400, source: "customer", notes: "رسوم ميناء" }] }],
    });
    const t = await calc.invoiceTotals(id);
    expect(t.trips_total).toBeCloseTo(2000, 2);
    expect(t.billable_total).toBeCloseTo(400, 2);
    expect(t.expenses_total).toBeCloseTo(0, 2);
    expect(t.customer_total).toBeCloseTo(2400, 2);
    expect(t.expected_profit).toBeCloseTo(2400, 2);
    // ويزيد رصيد العميل المستحق
    expect(await calc.customerBalance(s.cust)).toBeCloseTo(2400, 2);
  });

  it("الفاتورة الضريبية لا تقبل التعديل", async () => {
    const id = await repo.saveInvoice({ date: "2026-03-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 2000, expenses: [] }] });
    await expect(repo.saveInvoice({ date: "2026-03-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 2500, expenses: [] }] }, id))
      .rejects.toThrow(/لا تقبل التعديل/);
  });
});
