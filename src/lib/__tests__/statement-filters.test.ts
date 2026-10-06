// اختبارات الفلترة الذكية لكشف حساب العميل (v26):
//   النقلة من/إلى، القيمة، اسم/رقم الفاتورة، نوع المستند (بيع/مرتجع/إشعار/سند)،
//   والخدمة — مع بقاء الرصيد الجاري محسوباً من كامل الحركات.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as calc from "@/lib/calc";
import * as items from "@/lib/items";
import { clearFeatureCache } from "@/lib/features";

const R2 = (n: number): number => Math.round(n * 100) / 100;

async function seed() {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة النقل", currency: "ج.م", vat_rate: 15, plan_type: "open", is_active: true }]);
  // الفاتورة الضريبية بالباركود مفعّلة كي تُسمح إشعارات المدين/الدائن (المسار الافتراضي للإصلاح)
  seedTable("company_features", [{ company_id: "c1", feature_key: "tax_invoice", enabled: true }]);
  clearFeatureCache();
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });

  const cust = await repo.saveCustomer({ name: "شركة الدلتا للنقل", code: "C-0001", opening_balance: 0 });
  const containers = await items.saveItem({ name: "نقل حاويات", unit: "نقلة", default_price: 1000 });
  const bulk = await items.saveItem({ name: "نقل سائب", unit: "نقلة", default_price: 400 });

  // فاتورة 1: نقلتا حاويات (قيمة 2000 قبل الضريبة ⇒ 2300 بعد الضريبة)
  const inv1 = await repo.saveInvoice({
    date: "2026-02-10", customer_id: cust, attachments: [],
    trips: [
      { item_id: containers, from_loc: "المنصورة", to_loc: "القاهرة", qty: 2, unit_price: 1000, expenses: [] },
    ],
  });
  // فاتورة 2: نقل سائب (400 ⇒ 460 بعد الضريبة)
  const inv2 = await repo.saveInvoice({
    date: "2026-03-10", customer_id: cust, attachments: [],
    trips: [
      { item_id: bulk, from_loc: "طنطا", to_loc: "بورسعيد", qty: 1, unit_price: 400, expenses: [] },
    ],
  });

  const cb = await repo.saveAccount("cashbox", { name: "الخزينة الرئيسية", created_date: "2026-01-01", opening_balance: 0 });
  const receipt = await repo.saveReceipt({
    date: "2026-03-20", account_kind: "cashbox", account_id: cb,
    voucher_type: "customer", customer_id: cust, amount: 500, description: "دفعة تحت الحساب",
  });

  // إشعار مدين يدوي (زيادة كمية) — 100 + 15% = 115
  const debitNote = await repo.saveCreditDebitNote({
    note_type: "debit", invoice_id: inv1, customer_id: cust,
    date: "2026-04-01", amount: 100, vat_rate: 15, reason: "زيادة كمية نقل",
  });
  // مرتجع نقلة من الفاتورة الثانية — يُنشأ إشعار دائن مرتبط بالنقلة (400 + 15% = 460)
  const trip2 = table("invoice_trips").find((t) => t.invoice_id === inv2)!;
  const returnNote = await repo.saveCreditDebitNote({
    note_type: "credit", invoice_id: inv2, customer_id: cust,
    date: "2026-04-05", reason: "مرتجع نقلة", trip_ids: [trip2.id],
  });

  return { cust, cb, containers, bulk, inv1, inv2, receipt, debitNote, returnNote, trip2 };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

async function statement(s: Seeded, filters?: calc.StatementFilters) {
  return calc.customerStatement(s.cust, "2026-01-01", "2026-12-31", filters);
}

