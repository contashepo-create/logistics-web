// اختبارات تقرير أعمار ديون العملاء: توزيع الشرائح، تخصيص السداد بالأقدمية،
// الرصيد الافتتاحي (مدين ودائن)، وإشعارات المدين/الدائن.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as items from "@/lib/items";
import { customersAging } from "@/lib/customerAging";
import { clearFeatureCache } from "@/lib/features";

const AS_OF = new Date("2026-12-31T00:00:00Z");

async function seed() {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة النقل", currency: "ج.م", vat_rate: 15, plan_type: "open", is_active: true }]);
  seedTable("company_features", [{ company_id: "c1", feature_key: "tax_invoice", enabled: true }]);
  clearFeatureCache();
  await repo.saveYear({ year: 2025, date_from: "2025-01-01", date_to: "2025-12-31" });
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });

  const service = await items.saveItem({ name: "نقل معدات", unit: "نقلة", default_price: 1000 });

  // عميل 1: فاتورة قديمة (2025) + فاتورة حديثة + سند + إشعارات
  const c1 = await repo.saveCustomer({ name: "شركة الدلتا", code: "C-0001", opening_balance: 0 });
  const oldInv = await repo.saveInvoice({
    date: "2025-12-20", customer_id: c1, attachments: [],
    trips: [{ item_id: service, from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 600, expenses: [] }],
  });
  const newInv = await repo.saveInvoice({
    date: "2026-12-20", customer_id: c1, attachments: [],
    trips: [{ item_id: service, from_loc: "ج", to_loc: "د", qty: 2, unit_price: 1000, expenses: [] }],
  });
  const cb = await repo.saveAccount("cashbox", { name: "الخزينة", created_date: "2026-01-01", opening_balance: 0 });
  await repo.saveReceipt({
    date: "2026-02-01", account_kind: "cashbox", account_id: cb,
    voucher_type: "customer", customer_id: c1, amount: 500,
  });
  await repo.saveCreditDebitNote({
    note_type: "debit", invoice_id: oldInv, customer_id: c1,
    date: "2026-02-05", amount: 100, vat_rate: 15, reason: "زيادة كمية",
  });
  await repo.saveCreditDebitNote({
    note_type: "credit", invoice_id: newInv, customer_id: c1,
    date: "2026-12-25", amount: 200, vat_rate: 15, reason: "خصم",
  });

  // عميل 2: رصيد افتتاحي مدين فقط (بلا فواتير)
  const c2 = await repo.saveCustomer({ name: "مؤسسة النور", code: "C-0002", opening_balance: 1000 });

  // عميل 3: رصيد افتتاحي دائن (دفعة مقدَّمة) يخفض فاتورة حديثة
  const c3 = await repo.saveCustomer({ name: "شركة الأمل", code: "C-0003", opening_balance: -300 });
  await repo.saveInvoice({
    date: "2026-12-01", customer_id: c3, attachments: [],
    trips: [{ item_id: service, from_loc: "هـ", to_loc: "و", qty: 1, unit_price: 500, expenses: [] }],
  });

  return { c1, c2, c3 };
}

describe("أعمار ديون العملاء", () => {
  beforeEach(async () => { await seed(); });

  it("توزّع المستحق على الشرائح وتخصم السداد بالأقدم أولاً", async () => {
    const rows = await customersAging(AS_OF);
    const delta = rows.find((r) => r.name === "شركة الدلتا")!;

    // فاتورة 2025: 600 + 15% = 690، منها 500 سداد + 100 إشعار مدين + 15% = 805
    // المتبقي 805 − 500 = 305 (أقدم من 90 يوماً)
    // فاتورة 2026-12-20: 2300 − إشعار دائن 230 = 2070 (عمر 11 يوماً)
    expect(delta.current).toBeCloseTo(2070, 2);
    expect(delta.over90).toBeCloseTo(305, 2);
    expect(delta.total).toBeCloseTo(2375, 2);
    expect(delta.code).toBe("CUST-0001");
  });

  it("الرصيد الافتتاحي المدين يُحتسب كأقدم حركة، والدائن يُخصم كدفعة مقدَّمة", async () => {
    const rows = await customersAging(AS_OF);
    const nour = rows.find((r) => r.name === "مؤسسة النور")!;
    expect(nour.total).toBeCloseTo(1000, 2);
    expect(nour.over90).toBeCloseTo(1000, 2);

    const amal = rows.find((r) => r.name === "شركة الأمل")!;
    // 575 − 300 = 275
    expect(amal.total).toBeCloseTo(275, 2);
    expect(amal.current).toBeCloseTo(275, 2);
  });

  it("يرتّب النتائج تنازلياً بالمستحق ويتجاهل من لا مستحق عليه", async () => {
    const rows = await customersAging(AS_OF);
    const totals = rows.map((r) => r.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    expect(rows.every((r) => r.total > 0)).toBe(true);
  });

  it("يتأثر بالتاريخ المرجعي: فاتورة قريبة تصبح متأخرة لاحقاً", async () => {
    const later = await customersAging(new Date("2027-04-30T00:00:00Z"));
    const delta = later.find((r) => r.name === "شركة الدلتا")!;
    // بعد 131 يوماً من 2026-12-20 تصبح الفاتورة في شريحة «أكثر من 90»
    expect(delta.over90).toBeCloseTo(2375, 2);
    expect(delta.current).toBeCloseTo(0, 2);
  });
});
