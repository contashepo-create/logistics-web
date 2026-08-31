import { describe, it, expect, vi } from "vitest";

// rules.ts يستورد supabase عند التحميل — نعطّله لأن الاختبارات هنا خالصة (pure)
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => ({}) } }));

import { roundMoney, txt, ensurePositive, ensureNotBlank, isValidIsoDate, dateInOpenYear, RuleError } from "@/lib/rules";
import type { FinancialYear } from "@/lib/types";

describe("roundMoney", () => {
  it("يقرب لمنزلتين", () => {
    expect(roundMoney(1234.567)).toBe(1234.57);
    expect(roundMoney(1.004)).toBe(1.0);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
  it("يرفض قيماً غير منتهية", () => {
    expect(() => roundMoney(Infinity)).toThrow(RuleError);
    expect(() => roundMoney("abc")).toThrow(RuleError);
  });
  it("يرفض مبالغ فوق السقف", () => {
    expect(() => roundMoney(1_000_000_000_000)).toThrow("النطاق");
  });
  it("يقبل المبلغ الأقصى المسموح", () => {
    expect(roundMoney(999_999_999_999)).toBe(999_999_999_999);
  });
});

describe("txt", () => {
  it("يرفض نصوصاً طويلة جداً", () => {
    expect(() => txt("x".repeat(5001), "الاسم")).toThrow("طويل جداً");
  });
  it("يقبل النص ضمن الحد", () => {
    expect(txt("x".repeat(5000), "الاسم")).toHaveLength(5000);
  });
});

describe("ensurePositive / ensureNotBlank", () => {
  it("ensurePositive يرفض الصفر والسالب", () => {
    expect(() => ensurePositive(0)).toThrow(RuleError);
    expect(() => ensurePositive(-5)).toThrow(RuleError);
    expect(() => ensurePositive(10)).not.toThrow();
  });
  it("ensureNotBlank يرفض الفارغ", () => {
    expect(() => ensureNotBlank("   ", "الاسم")).toThrow(RuleError);
    expect(() => ensureNotBlank("قيمة", "الاسم")).not.toThrow();
  });
});

describe("isValidIsoDate", () => {
  it("يقبل تاريخاً صحيحاً", () => {
    expect(isValidIsoDate("2026-03-05")).toBe(true);
  });
  it("يرفض تاريخاً غير صالح", () => {
    expect(isValidIsoDate("2026-13-40")).toBe(false);
    expect(isValidIsoDate("03/05/2026")).toBe(false);
    expect(isValidIsoDate("abc")).toBe(false);
  });
});

describe("dateInOpenYear", () => {
  const years: FinancialYear[] = [
    { id: 1, year: 2026, date_from: "2026-01-01", date_to: "2026-12-31", status: "open", notes: "" },
  ];
  it("يقبل تاريخاً داخل السنة المفتوحة", () => {
    expect(dateInOpenYear("2026-06-15", years)).toBe(true);
  });
  it("يرفض تاريخاً خارج السنة", () => {
    expect(dateInOpenYear("2027-01-01", years)).toBe(false);
  });
  it("يرمي عند تاريخ غير صالح", () => {
    expect(() => dateInOpenYear("bad", years)).toThrow("تاريخ غير صالح");
  });
});
