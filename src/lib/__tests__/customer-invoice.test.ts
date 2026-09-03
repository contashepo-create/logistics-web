// فاتورة العميل المطبوعة: يجب أن تكون فاتورة بيع نظيفة بلا أي بيانات تكلفة أو ربح
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable } from "./memory-supabase";
import * as repo from "@/lib/repo";
import { customerInvoiceHtml } from "@/components/dialogs/operations";
import { clearFeatureCache, TAX_INVOICE_WARNING } from "@/lib/features";

async function seed() {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{
    id: "c1", name: "شركة النقل السريع", phone: "0100000000", address: "المنصورة - الدقهلية",
    currency: "ج.م", vat_rate: 14, vat_note: "فاتورة ضريبية", plan_type: "open", is_active: true,
  }]);
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  const cust = await repo.saveCustomer({ name: "مصانع الدلتا", phone: "01123456789", address: "طلخا", opening_balance: 0 });
  const drv = await repo.saveEmployee({ name: "سائق سرّي", emp_type: "driver" });
  const cb = await repo.saveAccount("cashbox", { name: "الخزينة", created_date: "2026-01-01", opening_balance: 10000 });
  const inv = await repo.saveInvoice({
    date: "2026-03-01", customer_id: cust, notes: "الدفع خلال ٣٠ يوماً", container_number: "MSCU9876543", attachments: [],
    trips: [{
      driver_id: drv, from_loc: "المنصورة", to_loc: "الإسكندرية", qty: 3, unit_price: 1500, notes: "حمولة أسمنت",
      container_numbers: ["TCLU1112223", "OOLU4445556", "MAEU7778889"],
      expenses: [
        { expense_type: "card", qty: 3, unit_amount: 120, source: "cash", account_kind: "cashbox", account_id: cb, notes: "كارتة" },
        { expense_type: "fuel", qty: 1, unit_amount: 800, source: "driver", notes: "سولار" },
        { expense_type: "trip", qty: 3, unit_amount: 200, source: "supplier", supplier_name: "محطة النور السرية", notes: "تريب" },
        { expense_type: "other", qty: 1, unit_amount: 450, source: "customer", notes: "رسوم ميناء" },
      ],
    }],
  });
  return { inv, cust };
}

describe("فاتورة العميل المطبوعة", () => {
  let ids: Awaited<ReturnType<typeof seed>>;
  let html: string;

  beforeEach(async () => {
    ids = await seed();
    html = (await customerInvoiceHtml(ids.inv))!.html;
  });

  it("تعرض ترويسة الشركة وبيانات العميل ورقم الفاتورة", () => {
    expect(html).toContain("شركة النقل السريع");
    expect(html).toContain("مصانع الدلتا");
    expect(html).toContain("INV-00001");
    expect(html).toContain("2026-03-01");
    expect(html).toContain("MSCU9876543");
    expect(html).toContain("فاتورة ضريبية");
    // التسميات بلغة واحدة فقط (الافتراضي: العربية) — لا تُعرض لغة ثانية بجوارها
    expect(html).not.toContain("Tax Invoice");
    expect(html).not.toContain("Tel:");
  });

  it("تعرض بند النقل بالعدد وسعر الوحدة والإجمالي وأرقام حاوياته", () => {
    expect(html).toContain("المنصورة ← الإسكندرية");
    expect(html).toContain("1,500.00"); // سعر النقلة الواحدة
    expect(html).toContain("4,500.00"); // 3 × 1500
    expect(html).toContain("الحاويات:");
    expect(html).toContain("TCLU1112223");
    expect(html).toContain("OOLU4445556");
    expect(html).toContain("MAEU7778889");
  });

  it("تعرض البند الذي يتحمّله العميل فقط دون أي مصروف داخلي", () => {
    expect(html).toContain("رسوم ميناء");
    expect(html).toContain("450.00");
    // لا تظهر المصروفات التي تتحملها الشركة
    expect(html).not.toContain("كارتة");
    expect(html).not.toContain("سولار");
    expect(html).not.toContain("360.00");
    expect(html).not.toContain("800.00");
    expect(html).not.toContain("600.00");
  });

  it("لا تكشف الموردين ولا السائقين ولا مصادر التمويل", () => {
    expect(html).not.toContain("محطة النور السرية");
    expect(html).not.toContain("سائق سرّي");
    expect(html).not.toContain("الخزينة");
    expect(html).not.toContain("عهدة");
    expect(html).not.toContain("مورد");
    expect(html).not.toMatch(/تكلفة|الربح|هامش|مصدر التمويل/);
  });

  it("تعرض الإجماليات والضريبة والمبلغ كتابةً", () => {
    // 4500 + 450 = 4950 ، ضريبة 14% = 693 ، الإجمالي 5643
    expect(html).toContain("4,950.00");
    expect(html).toContain("693.00");
    expect(html).toContain("5,643.00");
    expect(html).toContain("الإجمالي المستحق");
    expect(html).toContain("المبلغ كتابةً");
    expect(html).toContain("فقط لا غير");
  });

  it("تعرض ملاحظات الفاتورة وخانات التوقيع", () => {
    expect(html).toContain("الدفع خلال ٣٠ يوماً");
    expect(html).toContain("توقيع المستلم");
    expect(html).toContain("عن الشركة");
  });

  it("تحذير زاتكا مخصص للواجهة ولا يدخل في الفاتورة المطبوعة", async () => {
    const result = await customerInvoiceHtml(ids.inv);
    expect(result?.warnTaxInvoice).toBe(true);
    expect(result?.html).not.toContain(TAX_INVOICE_WARNING);
    expect(result?.html).not.toContain('alt="QR"');
  });

  it("يختفي تحذير المالك بعد تفعيل المطوّر للفاتورة الضريبية", async () => {
    seedTable("company_features", [{ company_id: "c1", feature_key: "tax_invoice", enabled: true }]);
    clearFeatureCache();
    const result = await customerInvoiceHtml(ids.inv);
    expect(result?.warnTaxInvoice).toBe(false);
  });
});
