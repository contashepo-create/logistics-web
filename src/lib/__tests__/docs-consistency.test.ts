// اختبارات توحيد المستندات: أسماء أوراق Excel، عرض الأعمدة، أصناف صفوف الجداول،
// وتحويل كشف الحساب ونسخة البيانات إلى نظام .doc-* المشترك.
import { describe, it, expect } from "vitest";
import {
  buildTableHtml,
  excelColumnWidth,
  sanitizeSheetName,
} from "@/lib/exporter";
import { DEFAULT_PRINT_SETTINGS, pdfDocOptions, scopedPrintCss } from "@/lib/print";
import { customerStatementHtml } from "@/lib/statementDoc";
import { backupReportHtml } from "@/lib/dataExport";
import type { CustomerStatementFull } from "@/lib/calc";

const st = {
  customer: { id: 1, code: "CUST-00001", name: "شركة الدلتا", phone: "0100", address: "المنصورة" },
  from: "2026-01-01",
  to: "2026-12-31",
  opening: 1000,
  invoiced: 5750,
  collected: 2000,
  notes_debit: 115,
  notes_credit: 230,
  closing: 4635,
  rows: [
    { date: "2026-02-01", doc: "INV-00001", kind: "invoice", desc: "نقل معدات", detail: "المنصورة ← القاهرة", debit: 2300, credit: 0, balance: 3300 },
    { date: "2026-03-01", doc: "REC-00001", kind: "receipt", desc: "تحصيل", detail: "", debit: 0, credit: 2000, balance: 1300 },
  ],
  openItems: [
    { number: 2, date: "2026-05-01", total: 1150, paid: 0, remaining: 1150 },
  ],
} as unknown as CustomerStatementFull;

describe("أسماء أوراق Excel", () => {
  it("يقصّ الاسم إلى 31 حرفاً ويحذف المحارف الممنوعة", () => {
    const long = "أعمار ديون العملاء والموردين للفترة من 2026-01-01 إلى 2026-12-31";
    const name = sanitizeSheetName(long);
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[\\/?*[\]:]/);
    expect(sanitizeSheetName("كشف/حساب: عميل?").length).toBeLessThanOrEqual(31);
    expect(sanitizeSheetName("كشف/حساب: عميل?")).not.toMatch(/[\\/?*[\]:]/);
  });

  it("يعيد اسماً بديلاً عند الاسم الفارغ", () => {
    expect(sanitizeSheetName("")).toBe("تقرير");
    expect(sanitizeSheetName("   ")).toBe("تقرير");
    expect(sanitizeSheetName("", "ورقة")).toBe("ورقة");
  });
});

describe("عرض أعمدة Excel", () => {
  it("يتوسّع مع أطول قيمة ويحترم الحد الأدنى والأقصى", () => {
    expect(excelColumnWidth(["100", "1,150.00"], 6)).toBeGreaterThanOrEqual(9);
    expect(excelColumnWidth(["x".repeat(80)], 4)).toBe(42);
    expect(excelColumnWidth([], 3)).toBe(9);
    // العربية تُحسب أعرض قليلاً من اللاتينية
    expect(excelColumnWidth(["شركة النقل والشحن"], 0)).toBeGreaterThan(excelColumnWidth(["abcdefghijklmnop"], 0));
  });
});

describe("أصناف صفوف الجداول", () => {
  it("تمرّر أصناف الصفوف (افتتاحي/إجماليات) إلى HTML", () => {
    const html = buildTableHtml(
      ["البيان", "المبلغ"],
      [["افتتاحي", "1,000.00"], ["فاتورة", "500.00"], ["الإجماليات", "1,500.00"]],
      null,
      ["doc-open-row", null, "doc-total-row"]
    );
    expect(html).toContain("<tr class='doc-open-row'>");
    expect(html).toContain("<tr class='doc-total-row'>");
    expect(html).toContain("<tr><td");
    expect(html.indexOf("doc-open-row")).toBeLessThan(html.indexOf("doc-total-row"));
  });

  it("يعمل بلا أصناف (توافق النداءات القديمة)", () => {
    const html = buildTableHtml(["أ", "ب"], [["1", "2"]]);
    expect(html).not.toContain("doc-open-row");
    expect(html).toContain("<thead><tr>");
  });
});

describe("كشف الحساب على نظام المستندات المشترك", () => {
  const html = customerStatementHtml({
    info: { company_name: "شركة النقل", currency: "ج.م" },
    ps: DEFAULT_PRINT_SETTINGS,
    st,
  });

  it("يستخدم جدول المستندات الموحّد بدل الأنماط المضمّنة المكرّرة", () => {
    expect(html).toContain("class='doc-table'");
    expect(html).toContain("doc-cell-num");
    expect(html).toContain("doc-cell-text");
    expect(html).not.toContain("padding:7px 8px");
  });

  it("يبرز صف الرصيد الافتتاحي وصف الإجماليات بأصناف مشتركة", () => {
    expect(html).toContain("doc-open-row");
    expect(html).toContain("doc-total-row");
    expect(html).toContain("رصيد ما قبل الفترة (افتتاحي)");
    expect(html).toContain("الإجماليات");
  });

  it("جداول التخطيط (الترويسة/البطاقات/التوقيع) بلا حدود", () => {
    expect(html).toContain("doc-plain");
    expect((html.match(/doc-plain/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("أنماط المستند المشترك", () => {
  const css = scopedPrintCss(DEFAULT_PRINT_SETTINGS);

  it("تشمل قواعد الجداول والخلايا وإبراز الافتتاحي/الإجماليات", () => {
    expect(css).toContain("doc-cell-num");
    expect(css).toContain("doc-cell-text");
    expect(css).toContain("doc-total-row");
    expect(css).toContain("doc-open-row");
    expect(css).toContain("doc-plain");
  });

  it("خيارات PDF تحمل نفس الأنماط ومقاس الورق والهوامش", () => {
    const opts = pdfDocOptions(DEFAULT_PRINT_SETTINGS, { title: "كشف حساب" });
    expect(opts.css).toContain("doc-plain");
    expect(opts.paper.w).toBeGreaterThan(0);
    expect(opts.marginMm).toBeGreaterThan(0);
    expect(opts.runningTitle).toBe("كشف حساب");
  });
});

describe("نسخة بيانات النظام", () => {
  const html = backupReportHtml({
    companyName: "شركة النقل",
    printedAt: "2026-11-08 10:00",
    printedBy: "المدير",
    sections: [
      { label: "العملاء", headers: ["الكود", "الاسم"], rows: [["C1", "شركة الدلتا"]] },
      { label: "الفواتير", headers: ["الرقم"], rows: [] },
    ],
  });

  it("يستخدم ترويسة المستند وعناوين الأقسام", () => {
    expect(html).toContain("doc-company");
    expect(html).toContain("doc-title");
    expect(html).toContain("العملاء (1)");
    expect(html).toContain("الفواتير (0)");
    expect(html).toContain("طُبع بواسطة: المدير");
  });

  it("يبني جدولاً موحّداً لكل قسم ويصرّح بالأقسام الفارغة", () => {
    expect(html).toContain("class='doc-table'");
    expect(html).toContain("لا توجد بيانات");
    expect(html).not.toContain("<table border=\"1\"");
  });
});
