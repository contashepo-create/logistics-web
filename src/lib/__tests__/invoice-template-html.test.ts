import { describe, expect, it } from "vitest";
import { renderInvoiceTemplate, type InvoiceTemplateModel } from "../invoice-template-html";
import { DEFAULT_PRINT_SETTINGS, PRINT_TEMPLATES } from "../print";

const model: InvoiceTemplateModel = {
  invoiceNumber: "INV-00042",
  issueDate: "2026-09-01",
  invoiceTitleAr: "فاتورة ضريبية",
  invoiceTitleEn: "Tax Invoice",
  currency: "ر.س",
  containerNumber: "MSCU1234567",
  seller: { name: "شركة النقل", taxNumber: "310000000000003", address: "الرياض", phone: "0500000000" },
  buyer: { name: "عميل الاختبار", code: "CUS-0042", taxNumber: "310000000000010" },
  lines: [{
    description: "خدمة نقل: الرياض ← جدة",
    detail: "حاوية",
    containerNumbers: ["TCLU1112223", "OOLU4445556"],
    quantity: 2,
    unitAmount: 1000,
    taxableAmount: 2000,
    vatRate: 15,
    vatAmount: 300,
    total: 2300,
  }],
  subtotal: 2000,
  vatRate: 15,
  vatAmount: 300,
  total: 2300,
  amountInWords: "ألفان وثلاثمائة ريال فقط لا غير",
  notes: "تسدد خلال ثلاثين يوماً",
  qrDataUrl: "data:image/png;base64,abc",
  qrCaption: "رمز الفاتورة الضريبية",
};

describe("هياكل قوالب الفاتورة المكيّفة من pro-acc", () => {
  it("ينتج ستة هياكل فعلية مختلفة مع بيانات النقل وVAT", () => {
    const outputs = PRINT_TEMPLATES.map((template) => renderInvoiceTemplate(model, {
      ...DEFAULT_PRINT_SETTINGS,
      template: template.id,
      show_signature: true,
    }));

    expect(new Set(outputs).size).toBe(6);
    PRINT_TEMPLATES.forEach((template, index) => {
      const html = outputs[index];
      expect(html).toContain(`data-invoice-template=\"${template.id}\"`);
      expect(html).toContain("INV-00042");
      expect(html).toContain("الرياض ← جدة");
      expect(html).toContain("الحاويات:");
      expect(html).toContain("TCLU1112223");
      expect(html).toContain("OOLU4445556");
      expect(html).toContain("300.00");
      expect(html).toContain("2,300.00");
    });
  });

  it("لا يعرض لغة التسميات الثانية بجانب العربية", () => {
    const html = renderInvoiceTemplate(model, DEFAULT_PRINT_SETTINGS);
    expect(html).toContain("فاتورة ضريبية");
    expect(html).not.toContain("Tax Invoice");
  });

  it("يحترم إخفاء QR من نموذج البيانات", () => {
    const html = renderInvoiceTemplate({ ...model, qrDataUrl: "" }, DEFAULT_PRINT_SETTINGS);
    expect(html).not.toContain('alt="QR"');
  });
});
