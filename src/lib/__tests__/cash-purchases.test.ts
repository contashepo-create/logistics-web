import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, seedTable, setUser, table } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as suppliers from "@/lib/suppliers";
import * as calc from "@/lib/calc";

async function seed() {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "المالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة النقل", currency: "ج.م", vat_rate: 15, plan_type: "open", is_active: true }]);
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  const cashbox = await repo.saveAccount("cashbox", { name: "الخزينة الرئيسية", created_date: "2026-01-01", opening_balance: 10000 });
  const vehicle = await repo.saveVehicle({ code: "T-1", plate_number: "1234", vehicle_type: "شاحنة", default_driver_id: null, notes: "" });
  const supplier = await suppliers.saveSupplier({ name: "المورّد", phone: "0504827613" });
  return { cashbox, vehicle, supplier };
}

const item = (price = 200): suppliers.PurchaseItem => ({ item_name: "وقود", unit: "لتر", qty: 1, unit_price: price, vat_rate: 15 });

describe("فاتورة المشتريات النقدية المباشرة", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("تُحفظ دون مورّد، تنشئ سنداً آلياً، وتخصم الإجمالي شاملاً الضريبة", async () => {
    const id = await suppliers.savePurchaseInvoice({
      date: "2026-03-10", purchase_type: "cash", supplier_id: null, supplier_ref: "فاتورة محطة",
      account_kind: "cashbox", account_id: s.cashbox, expense_category: "fuel", vehicle_id: s.vehicle,
      vat_rate: 15, vat_included: false, notes: "", items: [item()],
    });

    const invoice = await suppliers.getPurchaseInvoice(id);
    expect(invoice?.purchase_type).toBe("cash");
    expect(invoice?.supplier_id).toBeNull();
    expect(invoice?.expense_category).toBe("fuel");
    expect(invoice?.vehicle_id).toBe(s.vehicle);
    const payment = table("payment_vouchers").filter((row) => row.purchase_invoice_id === id);
    expect(payment).toHaveLength(1);
    expect(payment[0].voucher_type).toBe("purchase");
    expect(payment[0].amount).toBeCloseTo(230, 2);
    expect(await calc.accountBalance("cashbox", s.cashbox)).toBeCloseTo(9770, 2);
  });

  it("يسجل صافي المشتريات قبل VAT في بند P&L والسيارة المحددين", async () => {
    await suppliers.savePurchaseInvoice({
      date: "2026-03-10", purchase_type: "cash", supplier_id: null, supplier_ref: "",
      account_kind: "cashbox", account_id: s.cashbox, expense_category: "fuel", vehicle_id: s.vehicle,
      vat_rate: 15, vat_included: false, notes: "", items: [item()],
    });
    const pnl = await calc.pnlReport("2026-03-01", "2026-03-31");
    expect(pnl.purchase_expenses).toBeCloseTo(200, 2);
    expect(pnl.purchase_fuel).toBeCloseTo(200, 2);
    const vehicles = await calc.vehicleReport("2026-03-01", "2026-03-31");
    expect(Number(vehicles.find((row) => row.vehicle_id === s.vehicle)?.purchases)).toBeCloseTo(200, 2);
  });

  it("تعديل الفاتورة يحدّث سندها الآلي ولا يكرره، وحذفها يعكسه", async () => {
    const id = await suppliers.savePurchaseInvoice({
      date: "2026-03-10", purchase_type: "cash", supplier_id: null,
      account_kind: "cashbox", account_id: s.cashbox, expense_category: "maintenance", vehicle_id: null,
      vat_rate: 15, vat_included: false, items: [item(100)],
    });
    await suppliers.savePurchaseInvoice({
      id, date: "2026-03-11", purchase_type: "cash", supplier_id: null,
      account_kind: "cashbox", account_id: s.cashbox, expense_category: "maintenance", vehicle_id: null,
      vat_rate: 15, vat_included: false, items: [item(300)],
    });
    const payments = table("payment_vouchers").filter((row) => row.purchase_invoice_id === id);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBeCloseTo(345, 2);
    await suppliers.deletePurchaseInvoice(id);
    expect(table("purchase_invoices").find((row) => row.id === id)).toBeUndefined();
    expect(table("payment_vouchers").find((row) => row.purchase_invoice_id === id)).toBeUndefined();
    expect(await calc.accountBalance("cashbox", s.cashbox)).toBeCloseTo(10000, 2);
  });
});

describe("فاتورة المشتريات الآجلة", () => {
  it("تظل مرتبطة بالمورّد ولا تنشئ سند دفع نقدي", async () => {
    const s = await seed();
    const id = await suppliers.savePurchaseInvoice({
      date: "2026-04-01", purchase_type: "credit", supplier_id: s.supplier,
      account_kind: null, account_id: null, expense_category: "spare_parts", vehicle_id: null,
      vat_rate: 15, vat_included: false, items: [item(100)],
    });
    expect((await suppliers.getPurchaseInvoice(id))?.supplier_id).toBe(s.supplier);
    expect(table("payment_vouchers").filter((row) => row.purchase_invoice_id === id)).toHaveLength(0);
  });
});
