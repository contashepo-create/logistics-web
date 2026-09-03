// ترحيلة v20: تحصين صلاحيات لوحة المطوّر وإصلاح «permission denied for table companies»
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migration_admin_permissions_v20.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");

describe("ترحيلة صلاحيات لوحة المطوّر v20", () => {
  it("تعيد منح الصلاحيات على كل الجداول بشكل صريح", () => {
    expect(migration).toMatch(/grant select, insert, update, delete on all tables in schema public/i);
    expect(migration).toMatch(/to authenticated, service_role/);
    expect(migration).toMatch(/grant usage, select on all sequences/i);
  });

  it("تغطي الجداول الجديدة في v19 ضمن منح الصلاحيات والتصفير", () => {
    expect(migration).toContain("employee_deductions");
    expect(migration).toContain("deduction_settlements");
  });

  it("تعيد إنشاء دوال المطوّر كـ SECURITY DEFINER مع صلاحيات التنفيذ", () => {
    expect(migration).toContain("admin_set_company_feature");
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/grant execute on function public\.admin_set_company_feature[\s\S]*to authenticated, service_role/i);
    expect(migration).toMatch(/grant execute on function public\.admin_set_company_status[\s\S]*to authenticated, service_role/i);
  });

  it("تمنح ملكية الدوال لدور مالك الجداول إن وُجد", () => {
    expect(migration).toMatch(/alter function[\s\S]*owner to postgres/i);
  });

  it("دالة التصفير تشمل جداول الخصومات الجديدة", () => {
    expect(migration).toMatch(/admin_reset_company_data_v18[\s\S]*employee_deductions/);
    expect(schema).toMatch(/admin_reset_company_data_v18[\s\S]*employee_deductions/);
  });
});
