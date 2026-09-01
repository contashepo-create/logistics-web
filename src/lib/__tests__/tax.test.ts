import { describe, it, expect } from "vitest";
import {
  digitsOnly, isValidTaxNumber, isValidCommercialReg, isValidPostalCode, isValidBuildingNo,
  formatNationalAddress, validateTaxProfile, normalizeTaxProfile,
  entityLabel, taxStatusLabel, countryLabel, ENTITY_TYPES, TAX_STATUSES, SA_REGIONS,
} from "@/lib/tax";

describe("تطبيع الأرقام", () => {
  it("يحوّل الأرقام العربية ويحذف غير الرقمي", () => {
    expect(digitsOnly("٣١٢٣٤٥")).toBe("312345");
    expect(digitsOnly("30-01-2345 6789")).toBe("30012345678 9".replace(" ", ""));
    expect(digitsOnly("abc")).toBe("");
  });
});

describe("الرقم الضريبي السعودي", () => {
  it("يقبل 15 رقماً يبدأ وينتهي بـ 3", () => {
    expect(isValidTaxNumber("300000000000003")).toBe(true);
    expect(isValidTaxNumber("٣٠٠٠٠٠٠٠٠٠٠٠٠٠٣")).toBe(true);
  });
  it("يرفض الأطوال والبدايات الخاطئة", () => {
    expect(isValidTaxNumber("30000000000003")).toBe(false);   // 14
    expect(isValidTaxNumber("3000000000000034")).toBe(false); // 16
    expect(isValidTaxNumber("400000000000003")).toBe(false);  // لا يبدأ بـ 3
    expect(isValidTaxNumber("300000000000004")).toBe(false);  // لا ينتهي بـ 3
    expect(isValidTaxNumber("")).toBe(false);
  });
});

describe("بقية المعرّفات الرسمية", () => {
  it("السجل التجاري 10 أرقام", () => {
    expect(isValidCommercialReg("1010101010")).toBe(true);
    expect(isValidCommercialReg("101010101")).toBe(false);
  });
  it("الرمز البريدي 5 أرقام ورقم المبنى 4", () => {
    expect(isValidPostalCode("12345")).toBe(true);
    expect(isValidPostalCode("1234")).toBe(false);
    expect(isValidBuildingNo("1234")).toBe(true);
    expect(isValidBuildingNo("12345")).toBe(false);
  });
});

describe("العنوان الوطني", () => {
  it("يُجمّع الأجزاء بالترتيب ويتخطى الفارغ", () => {
    const out = formatNationalAddress({
      building_no: "1234", street: "طريق الملك فهد", district: "العليا",
      city: "الرياض", postal_code: "12345", additional_no: "6789", region: "الرياض", country: "SA",
    });
    expect(out).toBe("مبنى 1234، طريق الملك فهد، حي العليا، الرياض، 12345، 6789، الرياض");
  });
  it("يُظهر اسم الدولة عند خروجها عن السعودية ويعيد نصاً فارغاً بلا بيانات", () => {
    expect(formatNationalAddress({ city: "دبي", country: "AE" })).toContain("الإمارات");
    expect(formatNationalAddress({})).toBe("");
  });
});

describe("التحقق الشامل من الملف الضريبي", () => {
  it("الملف الفارغ مقبول ما لم يكن الرقم الضريبي مطلوباً", () => {
    expect(validateTaxProfile({})).toEqual([]);
    const req = validateTaxProfile({ tax_status: "taxable" }, { requireTaxNumber: true });
    expect(req.length).toBe(1);
    expect(req[0]).toContain("الرقم الضريبي مطلوب");
  });
  it("المعفى لا يُطالب برقم ضريبي", () => {
    expect(validateTaxProfile({ tax_status: "exempt" }, { requireTaxNumber: true })).toEqual([]);
  });
  it("يجمع كل الأخطاء الشكلية", () => {
    const errs = validateTaxProfile({
      tax_number: "123", commercial_reg: "12", postal_code: "1", building_no: "1", additional_no: "2",
    });
    expect(errs.length).toBe(5);
  });
  it("الملف الصحيح يمر", () => {
    expect(validateTaxProfile({
      tax_number: "300000000000003", commercial_reg: "1010101010",
      postal_code: "12345", building_no: "1234", additional_no: "6789",
    })).toEqual([]);
  });
});

describe("التطبيع قبل الحفظ", () => {
  it("يحوّل الأرقام العربية ويشذّب النصوص", () => {
    const out = normalizeTaxProfile({
      tax_number: "٣٠٠٠٠٠٠٠٠٠٠٠٠٠٣",
      commercial_reg: "10-10-10-10-10",
      city: "  الرياض   الجديدة ",
    });
    expect(out.tax_number).toBe("300000000000003");
    expect(out.commercial_reg).toBe("1010101010");
    expect(out.city).toBe("الرياض الجديدة");
  });
});

describe("المسميات والقوائم", () => {
  it("تُترجم القيم إلى عربية", () => {
    expect(entityLabel("company")).toBe("شركة");
    expect(taxStatusLabel("taxable")).toContain("خاضع");
    expect(countryLabel("SA")).toContain("السعودية");
    expect(countryLabel("XX")).toBe("XX");
  });
  it("القوائم غير فارغة وتغطي مناطق المملكة الثلاث عشرة", () => {
    expect(ENTITY_TYPES.length).toBeGreaterThan(3);
    expect(TAX_STATUSES.length).toBe(3);
    expect(SA_REGIONS.length).toBe(13);
  });
});
