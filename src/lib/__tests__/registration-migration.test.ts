import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(process.cwd(), "supabase/migration_registration_validation_v13.sql"), "utf8");
const openYearFixSql = readFileSync(join(process.cwd(), "supabase/migration_fix_voucher_open_year_v15.sql"), "utf8");

describe("ترحيلة التسجيل والتحقق v13", () => {
  it("تنشئ الشركة والملف والسنة المالية داخل RPC واحدة وتوقف المسار القديم", () => {
    expect(sql).toContain("register_company_with_year");
    expect(sql).toMatch(/insert into public\.companies/i);
    expect(sql).toMatch(/insert into public\.profiles/i);
    expect(sql).toMatch(/insert into public\.financial_years/i);
    expect(sql).toMatch(/revoke all on function public\.register_company\(text, text, text\)/i);
  });

  it("تمنع تكرار البريد والهاتف للحسابات والعملاء", () => {
    expect(sql).toContain("uq_companies_phone_normalized");
    expect(sql).toContain("uq_profiles_email_normalized");
    expect(sql).toContain("uq_customers_company_phone_normalized");
    expect(sql).toContain("trg_customers_unique_contact");
    expect(sql).toContain("raw_app_meta_data");
  });

  it("تضيف حراسة نصية ورقمية وتفرض السنة المفتوحة", () => {
    expect(sql).toContain("guard_text_fields");
    expect(sql).toContain("looks_malicious_text");
    expect(sql).toContain("guard_movement_open_year");
    expect(sql).toContain("ck_v13_payment_values");
    expect(sql).toContain("ck_v13_print_settings_object");
    expect(sql).toContain("guard_company_print_settings");
    expect(sql).toContain("guard_app_settings_json");
    expect(sql).toContain("jsonb_array_elements");
  });

  it("لا يعتمد حارس السنة على company_id قبل أن يملأه مشغّل الشركة", () => {
    for (const migration of [sql, openYearFixSql]) {
      expect(migration).toMatch(/v_company_id uuid := public\.auth_company_id\(\)/i);
      expect(migration).toMatch(/new\.company_id := v_company_id/i);
      expect(migration).toMatch(/y\.company_id = v_company_id/i);
      expect(migration).not.toMatch(/y\.company_id = new\.company_id/i);
    }
  });
});
