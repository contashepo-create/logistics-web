// اختبارات مُصدِّر التقرير الشامل للعميل (v26): تغطية كل الأقسام، تطابق أعمدة
// كل ورقة، وترقيم المستندات — قبل تحويلها إلى Excel/PDF/طباعة.
import { describe, it, expect } from "vitest";
import {
  customerReportSheets,
  customerReportSummaryLines,
  type ReportSheet,
} from "@/lib/customerReportExport";
import type { CustomerFullReport } from "@/lib/customerReport";

function fixture(): CustomerFullReport {
  return {
    customer: {
      id: 7,
      code: "C-0007",
      name: "شركة النيل للخدمات اللوجستية",
      address: "القاهرة - مدينة نصر",
      phone: "01234567890",
      tax_number: "310123456700003",
      commercial_reg: "123456",
      country: "السعودية",
      region: "الرياض",
      city: "الرياض",
      district: "العليا",
      street: "طريق الملك فهد",
      building_no: "1234",
      postal_code: "12211",
      additional_no: "5678",
      opening_balance: 1690,
      notes: "عميل رئيسي للخطوط الشرقية",
    },
    from: "2026-01-01",
    to: "2026-03-31",
    generated_at: "2026-03-31 12:00",
    summary: {
      opening: 1690,
      invoiced: 2760,
      collected: 500,
      notes_debit: 115,
      notes_credit: 2300,
      closing: 1765,
      invoices_count: 3,
      receipts_count: 1,
      notes_count: 2,
      trips_count: 5,
      qty_total: 9,
      services_count: 2,
      avg_invoice: 920,
      outstanding: 2260,
      first_movement: "2026-01-05",
      last_movement: "2026-03-20",
      last_invoice_date: "2026-03-20",
      days_since_last_invoice: 11,
    },
    statement: {
      opening: 1690,
      rows: [
        {
          date: "2026-01-05", doc: "فاتورة نقل", desc: "نقل معدات", detail: "الرياض ← الدمام",
          debit: 1150, credit: 0, kind: "invoice", balance: 2840, doc_type: "sale", number: 12,
          invoice_number: 12, from_locs: ["الرياض"], to_locs: ["الدمام"], item_ids: [1], amount: 1150,
        },
        {
          date: "2026-02-10", doc: "سند قبض", desc: "تحصيل نقدي", detail: "خزينة: الرئيسية",
          debit: 0, credit: 500, kind: "receipt", balance: 2340, doc_type: "receipt", number: 4, amount: 500,
        },
      ],
      closing: 1765,
      invoiced: 2760,
      collected: 500,
      notes_debit: 115,
      notes_credit: 2300,
      matched_debit: 1150,
      matched_credit: 500,
      all_rows_count: 5,
      matched_count: 2,
      applied: "نوع المستند: بيع/مرتجع",
    },
    invoices: [
      {
        id: 12, number: 12, label: "INV-00012", date: "2026-01-05", notes: "", vat_rate: 15,
        subtotal: 1000, vat_amount: 150, total: 1150, paid: 500, remaining: 650,
        status: "partial", trips_count: 2, legs: ["الرياض ← الدمام"], in_range: true,
      },
    ],
    trips: [
      {
        trip_id: 41, invoice_number: 12, invoice_label: "INV-00012", date: "2026-01-05",
        item_name: "نقل الرياض ← الدمام", from_loc: "الرياض", to_loc: "الدمام",
        route: "الرياض ← الدمام", qty: 2, unit_price: 500, amount: 1000,
        containers: ["MSCU1234567"], vehicle_name: "تريلا", driver_name: "سعيد", notes: "",
      },
    ],
    services: [
      {
        item_id: 1, name: "نقل الرياض ← الدمام", unit: "نقلة", from_loc: "الرياض", to_loc: "الدمام",
        trips_count: 2, qty_total: 3, revenue: 1000, vat_amount: 150, total: 1150,
      },
      {
        item_id: 2, name: "أعمال تحميل", unit: "نقلة", from_loc: "", to_loc: "",
        trips_count: 1, qty_total: 1, revenue: 300, vat_amount: 45, total: 345,
      },
    ],
    receipts: [
      {
        id: 4, label: "REC-00004", date: "2026-02-10", amount: 500, description: "تحصيل نقدي",
        allocations: "INV-00012: 500.00", account_name: "خزينة: الرئيسية",
      },
    ],
    notes: [
      {
        id: 9, label: "CN-00009", type: "credit", date: "2026-03-01", amount: 2000, vat_amount: 300,
        total: 2300, reason: "خصم اتفاق", invoice_number: 12, trips: ["الرياض ← الدمام"],
      },
    ],
    aging: [
      { bucket: "حتى 30 يوم", count: 1, amount: 650 },
      { bucket: "31 – 60 يوم", count: 0, amount: 0 },
      { bucket: "61 – 90 يوم", count: 0, amount: 0 },
      { bucket: "أكثر من 90 يوم", count: 1, amount: 1610 },
    ],
    open_items: [
      { number: 12, date: "2026-01-05", total: 1150, paid: 500, remaining: 650, age_days: 85 },
    ],
  };
}