describe("الفلترة الذكية لكشف حساب العميل", () => {
  let s: Seeded;
  beforeEach(async () => { s = await seed(); });

  it("بلا فلاتر: يعرض كل الحركات ولا يغيّر الأرصدة", async () => {
    const all = await statement(s);
    // افتتاحي 0 + فاتورتان (2300 + 460) + إشعار مدين 115 − سند 500 − مرتجع 460
    expect(all.all_rows_count).toBe(5);
    expect(all.matched_count).toBe(all.all_rows_count);
    expect(all.rows.length).toBe(all.all_rows_count);
    expect(all.invoiced).toBeCloseTo(2760, 2);
    expect(all.collected).toBeCloseTo(500, 2);
    expect(all.notes_debit).toBeCloseTo(115, 2);
    expect(all.notes_credit).toBeCloseTo(460, 2);
    expect(all.closing).toBeCloseTo(1915, 2);
    expect(all.applied).toBe("");
  });

  it("نوع المستند: بيع / مرتجع / إشعار مدين / إشعار دائن / سند قبض", async () => {
    const sales = await statement(s, { docType: "sale" });
    expect(sales.rows).toHaveLength(2);
    expect(sales.rows.every((r) => r.doc_type === "sale")).toBe(true);

    const returns = await statement(s, { docType: "return" });
    expect(returns.rows).toHaveLength(1);
    expect(returns.rows[0].doc).toContain("إشعار دائن");
    expect(returns.rows[0].detail).toContain("مرتجع نقلة");
    expect(returns.rows[0].from_locs).toEqual(["طنطا"]);

    const notes = await statement(s, { docType: "debit_note" });
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0].amount).toBeCloseTo(115, 2);
    expect(notes.rows[0].invoice_number).toBe(1);

    const pureCredit = await statement(s, { docType: "credit_note" });
    expect(pureCredit.rows).toHaveLength(0); // الإشعار الدائن هنا مرتجع نقلة لا حسم عام

    const receipts = await statement(s, { docType: "receipt" });
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows[0].credit).toBeCloseTo(500, 2);
    expect(receipts.rows[0].detail).toContain("سداد");
  });

  it("النقلة من/إلى: يطابق مسار الفواتير والمرتجعات ويستبعد المستندات بلا مسار", async () => {
    const fromMansoura = await statement(s, { fromLoc: "المنصورة" });
    expect(fromMansoura.rows).toHaveLength(1);
    expect(fromMansoura.rows[0].doc).toContain("فاتورة نقل");

    const toCairo = await statement(s, { toLoc: "القاهرة" });
    expect(toCairo.rows).toHaveLength(1);
    expect(toCairo.rows[0].amount).toBeCloseTo(2300, 2);

    // السندات والإشعارات اليدوية بلا مسار ⇒ لا تظهر عند تحديد مسار
    expect(toCairo.rows.some((r) => r.doc_type === "receipt")).toBe(false);
    expect(toCairo.rows.some((r) => r.doc_type === "debit_note")).toBe(false);

    const returnLeg = await statement(s, { fromLoc: "طنطا", toLoc: "بورسعيد" });
    expect(returnLeg.rows).toHaveLength(2); // فاتورة النقل السائب + مرتجع نقلة منها

    const none = await statement(s, { fromLoc: "أسوان" });
    expect(none.rows).toHaveLength(0);
    expect(none.matched_count).toBe(0);
    expect(none.all_rows_count).toBeGreaterThan(0);
  });

  it("القيمة: حد أدنى/أقصى شامل الضريبة مع مسامحة الكسور", async () => {
    // 2300 (فاتورة) فقط يتجاوز 1000 — المرتجع 460 والسند 500 والإشعار 115 دونه
    const big = await statement(s, { amountMin: 1000 });
    expect(big.rows.map((r) => r.doc_type)).toEqual(["sale"]);

    // كل ما قيمته ≤ 500: الإشعار المدين 115، السند 500، المرتجع 460، والفاتورة 460
    const small = await statement(s, { amountMax: 500 });
    expect(small.rows.map((r) => r.doc_type).sort())
      .toEqual(["debit_note", "receipt", "return", "sale"]);

    // نطاق قيمة واحد (460) يطابق فاتورة النقل السائب ومرتجع نقلتها معاً
    const range = await statement(s, { amountMin: 460, amountMax: 460 });
    expect(range.rows.map((r) => r.doc_type).sort()).toEqual(["return", "sale"]);
    expect(range.rows.every((r) => Math.abs((r.amount ?? 0) - 460) < 0.01)).toBe(true);
  });

  it("اسم/رقم الفاتورة: بحث بالرقم اللاتيني والعربي وبأرقام السندات", async () => {
    // البحث برقم الفاتورة يعرض الفاتورة وحدها (بلا المستندات المرتبطة بها)
    const byLabel = await statement(s, { q: "INV-00002", docType: "sale" });
    expect(byLabel.rows).toHaveLength(1);
    expect(byLabel.rows[0].doc).toContain("INV-00002");

    // ومع إشعار المرتجع المرتبط بالفاتورة نفسها يعود صفّان كلاهما يحمل الرقم
    const withLinked = await statement(s, { q: "INV-00002" });
    expect(withLinked.rows).toHaveLength(2);
    expect(withLinked.rows.every((r) => r.invoice_number === 2)).toBe(true);

    const byNumber = await statement(s, { q: "2" });
    expect(byNumber.rows.length).toBeGreaterThanOrEqual(1);
    expect(byNumber.rows.some((r) => r.invoice_number === 2)).toBe(true);

    // الأرقام العربية الهندية تُطبَّع تلقائياً
    const arabicDigits = await statement(s, { q: "٠٠٠٠٢" });
    expect(arabicDigits.rows).toHaveLength(withLinked.rows.length);
    expect(arabicDigits.rows.every((r) => r.invoice_number === 2)).toBe(true);

    // السند يظهر عند البحث برقم الفاتورة التي وُزِّع عليها السداد (الأقدم أولاً)
    const receiptByInvoice = await statement(s, { q: "INV-00001", docType: "receipt" });
    expect(receiptByInvoice.rows).toHaveLength(1);
    expect(receiptByInvoice.rows[0].detail).toContain("سداد");
    expect(receiptByInvoice.rows[0].detail).toContain("INV-00001");
    // ولا يظهر عند البحث برقم فاتورة لم يُخصَّص لها شيء
    expect((await statement(s, { q: "INV-00002", docType: "receipt" })).rows).toHaveLength(0);

    const byReason = await statement(s, { q: "زيادة كمية" });
    expect(byReason.rows).toHaveLength(1);
    expect(byReason.rows[0].doc_type).toBe("debit_note");

    const byRoute = await statement(s, { q: "بورسعيد" });
    expect(byRoute.rows.map((r) => r.doc_type).sort()).toEqual(["return", "sale"]);
  });

  it("الخدمة: يقصر النتائج على الخدمة المختارة", async () => {
    // الإشعار المدين اليدوي بلا نقلات مرتبطة ⇒ لا يُنسب لخدمة معيّنة
    const onlyContainers = await statement(s, { itemId: s.containers });
    expect(onlyContainers.rows.map((r) => r.doc_type)).toEqual(["sale"]);
    expect(onlyContainers.rows[0].invoice_number).toBe(1);
    expect(onlyContainers.matched_count).toBe(1);

    const onlyBulk = await statement(s, { itemId: s.bulk });
    expect(onlyBulk.rows.map((r) => r.doc_type).sort()).toEqual(["return", "sale"]);

    const unused = await items.saveItem({ name: "خدمة لم تُستخدم" });
    expect((await statement(s, { itemId: unused })).rows).toHaveLength(0);
  });

  it("يجمع الفلاتر بـ AND ويصفها في التصدير", async () => {
    const combined = await statement(s, { docType: "sale", fromLoc: "المنصورة", amountMin: 1000, q: "INV" });
    expect(combined.rows).toHaveLength(1);
    expect(combined.rows[0].invoice_number).toBe(1);
    expect(combined.applied).toContain("النوع: فاتورة بيع");
    expect(combined.applied).toContain("من: المنصورة");
    expect(combined.applied).toContain("القيمة من 1000");
    expect(combined.applied).toContain("بحث: INV");
  });

  it("الفلترة لا تخلّ بالرصيد الجاري: closing ثابت وbalance كل صف من كامل الحركات", async () => {
    const all = await statement(s);
    const filtered = await statement(s, { docType: "sale" });

    expect(filtered.closing).toBeCloseTo(all.closing, 2);
    expect(filtered.opening).toBeCloseTo(all.opening, 2);
    expect(filtered.matched_count).toBeLessThan(filtered.all_rows_count);

    // كل صف مُرشَّح يحمل رصيده الجاري الصحيح كما في الكشف الكامل
    for (const row of filtered.rows) {
      const same = all.rows.find((r) => r.date === row.date && r.doc === row.doc)!;
      expect(row.balance).toBeCloseTo(same.balance ?? 0, 2);
    }
    // إجماليات العرض تتبع الصفوف المُرشَّحة فقط
    expect(filtered.invoiced).toBeCloseTo(2760, 2);
    expect(filtered.collected).toBeCloseTo(0, 2);
    expect(R2(filtered.matched_debit - filtered.matched_credit)).toBeCloseTo(2760, 2);
  });
});

