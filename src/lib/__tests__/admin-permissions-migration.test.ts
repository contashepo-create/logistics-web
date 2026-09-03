// ترحيلة v20: تحصين صلاحيات لوحة المطوّر وإصلاح «permission denied for table companies»
// وترحيلة v21: إصلاح «permission denied for function admin_reset_company_data_v18»
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migration_admin_permissions_v20.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");
const grantsV21 = readFileSync(join(process.cwd(), "supabase/migration_fix_admin_rpc_grants_v21.sql"), "utf8");
const linterV8 = readFileSync(join(process.cwd(), "supabase/migration_linter_hardening_v8.sql"), "utf8");

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

describe("ترحيلة إصلاح صلاحيات تنفيذ دوال المطوّر v21", () => {
  it("تمنح authenticated صلاحية تنفيذ دالة التصفير ودوال v18 الإدارية", () => {
    expect(grantsV21).toMatch(/admin_reset_company_data_v18/);
    expect(grantsV21).toMatch(/admin_get_company_extras_v18/);
    expect(grantsV21).toMatch(/admin_platform_stats_v18/);
    expect(grantsV21).toMatch(/admin_recent_visitors_v18/);
    expect(grantsV21).toMatch(/admin_database_health_v18/);
    expect(grantsV21).toMatch(/grant execute on function %s to authenticated/);
  });

  it("تسحب EXECUTE من anon/public أولاً ثم تمنحه — المنع الافتراضي باقٍ", () => {
    expect(grantsV21).toMatch(/revoke all on function %s from public, anon, authenticated/);
    expect(grantsV21).toMatch(/rpc_anon text\[\] := array\['is_allowed_email'\]/);
    expect(grantsV21).toMatch(/grant execute on function %s to anon, authenticated/);
  });

  it("تُبقي service_role بكامل الصلاحيات (مسارات الخادم)", () => {
    expect(grantsV21).toMatch(/grant execute on function %s to service_role/);
  });

  it("تضمن ملكية دوال المطوّر لدور مالك الجداول إن وُجد", () => {
    expect(grantsV21).toMatch(/alter function %s owner to postgres/);
  });

  it("تتضمن تحققاً نهائياً بـ has_function_privilege للمطوّر", () => {
    expect(grantsV21).toMatch(/has_function_privilege\('authenticated', p\.oid, 'execute'\)/);
  });
});

describe("ترحيلة v8 لا تسحب صلاحيات دوال v14–v20 عند إعادة تشغيلها", () => {
  // v8 يسحب EXECUTE من authenticated عن كل الدوال ثم يعيده من قائمة ثابتة؛
  // إن حُذف اسم دالة أحدث من القائمة عاد «permission denied for function …».
  const newerRpcFunctions = [
    "register_company_with_year",
    "save_purchase_invoice_v14",
    "delete_purchase_invoice_v14",
    "save_credit_note_for_trips_v16",
    "valid_trip_container_numbers",
    "admin_platform_stats",
    "admin_get_company_extras_v18",
    "admin_reset_company_data_v18",
    "admin_platform_stats_v18",
    "admin_recent_visitors_v18",
    "admin_database_health_v18",
  ];

  it.each(newerRpcFunctions)("قائمة rpc_authenticated في v8 تضم %s", (fn) => {
    // نتحقق من ظهور الاسم بين بداية المصفوفة ونهايتها (قبل السطر rpc_anon)
    const arrayBody = linterV8.match(/rpc_authenticated text\[\] := array\[([\s\S]*?)\n  \];/);
    expect(arrayBody).not.toBeNull();
    expect(arrayBody![1]).toContain(`'${fn}'`);
  });

  it("تشير تعليقات v8 إلى ضرورة إعادة ضبط الصلاحيات عبر v21", () => {
    expect(linterV8).toMatch(/migration_fix_admin_rpc_grants_v21\.sql/);
  });
});
