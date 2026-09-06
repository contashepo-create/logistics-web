import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migration_multi_company_users_v25.sql"),
  "utf8",
);

describe("ترحيلة تعدّد المستخدمين الإضافيين v25", () => {
  it("ترفع القيد المصطنع القديم وتُبقي «مالك واحد لكل شركة»", () => {
    expect(sql).toMatch(/drop index if exists public\.uq_profiles_one_additional_per_company/i);
    expect(sql).toMatch(/create unique index if not exists uq_profiles_one_owner_per_company/i);
    // لا يجوز إعادة إنشاء الفهرس الفريد للمستخدم الإضافي.
    expect(sql).not.toMatch(/create unique index[^;]*uq_profiles_one_additional_per_company/i);
  });

  it("تضيف حد المستخدمين لكل شركة بقيمة افتراضية لا تغيّر السلوك القائم", () => {
    expect(sql).toMatch(/add column if not exists max_additional_users int not null default 1/i);
    expect(sql).toMatch(/check \(max_additional_users between 0 and 10\)/i);
  });

  it("تفرض الحد بمشغّل مع قفل يمنع سباق الطلبات المتزامنة", () => {
    expect(sql).toMatch(/create or replace function public\.enforce_additional_user_limit/i);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\('company-users:/i);
    expect(sql).toMatch(/create trigger trg_profiles_additional_limit/i);
    expect(sql).toContain("بلغت هذه الشركة الحد المسموح به للمستخدمين الإضافيين");
  });

  it("لا تحسب الصف الجاري ضمن العدد حتى لا يفشل التحديث على نفسه", () => {
    expect(sql).toMatch(/p\.id <> new\.id/);
  });

  it("تحمي RPC ضبط الحد بفحص المطوّر وترفض خفضه دون العدد القائم", () => {
    expect(sql).toMatch(/create or replace function public\.admin_set_company_user_limit_v25/i);
    expect(sql).toMatch(/if not public\.is_admin\(\) then raise exception/i);
    expect(sql).toMatch(/revoke all on function public\.admin_set_company_user_limit_v25\(uuid, int\) from public, anon/i);
    expect(sql).toContain("احذف الزائد قبل خفض الحد");
  });

  it("تُرجع الحد والاستهلاك في لقطة الشركة للوحة المطوّر", () => {
    expect(sql).toMatch(/create or replace function public\.admin_get_company_extras_v18/i);
    expect(sql).toMatch(/'max_additional_users'/);
    expect(sql).toMatch(/'used_additional_users'/);
    expect(sql).toMatch(/'active_additional_users'/);
  });

  it("لا تمسّ أي جدول تشغيلي ولا تحذف بيانات", () => {
    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/delete from/i);
    expect(sql).not.toMatch(/truncate/i);
  });

  it("آمنة لإعادة التشغيل داخل معاملة واحدة", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/add column if not exists/i);
    expect(sql).toMatch(/drop trigger if exists/i);
  });
});
