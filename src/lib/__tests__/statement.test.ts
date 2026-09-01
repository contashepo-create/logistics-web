// تخصيص تحصيلات العميل بالأقدمية + كشف الحساب الاحترافي
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as calc from "@/lib/calc";
import { customerStatementHtml } from "@/lib/statementDoc";
import { DEFAULT_PRINT_SETTINGS } from "@/lib/print";

async function seed() {
  resetDb();
  setUser({ id: "u1", email: "o@t.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "o@t.com", name: "م" }]);
  seedTable("companies", [{ id: "c1", name: "شركة النقل", currency: "ج.م", vat_rate: 0, plan_type: "open", is_active: true }]);
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  const cust = await repo.saveCustomer({ name: "عميل المطابقة", phone: "0100", address: "المنصورة", opening_balance: 0 });
  const cb = await repo.saveAccount("cashbox", { name: "الخزينة", created_date: "2026-01-01", opening_balance: 0 });
  const inv1 = await repo.saveInvoice({ date: "2026-01-10", customer_id: cust, attachments: [],
    trips: [{ from_loc: "المنصورة", to_loc: "القاهرة", qty: 1, unit_price: 1000, expenses: [] }] });
  const inv2 = await repo.saveInvoice({ date: "2026-02-10", customer_id: cust, attachments: [],
    trips: [{ from_loc: "المنصورة", to_loc: "أسوان", qty: 2, unit_price: 1000, expenses: [] }] });
  const inv3 = await repo.saveInvoice({ date: "2026-03-10", customer_id: cust, attachments: [],
    trips: [{ from_loc: "طنطا", to_loc: "بورسعيد", qty: 1, unit_price: 500, expenses: [] }] });
  return { cust, cb, inv1, inv2, inv3 };
}

describe("تخصيص الدفعات على الفواتير بالأقدمية", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("الدفعة تسدّد الأقدم أولاً ثم تنتقل للتالية", async () => {
    await repo.saveReceipt({ date: "2026-03-01", account_kind: "cashbox", account_id: s.cb,
      voucher_type: "customer", customer_id: s.cust, amount: 1600, description: "دفعة" });
    const a = await calc.customerAllocations(s.cust);
    const inv1 = a.byInvoice.get(s.inv1)!;
    const inv2 = a.byInvoice.get(s.inv2)!;
    const inv3 = a.byInvoice.get(s.inv3)!;
    expect(inv1.paid).toBeCloseTo(1000, 2);
    expect(inv1.remaining).toBeCloseTo(0, 2);
    expect(inv2.paid).toBeCloseTo(600, 2);
    expect(inv2.remaining).toBeCloseTo(1400, 2);
    expect(inv3.paid).toBeCloseTo(0, 2);
    expect(a.unallocated).toBeCloseTo(0, 2);
  });

  it("عدة دفعات تُخصَّص بالترتيب الزمني", async () => {
    await repo.saveReceipt({ date: "2026-01-20", account_kind: "cashbox", account_id: s.cb, voucher_type: "customer", customer_id: s.cust, amount: 400, description: "أولى" });
    await repo.saveReceipt({ date: "2026-02-20", account_kind: "cashbox", account_id: s.cb, voucher_type: "customer", customer_id: s.cust, amount: 900, description: "ثانية" });
    const a = await calc.customerAllocations(s.cust);
    expect(a.byInvoice.get(s.inv1)!.remaining).toBeCloseTo(0, 2);   // 400 + 600
    expect(a.byInvoice.get(s.inv2)!.paid).toBeCloseTo(300, 2);
  });

  it("الزيادة عن قيمة الفواتير تُعد دفعة غير مخصَّصة", async () => {
    await repo.saveReceipt({ date: "2026-04-01", account_kind: "cashbox", account_id: s.cb, voucher_type: "customer", customer_id: s.cust, amount: 4000, description: "دفعة كبيرة" });
    const a = await calc.customerAllocations(s.cust);
    expect(a.unallocated).toBeCloseTo(500, 2); // 3500 فواتير
    expect([...a.byInvoice.values()].every((i) => i.remaining === 0)).toBe(true);
  });
});

describe("كشف حساب العميل الاحترافي", () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => { s = await seed(); });

  it("يعرض الافتتاحي والحركات والرصيد الختامي المتسق", async () => {
    await repo.saveReceipt({ date: "2026-02-15", account_kind: "cashbox", account_id: s.cb, voucher_type: "customer", customer_id: s.cust, amount: 1200, description: "تحصيل" });
    const st = await calc.customerStatementFull(s.cust, "2026-02-01", "2026-12-31");
    expect(st.opening).toBeCloseTo(1000, 2);       // فاتورة يناير خارج الفترة
    expect(st.invoiced).toBeCloseTo(2500, 2);      // فبراير 2000 + مارس 500
    expect(st.collected).toBeCloseTo(1200, 2);
    expect(st.closing).toBeCloseTo(2300, 2);
    expect(st.closing).toBeCloseTo(await calc.customerBalance(s.cust), 2);
    expect(st.rows[st.rows.length - 1].balance).toBeCloseTo(st.closing, 2);
  });

  it("يبيّن على أي فواتير وُزّعت الدفعة", async () => {
    await repo.saveReceipt({ date: "2026-03-20", account_kind: "cashbox", account_id: s.cb, voucher_type: "customer", customer_id: s.cust, amount: 1600, description: "دفعة" });
    const st = await calc.customerStatementFull(s.cust, "1900-01-01", "2999-12-31");
    const rec = st.rows.find((r) => r.kind === "receipt")!;
    expect(rec.detail).toContain("INV-00001");
    expect(rec.detail).toContain("INV-00002");
  });

  it("يعرض تركيبة الرصيد المتبقي بالأقدمية", async () => {
    await repo.saveReceipt({ date: "2026-03-20", account_kind: "cashbox", account_id: s.cb, voucher_type: "customer", customer_id: s.cust, amount: 1600, description: "دفعة" });
    const st = await calc.customerStatementFull(s.cust, "1900-01-01", "2999-12-31");
    expect(st.openItems.map((o) => o.number)).toEqual([2, 3]);
    expect(st.openItems[0].remaining).toBeCloseTo(1400, 2);
  });

  it("يصف بنود الفاتورة في الكشف (المسارات والعدد)", async () => {
    const st = await calc.customerStatementFull(s.cust, "1900-01-01", "2999-12-31");
    const inv = st.rows.find((r) => r.kind === "invoice")!;
    expect(inv.desc).toContain("المنصورة ← القاهرة");
    const inv2 = st.rows.filter((r) => r.kind === "invoice")[1];
    expect(inv2.desc).toContain("×2");
  });

  it("مستند الطباعة احترافي ويحمل كل عناصر المطابقة", async () => {
    await repo.saveReceipt({ date: "2026-03-20", account_kind: "cashbox", account_id: s.cb, voucher_type: "customer", customer_id: s.cust, amount: 1600, description: "دفعة" });
    const st = await calc.customerStatementFull(s.cust, "1900-01-01", "2999-12-31");
    const html = customerStatementHtml({
      info: { company_name: "شركة النقل", company_phone: "0100", company_address: "المنصورة", currency: "ج.م" },
      ps: { ...DEFAULT_PRINT_SETTINGS, show_signature: true }, st,
    });
    expect(html).toContain("كشف حساب عميل");
    expect(html).toContain("عميل المطابقة");
    expect(html).toContain("رصيد ما قبل الفترة");
    expect(html).toContain("تركيبة الرصيد المستحق");
    expect(html).toContain("مطابقة العميل");
    expect(html).toContain("عليه");           // جانب الرصيد
    expect(html).toContain("فقط لا غير");     // التفقيط
    expect(html).toContain("INV-00001");
  });

  it("الكشف لا يعرض حالة الفاتورة (مدفوعة/غير مدفوعة)", async () => {
    await repo.saveReceipt({ date: "2026-03-20", account_kind: "cashbox", account_id: s.cb, voucher_type: "customer", customer_id: s.cust, amount: 5000, description: "سداد" });
    const st = await calc.customerStatementFull(s.cust, "1900-01-01", "2999-12-31");
    const html = customerStatementHtml({ info: { company_name: "ش", currency: "ج.م" }, ps: DEFAULT_PRINT_SETTINGS, st });
    expect(html).not.toContain("مدفوعة");
    expect(html).not.toContain("غير مدفوعة");
    expect(html).not.toContain("حالة الفاتورة");
  });
});