describe("وصف الفلاتر المطبَّقة (statementFiltersLabel)", () => {
  it("يبني وصفاً عربياً مقروءاً للطباعة والتصدير", () => {
    expect(calc.statementFiltersLabel()).toBe("");
    expect(calc.statementFiltersLabel({})).toBe("");
    const label = calc.statementFiltersLabel({
      docType: "return", q: "INV-1", fromLoc: "أ", toLoc: "ب",
      amountMin: 10, amountMax: 20, itemId: 5,
    });
    expect(label).toContain("النوع: مرتجع نقلة");
    expect(label).toContain("بحث: INV-1");
    expect(label).toContain("من: أ");
    expect(label).toContain("إلى: ب");
    expect(label).toContain("القيمة من 10");
    expect(label).toContain("القيمة إلى 20");
    expect(label).toContain("خدمة رقم 5");
  });

  it("أنواع المستندات المعروضة للفلترة تغطي البيع والمرتجع والإشعارات والسندات", () => {
    const values = calc.STATEMENT_DOC_TYPES.map((t) => t.value);
    expect(values).toEqual(["sale", "return", "debit_note", "credit_note", "receipt"]);
    expect(calc.STATEMENT_DOC_TYPES.every((t) => Boolean(t.label))).toBe(true);
  });
});
