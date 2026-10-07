// اختبارات التقرير الشامل للعميل (v26): كل ما يخص العميل في مستند واحد —
// البيانات الأساسية، المؤشرات، الفواتير ونقلاتها وخدماتها، السندات وتخصيصها،
// الإشعارات ومرتجعاتها، وتركيبة الرصيد وأعمار الديون — وجاهزيته للتصدير.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as calc from "@/lib/calc";
import * as items from "@/lib/items";
import * as customerReport from "@/lib/customerReport";
import { clearFeatureCache } from "@/lib/features";

async function seed() {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة النقل", currency: "ج.م", vat_rate: 15, plan_type: "open", is_active: true }]);
  seedTable("company_features", [{ company_id: "c1", feature_key: "tax_invoice", enabled: true }]);
  clearFeatureCache();
  // سنتان ماليتان مفتوحتان: فاتورة سابقة للفترة (2025) وفواتير الفترة (2026)
  await repo.saveYear({ year: 2025, date_from: "2025-01-01", date_to: "2025-12-31" });
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });

  const cust = await repo.saveCustomer({
    name: "شركة الدلتا للنقل", code: "C-0001", phone: "01000000001",
    address: "المنصورة - شارع الجيش", opening_balance: 1000,
  });
  const other = await repo.saveCustomer({ name: "مصنع أسيوط للأسمنت", code: "C-0002", opening_balance: 0 });
  // خدمة خط (مسارها مخزَّن في الصنف) + خدمة عامة يكتب مسارها يدوياً في النقلة
  const containers = await items.saveItem({
    name: "نقل المنصورة - القاهرة", unit: "نقلة", default_price: 1000,
    from_loc: "المنصورة", to_loc: "القاهرة",
  });
  const bulk = await items.saveItem({ name: "نقل سائب", unit: "نقلة", default_price: 400 });

  const vehicle = await repo.saveVehicle({ plate_number: "ر س د 1234", name: "تريلا" });
  const driver = await repo.saveEmployee({ name: "سعيد السائق", emp_type: "driver" });

  // فاتورة داخل الفترة: نقلتا حاويات + نقل سائب (2000 + 400 قبل الضريبة)
  const inv1 = await repo.saveInvoice({
    date: "2026-02-10", customer_id: cust, attachments: [], notes: "فاتورة داخل الفترة",
    trips: [
      { item_id: containers, vehicle_id: vehicle, driver_id: driver, from_loc: "المنصورة", to_loc: "القاهرة", qty: 2, unit_price: 1000, expenses: [] },
      { item_id: bulk, from_loc: "طنطا", to_loc: "بورسعيد", qty: 1, unit_price: 400, expenses: [] },
    ],
  });
  // فاتورة سابقة للفترة (تظهر في التركيبة والأرصدة لا في حركات الفترة)
  const presetInvoice = await repo.saveInvoice({
    date: "2025-12-20", customer_id: cust, attachments: [],
    trips: [{ item_id: bulk, from_loc: "دمياط", to_loc: "أسيوط", qty: 1, unit_price: 600, expenses: [] }],
  });
  // فاتورة عميل آخر: يجب ألا تظهر في تقرير هذا العميل
  await repo.saveInvoice({
    date: "2026-02-12", customer_id: other, attachments: [],
    trips: [{ item_id: containers, from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 900, expenses: [] }],
  });

  const cb = await repo.saveAccount("cashbox", { name: "الخزينة الرئيسية", created_date: "2026-01-01", opening_balance: 0 });
  const receipt = await repo.saveReceipt({
    date: "2026-03-01", account_kind: "cashbox", account_id: cb,
    voucher_type: "customer", customer_id: cust, amount: 500, description: "دفعة أولى",
  });
  const debitNote = await repo.saveCreditDebitNote({
    note_type: "debit", invoice_id: inv1, customer_id: cust,
    date: "2026-03-05", amount: 100, vat_rate: 15, reason: "زيادة كمية",
  });
  const trip = table("invoice_trips").find((t) => t.invoice_id === inv1 && t.item_id === containers)!;
  const returnNote = await repo.saveCreditDebitNote({
    note_type: "credit", invoice_id: inv1, customer_id: cust,
    date: "2026-03-10", reason: "مرتجع نقلة القاهرة", trip_ids: [trip.id],
  });

  return { cust, other, containers, bulk, vehicle, driver, inv1, presetInvoice, cb, receipt, debitNote, returnNote };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

