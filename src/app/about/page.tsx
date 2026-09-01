"use client";

import Link from "next/link";
import { DeveloperCard, useAppSettings } from "@/components/DeveloperInfo";
import { displayPhone, showField } from "@/lib/settings";

const MODULES = [
  "العملاء وكشوف حساباتهم",
  "الموظفون والسائقون والسلف",
  "السيارات وتقارير الأداء",
  "فواتير النقل والرحلات",
  "سندات القبض والدفع",
  "الخزائن والبنوك والتحويلات",
  "مسيّر الرواتب الشهري",
  "تقارير الأرباح والخسائر (P&L)",
  "السنوات المالية والإقفال",
  "تصدير Excel و PDF و CSV",
];

/** صفحة «حول التطبيق» — عامة، وكل بياناتها تُدار من لوحة المطوّر. */
export default function AboutPage() {
  const s = useAppSettings();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: 24 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 10, flexWrap: "wrap" }}>
          <div>
            <div className="page-title">حول التطبيق</div>
            <div className="page-sub">{s.app_name}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/" className="btn">🏠 الرئيسية</Link>
            <Link href="/customers" className="btn">↩ التطبيق</Link>
          </div>
        </div>

        <div className="page-card" style={{ marginBottom: 16 }}>
          <div className="group-title">📘 نبذة</div>
          <p style={{ lineHeight: 2, color: "var(--muted)", margin: 0 }}>{s.about_text}</p>
          <div style={{ marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap", color: "var(--muted)", fontSize: 14 }}>
            {showField(s, "app_version") && <span>الإصدار: <b dir="ltr">{s.app_version}</b></span>}
            {showField(s, "support_hours") && <span>الدعم: <b>{s.support_hours}</b></span>}
          </div>
        </div>

        <div className="page-card" style={{ marginBottom: 16 }}>
          <div className="group-title">🧩 وحدات النظام</div>
          <ul style={{ columns: 2, columnGap: 24, margin: 0, paddingInlineStart: 20, lineHeight: 2.1, color: "var(--muted)" }}>
            {MODULES.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>

        <div style={{ marginBottom: 16 }}>
          <DeveloperCard />
        </div>

        <div className="page-card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13.5, lineHeight: 2 }}>
          <div>
            © {new Date().getFullYear()} {s.app_name} — {s.copyright}
          </div>
          {showField(s, "phone") && <div dir="ltr">{displayPhone(s.phone)}</div>}
          {showField(s, "email") && <div dir="ltr">{s.email}</div>}
        </div>
      </div>
    </div>
  );
}
