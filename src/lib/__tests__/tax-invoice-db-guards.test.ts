// تحقق نصي من بوابة ميزة الفاتورة الضريبية (tax_invoice) على مستوى قاعدة البيانات:
//   • عند التفعيل: الفاتورة لا تُعدَّل (save_invoice) ولا تُحذف (trigger).
//   • عند الإيقاف: لا تُنشأ إشعارات مدين/دائن جديدة (trigger على الإدراج فقط).
//   • الدالتان invoker (بلا security definer) كي يرى is_admin() الدور الحقيقي،
//     مع استثناء مسارات المطوّر/service_role (تصفير أو حذف شركة) من الاعتراض.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(join(process.cwd(), "supabase/migration_items_services_v26.sql"), "utf8");
const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");
const both = [schema, migration];

function functionBlock(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `الدالة ${name} غير موجودة`).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf("as $$", start);
  const end = sql.indexOf("$$;", bodyStart);
  return sql.slice(start, end);
}

describe("بوابة الفاتورة الضريبية في قاعدة البيانات (v26)", () => {
  it("تمنع تعديل الفاتورة داخل save_invoice عند تفعيل الميزة", () => {
    for (const sql of both) {
      const start = sql.indexOf("create or replace function public.save_invoice(");
      const bodyStart = sql.indexOf("as $$", start);
      const end = sql.indexOf("$$;", bodyStart);
      const body = sql.slice(bodyStart, end);
      const notFound = body.indexOf("'الفاتورة غير موجودة.'");
      const guard = body.indexOf("if public.has_company_feature('tax_invoice') then");
      expect(notFound).toBeGreaterThan(-1);
      expect(guard).toBeGreaterThan(notFound); // البوابة بعد التحقق من وجود الفاتورة
      expect(body).toContain("'الفاتورة الضريبية لا تقبل التعديل بعد إصدارها. أنشئ إشعاراً دائناً أو مديناً للتصحيح.'");
    }
  });

  it("تمنع حذف الفاتورة بمُشغِّل قبل الحذف مع رسالة واضحة", () => {
    for (const sql of both) {
      expect(sql).toContain("create or replace function public.guard_invoice_tax_delete() returns trigger");
      expect(sql).toMatch(/drop trigger if exists trg_invoice_tax_delete on public\.invoices;/);
      expect(sql).toMatch(/create trigger trg_invoice_tax_delete\s*\n\s*before delete on public\.invoices\s*\n\s*for each row execute function public\.guard_invoice_tax_delete\(\);/);
      const block = functionBlock(sql, "guard_invoice_tax_delete");
      expect(block).toContain("public.has_company_feature('tax_invoice')");
      expect(block).toContain("raise exception 'لا يمكن حذف فاتورة ضريبية بعد إصدارها. استخدم إشعاراً دائناً أو مديناً للتصحيح.'");
      // استثناء المطوّر/service_role حتى لا تتعطّل مسارات الإدارة (تصفير/حذف شركة)
      expect(block).toContain("if public.is_admin() then return old; end if;");
    }
  });

  it("تمنع إنشاء إشعارات جديدة عند إيقاف الميزة (الإدراج فقط، والقديم يبقى)", () => {
    for (const sql of both) {
      expect(sql).toContain("create or replace function public.guard_credit_note_tax_feature() returns trigger");
      expect(sql).toMatch(/drop trigger if exists trg_credit_note_tax_feature on public\.credit_debit_notes;/);
      expect(sql).toMatch(/create trigger trg_credit_note_tax_feature\s*\n\s*before insert on public\.credit_debit_notes\s*\n\s*for each row execute function public\.guard_credit_note_tax_feature\(\);/);
      // لا يُمنع التحديث أو الحذف للإشعارات القديمة (تبقى مؤثرة وقابلة للإدارة)
      expect(sql).not.toMatch(/trg_credit_note_tax_feature[\s\S]{0,80}before insert or update/);
      const block = functionBlock(sql, "guard_credit_note_tax_feature");
      expect(block).toContain("if not public.has_company_feature('tax_invoice') then");
      expect(block).toContain("raise exception 'إشعارات المدين والدائن متاحة فقط عند تفعيل الفاتورة الضريبية بالباركود. عدّل الفاتورة أو احذفها للتصحيح.'");
      expect(block).toContain("if public.is_admin() then return new; end if;");
    }
  });

  it("الدالتان بصلاحية المُنفِّذ (invoker) لا security definer", () => {
    for (const sql of both) {
      for (const name of ["guard_invoice_tax_delete", "guard_credit_note_tax_feature"]) {
        const block = functionBlock(sql, name);
        expect(block).toContain("language plpgsql set search_path = public as $$");
        expect(block).not.toContain("security definer");
      }
    }
  });
});