describe("التقرير الشامل للعميل", () => {
  let s: Seeded;
  beforeEach(async () => { s = await seed(); });

  it("يشمل بيانات العميل وكل المؤشرات المالية للفترة", async () => {
    const report = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-12-31"))!;

    expect(report.customer?.name).toBe("شركة الدلتا للنقل");
    expect(report.from).toBe("2026-01-01");
    expect(report.to).toBe("2026-12-31");

    // الافتتاحي = 1000 + فاتورة 2025 (600 + 15%) = 1690
    expect(report.summary.opening).toBeCloseTo(1690, 2);
    expect(report.summary.invoiced).toBeCloseTo(2760, 2);        // 2400 + 15%
    expect(report.summary.collected).toBeCloseTo(500, 2);
    expect(report.summary.notes_debit).toBeCloseTo(115, 2);
    expect(report.summary.notes_credit).toBeCloseTo(2300, 2);    // مرتجع نقلة الحاويات 2000 + 15%
    expect(report.summary.invoices_count).toBe(1);               // فاتورة واحدة داخل الفترة
    expect(report.summary.receipts_count).toBe(1);
    expect(report.summary.notes_count).toBe(2);
    expect(report.summary.trips_count).toBe(2);
    expect(report.summary.qty_total).toBeCloseTo(3, 2);
    expect(report.summary.services_count).toBe(2);
    expect(report.summary.avg_invoice).toBeCloseTo(2760, 2);
    expect(report.summary.first_movement).toBe("2026-02-10");
    expect(report.summary.last_movement).toBe("2026-03-10");
    expect(report.summary.last_invoice_date).toBe("2026-02-10");
    expect(report.summary.days_since_last_invoice).toBe(324); // من 2026-02-10 إلى نهاية الفترة

    // الرصيد الختامي = الافتتاحي + الفواتير + الإشعار المدين − السندات − الإشعار الدائن
    expect(report.summary.closing)
      .toBeCloseTo(1690 + 2760 + 115 - 500 - report.summary.notes_credit, 2);
    expect(report.summary.closing).toBeCloseTo(await calc.customerBalance(s.cust), 2);
  });

  it("الفواتير تأتي بنقلاتها وحالاتها، والسابقة للفترة تُعلَّم ولا تُحتسب في المؤشرات", async () => {
    const report = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-12-31"))!;

    expect(report.invoices).toHaveLength(2);
    const [oldest, current] = report.invoices;
    expect(oldest.id).toBe(s.presetInvoice);
    expect(oldest.in_range).toBe(false);
    expect(oldest.legs).toEqual(["دمياط ← أسيوط"]);

    expect(current.id).toBe(s.inv1);
    expect(current.in_range).toBe(true);
    expect(current.label).toBe("INV-00001");
    expect(current.trips_count).toBe(2);
    expect(current.legs).toEqual(["المنصورة ← القاهرة", "طنطا ← بورسعيد"]);
    expect(current.subtotal).toBeCloseTo(2400, 2);
    expect(current.vat_amount).toBeCloseTo(360, 2);
    expect(current.total).toBeCloseTo(2760, 2);
    // السداد يُخصَّص للأقدم أولاً: 500 على فاتورة 2025 (690) فيصبح المتبقي عليها 190
    expect(oldest.paid).toBeCloseTo(500, 2);
    expect(oldest.remaining).toBeCloseTo(190, 2);
    expect(oldest.status).toBe("partial");
    expect(current.paid).toBeCloseTo(0, 2);
    expect(current.status).toBe("open");

    // لا تظهر أي بيانات العميل الآخر
    expect(report.invoices.every((i) => i.id !== undefined)).toBe(true);
    expect(report.trips.every((t) => t.invoice_number === 1 || t.invoice_number === 2)).toBe(true);
    expect(report.trips.map((t) => t.route)).toContain("المنصورة ← القاهرة");
    expect(report.trips.some((t) => t.item_name === "نقل المنصورة - القاهرة")).toBe(true);
  });

  it("النقلات تحمل الخدمة والسيارة والسائق والحاويات", async () => {
    const report = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-12-31"))!;
    const firstTrip = report.trips.find((t) => t.from_loc === "المنصورة")!;

    expect(firstTrip.item_name).toBe("نقل المنصورة - القاهرة");
    expect(firstTrip.vehicle_name).toBe("ر س د 1234");
    expect(firstTrip.driver_name).toBe("سعيد السائق");
    expect(firstTrip.unit_price).toBeCloseTo(1000, 2);
    expect(firstTrip.amount).toBeCloseTo(2000, 2);
    expect(Array.isArray(firstTrip.containers)).toBe(true);
  });

  it("قسم الخدمات يجمع عدد النقلات والإيراد لكل خدمة لهذا العميل", async () => {
    const report = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-12-31"))!;
    const containers = report.services.find((x) => x.name === "نقل المنصورة - القاهرة")!;
    const bulk = report.services.find((x) => x.name === "نقل سائب")!;

    expect(containers.trips_count).toBe(1);
    expect(containers.qty_total).toBeCloseTo(2, 2);
    expect(containers.revenue).toBeCloseTo(2000, 2);
    expect(containers.total).toBeCloseTo(2300, 2);
    expect(containers.unit).toBe("نقلة");

    expect(bulk.trips_count).toBe(1);
    expect(bulk.revenue).toBeCloseTo(400, 2);

    // خدمة لم يستخدمها هذا العميل لا تدخل في قسمه
    expect(report.services).toHaveLength(2);
    // وخدمة الخط تحمل خطها المخزَّن (من ← إلى) في قسم الخدمات، والخدمة العامة بلا خط
    expect(`${containers.from_loc} ← ${containers.to_loc}`).toBe("المنصورة ← القاهرة");
    expect(bulk.from_loc).toBe("");
    expect(bulk.to_loc).toBe("");
  });

  it("سندات القبض تعرض التخصيص على الفواتير واسم الحساب الفعلي", async () => {
    const report = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-12-31"))!;
    expect(report.receipts).toHaveLength(1);
    const receipt = report.receipts[0];
    expect(receipt.label).toBe("RV-00001");
    expect(receipt.amount).toBeCloseTo(500, 2);
    expect(receipt.account_name).toBe("خزينة: الخزينة الرئيسية");
    // الأقدم أولاً: 500 كلها على فاتورة 2025
    expect(receipt.allocations).toContain("INV-00002");
    expect(receipt.allocations).toContain("500.00");
  });

  it("الإشعارات تحمل نوعها ومبلغها وضريبتها ومسارات المرتجعات", async () => {
    const report = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-12-31"))!;
    expect(report.notes).toHaveLength(2);

    const debit = report.notes.find((n) => n.type === "debit")!;
    expect(debit.label).toBe("DN-00001");
    expect(debit.amount).toBeCloseTo(100, 2);
    expect(debit.vat_amount).toBeCloseTo(15, 2);
    expect(debit.total).toBeCloseTo(115, 2);
    expect(debit.invoice_number).toBe(1);
    expect(debit.trips).toEqual([]);

    const credit = report.notes.find((n) => n.type === "credit")!;
    expect(credit.label).toBe("CN-00002"); // الترقيم متسلسل بين مدين ودائن
    expect(credit.amount).toBeCloseTo(2000, 2);
    expect(credit.total).toBeCloseTo(2300, 2);
    expect(credit.invoice_number).toBe(1);
    expect(credit.trips).toEqual(["المنصورة ← القاهرة"]);
  });

  it("تركيبة الرصيد وأعمار الديون بالأقدمية ووصف جانب الرصيد", async () => {
    const report = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-12-31"))!;

    // المفتوح: فاتورة 2025 (690) + فاتورة الفترة (2760 − 500)
    expect(report.open_items).toHaveLength(2);
    const [oldest, current] = report.open_items;
    expect(oldest.number).toBe(2);
    expect(oldest.total).toBeCloseTo(690, 2);
    expect(oldest.paid).toBeCloseTo(500, 2);
    expect(oldest.remaining).toBeCloseTo(190, 2);
    // تاريخ المرجع هو نهاية الفترة (2026-12-31) لا تاريخ اليوم
    expect(oldest.age_days).toBe(376);
    // المتبقي على فاتورة الفترة بعد الإشعارات: 2760 + 115 إشعار مدين − 2300 إشعار دائن
    expect(current.remaining).toBeCloseTo(575, 2);
    expect(current.age_days).toBe(324);

    expect(report.aging.map((b) => b.bucket))
      .toEqual(["حتى 30 يوم", "31 – 60 يوم", "61 – 90 يوم", "أكثر من 90 يوم"]);
    // بالتاريخ المرجعي 2026-12-31: كل المتبقي أقدم من 90 يوماً
    expect(report.aging.map((b) => b.count)).toEqual([0, 0, 0, 2]);
    const agingTotal = report.aging.reduce((a, b) => a + b.amount, 0);
    expect(agingTotal).toBeCloseTo(report.open_items.reduce((a, i) => a + i.remaining, 0), 2);
    expect(report.summary.outstanding).toBeCloseTo(agingTotal, 2);

    // وبتاريخ مرجعي أقرب (2026-03-20) يتوزع المتبقي على شريحتين
    const mid = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-03-20"))!;
    expect(mid.open_items.map((i) => i.age_days)).toEqual([90, 38]);
    expect(mid.aging.map((b) => b.count)).toEqual([0, 1, 1, 0]);
    // المتبقي بعد الإشعارات (نفس أساس تخصيص السدادات): فاتورة الفترة 2760 + 115 − 2300 = 575
    expect(mid.aging[1].amount).toBeCloseTo(575, 2);
    expect(mid.aging[2].amount).toBeCloseTo(190, 2);
    expect(mid.summary.outstanding).toBeCloseTo(765, 2);
    expect(mid.summary.days_since_last_invoice).toBe(38);

    expect(customerReport.balanceSideLabel(report.summary.outstanding)).toBe("مستحق على العميل");
    expect(customerReport.balanceSideLabel(-10)).toBe("مستحق للعميل");
    expect(customerReport.balanceSideLabel(0)).toBe("لا توجد مديونية");
  });

  it("يتضمن كشف الحساب التفصيلي ويقبل الفلترة الذكية على قسم الحركات", async () => {
    const full = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-12-31"))!;
    expect(full.statement.rows.length).toBe(full.statement.all_rows_count);

    const filtered = (await customerReport.customerFullReport(s.cust, "2026-01-01", "2026-12-31", {
      docType: "sale", fromLoc: "المنصورة",
    }))!;
    expect(filtered.statement.rows).toHaveLength(1);
    expect(filtered.statement.rows[0].invoice_number).toBe(1);
    expect(filtered.statement.applied).toContain("النوع: فاتورة بيع");
    expect(filtered.statement.applied).toContain("من: المنصورة");
    // الرصيد الختامي يبقى محسوباً من كامل الحركات رغم الفلترة
    expect(filtered.statement.closing).toBeCloseTo(full.statement.closing, 2);
    // وبقية أقسام التقرير تبقى شاملة (الفواتير/السندات/الإشعارات)
    expect(filtered.invoices.length).toBe(full.invoices.length);
    expect(filtered.receipts).toHaveLength(1);
    expect(filtered.notes).toHaveLength(2);
  });

  it("يعيد null لعميل غير موجود ويحفظ التقرير لحظياً", async () => {
    await expect(customerReport.customerFullReport(9999, "2026-01-01", "2026-12-31")).resolves.toBeNull();
    expect(await customerReport.customerBalanceNow(s.cust)).toBeCloseTo(await calc.customerBalance(s.cust), 2);
  });
});
