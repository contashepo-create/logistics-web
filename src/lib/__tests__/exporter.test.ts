// اختبارات محرك التصدير/الطباعة (الدوال الخالصة): تعقيم XSS وبناء HTML.
import { describe, it, expect, vi } from "vitest";
import {
  esc, companyHeaderHtml, buildTableHtml, buildReportHtml, openPrintPreview, isNumericCell,
} from "@/lib/exporter";

describe("esc — تعقيم XSS", () => {
  it("يعقّم الرموز الخطرة", () => {
    expect(esc('<script>alert("x")</script>')).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(esc("a & b")).toBe("a &amp; b");
    expect(esc("1 < 2 > 0")).toBe("1 &lt; 2 &gt; 0");
  });

  // القيم تُحقن أحياناً داخل خصائص HTML (src/alt/style)، فلولا ترميز
  // الاقتباسات لأمكن الخروج من الخاصية وحقن معالج أحداث.
  it("يعقّم الاقتباسات فلا يمكن الخروج من خاصية HTML", () => {
    expect(esc('" onerror="alert(1)')).toBe("&quot; onerror=&quot;alert(1)");
    expect(esc("' onload='x")).toBe("&#39; onload=&#39;x");
    expect(esc('a"b')).not.toContain('"');
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
    const html = companyHeaderHtml({ company_name: "شركة" });
    expect(html).toBe('<div class="doc-company">شركة</div>');
    expect(html).not.toContain("doc-contact");
  });
  it("يحترم خيارات إخفاء الهاتف والعنوان", () => {
    const html = companyHeaderHtml(
      { company_name: "شركة", company_phone: "055", company_address: "الرياض" },
      { showPhone: false, showAddress: false }
    );
    expect(html).not.toContain("055");
    expect(html).not.toContain("الرياض");
  });
  it("يضيف الشعار والنص الإضافي عند تفعيلهما", () => {
    const html = companyHeaderHtml({ company_name: "شركة" }, { showLogo: true, logoUrl: "https://x/logo.png", headerNote: "فرع جدة" });
    expect(html).toContain("logo.png");
    expect(html).toContain("فرع جدة");
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

  it("يضع الرأس في thead كي يتكرر في كل صفحة مطبوعة", () => {
    const html = buildTableHtml(["البيان", "المبلغ"], [["نقل", "1,150.00"]]);
    expect(html).toContain("<thead><tr>");
    expect(html).toContain("</thead><tbody>");
    expect(html).toContain("<th align='center'");
  });

  it("يميّز الأعمدة الرقمية ويحاذيها وسطاً بأرقام متساوية العرض", () => {
    const html = buildTableHtml(["البيان", "المبلغ"], [["نقل", "1,150.00"], ["تحصيل", "٠٠٠"]]);
    expect(html).toContain("class='doc-cell-num'");
    expect(html).toContain("class='doc-cell-text'");
    // عمود النص يميناً وعمود المبلغ وسطاً
    expect(html).toContain("align='right' class='doc-cell-text'");
    expect(html).toContain("align='center' class='doc-cell-num'");
  });

  it("لا يعتبر النص الفارغ أو الحر رقمياً", () => {
    expect(isNumericCell("1,150.00")).toBe(true);
    expect(isNumericCell("2026-01-05")).toBe(true);
    expect(isNumericCell("١٥٠٠")).toBe(true);
    expect(isNumericCell("")).toBe(false);
    expect(isNumericCell("نقل معدات")).toBe(false);
  });
});

describe("معاينة الطباعة الفورية", () => {
  it("يفتح النافذة ويكتب حالة التحميل فوراً قبل تجهيز المستند", () => {
    const writes: string[] = [];
    const popup = {
      document: { open: vi.fn(), write: (html: string) => writes.push(html), close: vi.fn() },
      focus: vi.fn(),
    };
    const open = vi.fn(() => popup);
    vi.stubGlobal("window", { open });
    try {
      expect(openPrintPreview("فاتورة 42")).toBe(popup);
      expect(open).toHaveBeenCalledOnce();
      expect(writes.join("")).toContain("جارٍ تجهيز معاينة الفاتورة");
      expect(writes.join("")).toContain("فاتورة 42");
    } finally {
      vi.unstubAllGlobals();
    }
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
  it("يحترم خيارات المستند: إخفاء الترويسة وإظهار التوقيع", () => {
    const html = buildReportHtml({
      info, title: "ت", headers: ["a"], rows: [["v"]],
      doc: { showHeader: false, showSignature: true, signatureLabel: "المدير المالي", showCount: false },
    });
    expect(html).not.toContain("doc-head");
    expect(html).toContain("المدير المالي");
    expect(html).not.toContain("عدد السجلات");
  });
  it("يعرض الملخص كبطاقات قيم احترافية بدل جدول صغير", () => {
    const html = buildReportHtml({
      info, title: "كشف", headers: ["البيان"], rows: [["x"]],
      summaryLines: [["الرصيد الافتتاحي", "1,000.00"], ["الرصيد الحالي", "2,500.00"]],
    });
    expect(html).toContain("class='doc-summary'");
    expect(html).toContain("doc-summary-item");
    expect(html).toContain("<span class='k'>الرصيد الافتتاحي</span>");
    expect(html).toContain("<span class='v'>2,500.00</span>");
  });

  it("يتجاهل الجدول والملخص عند غيابهما", () => {
    const html = buildReportHtml({ info, title: "ت" });
    expect(html).not.toContain("<table");
    expect(html).toContain("ت");
  });
});
