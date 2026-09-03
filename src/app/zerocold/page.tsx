"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  adminStats,
  recentSiteVisitors,
  type AdminPlatformStats,
  type SiteVisitorRow,
} from "@/lib/admin";
import { notify } from "@/components/toast";

function dateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function locationOf(visitor: SiteVisitorRow): string {
  return [visitor.city, visitor.region, visitor.country].filter(Boolean).join("، ") || "غير متاح";
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminPlatformStats | null>(null);
  const [visitors, setVisitors] = useState<SiteVisitorRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStats, nextVisitors] = await Promise.all([adminStats(), recentSiteVisitors(50)]);
      setStats(nextStats);
      setVisitors(nextVisitors);
    } catch (e) {
      notify(e instanceof Error ? e.message : "تعذّر تحميل مؤشرات المنصة.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !stats) {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>جارٍ تحميل مؤشرات المنصة…</div>;
  }

  const cards: { label: string; value: number; icon: string; hint?: string }[] = [
    { label: "إجمالي الشركات", value: stats?.companies ?? 0, icon: "🏢" },
    { label: "الشركات النشطة", value: stats?.active_companies ?? 0, icon: "✅" },
    { label: "الفترة التجريبية", value: stats?.trial_companies ?? 0, icon: "🧪" },
    { label: "اشتراكات سارية", value: stats?.subscribed_companies ?? 0, icon: "💳" },
    { label: "اشتراكات منتهية", value: stats?.expired_companies ?? 0, icon: "⌛" },
    { label: "شركات موقوفة", value: stats?.suspended_companies ?? 0, icon: "⏸" },
    { label: "شركات جديدة — 30 يوماً", value: stats?.new_companies_30d ?? 0, icon: "🆕" },
    { label: "طلبات تفعيل معلقة", value: stats?.pending_requests ?? 0, icon: "📨" },
    { label: "حسابات المالكين", value: stats?.owner_accounts ?? 0, icon: "👤" },
    { label: "حسابات إضافية", value: stats?.additional_accounts ?? 0, icon: "👥" },
    { label: "الزوار الفريدون", value: stats?.visitors ?? 0, icon: "🌐", hint: "كل جهاز مرة واحدة" },
    { label: "زوار جدد اليوم", value: stats?.visitors_today ?? 0, icon: "📍" },
    { label: "زوار جدد — 30 يوماً", value: stats?.visitors_30d ?? 0, icon: "📈" },
    { label: "مرات فتح التطبيق", value: stats?.page_views ?? 0, icon: "👁" },
  ];

  return (
    <div>
      <div className="admin-page-heading">
        <div>
          <h1 className="page-title">نظرة عامة على المنصة</h1>
          <p className="page-sub">مؤشرات الإدارة والاشتراكات والزوار فقط — دون فواتير العملاء أو مبالغهم أو حركاتهم</p>
        </div>
        <div className="admin-heading-actions">
          <Link href="/zerocold/diagnostics" className="btn">🩺 فحص Supabase</Link>
          <button className="btn btn-primary" onClick={() => void load()} disabled={loading}>↻ تحديث</button>
        </div>
      </div>

      <section className="admin-metric-grid" aria-label="مؤشرات المنصة">
        {cards.map((card) => (
          <article key={card.label} className="admin-metric-card">
            <div className="admin-metric-icon" aria-hidden>{card.icon}</div>
            <div>
              <div className="admin-metric-label">{card.label}</div>
              <div className="admin-metric-value">{card.value.toLocaleString("ar-EG")}</div>
              {card.hint && <div className="admin-metric-hint">{card.hint}</div>}
            </div>
          </article>
        ))}
      </section>

      <section className="page-card admin-section-card">
        <div className="admin-section-head">
          <div>
            <h2>آخر الزوار</h2>
            <p>آخر زيارة: {dateTime(stats?.last_visit_at ?? null)}</p>
          </div>
          <span className="privacy-pill">معرّف الجهاز محفوظ كتجزئة مشفّرة</span>
        </div>
        <div className="admin-info-note">
          الزائر الفريد يُحتسب مرة واحدة لكل Cookie جهاز لمدة سنة. التنقل بين الصفحات لا ينشئ زائراً جديداً،
          والموقع تقريبي ويظهر فقط إذا أرسله مزود الاستضافة؛ لا يُستخدم GPS.
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>آخر ظهور</th><th>IP</th><th>الجهاز</th><th>المتصفح والنظام</th>
                <th>الموقع التقريبي</th><th>الصفحة الأولى</th><th>مرات الفتح</th>
              </tr>
            </thead>
            <tbody>
              {visitors.length === 0 && (
                <tr><td colSpan={7} className="empty-cell">لا توجد زيارات مسجلة بعد.</td></tr>
              )}
              {visitors.map((visitor, index) => (
                <tr key={`${visitor.ip_address}-${visitor.first_seen}-${index}`}>
                  <td dir="ltr">{dateTime(visitor.last_seen)}</td>
                  <td dir="ltr" className="mono-cell">{visitor.ip_address || "غير متاح"}</td>
                  <td>{visitor.device_type || "غير معروف"}</td>
                  <td>{visitor.browser || "غير معروف"}<small className="table-secondary">{visitor.operating_system || ""}</small></td>
                  <td>{locationOf(visitor)}</td>
                  <td dir="ltr" className="mono-cell">{visitor.first_path || "/"}</td>
                  <td>{visitor.page_views.toLocaleString("ar-EG")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
