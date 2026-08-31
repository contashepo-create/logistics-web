// اختبارات محرك التصدير/الطباعة (الدوال الخالصة): تعقيم XSS وبناء HTML.
import { describe, it, expect } from "vitest";
import { esc, companyHeaderHtml, buildTableHtml, buildReportHtml } from "@/lib/exporter";

describe("esc — تعقيم XSS", () => {
  it("يعقّم الرموز الخطرة", () => {
    expect(esc('<script>alert("x")</script>')).toBe("&lt;script&gt;alert(\"x\")&lt;/script&gt;");
    expect(esc("a & b")).toBe("a &amp; b");
    expect(esc("1 < 2 > 0")).toBe("1 &lt; 2 &gt; 0");
  });
  it("يعيد فاصلاً بديلاً للقيم الفارغة", () => {
    expect(esc(null)).toBe("—");
    expect(esc(undefined)).toBe("—");
    expect(esc("")).toBe("");
  });
});

describe("companyHeaderHtml", () => {
  it("يشمل اسم الشركة مع تعقيم وبيانات الاتصال", () => {
    const html = companyHeaderHtml({ company_name: "شركة <نقل>", company_phone: "055", company_address: "الرياض" });
    expect(html).toContain("شركة &lt;نقل&gt;");
    expect(html).toContain("055 | الرياض");
  });
  it("يتجاهل بيانات اتصال فارغة", () => {
    expect(companyHeaderHtml({ company_name: "شركة" })).toBe("<b style=\"font-size:16pt\">شركة</b>");
  });
});

describe("buildTableHtml", () => {
  it("يبني جدولاً مع تعقيم الخلايا", () => {
    const html = buildTableHtml(["اسم", "قيمة"], [["<b>x</b>", 5]], 1);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("align='center'"); // من centerFrom
  });
  it("يحاذي لليمين بلا centerFrom", () => {
    const html = buildTableHtml(["a"], [["v"]]);
    expect(html).toContain("align='right'");
  });
});

describe("buildReportHtml", () => {
  const info = { company_name: "شركتي", company_phone: "", company_address: "", company_vat_note: "فاتورة مرجعية" };

  it("يعقّم العنوان والترجمة والملخص والحاشية", () => {
    const html = buildReportHtml({
      info,
      title: "تقرير <نقل>",
      subtitle: "فترة & نتائج",
      headers: ["عمود"],
      rows: [["<img onerror=alert(1)>"]],
      summaryLines: [["إجمالي", "<b>100</b>"]],
      footerNote: "ملاحظة <س>",
    });
    expect(html).toContain("تقرير &lt;نقل&gt;");
    expect(html).toContain("فترة &amp; نتائج");
    expect(html).toContain("&lt;img onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;100&lt;/b&gt;");
    expect(html).toContain("ملاحظة &lt;س&gt;");
  });
  it("يستخدم الحاشية الافتراضية من info عند غياب footerNote", () => {
    const html = buildReportHtml({ info, title: "ت", headers: ["a"], rows: [] });
    expect(html).toContain("فاتورة مرجعية");
  });
  it("يتجاهل الجدول والملخص عند غيابهما", () => {
    const html = buildReportHtml({ info, title: "ت" });
    expect(html).not.toContain("<table");
    expect(html).toContain("ت");
  });
});