describe("customerReportSheets — التقرير الشامل للعميل", () => {
  it("يغطي كل ما يخص العميل في أقسام مرتّبة", () => {
    const labels = customerReportSheets(fixture()).map((s) => s.label);
    expect(labels).toEqual([
      "بيانات العميل",
      "كشف الحساب",
      "الفواتير",
      "النقلات",
      "الخدمات",
      "سندات القبض",
      "الإشعارات المدينة والدائنة",
      "الديون والأعمار",
      "الفواتير المفتوحة",
    ]);
  });

  it("كل صف يطابق عدد أعمدة ورقته (شرط التصدير والطباعة)", () => {
    for (const sheet of customerReportSheets(fixture()) as ReportSheet[]) {
      expect(sheet.headers.length).toBeGreaterThan(1);
      for (const row of sheet.rows) expect(row.length).toBe(sheet.headers.length);
    }
  });

  it("ورقة «بيانات العميل» تضم البيانات التعريفية والملخص المالي والمؤشرات", () => {
    const sheet = customerReportSheets(fixture())[0];
    const text = sheet.rows.map((r) => r.join(" | ")).join("\n");
    expect(text).toContain("شركة النيل للخدمات اللوجستية");
    expect(text).toContain("C-0007");
    expect(text).toContain("310123456700003");
    expect(text).toContain("عميل رئيسي للخطوط الشرقية");
    expect(text).toContain("رصيد الإقفال");
    expect(text).toContain("1,765.00");
    // مؤشرات الجودة: عدد الخدمات وعدد النقلات وأيام منذ آخر فاتورة
    expect(text).toContain("عدد الخدمات المستخدمة | 2");
    expect(text).toContain("عدد النقلات | 5");
    expect(text).toContain("أيام منذ آخر فاتورة | 11");
  });

  it("كشف الحساب يعرض نوع المستند والرقم والمدين/الدائن والرصيد", () => {
    const sheet = customerReportSheets(fixture()).find((s) => s.label === "كشف الحساب")!;
    expect(sheet.rows[0]).toEqual([
      "2026-01-05", "فاتورة نقل", "12", "نقل معدات — الرياض ← الدمام", "1,150.00", "", "2,840.00",
    ]);
    expect(sheet.rows[1][5]).toBe("500.00");
  });

  it("الفواتير تعرض الترقيم المعياري والحالة العربية وعلم داخل الفترة", () => {
    const sheet = customerReportSheets(fixture()).find((s) => s.label === "الفواتير")!;
    expect(sheet.rows[0][0]).toBe("INV-00012");
    expect(sheet.rows[0][9]).toBe("مسددة جزئياً");
    expect(sheet.rows[0][10]).toBe("نعم");
  });

  it("الخدمات تُفرّق بين خدمة الخط والخدمة العامة", () => {
    const sheet = customerReportSheets(fixture()).find((s) => s.label === "الخدمات")!;
    expect(sheet.rows[0][2]).toBe("الرياض ← الدمام");
    expect(sheet.rows[1][2]).toBe("خدمة عامة");
  });

  it("الإشعارات تعرض النوع بالعربية وتربط بالفاتورة", () => {
    const sheet = customerReportSheets(fixture()).find((s) => s.label === "الإشعارات المدينة والدائنة")!;
    expect(sheet.rows[0][1]).toBe("إشعار دائن");
    expect(sheet.rows[0][7]).toBe("INV-00012");
    expect(sheet.rows[0][5]).toBe("2,300.00");
  });

  it("الديون والأعمار تجمع الإجمالي من مستحق الفواتير", () => {
    const sheet = customerReportSheets(fixture()).find((s) => s.label === "الديون والأعمار")!;
    expect(sheet.rows.at(-1)).toEqual(["الإجمالي", 2, "2,260.00"]);
  });

  it("ملخص التصدير يلخّص الفترة والأرصدة والعدادات", () => {
    const lines = customerReportSummaryLines(fixture());
    const keys = lines.map(([k]) => k);
    expect(keys).toContain("الفترة");
    expect(keys).toContain("رصيد الإقفال");
    expect(lines.find(([k]) => k === "رصيد الإقفال")![1]).toBe("1,765.00 (مستحق على العميل)");
    expect(lines.find(([k]) => k === "إشعارات مدينة / دائنة")![1]).toBe("115.00 / 2,300.00");
    expect(lines.find(([k]) => k === "عدد النقلات / إجمالي الكميات")![1]).toBe("5 / 9");
  });

  it("يتعامل مع عميل بلا أي حركات دون أخطاء", () => {
    const rep = fixture();
    rep.statement.rows = [];
    rep.invoices = [];
    rep.trips = [];
    rep.services = [];
    rep.receipts = [];
    rep.notes = [];
    rep.aging = [];
    rep.open_items = [];
    const sheets = customerReportSheets(rep);
    expect(sheets).toHaveLength(9);
    for (const sheet of sheets) for (const row of sheet.rows) expect(row.length).toBe(sheet.headers.length);
  });
});
