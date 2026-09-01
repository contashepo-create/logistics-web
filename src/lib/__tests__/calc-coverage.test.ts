// تغطية الدوال المتبقية في calc.ts (تحويلات، تسميات، وأدوات مساعدة) لم تُغطَّ في الاختبارات الرئيسية.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table } from "./memory-supabase";
import * as calc from "@/lib/calc";
import * as repo from "@/lib/repo";

function setup() {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة", vat_rate: 0, plan_type: "open", is_active: true }]);
}

describe("دوال التحويل والتسميات (خالصة)", () => {
  it("num يحوّل القيم ويفرض صفراً للقيم غير الرقمية", () => {
    expect(calc.num("123")).toBe(123);
    expect(calc.num(45.6)).toBe(45.6);
    expect(calc.num(null)).toBe(0);
    expect(calc.num("abc")).toBe(0);
    expect(calc.num(undefined)).toBe(0);
  });
  it("accountTable و accountKindLabel", () => {
    expect(calc.accountTable("cashbox")).toBe("cashboxes");
    expect(calc.accountTable("bank")).toBe("banks");
    expect(calc.accountKindLabel("cashbox")).toBe("خزينة");
    expect(calc.accountKindLabel("bank")).toBe("بنك");
  });
  it("invoiceNumberLabel و voucherNumberLabel", () => {
    expect(calc.invoiceNumberLabel(7)).toBe("INV-00007");
    expect(calc.voucherNumberLabel("RV", 3)).toBe("RV-00003");
    expect(calc.voucherNumberLabel("PV", 12345)).toBe("PV-12345");
  });
});

describe("tripProfit", () => {
  it("يحسب صافي النقلة مع فلترة تاريخية للسندات", async () => {
    setup();
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "عميل", opening_balance: 0 });
    const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 100000 });
    const inv = await repo.saveInvoice({
      date: "2026-03-01", customer_id: cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", price: 1000, expenses: [{ expense_type: "trip", source: "supplier", supplier_name: "محطة", amount: 100 }] }],
    });
    const tripId = table("invoice_trips").find((t) => t.invoice_id === inv)!.id;
    await repo.savePayment({ date: "2026-03-02", account_kind: "cashbox", account_id: cb, voucher_type: "trip", trip_id: tripId, amount: 50, description: "x" });

    const p = await calc.tripProfit(tripId);
    expect(p.price).toBeCloseTo(1000, 2);
    expect(p.direct).toBeCloseTo(100, 2);
    expect(p.later).toBeCloseTo(50, 2);
    expect(p.net).toBeCloseTo(850, 2);

    // فلترة تاريخية: خارج نطاق السند لا يُحتسب
    const outside = await calc.tripProfit(tripId, "2026-04-01", "2026-05-01");
    expect(outside.later).toBeCloseTo(0, 2);
  });
});

describe("getInvoiceFull", () => {
  it("يعيد الفاتورة كاملة مع العميل والنقلات والمصروفات", async () => {
    setup();
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "عميل", opening_balance: 0 });
    const inv = await repo.saveInvoice({
      date: "2026-03-01", customer_id: cust, notes: "n", attachments: [],
      trips: [
        { from_loc: "أ", to_loc: "ب", price: 1000, expenses: [{ expense_type: "fuel", source: "supplier", supplier_name: "محطة", amount: 100, notes: "x" }] },
        { from_loc: "ب", to_loc: "ج", price: 500, expenses: [] },
      ],
    });
    const full = await calc.getInvoiceFull(inv);
    expect(full).not.toBeNull();
    expect(full!.customer!.name).toBe("عميل");
    expect(full!.trips).toHaveLength(2);
    expect(full!.trips[0].expenses).toHaveLength(1);
    expect(full!.trips_total).toBeCloseTo(1500, 2);
    expect(full!.expenses_total).toBeCloseTo(100, 2);

    expect(await calc.getInvoiceFull(99999)).toBeNull();
  });
});

describe("tripsOptions / accountName / allAccounts / accountsWithBalance / customersWithBalance", () => {
  it("tripsOptions يبني تسمية لكل نقلة", async () => {
    setup();
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const cust = await repo.saveCustomer({ name: "عميل", opening_balance: 0 });
    await repo.saveInvoice({ date: "2026-03-01", customer_id: cust, attachments: [], trips: [{ from_loc: "أ", to_loc: "ب", price: 100, expenses: [] }] });
    const opts = await calc.tripsOptions();
    expect(opts).toHaveLength(1);
    expect(opts[0].label).toContain("عميل");
    expect(opts[0].label).toContain("أ ← ب");
  });

  it("accountName و allAccounts و accountsWithBalance", async () => {
    setup();
    await repo.saveAccount("cashbox", { name: "خزينة أ", created_date: "2026-01-01", opening_balance: 1000 });
    await repo.saveAccount("bank", { name: "بنك ب", created_date: "2026-01-01", opening_balance: 500 });

    const cb = table("cashboxes")[0];
    expect(await calc.accountName("cashbox", cb.id)).toBe("خزينة أ");

    const all = await calc.allAccounts();
    expect(all).toHaveLength(2);
    expect(all.some((a) => a.kind === "cashbox")).toBe(true);
    expect(all.some((a) => a.kind === "bank")).toBe(true);

    const cbs = await calc.accountsWithBalance("cashbox");
    expect(cbs).toHaveLength(1);
    expect(cbs[0].balance).toBeCloseTo(1000, 2);
  });

  it("customersWithBalance يعيد أرصدة", async () => {
    setup();
    await repo.saveCustomer({ name: "عميل", opening_balance: 1500 });
    const rows = await calc.customersWithBalance();
    expect(rows).toHaveLength(1);
    expect(rows[0].balance).toBeCloseTo(1500, 2);
  });
});

describe("yearSnapshotData", () => {
  it("يبني لقطة بأرصدة العملاء والحسابات والأرباح", async () => {
    setup();
    const yid = await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    await repo.saveCustomer({ name: "عميل", opening_balance: 0 });
    await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 500 });

    const snap = await calc.yearSnapshotData(yid);
    expect(snap.year).toBe(2026);
    expect(snap.customers).toHaveLength(1);
    expect(snap.cashboxes).toHaveLength(1);
    expect(snap.pnl).toBeDefined();

    // سنة غير موجودة → كائن فارغ
    expect(await calc.yearSnapshotData(99999)).toEqual({});
  });
});
