// اختبارات طبقة الأمان: البريد المسموح، التعقيم، منع الحقن، الرموز العشوائية
import { describe, it, expect } from "vitest";
import {
  checkSignupEmail, checkPassword, sanitizeText, escapeHtml, looksMalicious,
  safeField, safePhone, generateClientCode, generateTicketCode,
  isValidClientCode, isValidTicketCode, normalizeCode, CODE_ALPHABET,
} from "@/lib/security";

describe("قبول البريد الإلكتروني", () => {
  it("يقبل مزوّدي البريد المسموح بهم فقط", () => {
    for (const e of ["a.b@gmail.com", "x@yahoo.com", "y@hotmail.com", "z@outlook.com", "w@icloud.com", "q@me.com"]) {
      expect(checkSignupEmail(e).ok).toBe(true);
    }
  });
  it("يرفض النطاقات الأخرى والشركات", () => {
    for (const e of ["a@mycompany.com", "a@example.org", "a@gmail.co", "a@gmail.com.evil.io"]) {
      expect(checkSignupEmail(e).ok).toBe(false);
    }
  });
  it("يرفض البريد المؤقت/الوهمي", () => {
    for (const e of ["a@mailinator.com", "a@yopmail.com", "a@10minutemail.com", "a@temp-mail.org", "a@1secmail.com"]) {
      const r = checkSignupEmail(e);
      expect(r.ok).toBe(false);
      expect(r.message).toContain("وهمي");
    }
  });
  it("يرفض الصيغ المشوّهة ومحاولات الحقن", () => {
    for (const e of ["", "no-at", "a b@gmail.com", "a@@gmail.com", "a..b@gmail.com", "a'@gmail.com", "<x>@gmail.com"]) {
      expect(checkSignupEmail(e).ok).toBe(false);
    }
  });
  it("يطبّع البريد (حروف صغيرة وبلا مسافات)", () => {
    expect(checkSignupEmail("  Ahmed.Ali@GMAIL.com ").email).toBe("ahmed.ali@gmail.com");
  });
});

describe("سياسة كلمة المرور", () => {
  it("ترفض القصيرة والشائعة وبلا أرقام", () => {
    expect(checkPassword("abc").ok).toBe(false);
    expect(checkPassword("12345678").ok).toBe(false);
    expect(checkPassword("password").ok).toBe(false);
    expect(checkPassword("abcdefgh").ok).toBe(false);
  });
  it("تقبل كلمة قوية", () => {
    expect(checkPassword("Ahmed2026x").ok).toBe(true);
  });
});

describe("تعقيم المدخلات", () => {
  it("يزيل وسوم HTML ومحارف التحكم", () => {
    expect(sanitizeText("<b>مرحبا</b>")).not.toContain("<");
    expect(sanitizeText("a\u0000b\u202Ec")).toBe("abc");
  });
  it("يقصّ الطول", () => {
    expect(sanitizeText("x".repeat(5000), 100).length).toBe(100);
  });
  it("escapeHtml يمنع كسر السياق", () => {
    expect(escapeHtml('<script>"x"</script>')).toBe("&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  });
  it("looksMalicious يكشف أنماط الحقن الشائعة", () => {
    const bad = [
      "<script>alert(1)</script>",
      "javascript:alert(1)",
      "' OR 1=1; DROP TABLE users--",
      "1 UNION SELECT password FROM profiles",
      "<img src=x onerror=alert(1)>",
      "../../../../etc/passwd",
      "${process.env.SECRET}",
    ];
    for (const b of bad) expect(looksMalicious(b)).toBe(true);
    expect(looksMalicious("عندي مشكلة في الفاتورة رقم 25 من فضلك")).toBe(false);
  });
  it("safeField يرفض المحتوى الخبيث ويفرض الطول", () => {
    expect(() => safeField("<script>x</script>", { label: "الاسم" })).toThrow();
    expect(() => safeField("", { label: "الاسم", required: true })).toThrow();
    expect(() => safeField("ab", { label: "الاسم", min: 3 })).toThrow();
    expect(safeField("  أحمد  ", { label: "الاسم" })).toBe("أحمد");
  });
  it("safePhone ينظّف الأرقام", () => {
    expect(safePhone("+20 100 <b>123</b> 4567")).toBe("+20 100 b 123 /b 4567".replace(/[^\d+\s-]/g, "").trim());
    expect(() => safePhone("12", true)).toThrow();
  });
});

describe("الأرقام الفريدة", () => {
  it("رقم العميل 8 خانات من أبجدية غير ملتبسة", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateClientCode();
      expect(c).toHaveLength(8);
      expect(isValidClientCode(c)).toBe(true);
      expect(/[01OIL]/.test(c)).toBe(false);
    }
  });
  it("لا تكرار ولا تتابع بين الأرقام المولّدة", () => {
    const set = new Set<string>();
    for (let i = 0; i < 2000; i++) set.add(generateClientCode());
    expect(set.size).toBeGreaterThan(1990);           // عشوائية عالية
    const a = generateClientCode(), b = generateClientCode();
    expect(a).not.toBe(b);
  });
  it("رقم الشكوى بصيغة CT- وعشرة محارف", () => {
    const t = generateTicketCode();
    expect(isValidTicketCode(t)).toBe(true);
    expect(t.startsWith("CT-")).toBe(true);
    expect(t.length).toBe(13);
  });
  it("يرفض الأرقام المزوّرة أو المعدّلة يدوياً", () => {
    expect(isValidClientCode("ABC")).toBe(false);
    expect(isValidClientCode("ABCD01IL")).toBe(false);   // محارف ممنوعة
    expect(isValidTicketCode("CT-123")).toBe(false);
    expect(isValidTicketCode("XX-ABCDEFGHJK")).toBe(false);
  });
  it("normalizeCode يوحّد الإدخال", () => {
    expect(normalizeCode("  ct-abcdefghjk ")).toBe("CT-ABCDEFGHJK");
  });
  it("مساحة المفاتيح كبيرة بما يكفي ضد التخمين", () => {
    // 30^8 ≈ 6.5×10^11 احتمال لرقم العميل
    expect(Math.pow(CODE_ALPHABET.length, 8)).toBeGreaterThan(1e11);
  });
});
