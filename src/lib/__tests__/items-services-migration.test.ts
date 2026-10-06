// تحقق نصي من ترحيلة الأصناف والخدمات v26 وتطابقها مع schema.sql:
//   الجدول، الربط بالنقلات (إلزامي)، دالة الحفظ الآمن، العزل والصلاحيات،
//   وشمول فحص الصحة وإعادة ضبط بيانات الشركة.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migration_items_services_v26.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");
const both = [migration, schema];

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `الدالة ${name} غير موجودة`).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf("as $", start);
  const end = sql.indexOf("$$;", bodyStart);
  return sql.slice(bodyStart, end);
}

describe("ترحيلة الأصناف والخدمات v26", () => {
  it("تنشئ جدول items كنوعين فقط (خدمة بلا مخزون فعلي / صنف مخزني)", () => {
    for (const sql of both) {
      expect(sql).toMatch(/create table if not exists public\.items/i);
      expect(sql).toMatch(/item_type\s+text\s+not null\s+default\s+'service'[\s\S]{0,80}check \(item_type in \('service', 'product'\)\)/i);
      expect(sql).toMatch(/default_price double precision not null default 0 check \(default_price >= 0\)/i);
      expect(sql).toContain("uq_items_company_name");
      expect(sql).toMatch(/on public\.items\(company_id, lower\(name\)\)/i);
      expect(sql).toContain("uq_items_company_code");
      expect(sql).toContain("idx_items_company_type");
      // لا يوجد أي مخزون كميات في الكتالوج (الخدمات لا تحمل رصيداً)
      expect(sql).not.toMatch(/items[\s\S]{0,400}?qty_on_hand/i);
      expect(sql).not.toMatch(/items[\s\S]{0,400}?stock_qty/i);
    }
  });

  it("تربط النقلات بالخدمة مع إبقاء النقلة عند حذف الخدمة", () => {
    // في ملف المخطط: عمود داخل تعريف الجدول
    expect(schema).toMatch(/item_id\s+bigint references public\.items\(id\) on delete set null/i);
    // وفي الترحيلة: إضافة العمود على قاعدة قائمة
    expect(migration).toMatch(
      /alter table public\.invoice_trips add column if not exists item_id bigint\s*\n\s*references public\.items\(id\) on delete set null/i
    );
    expect(migration).toContain("create index if not exists idx_trips_item");
    expect(schema).toContain("idx_trips_item");
  });

  it("تعبّئ خدمة افتراضية وتربط النقلات القديمة بها", () => {
    expect(migration).toMatch(/insert into public\.items[\s\S]*?'ITM-0001'[\s\S]*?where not exists/i);
    expect(migration).toContain("'خدمة نقل'");
    expect(migration).toMatch(/update public\.invoice_trips[\s\S]*?set item_id = \([\s\S]*?order by \(i\.item_type = 'service'\) desc, i\.id/i);
    expect(migration).toMatch(/where t\.item_id is null/i);
  });

  it("تُجعل الخدمة إلزامية داخل save_invoice مع التحقق من ملكيتها للشركة", () => {
    for (const sql of both) {
      const body = functionBody(sql, "save_invoice");
      expect(body).toMatch(/v_item := nullif\(v_trip->>'item_id', ''\)::bigint/i);
      expect(body).toMatch(/if v_item is null then raise exception 'اختر الصنف\/الخدمة لكل نقلة\.'/i);
      expect(body).toMatch(/where id = v_item and company_id = v_cid/i);
      expect(body).toContain("'الصنف/الخدمة المحدد غير موجود.'");
      // الربط في التحديث والإدراج معاً
      expect(body).toMatch(/update public\.invoice_trips set[\s\S]*?item_id\s+= v_item/i);
      expect(body).toMatch(/insert into public\.invoice_trips[\s\S]*?item_id[\s\S]*?v_item/i);
    }
    // التوقيع لم يتغير (توافق الاستدعاءات القائمة)
    for (const sql of both) {
      expect(sql).toContain("revoke execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text)");
      expect(sql).toContain("grant execute on function public.save_invoice(bigint, date, bigint, double precision, text, jsonb, jsonb, text) to authenticated, service_role;");
    }
  });

  it("save_item_v26: تحقق كامل، منع تكرار الاسم، وترقيم آمن للأكواد", () => {
    for (const sql of both) {
      // التوقيع القديم (٧ وسائط) يُسقَط حتى لا يبقى تحميل زائد غامض
      expect(sql).toContain("drop function if exists public.save_item_v26(bigint, text, text, text, double precision, text, text);");
      const body = functionBody(sql, "save_item_v26");
      expect(body).toContain("if v_cid is null then raise exception 'لا توجد شركة مرتبطة بحسابك.';");
      expect(body).toMatch(/if not public\.is_company_active\(\) then raise exception/i);
      expect(body).toMatch(/char_length\(v_name\) > 160/i);
      expect(body).toMatch(/v_type not in \('service', 'product'\)/i);
      expect(body).toMatch(/coalesce\(p_default_price, 0\) < 0/i);
      expect(body).toMatch(/coalesce\(p_default_price, 0\) > 999999999999/i);
      expect(body).toMatch(/char_length\(btrim\(coalesce\(p_unit, ''\)\)\) > 40/i);
      expect(body).toMatch(/lower\(name\) = lower\(v_name\)/i);
      expect(body).toContain("'يوجد صنف/خدمة بنفس الاسم.'");
      // قفل صف الشركة قبل الترقيم (منع سباق الأكواد)
      expect(body).toMatch(/perform 1 from public\.companies where id = v_cid for update/i);
      expect(body).toMatch(/regexp_replace\(code, '\\D', '', 'g'\)/i);
      expect(body).toMatch(/exit when not exists \(/i);
      expect(body).toMatch(/update public\.items set code = v_code where id = v_id/i);
      expect(body).toMatch(/if not found then raise exception 'الصنف\/الخدمة غير موجود\.'/i);
      expect(body).toContain("perform public.log_activity('item.save', 'item', v_id::text, '');");
    }
    for (const sql of both) {
      expect(sql).toContain("revoke all on function public.save_item_v26(bigint, text, text, text, double precision, text, text, text, text) from public, anon;");
      expect(sql).toContain("grant execute on function public.save_item_v26(bigint, text, text, text, double precision, text, text, text, text) to authenticated, service_role;");
    }
  });

  it("تخزّن خط الخدمة (من ← إلى) داخل الصنف وتفرضه على النقلة", () => {
    for (const sql of both) {
      // عمودا الخط في الكتالوج
      expect(sql).toMatch(/from_loc\s+text not null default ''/i);
      expect(sql).toMatch(/to_loc\s+text not null default ''/i);
      expect(sql).toContain("idx_items_route");
      // قبول الخط واستكماله في دالة الحفظ
      const itemBody = functionBody(sql, "save_item_v26");
      expect(itemBody).toMatch(/v_from text := btrim\(coalesce\(p_from_loc, ''\)\)/i);
      expect(itemBody).toMatch(/if \(v_from = ''\) <> \(v_to = ''\) then/i);
      expect(itemBody).toContain("أكمل مكان الانطلاق والوصول للخط");
      expect(itemBody).toMatch(/insert into public\.items[\s\S]*?from_loc, to_loc\)/i);
      expect(itemBody).toMatch(/from_loc = v_from,/i);
      // فرض المسار على النقلة داخل save_invoice
      const invBody = functionBody(sql, "save_invoice");
      expect(invBody).toMatch(/select from_loc, to_loc into v_item_from, v_item_to/i);
      expect(invBody).toMatch(/v_from := v_item_from;/i);
      expect(invBody).toMatch(/v_from := btrim\(coalesce\(v_trip->>'from_loc', ''\)\)/i);
      expect(invBody).toMatch(/from_loc\s+= v_from,/i);
      expect(invBody).toContain("أكمل أماكن الانطلاق والوصول لكل نقلة.");
    }
    // الترحيلة تضيف الأعمدة لقاعدة قائمة
    expect(migration).toMatch(/alter table public\.items add column if not exists from_loc text not null default '';/i);
    expect(migration).toMatch(/alter table public\.items add column if not exists to_loc\s+text not null default '';/i);
  });

  it("تعزل الجدول بحسب الشركة وتمنح الصلاحيات بلا anon", () => {
    expect(migration).toContain("alter table public.items enable row level security;");
    expect(migration).toMatch(/create policy tenant_isolation on public\.items for all[\s\S]*?company_id = public\.auth_company_id\(\) and public\.is_company_active\(\)/i);
    expect(migration).toMatch(/create trigger trg_set_company_id before insert on public\.items/i);
    expect(migration).toContain("grant select, insert, update, delete on public.items to authenticated, service_role;");
    expect(migration).toContain("revoke all on public.items from anon;");
    expect(migration).toContain("grant usage, select on sequence public.items_id_seq to authenticated, service_role;");
    // وفي ملف المخطط العام يشمله العزل الجماعي للجداول
    expect(schema).toMatch(/for select to authenticated/i);
    expect(schema).toMatch(/'employee_deductions','deduction_settlements','items'/);
    expect(schema).toMatch(/'purchase_invoices', 'suppliers', 'items'/);
  });

  it("يشمل فحص صحة قاعدة البيانات وإعادة ضبط بيانات الشركة", () => {
    for (const sql of both) {
      expect(sql).toMatch(/admin_database_health_v18/i);
      expect(sql).toMatch(/'save_item_v26'/);
      expect(sql).toMatch(/'items',\s*'year_opening_balances'/);
      expect(sql).toMatch(/'purchase_invoices', 'suppliers', 'items'/);
    }
  });

  it("لا يخلط بين items وجدول بنود المشتريات purchase_items", () => {
    // استعلامات الخدمة تستهدف items فقط: لا يظهر purchase_items في أي استعلام وارد
    const productQueries = migration.match(/from\s+public\.(\w+)/gi) ?? [];
    const names = productQueries.map((m) => m.toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n) => n.includes("purchase_items"))).toBe(false);
    expect(names.some((n) => n.includes("public.items"))).toBe(true);
  });

  it("يطلب من المطوّر تنفيذ الترحيلة عبر ملفها المستقل", () => {
    expect(migration).toMatch(/آمن التكرار|يمكن تنفيذه أكثر من مرة/i);
    expect(migration).toMatch(/--\s*select count\(\*\) as items from public\.items/i);
  });
});
