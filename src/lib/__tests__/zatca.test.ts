import { describe, it, expect } from "vitest";
import {
  tlv, bytesToBase64, zatcaAmount, zatcaTimestamp, buildZatcaQr, parseZatcaQr,
  zatcaInvoiceType, zatcaMissingFields, ZATCA_TYPE_LABEL,
} from "@/lib/zatca";

describe("ترميز TLV", () => {
  it("يضع التاج ثم الطول ثم القيمة بترميز UTF-8", () => {
    const out = tlv(1, "AB");
    expect(Array.from(out)).toEqual([1, 2, 65, 66]);
  });

  it("يحسب الطول بالبايتات لا بالحروف (العربية بايتان لكل حرف)", () => {
    const out = tlv(1, "شركة");
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(8);
  });

  it("يرفض قيمة أطول من 255 بايت", () => {
    expect(() => tlv(1, "a".repeat(256))).toThrow();
  });
});

describe("سلسلة QR المعتمدة", () => {
  const input = {
    sellerName: "شركة النقل",
    vatNumber: "300000000000003",
    timestamp: "2026-01-15T10:30:00.000Z",
    totalWithVat: 1150,
    vatAmount: 150,
  };

  it("تُنتج Base64 قابلة للفك إلى التاجات الخمسة", () => {
    const qr = buildZatcaQr(input);
    expect(qr).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const parsed = parseZatcaQr(qr);
    expect(parsed[1]).toBe("شركة النقل");
    expect(parsed[2]).toBe("300000000000003");
    expect(parsed[3]).toBe("2026-01-15T10:30:00Z");
    expect(parsed[4]).toBe("1150.00");
    expect(parsed[5]).toBe("150.00");
  });

  it("ينظّف الرقم الضريبي من الفواصل والمسافات", () => {
    const qr = buildZatcaQr({ ...input, vatNumber: "3 0000-0000 00000 3" });
    expect(parseZatcaQr(qr)[2]).toBe("300000000000003");
  });

  it("يُنسّق المبالغ برقمين عشريين دائماً", () => {
    expect(zatcaAmount(0)).toBe("0.00");
    expect(zatcaAmount(1150.5)).toBe("1150.50");
    expect(zatcaAmount(99.999)).toBe("100.00");
  });

  it("الطابع الزمني بلا أجزاء ميلي ثانية", () => {
    expect(zatcaTimestamp("2026-01-15T10:30:00.123Z")).toBe("2026-01-15T10:30:00Z");
    expect(zatcaTimestamp("قيمة غير صالحة")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("Base64 مطابق للتوقّع لمدخل معروف", () => {
    const bytes = new Uint8Array([1, 2, 65, 66]);
    expect(bytesToBase64(bytes)).toBe("AQJBQg==");
  });
});

describe("نوع الفاتورة", () => {
  it("مشترٍ خاضع برقم ضريبي صحيح ⇒ فاتورة ضريبية", () => {
    expect(zatcaInvoiceType({ tax_number: "300000000000003", tax_status: "taxable" })).toBe("standard");
  });

  it("بلا رقم ضريبي أو معفى ⇒ مبسّطة", () => {
    expect(zatcaInvoiceType({ tax_number: "", tax_status: "taxable" })).toBe("simplified");
    expect(zatcaInvoiceType({ tax_number: "300000000000003", tax_status: "exempt" })).toBe("simplified");
    expect(zatcaInvoiceType(null)).toBe("simplified");
  });

  it("لكل نوع تسمية عربية وإنجليزية", () => {
    expect(ZATCA_TYPE_LABEL.standard.en).toBe("Tax Invoice");
    expect(ZATCA_TYPE_LABEL.simplified.ar).toContain("مبسّطة");
  });
});

describe("الحقول الإلزامية", () => {
  const base = {
    sellerName: "شركة النقل",
    sellerVat: "300000000000003",
    sellerAddress: "الرياض",
    date: "2026-01-15",
  };

  it("الفاتورة المبسّطة لا تشترط بيانات المشتري", () => {
    expect(zatcaMissingFields({ ...base, type: "simplified" })).toEqual([]);
  });

  it("الفاتورة الضريبية تشترط اسم المشتري ورقمه الضريبي", () => {
    const missing = zatcaMissingFields({ ...base, type: "standard" });
    expect(missing).toContain("اسم المشتري");
    expect(missing).toContain("الرقم الضريبي للمشتري");
  });

  it("ترصد نقص بيانات البائع", () => {
    const missing = zatcaMissingFields({ type: "simplified", sellerVat: "123" });
    expect(missing).toContain("اسم البائع");
    expect(missing).toContain("الرقم الضريبي للبائع (15 رقماً)");
    expect(missing).toContain("عنوان البائع");
    expect(missing).toContain("تاريخ الإصدار");
  });

  it("الفاتورة الضريبية المكتملة لا ينقصها شيء", () => {
    expect(zatcaMissingFields({
      ...base, type: "standard", buyerName: "عميل", buyerVat: "310000000000003",
    })).toEqual([]);
  });
});
