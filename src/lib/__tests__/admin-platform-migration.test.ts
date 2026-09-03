import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migration_admin_platform_tools_v18.sql", "utf8");

function functionBody(name: string, nextMarker: string): string {
  const start = migration.indexOf(`function public.${name}`);
  const end = migration.indexOf(nextMarker, start);
  return migration.slice(start, end < 0 ? undefined : end);
}

describe("ترحيلة منصة المطوّر v18", () => {
  it("تصفّر كل جداول العمل المعروفة وتحافظ على سجلات المنصة", () => {
    const body = functionBody("admin_reset_company_data_v18", "-- ---------------------------------------------------------------------------\n-- نظرة المنصة");
    for (const table of [
      "customers", "invoices", "invoice_trips", "trip_expenses", "suppliers",
      "purchase_invoices", "purchase_items", "employees", "payrolls", "vehicles",
      "receipt_vouchers", "payment_vouchers", "advance_settlements", "financial_years",
    ]) expect(body).toContain(`'${table}'`);
    expect(body).toContain("insert into public.financial_years");
    expect(body).not.toMatch(/delete from public\.(companies|profiles|company_features|activation_requests|support_messages|complaints)/);
  });

  it("مؤشرات النظرة لا تحسب عمليات العملاء أو مبالغهم", () => {
    const body = functionBody("admin_platform_stats_v18", "create or replace function public.admin_recent_visitors_v18");
    expect(body).not.toContain("public.customers");
    expect(body).not.toContain("public.invoices");
    expect(body).not.toContain("public.invoice_trips");
    expect(body).not.toMatch(/revenue|collected|spent|salaries/);
    expect(migration).toMatch(/function public\.admin_platform_stats\(\)[\s\S]*return public\.admin_platform_stats_v18\(\)/);
  });

  it("سجل النشاط يفرض actor_id للمستخدم الحالي", () => {
    expect(migration).toMatch(/create policy activity_read[\s\S]*using \(actor_id = auth\.uid\(\)\)/);
  });

  it("الزائر الفريد upsert على التجزئة ولا يمنح المتصفح وصولاً مباشراً", () => {
    expect(migration).toContain("visitor_key text primary key");
    expect(migration).toContain("on conflict (visitor_key) do update");
    expect(migration).toContain("page_views = site_visitors.page_views + 1");
    expect(migration).toContain("revoke all on public.site_visitors from public, anon, authenticated");
  });
});
