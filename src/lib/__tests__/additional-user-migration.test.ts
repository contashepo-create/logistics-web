import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migration_fix_additional_user_creation_v24.sql"),
  "utf8",
);

describe("ترحيلة إصلاح إنشاء المستخدم الإضافي v24", () => {
  it("تنشئ جدول تذاكر الإنشاء الخادمية مع RLS ومنع الأدوار العامة", () => {
    expect(sql).toMatch(/create table if not exists public\.managed_signups/i);
    expect(sql).toMatch(/alter table public\.managed_signups enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.managed_signups from public, anon, authenticated/i);
    expect(sql).toMatch(/grant .*insert.* on public\.managed_signups to service_role/i);
  });

  it("لا تعتمد على app_metadata وحدها لتمييز المستخدم الإضافي", () => {
    // جوهر الإصلاح: GoTrue تكتب app_metadata بعد الإدراج، فالتذكرة هي المصدر.
    expect(sql).toMatch(/update public\.managed_signups/i);
    expect(sql).toMatch(/consumed_at\s*=\s*now\(\)/i);
    expect(sql).toMatch(/expires_at\s*>\s*now\(\)/i);
    expect(sql).toMatch(/if found then managed := true/i);
  });

  it("تُبقي تحققات المالك على التسجيل العادي فقط", () => {
    expect(sql).toMatch(/if managed then\s*\n\s*return new;/i);
    expect(sql).toContain("رقم الهاتف مستخدم بالفعل في حساب آخر.");
    expect(sql).toContain("اسم الشركة مطلوب ويجب أن يكون حقيقياً.");
    expect(sql).toContain("تاريخا السنة المالية مطلوبان وصحيحان.");
  });

  it("تسمح للمستخدم الإضافي بمشاركة بيانات اتصال شركته نفسها", () => {
    expect(sql).toMatch(/create or replace function public\.guard_unique_account_contact/i);
    expect(sql).toMatch(/c\.id is distinct from new\.company_id/i);
    // الشرط القديم كان يرفض role = 'additional' دائماً.
    expect(sql).not.toMatch(/new\.role <> 'owner'/i);
  });

  it("تمنح دور خدمة المصادقة صلاحية تنفيذ دوال المشغّل وتعيد تركيبه", () => {
    expect(sql).toContain("supabase_auth_admin");
    expect(sql).toMatch(/grant execute on function public\.enforce_signup_metadata\(\) to supabase_auth_admin/i);
    expect(sql).toMatch(/create trigger trg_auth_users_signup_metadata before insert on auth\.users/i);
  });

  it("آمنة لإعادة التشغيل داخل معاملة واحدة", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/create table if not exists/i);
    expect(sql).toMatch(/drop trigger if exists/i);
  });
});
