import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migration_trip_container_numbers_v17.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");

describe("ترحيلة أرقام حاويات النقلات v17", () => {
  it("تضيف المصفوفة إلى النقلة وتربط صلاحيتها بكمية النقلة", () => {
    for (const sql of [migration, schema]) {
      expect(sql).toMatch(/container_numbers\s+jsonb\s+not null\s+default\s+'\[\]'::jsonb/i);
      expect(sql).toContain("valid_trip_container_numbers(container_numbers, qty)");
      expect(sql).toMatch(/jsonb_array_length\(p_numbers\)\s*>\s*p_qty/i);
    }
  });

  it("تمنع دالة التحقق القيم غير النصية والفارغة والمكررة", () => {
    for (const sql of [migration, schema]) {
      expect(sql).toMatch(/jsonb_typeof\(v_item\)\s*<>\s*'string'/i);
      expect(sql).toMatch(/v_value\s*=\s*''/i);
      expect(sql).toMatch(/v_key\s*=\s*any\(v_seen\)/i);
    }
  });

  it("يعيد save_invoice التحقق ويحفظ الأرقام المنظفة ذرياً مع كل نقلة", () => {
    expect(migration).toMatch(/create or replace function public\.save_invoice/i);
    expect(migration).toMatch(/v_seen_containers[\s\S]*مكرر داخل الفاتورة/i);
    expect(migration).toMatch(/container_numbers\s*=\s*v_normalized_containers/i);
    expect(migration).toMatch(/insert into public\.invoice_trips[\s\S]*container_numbers/i);
    expect(migration).toMatch(/security definer set search_path = public, pg_temp/i);
  });
});
