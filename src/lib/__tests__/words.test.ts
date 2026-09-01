import { describe, it, expect } from "vitest";
import { numberToArabicWords, amountToArabicWords } from "@/lib/format";

describe("تفقيط المبالغ بالعربية", () => {
  it("الأعداد الأساسية", () => {
    expect(numberToArabicWords(0)).toBe("صفر");
    expect(numberToArabicWords(7)).toBe("سبعة");
    expect(numberToArabicWords(15)).toBe("خمسة عشر");
    expect(numberToArabicWords(21)).toBe("واحد وعشرون");
    expect(numberToArabicWords(100)).toBe("مائة");
    expect(numberToArabicWords(345)).toBe("ثلاثمائة وخمسة وأربعون");
  });
  it("الآلاف والملايين", () => {
    expect(numberToArabicWords(1000)).toBe("ألف");
    expect(numberToArabicWords(2000)).toBe("ألفان");
    expect(numberToArabicWords(4500)).toBe("أربعة آلاف وخمسمائة");
    expect(numberToArabicWords(1000000)).toBe("مليون");
    expect(numberToArabicWords(2500000)).toContain("مليونان");
  });
  it("تفقيط مبلغ بالعملة والكسور", () => {
    expect(amountToArabicWords(4500)).toBe("أربعة آلاف وخمسمائة جنيه فقط لا غير");
    expect(amountToArabicWords(1200.5)).toContain("خمسون قرش");
    expect(amountToArabicWords(0)).toBe("صفر جنيه فقط لا غير");
    expect(amountToArabicWords(150, "ريال", "هللة")).toBe("مائة وخمسون ريال فقط لا غير");
  });
});
