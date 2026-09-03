"use client";

import { useCallback, useEffect, useState } from "react";
import { databaseHealth, type DatabaseHealth } from "@/lib/admin";
import { notify } from "@/components/toast";

function dateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "medium" }).format(date);
}

export default function AdminDiagnosticsPage() {
  const [health, setHealth] = useState<DatabaseHealth | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");

  const run = useCallback(async () => {
    setLoading(true);
    setFailure("");
    const started = performance.now();
    try {
      const result = await databaseHealth();
      setLatency(Math.max(1, Math.round(performance.now() - started)));
      setHealth(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "تعذّر الاتصال بقاعدة البيانات.";
      setFailure(message);
      setHealth(null);
      setLatency(null);
      notify(message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const missingTables = health?.tables.filter((item) => !item.exists) ?? [];
  const rlsProblems = health?.tables.filter((item) => item.exists && !item.rls_enabled) ?? [];
  const missingFunctions = health?.functions.filter((item) => !item.exists) ?? [];

  return (
    <div>
      <div className="admin-page-heading">
        <div>
          <h1 className="page-title">صحة Supabase والتشخيص</h1>
          <p className="page-sub">فحص الاتصال وبنية الجداول وRLS والدوال فقط — لا تُقرأ بيانات عمل الشركات أو أعداد صفوفها</p>
        </div>
        <button className="btn btn-primary" onClick={() => void run()} disabled={loading}>
          {loading ? "جارٍ الفحص…" : "↻ إعادة الفحص"}
        </button>
      </div>

      <section className="diagnostic-summary-grid">
        <article className={`diagnostic-summary ${failure ? "is-bad" : health ? "is-good" : ""}`}>
          <span className="diagnostic-icon">{failure ? "✕" : health ? "✓" : "…"}</span>
          <div><small>اتصال Supabase</small><strong>{failure ? "فشل الاتصال" : health ? "متصل" : "جارٍ الفحص"}</strong></div>
        </article>
        <article className={`diagnostic-summary ${health?.healthy ? "is-good" : health ? "is-warn" : ""}`}>
          <span className="diagnostic-icon">{health?.healthy ? "✓" : "!"}</span>
          <div><small>سلامة البنية</small><strong>{health?.healthy ? "سليمة" : health ? "تحتاج مراجعة" : "—"}</strong></div>
        </article>
        <article className="diagnostic-summary">
          <span className="diagnostic-icon">↔</span>
          <div><small>زمن الاستجابة</small><strong dir="ltr">{latency == null ? "—" : `${latency} ms`}</strong></div>
        </article>
        <article className="diagnostic-summary">
          <span className="diagnostic-icon">◷</span>
          <div><small>وقت قاعدة البيانات</small><strong>{health ? dateTime(health.database_time) : "—"}</strong></div>
        </article>
      </section>

      {failure && (
        <section className="diagnostic-alert is-bad">
          <strong>تعذّر تنفيذ فحص Supabase</strong>
          <p>{failure}</p>
          <p>تحقق من متغيرات NEXT_PUBLIC_SUPABASE_URL وNEXT_PUBLIC_SUPABASE_ANON_KEY، ثم طبّق ترحيلة v18.</p>
        </section>
      )}

      {health && !health.healthy && (
        <section className="diagnostic-alert is-warn">
          <strong>ملاحظات التشخيص</strong>
          {missingTables.length > 0 && <p>جداول غير موجودة: {missingTables.map((item) => item.name).join("، ")}</p>}
          {rlsProblems.length > 0 && <p>RLS غير مفعّل: {rlsProblems.map((item) => item.name).join("، ")}</p>}
          {missingFunctions.length > 0 && <p>دوال غير موجودة: {missingFunctions.map((item) => item.name).join("، ")}</p>}
          <p>طبّق ملفات الترحيل غير المنفذة، وبالأخص <code dir="ltr">migration_admin_platform_tools_v18.sql</code>.</p>
        </section>
      )}

      {health && (
        <>
          <section className="page-card admin-section-card">
            <div className="admin-section-head">
              <div><h2>الجداول وسياسات العزل</h2><p>يعرض وجود الجدول وحالة RLS وعدد السياسات، دون قراءة أي صف.</p></div>
              <span className="privacy-pill">PostgreSQL {health.postgres_version}</span>
            </div>
            <div className="diagnostic-object-grid">
              {health.tables.map((table) => (
                <article key={table.name} className={`diagnostic-object ${table.exists && table.rls_enabled ? "is-good" : "is-bad"}`}>
                  <div className="diagnostic-object-title"><code dir="ltr">{table.name}</code><span>{table.exists && table.rls_enabled ? "✓" : "!"}</span></div>
                  <div className="diagnostic-object-meta">
                    <span>{table.exists ? "موجود" : "مفقود"}</span>
                    <span>{table.rls_enabled ? "RLS مفعّل" : "RLS غير مفعّل"}</span>
                    <span>{table.policy_count ?? 0} سياسة</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="page-card admin-section-card">
            <div className="admin-section-head">
              <div><h2>الدوال الأساسية</h2><p>الدوال المطلوبة لتشغيل التطبيق وأدوات لوحة المطوّر.</p></div>
            </div>
            <div className="diagnostic-function-list">
              {health.functions.map((fn) => (
                <div key={fn.name} className={fn.exists ? "is-good" : "is-bad"}>
                  <span>{fn.exists ? "✓" : "✕"}</span><code dir="ltr">{fn.name}()</code>
                </div>
              ))}
            </div>
          </section>
          <p className="diagnostic-footnote">آخر فحص: {dateTime(health.checked_at)}</p>
        </>
      )}
    </div>
  );
}
