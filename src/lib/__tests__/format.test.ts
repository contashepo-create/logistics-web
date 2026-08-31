import { describe, it, expect } from "vitest";
import { normalizeDigits, parseFloatSafe, money, monthName, periodLabel, clean, todayIso } from "@/lib/format";

describe("normalizeDigits", () => {
  it("يحول الأرقام العربية", () => {
    expect(normalizeDigits("١٢٣٤٥٦٧٨٩٠")).toBe("1234567890");
  });
  it("يحول الأرقام الفارسية", () => {
    expect(normalizeDigits("۱۲۳")).toBe("123");
  });
  it("يعيد نصاً فارغاً للقيمة null", () => {
    expect(normalizeDigits(null)).toBe("");
  });
});

describe("parseFloatSafe", () => {
  it("يقرأ أرقاماً بفواصل آلاف", () => {
    expect(parseFloatSafe("1,234.56")).toBe(1234.56);
  });
  it("يقبل الفاصلة العشرية العربية", () => {
    expect(parseFloatSafe("١٢٣٫٤٥")).toBeCloseTo(123.45);
  });
  it("يقبل أرقاماً عربية", () => {
    expect(parseFloatSafe("١٢٣")).toBe(123);
  });
  it("يُرجع القيمة الافتراضية للنص الفارغ", () => {
    expect(parseFloatSafe("", 7)).toBe(7);
  });
  it("يرمي عند قيمة غير رقمية", () => {
    expect(() => parseFloatSafe("abc")).toThrow("قيمة رقمية غير صالحة");
  });
});

describe("money", () => {
  it("يُنسق بمنزلتين", () => {
    expect(money(1234.5)).toBe("1,234.50");
  });
  it("يعالج قيماً غير رقمية بأمان", () => {
    expect(money("abc")).toBe("0.00");
  });
});

describe("monthName / periodLabel", () => {
  it("يُرجع اسم الشهر", () => {
    expect(monthName(3)).toBe("مارس");
  });
  it("يعالج شهراً خارج النطاق", () => {
    expect(monthName(13)).toBe("13");
  });
  it("يُرجع تسمية الفترة", () => {
    expect(periodLabel(2026, 3)).toBe("مارس 2026");
  });
});

describe("clean / todayIso", () => {
  it("يزيل الفراغات الزائدة", () => {
    expect(clean("  أ  ب   ج  ")).toBe("أ ب ج");
  });
  it("todayIso بصيغة صحيحة", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
