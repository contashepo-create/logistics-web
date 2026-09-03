import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migration_credit_note_trip_returns_v16.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");

describe("ترحيلة مرتجع النقلات في الإشعار الدائن v16", () => {
  it("تنشئ جدول الربط وتمنع إرجاع النقلة نفسها مرتين", () => {
    for (const sql of [migration, schema]) {
      expect(sql).toContain("credit_note_trips");
      expect(sql).toContain("uq_credit_note_trips_one_return_per_trip");
      expect(sql).toMatch(/credit_note_id bigint not null references public\.credit_debit_notes\(id\) on delete cascade/i);
    }
  });

  it("تحسب مبلغ النقلات وضريبة الفاتورة داخل RPC ذرية", () => {
    expect(migration).toContain("save_credit_note_for_trips_v16");
    expect(migration).toMatch(/sum\(t\.price\)/i);
    expect(migration).toMatch(/i\.vat_rate/i);
    expect(migration).toMatch(/insert into public\.credit_debit_notes[\s\S]*insert into public\.credit_note_trips/i);
    expect(migration).not.toMatch(/p_amount|p_vat_rate/i);
  });

  it("تقصر كتابة روابط المرتجع على RPC وتسمح للمستخدم بالقراءة فقط", () => {
    expect(migration).toMatch(/revoke insert, update, delete on public\.credit_note_trips from authenticated/i);
    expect(migration).toMatch(/grant select on public\.credit_note_trips to authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.save_credit_note_for_trips_v16[\s\S]*to authenticated/i);
  });
});
