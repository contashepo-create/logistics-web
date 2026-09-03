import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const purchases = readFileSync("supabase/migration_cash_purchases_advances_v14.sql", "utf8");
const years = readFileSync("supabase/migration_year_rollover_and_notes.sql", "utf8");
const tripReturns = readFileSync("supabase/migration_credit_note_trip_returns_v16.sql", "utf8");

describe("نتائج تدقيق قاعدة البيانات", () => {
  it("يحذف اسمي قيد نوع سند الدفع القديم حتى لا يُرفض purchase", () => {
    expect(purchases).toContain("drop constraint if exists payment_vouchers_voucher_type_chk");
    expect(purchases).toContain("drop constraint if exists payment_vouchers_voucher_type_check");
    expect(purchases).toContain("'purchase'");
  });

  it("يمنع الشركة الموقوفة من حفظ المشتريات أو حذفها", () => {
    const activeGuards = purchases.match(/not public\.is_company_active\(\)/g) ?? [];
    expect(activeGuards.length).toBeGreaterThanOrEqual(2);
  });

  it("يمنع الشركة الموقوفة من إنشاء سنة مالية جديدة", () => {
    expect(years).toContain("not public.is_company_active()");
  });

  it("يمنح مفتاح الخدمة sequence جدول مرتجع النقلات الجديد", () => {
    expect(tripReturns).toContain(
      "grant usage, select on sequence public.credit_note_trips_id_seq to service_role",
    );
  });
});
