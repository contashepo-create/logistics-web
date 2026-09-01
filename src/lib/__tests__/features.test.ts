import { describe, expect, it } from "vitest";
import { isCompanyOwner, shouldWarnTaxInvoice, TAX_INVOICE_WARNING } from "@/lib/features";
import { DEFAULT_PRINT_SETTINGS } from "@/lib/print";

describe("المميزات الإضافية — الفاتورة الضريبية", () => {
  it("الباركود متوقف افتراضياً لكل شركة", () => {
    expect(DEFAULT_PRINT_SETTINGS.invoice_show_barcode).toBe(false);
  });

  it("يحذر المالك عند وجود ضريبة والميزة متوقفة", () => {
    expect(shouldWarnTaxInvoice({
      featureEnabled: false,
      vatRate: 15,
      profile: { role: "owner" },
    })).toBe(true);
  });

  it("لا يحذر المستخدم الإضافي", () => {
    expect(shouldWarnTaxInvoice({
      featureEnabled: false,
      vatRate: 15,
      profile: { role: "additional" },
    })).toBe(false);
  });

  it("لا يحذر عند تفعيل المطوّر للميزة أو عند عدم وجود ضريبة", () => {
    expect(shouldWarnTaxInvoice({ featureEnabled: true, vatRate: 15, profile: { role: "owner" } })).toBe(false);
    expect(shouldWarnTaxInvoice({ featureEnabled: false, vatRate: 0, profile: { role: "owner" } })).toBe(false);
  });

  it("السجل القديم بلا role يُعامل كمالك", () => {
    expect(isCompanyOwner({})).toBe(true);
  });

  it("نص التحذير يذكر الحساب وعدم مطابقة زاتكا", () => {
    expect(TAX_INVOICE_WARNING).toContain("تحسب قيمة الضريبة");
    expect(TAX_INVOICE_WARNING).toContain("لا تطابق");
    expect(TAX_INVOICE_WARNING).toContain("زاتكا");
  });
});
