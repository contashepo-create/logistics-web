"use client";

import { useEffect, useState } from "react";
import { adminStats } from "@/lib/admin";
import { money } from "@/lib/format";

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    adminStats().then(setStats).catch(() => setStats({}));
  }, []);

  if (!stats) {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>جارٍ التحميل…</div>;
  }

  const cards: { label: string; value: string | number }[] = [
    { label: "الشركات", value: stats.companies ?? 0 },
    { label: "الشركات النشطة", value: stats.active_companies ?? 0 },
    { label: "العملاء", value: stats.customers ?? 0 },
    { label: "الفواتير", value: stats.invoices ?? 0 },
    { label: "النقلات", value: stats.trips ?? 0 },
    { label: "سندات القبض", value: stats.receipts ?? 0 },
    { label: "سندات الدفع", value: stats.payments ?? 0 },
    { label: "مسيرات الرواتب", value: stats.payrolls ?? 0 },
    { label: "إجمالي قيمة النقلات", value: money(stats.revenue) },
    { label: "إجمالي المقبوضات", value: money(stats.collected) },
    { label: "إجمالي المدفوعات", value: money(stats.spent) },
    { label: "إجمالي الرواتب المنصرفة", value: money(stats.salaries) },
  ];

  return (
    <div>
      <h1 className="page-title">نظرة عامة على النظام</h1>
      <p className="page-sub">إحصاءات مجمّعة لكل الشركات المسجلة</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginTop: 16 }}>
        {cards.map((c) => (
          <div key={c.label} className="total-card">
            <div className="total-label">{c.label}</div>
            <div className="total-value">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
