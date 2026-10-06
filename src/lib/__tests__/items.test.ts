// اختبارات دورة الأصناف والخدمات (v26):
//   الكتالوج + الإنشاء/التعديل + منع الحذف عند الاستخدام + الخدمة الافتراضية
//   + تقرير كل خدمة وتقرير جميع الأصناف/الخدمات (الخدمات بلا مخزون فعلي).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table, resetQueryCount, getQueryCount } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as items from "@/lib/items";
import { clearFeatureCache } from "@/lib/features";
import * as calc from "@/lib/calc";

async function setup(opts: { withTaxInvoice?: boolean } = {}) {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة النقل", currency: "ج.م", vat_rate: 0, plan_type: "open", is_active: true }]);
  seedTable("company_features", opts.withTaxInvoice
    ? [{ company_id: "c1", feature_key: "tax_invoice", enabled: true }]
    : []);
  clearFeatureCache();
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
}

describe("كتالوج الأصناف والخدمات", () => {
  beforeEach(async () => { await setup(); });

  it("ينشئ خدمة بترقيم تسلسلي ونوع افتراضي service وبلا أي مخزون", async () => {
    const id = await items.saveItem({ name: "نقل حاويات", unit: "نقلة", default_price: 1500 });
    const item = await items.getItem(id);

    expect(item?.code).toBe("ITM-0001");
    expect(item?.item_type).toBe("service");
    expect(item?.unit).toBe("نقلة");
    expect(item?.default_price).toBeCloseTo(1500, 2);
    expect(item?.is_active).toBe(true);
    // الخدمة لا تحمل أي رصيد كميات: لا يوجد في الكتالوج أي حقل مخزون
    expect(Object.keys(item ?? {})).not.toContain("stock");
    expect(Object.keys(item ?? {})).not.toContain("qty_on_hand");
  });

  it("يرفض تكرار الاسم داخل الشركة (بلا حساسية لحالة الأحرف) ويسمح بالاسم في شركة أخرى", async () => {
    await items.saveItem({ name: "خدمة A" });
    await expect(items.saveItem({ name: "خدمة a" })).rejects.toThrow(/يوجد صنف\/خدمة بنفس الاسم/);

    seedTable("companies", [
      { id: "c1", name: "شركة النقل", vat_rate: 0, plan_type: "open", is_active: true },
      { id: "c2", name: "شركة أخرى", vat_rate: 0, plan_type: "open", is_active: true },
    ]);
    seedTable("profiles", [{ id: "u1", company_id: "c2", email: "owner@test.com", name: "مالك" }]);
    const id = await items.saveItem({ name: "خدمة a" });
    expect(id).toBeGreaterThan(0);
  });

  it("يرفض الأسماء الفارغة والسعر السالب والنوع غير الصالح والوحدة الطويلة", async () => {
    await expect(items.saveItem({ name: "   " })).rejects.toThrow(/يجب إدخال اسم/);
    await expect(items.saveItem({ name: "خدمة", default_price: -1 })).rejects.toThrow(/سالب/);
    await expect(items.saveItem({ name: "خدمة", item_type: "stock" })).rejects.toThrow(/نوع الصنف غير صالح/);
    await expect(items.saveItem({ name: "خدمة", unit: "ن".repeat(41) })).rejects.toThrow(/الوحدة/);
  });

  it("يعدّل الصنف بنفس المعرّف ولا يغيّر كوده", async () => {
    const id = await items.saveItem({ name: "نقل بضائع", unit: "نقلة", default_price: 100 });
    const code = (await items.getItem(id))!.code;
    await items.saveItem({ name: "نقل بضائع مبرّد", item_type: "product", unit: "طن", default_price: 0 }, id);

    const updated = await items.getItem(id);
    expect(updated?.code).toBe(code);
    expect(updated?.name).toBe("نقل بضائع مبرّد");
    expect(updated?.item_type).toBe("product");
    expect(updated?.unit).toBe("طن");
    expect(table("items").filter((i) => i.company_id === "c1")).toHaveLength(1);
  });

  it("يحذف صنفاً من الوسط ثم يرقّم الجديد بلا تصادم على الأكواد", async () => {
    const first = await items.saveItem({ name: "خدمة 1" });
    const middle = await items.saveItem({ name: "خدمة 2" });
    const last = await items.saveItem({ name: "خدمة 3" });
    expect((await items.getItem(first))!.code).toBe("ITM-0001");
    expect((await items.getItem(middle))!.code).toBe("ITM-0002");
    expect((await items.getItem(last))!.code).toBe("ITM-0003");

    // حذف الأوسط: لو كان الترقيم بعدد الصفوف لتكرر الكود ITM-0003 مع الصف الأخير
    await items.deleteItem(middle);
    const added = await items.saveItem({ name: "خدمة 4" });
    expect((await items.getItem(added))!.code).toBe("ITM-0004");
    const codes = table("items").filter((i) => i.company_id === "c1").map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("يمنع حذف صنف مستخدم في نقلات ويقترح التعطيل، ويسمح بحذف غير المستخدم", async () => {
    const used = await items.saveItem({ name: "خدمة مستخدمة" });
    const free = await items.saveItem({ name: "خدمة غير مستخدمة" });
    const cust = await repo.saveCustomer({ name: "شركة الدلتا للنقل", opening_balance: 0 });
    await repo.saveInvoice({
      date: "2026-02-01", customer_id: cust, attachments: [],
      trips: [{ item_id: used, from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 500, expenses: [] }],
    });

    await expect(items.deleteItem(used)).rejects.toThrow(/عطّله بدلاً من حذفه/);
    expect(await items.itemUsageCount(used)).toBe(1);

    await items.setItemActive(used, false);
    await expect(items.listItems()).resolves.toHaveLength(1); // غير المفعّلة لا تظهر افتراضياً
    await expect(items.listItems({ includeInactive: true })).resolves.toHaveLength(2);

    await items.deleteItem(free);
    expect(await items.getItem(free)).toBeNull();
  });

  it("الخدمة الافتراضية: تُنشأ مرة واحدة ثم تُعاد بلا تكرار", async () => {
    const first = await items.defaultServiceItemId();
    const again = await items.defaultServiceItemId();

    expect(again).toBe(first);
    const created = await items.getItem(first);
    expect(created?.name).toBe(items.DEFAULT_SERVICE_NAME);
    expect(created?.item_type).toBe("service");
    expect(table("items").filter((i) => i.company_id === "c1")).toHaveLength(1);
  });

  it("الخدمة الافتراضية تختار الأقدم بلا كاش (لا تعيد معرّف شركة سابقة)", async () => {
    const firstCompanyService = await items.defaultServiceItemId();
    // تبديل الجلسة إلى شركة أخرى بأصنافها الخاصة
    seedTable("companies", [
      { id: "c1", name: "شركة النقل", vat_rate: 0, plan_type: "open", is_active: true },
      { id: "c2", name: "شركة ثانية", vat_rate: 0, plan_type: "open", is_active: true },
    ]);
    seedTable("profiles", [{ id: "u1", company_id: "c2", email: "owner@test.com", name: "مالك" }]);
    const c2Item = await items.saveItem({ name: "خدمة الشركة الثانية" });

    const forSecond = await items.defaultServiceItemId();
    expect(forSecond).toBe(c2Item);
    expect(forSecond).not.toBe(firstCompanyService);

    // وبالعودة للشركة الأولى تُعاد خدمتها هي نفسها (لا تسرّب بين الشركات)
    seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
    expect(await items.defaultServiceItemId()).toBe(firstCompanyService);
  });

  it("حفظ الفاتورة بلا خدمة يربط النقلة بالخدمة الافتراضية تلقائياً", async () => {
    const cust = await repo.saveCustomer({ name: "مؤسسة النيل للتجارة", opening_balance: 0 });
    const invId = await repo.saveInvoice({
      date: "2026-02-01", customer_id: cust, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 100, expenses: [] }],
    });
    const trip = table("invoice_trips").find((t) => t.invoice_id === invId)!;
    expect(trip.item_id).toBe(await items.defaultServiceItemId());
  });

  it("يرفض ربط النقلة بخدمة غير موجودة أو لا تخص الشركة", async () => {
    const cust = await repo.saveCustomer({ name: "شركة الدلتا للنقل", opening_balance: 0 });
    await expect(repo.saveInvoice({
      date: "2026-02-01", customer_id: cust, attachments: [],
      trips: [{ item_id: 9999, from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 100, expenses: [] }],
    })).rejects.toThrow(/الصنف\/الخدمة المحدد غير موجود/);
  });
});

