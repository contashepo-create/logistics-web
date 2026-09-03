import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPermissionError, translateDbError } from "../db";

const ROOT = process.cwd(); // vitest يعمل من جذر المشروع

// الأعمدة التشغيلية التي تحفظها شاشة «الإعدادات ← بيانات الشركة» + الطباعة
const EXPECTED_COLUMNS = [
  "name", "name_en", "phone", "email", "website", "address",
  "currency", "vat_rate", "vat_note",
  "tax_number", "commercial_reg", "unified_number",
  "entity_type", "tax_status",
  "country", "region", "city", "district", "street",
  "building_no", "postal_code", "additional_no", "address_note",
  "print_settings",
];

function grantColumns(file: string): string[] {
  const sql = readFileSync(join(ROOT, "supabase", file), "utf8");
  const re = /grant\s+update\s*\(([^)]+)\)\s+on\s+public\.companies\s+to\s+authenticated\s*;/gi;
  const columns = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    for (const col of m[1].split(",")) {
      const c = col.trim();
      if (c) columns.add(c.toLowerCase());
    }
  }
  return [...columns];
}

describe("صلاحيات تعديل بيانات الشركة (companies)", () => {
  it("يمنح authenticated كل أعمدة الإعدادات التشغيلية في schema.sql", () => {
    const granted = grantColumns("schema.sql");
    for (const col of EXPECTED_COLUMNS) {
      expect(granted).toContain(col);
    }
  });

  it("ملف إصلاح الصلاحيات migration_fix_company_updates.sql يمنح نفس الأعمدة", () => {
    const granted = grantColumns("migration_fix_company_updates.sql");
    for (const col of EXPECTED_COLUMNS) {
      expect(granted).toContain(col);
    }
  });

  it("ملف الإصلاح يلغي أي أعمدة تحديث سابقة قبل منح القائمة المحددة", () => {
    const sql = readFileSync(join(ROOT, "supabase", "migration_fix_company_updates.sql"), "utf8");
    expect(sql).toMatch(/revoke update on public\.companies from authenticated;?/i);
    expect(sql).toMatch(/service_role/);
  });
});

describe("ترجمة أخطاء قاعدة البيانات", () => {
  it("يتعرّف على خطأ permission denied / row-level security", () => {
    expect(isPermissionError("permission denied for table companies")).toBe(true);
    expect(isPermissionError("new row violates row-level security policy")).toBe(true);
    expect(isPermissionError("syntax error")).toBe(false);
  });

  it("يعيد رسالة عربية تدل على ملف الإصلاح عند خطأ الصلاحيات", () => {
    const msg = translateDbError("permission denied for table companies");
    expect(msg).toMatch(/migration_fix_company_updates\.sql/);
  });

  it("يعيد رسالة مناسبة عند نقص الجداول أو الأعمدة أو الدوال", () => {
    expect(translateDbError('column "print_settings" of relation "companies" does not exist')).toMatch(/قاعدة البيانات غير محدّثة/);
    expect(translateDbError('relation "credit_note_trips" does not exist')).toMatch(/قاعدة البيانات غير محدّثة/);
    expect(translateDbError("function register_company does not exist")).toMatch(/قاعدة البيانات غير محدّثة/);
  });
});
