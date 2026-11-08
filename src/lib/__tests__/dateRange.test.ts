// اختبارات التحقق الموحّد من نطاق التواريخ المستخدم في كل التقارير.
import { describe, it, expect } from "vitest";
import { assertDateRange, isValidDateRange, DATE_RANGE_ERROR } from "@/lib/dateRange";

describe("التحقق من نطاق التواريخ", () => {
  it("يعتبر النطاق صالحاً عندما تكون البداية قبل النهاية أو مساوية لها", () => {
    expect(isValidDateRange("2026-01-01", "2026-12-31")).toBe(true);
    expect(isValidDateRange("2026-05-05", "2026-05-05")).toBe(true);
    expect(() => assertDateRange("2026-01-01", "2026-12-31")).not.toThrow();
  });

  it("يرفض النطاق المعكوس برسالة عربية واضحة", () => {
    expect(isValidDateRange("2026-12-31", "2026-01-01")).toBe(false);
    expect(() => assertDateRange("2026-12-31", "2026-01-01")).toThrow(DATE_RANGE_ERROR);
  });

  it("يعتبر التاريخ الفارغ غير مقيَّد لا خطأً، إلا إذا طُلب إلزامه", () => {
    expect(isValidDateRange("", "2026-01-01")).toBe(true);
    expect(isValidDateRange(null, null)).toBe(true);
    expect(() => assertDateRange("", "2026-01-01")).not.toThrow();
    expect(() => assertDateRange("", "2026-01-01", { required: true })).toThrow();
  });

  it("يرفض التواريخ غير الصالحة (مثل 2026-02-31)", () => {
    expect(() => assertDateRange("2026-02-31", "2026-03-01")).toThrow(/غير صالح/);
    expect(() => assertDateRange("2026-01-01", "abc")).toThrow(/غير صالحة|غير صالح/);
  });
});