describe("تقارير الخدمات (بلا مخزون فعلي)", () => {
  async function seedUsage() {
    const containers = await items.saveItem({ name: "نقل حاويات", unit: "نقلة", default_price: 1000 });
    const bulk = await items.saveItem({ name: "نقل سائب", unit: "نقلة", default_price: 400 });
    const custA = await repo.saveCustomer({ name: "شركة المنصورة للتجارة", code: "C-0001", opening_balance: 0 });
    const custB = await repo.saveCustomer({ name: "مصنع أسيوط للأسمنت", code: "C-0002", opening_balance: 0 });

    const inv1 = await repo.saveInvoice({
      date: "2026-02-10", customer_id: custA, attachments: [],
      trips: [
        { item_id: containers, from_loc: "المنصورة", to_loc: "القاهرة", qty: 2, unit_price: 1000, expenses: [] },
        { item_id: bulk, from_loc: "طنطا", to_loc: "بورسعيد", qty: 1, unit_price: 400, expenses: [] },
      ],
    });
    const inv2 = await repo.saveInvoice({
      date: "2026-03-05", customer_id: custB, attachments: [],
      trips: [{ item_id: containers, from_loc: "دمياط", to_loc: "أسوان", qty: 1, unit_price: 1000, expenses: [] }],
    });
    return { containers, bulk, custA, custB, inv1, inv2 };
  }

  it("التقرير المجمّع يجمع الإيراد والكميات لكل خدمة على حدة", async () => {
    await setup();
    const s = await seedUsage();
    const report = await items.itemsUsageReport("2026-01-01", "2026-12-31");

    const containerRow = report.summary.find((r) => r.item_id === s.containers)!;
    expect(containerRow.trips_count).toBe(2);
    expect(containerRow.qty_total).toBeCloseTo(3, 2);
    expect(containerRow.revenue).toBeCloseTo(3000, 2); // 2000 + 1000
    expect(containerRow.invoices_count).toBe(2);
    expect(containerRow.last_date).toBe("2026-03-05");

    const bulkRow = report.summary.find((r) => r.item_id === s.bulk)!;
    expect(bulkRow.trips_count).toBe(1);
    expect(bulkRow.revenue).toBeCloseTo(400, 2);

    expect(report.totals.trips_count).toBe(3);
    expect(report.totals.revenue).toBeCloseTo(3400, 2);
    expect(report.totals.used_items_count).toBe(2);
    expect(report.totals.items_count).toBe(2);
    expect(report.lines).toHaveLength(3);
  });

  it("تقرير كل خدمة يقصر السطور والإجماليات على الخدمة المطلوبة", async () => {
    await setup();
    const s = await seedUsage();
    const one = await items.itemUsageReport(s.containers, "2026-01-01", "2026-12-31");

    expect(one.item?.name).toBe("نقل حاويات");
    expect(one.lines).toHaveLength(2);
    expect(one.lines.every((l) => l.item_id === s.containers)).toBe(true);
    expect(one.totals.trips_count).toBe(2);
    expect(one.totals.qty_total).toBeCloseTo(3, 2);
    expect(one.totals.revenue).toBeCloseTo(3000, 2);
    expect(one.totals.invoices_count).toBe(2);
  });

  it("يقبل قصر التقرير على عميل واحد (لتقرير العميل الشامل)", async () => {
    await setup();
    const s = await seedUsage();
    const forA = await items.itemsUsageReport("2026-01-01", "2026-12-31", { customerId: s.custA });

    expect(forA.lines.every((l) => l.customer_name === "شركة المنصورة للتجارة")).toBe(true);
    expect(forA.lines).toHaveLength(2);
    expect(forA.totals.revenue).toBeCloseTo(2400, 2);
  });

  it("الفترة تحدد النتائج، والنقلات القديمة بلا خدمة تظهر كخدمة غير محددة", async () => {
    await setup();
    const s = await seedUsage();
    const march = await items.itemsUsageReport("2026-03-01", "2026-03-31");
    expect(march.totals.revenue).toBeCloseTo(1000, 2);
    expect(march.lines).toHaveLength(1);

    // نقلة أُنشئت قبل الربط (item_id = null) لا تُهمل في التقارير
    table("invoice_trips").push({
      id: 999, company_id: "c1", invoice_id: s.inv1, item_id: null,
      from_loc: "س", to_loc: "ص", qty: 1, unit_price: 50, price: 50, container_numbers: [],
    });
    const report = await items.itemsUsageReport("2026-01-01", "2026-12-31");
    const unknown = report.summary.find((r) => r.item_id === null)!;
    expect(unknown.name).toBe("غير محدد (قبل ربط الخدمات)");
    expect(unknown.revenue).toBeCloseTo(50, 2);
    expect(unknown.trips_count).toBe(1);
  });

  it("تقرير جميع الأصناف لا يتأثر بعدد الخدمات (عدد استعلامات ثابت)", async () => {
    await setup();
    await seedUsage();
    resetQueryCount();
    await items.itemsUsageReport("2026-01-01", "2026-12-31");
    const few = getQueryCount();

    for (let i = 0; i < 8; i += 1) await items.saveItem({ name: `خدمة إضافية ${i}` });
    resetQueryCount();
    await items.itemsUsageReport("2026-01-01", "2026-12-31");
    expect(getQueryCount()).toBe(few);
    expect(few).toBeLessThanOrEqual(4);
  });

  it("خدمة الخط: تُخزَّن (من ← إلى) وتُعبَّأ، وخدمة عامة بلا خط", async () => {
    const route = await items.saveItem({
      name: "نقل الرياض - الدمام", unit: "نقلة", default_price: 2500,
      from_loc: "الرياض", to_loc: "الدمام",
    });
    const generic = await items.saveItem({ name: "أعمال تحميل", unit: "ساعة", default_price: 100 });

    const routeItem = await items.getItem(route)!;
    expect(routeItem!.from_loc).toBe("الرياض");
    expect(routeItem!.to_loc).toBe("الدمام");
    expect(items.isRouteItem(routeItem)).toBe(true);
    expect(items.itemRouteLabel(routeItem)).toBe("الرياض ← الدمام");

    const genericItem = await items.getItem(generic);
    expect(items.isRouteItem(genericItem)).toBe(false);
    expect(items.itemRouteLabel(genericItem)).toBe("خدمة عامة");

    // الخط إما كامل أو فارغ — لا أنصاف خطوط
    await expect(items.saveItem({ name: "خط ناقص", from_loc: "جدة" }))
      .rejects.toThrow(/أكمل مكان الانطلاق والوصول للخط/);
    await expect(items.saveItem({ name: "خط ناقص 2", to_loc: "مكة" }))
      .rejects.toThrow(/أكمل مكان الانطلاق والوصول للخط/);

    // وتعديل الخط ممكن بنفس المعرّف
    await items.saveItem({
      name: "نقل الرياض - الدمام", unit: "نقلة", default_price: 2600,
      from_loc: "الرياض", to_loc: "جدة",
    }, route);
    expect((await items.getItem(route))!.to_loc).toBe("جدة");
  });

  it("الصنف هو المصدر الوحيد للمسار: يفرض خطّه على النقلة ويرفض المسار المخالف", async () => {
    await setup();
    const route = await items.saveItem({
      name: "نقل الرياض - الدمام", unit: "نقلة", default_price: 2500,
      from_loc: "الرياض", to_loc: "الدمام",
    });
    const cust = await repo.saveCustomer({ name: "شركة الخليج للتجارة", opening_balance: 0 });

    // المستخدم اختار الخدمة وكتب مساراً مختلفاً ⇒ المسار المخزَّن في الصنف هو الذي يُحفظ
    const invId = await repo.saveInvoice({
      date: "2026-02-01", customer_id: cust, attachments: [],
      trips: [{ item_id: route, from_loc: "جدة", to_loc: "أبها", qty: 1, unit_price: 2500, expenses: [] }],
    });
    const trip = table("invoice_trips").find((t) => t.invoice_id === invId)!;
    expect(trip.from_loc).toBe("الرياض");
    expect(trip.to_loc).toBe("الدمام");
    expect(trip.item_id).toBe(route);

    // وخدمة الخط لا تحتاج كتابة المسار إطلاقاً (الواجهة تُقفل الحقلين)
    const invId2 = await repo.saveInvoice({
      date: "2026-02-02", customer_id: cust, attachments: [],
      trips: [{ item_id: route, qty: 1, unit_price: 2500, expenses: [] }],
    });
    const trip2 = table("invoice_trips").find((t) => t.invoice_id === invId2)!;
    expect(`${trip2.from_loc} ← ${trip2.to_loc}`).toBe("الرياض ← الدمام");

    // أما الخدمة العامة فيبقى مسارها يدوياً ويُلزم باكتماله
    const generic = await items.saveItem({ name: "أعمال تحميل", unit: "ساعة", default_price: 100 });
    const invId3 = await repo.saveInvoice({
      date: "2026-02-03", customer_id: cust, attachments: [],
      trips: [{ item_id: generic, from_loc: "المنصورة", to_loc: "القاهرة", qty: 1, unit_price: 100, expenses: [] }],
    });
    const trip3 = table("invoice_trips").find((t) => t.invoice_id === invId3)!;
    expect(`${trip3.from_loc} ← ${trip3.to_loc}`).toBe("المنصورة ← القاهرة");

    await expect(repo.saveInvoice({
      date: "2026-02-04", customer_id: cust, attachments: [],
      trips: [{ item_id: generic, from_loc: "", to_loc: "القاهرة", qty: 1, unit_price: 100, expenses: [] }],
    })).rejects.toThrow(/مكان الانطلاق|أكمل/);
  });

  it("تقارير الخدمات تعرض خط كل خدمة وتجمع النقلات على أساسه", async () => {
    await setup();
    const riyadhDammam = await items.saveItem({
      name: "نقل الرياض - الدمام", unit: "نقلة", default_price: 2500,
      from_loc: "الرياض", to_loc: "الدمام",
    });
    const jeddahMakkah = await items.saveItem({
      name: "نقل جدة - مكة", unit: "نقلة", default_price: 800,
      from_loc: "جدة", to_loc: "مكة",
    });
    const cust = await repo.saveCustomer({ name: "مؤسسة البحر الأحمر", opening_balance: 0 });
    await repo.saveInvoice({
      date: "2026-02-01", customer_id: cust, attachments: [],
      trips: [
        { item_id: riyadhDammam, qty: 2, unit_price: 2500, expenses: [] },
        { item_id: jeddahMakkah, qty: 1, unit_price: 800, expenses: [] },
      ],
    });

    const report = await items.itemsUsageReport("2026-01-01", "2026-12-31");
    const row1 = report.summary.find((r) => r.item_id === riyadhDammam)!;
    const row2 = report.summary.find((r) => r.item_id === jeddahMakkah)!;
    expect(`${row1.from_loc} ← ${row1.to_loc}`).toBe("الرياض ← الدمام");
    expect(row1.qty_total).toBeCloseTo(2, 2);
    expect(row1.revenue).toBeCloseTo(5000, 2);
    expect(`${row2.from_loc} ← ${row2.to_loc}`).toBe("جدة ← مكة");

    // سطور الاستخدام تحمل مسار الخدمة نفسه (وهو مسار النقلة المفروض)
    expect(report.lines.map((l) => `${l.from_loc} ← ${l.to_loc}`))
      .toEqual(["الرياض ← الدمام", "جدة ← مكة"]);

    // التقرير الذكي للكشف يستطيع الفلترة بمسار الخط
    const st = await calc.customerStatement(cust, "2026-01-01", "2026-12-31", { fromLoc: "الرياض", toLoc: "الدمام" });
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0].detail ?? st.rows[0].desc).toContain("الرياض");
  });

  it("خيارات الخدمات وسعرها الافتراضي", async () => {
    await setup();
    const id = await items.saveItem({ name: "نقل مبرّد", unit: "نقلة", default_price: 250 });
    const options = await items.itemOptions();
    expect(options).toContainEqual({ id, label: "نقل مبرّد — نقلة" });
    // خدمة الخط تُظهر مسارها في الوصف إن لم يكن مذكوراً في الاسم
    const route = await items.saveItem({ name: "خدمة سريعة", from_loc: "القاهرة", to_loc: "أسوان", unit: "نقلة" });
    const routeOption = (await items.itemOptions()).find((o) => o.id === route)!;
    expect(routeOption.label).toContain("(القاهرة ← أسوان)");
    expect(items.defaultUnitPrice(await items.getItem(id))).toBeCloseTo(250, 2);
    expect(items.defaultUnitPrice(null)).toBeCloseTo(0, 2);
  });
});
