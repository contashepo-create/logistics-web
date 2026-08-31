"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listYears } from "@/lib/repo";
import { getCompany, isAdmin, signOut } from "@/lib/auth";
import { stateLabel, subscriptionState } from "@/lib/subscription";
import type { Company } from "@/lib/types";

const NAV_SECTIONS: { title: string; items: { label: string; href: string }[] }[] = [
  {
    title: "📁 البيانات الأساسية",
    items: [
      { label: "العملاء", href: "/customers" },
      { label: "الموظفون والسائقون", href: "/employees" },
      { label: "السيارات", href: "/vehicles" },
      { label: "السنوات المالية", href: "/years" },
    ],
  },
  {
    title: "🏦 الخزائن والبنوك",
    items: [
      { label: "الخزائن", href: "/cashboxes" },
      { label: "البنوك", href: "/banks" },
    ],
  },
  {
    title: "🔄 العمليات اليومية",
    items: [
      { label: "فواتير النقل", href: "/invoices" },
      { label: "سندات القبض", href: "/receipts" },
      { label: "سندات الدفع", href: "/payments" },
    ],
  },
  {
    title: "💰 الرواتب",
    items: [{ label: "إدارة الرواتب", href: "/payroll" }],
  },
  {
    title: "📊 التقارير الذكية",
    items: [
      { label: "أرباح الفواتير والرحلات", href: "/reports/trips" },
      { label: "كشف حساب عميل", href: "/reports/customer-statement" },
      { label: "كشف حساب موظف/سائق", href: "/reports/employee-statement" },
      { label: "أداء السيارات", href: "/reports/vehicles" },
      { label: "الأرباح والخسائر (P&L)", href: "/reports/pnl" },
    ],
  },
  {
    title: "⚙️ النظام",
    items: [
      { label: "الإعدادات", href: "/settings" },
      { label: "الاشتراك والباقات", href: "/subscription" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: years } = useQuery({ queryKey: ["years"], queryFn: listYears });
  const openList = (years ?? []).filter((y) => y.status === "open").map((y) => String(y.year));
  const [company, setCompany] = useState<Company | null>(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    getCompany().then(setCompany);
    isAdmin().then(setAdmin);
  }, []);

  const logout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">🚛 النظام المحاسبي<br />لشركة النقل</div>
      <nav style={{ flex: 1, overflowY: "auto" }}>
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="nav-section-title">{section.title}</div>
            {section.items.map((item) => (
              <Link key={item.href} href={item.href} className={`nav-item ${pathname === item.href ? "active" : ""}`}>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        {admin && (
          <div>
            <div className="nav-section-title">🛡️ الإدارة</div>
            <Link href="/zerocold" className={`nav-item ${pathname.startsWith("/zerocold") ? "active" : ""}`}>
              لوحة المطور
            </Link>
          </div>
        )}
      </nav>
      <div className="nav-year-info">
        السنوات المفتوحة: {openList.length ? openList.join("، ") : "لا يوجد ⚠️"}
      </div>
      <div className="nav-user">
        <div className="nav-user-company">{company?.name || "شركتي"}</div>
        <div
          className="nav-user-plan"
          style={{
            color: company && subscriptionState(company) === "trial" ? "var(--warning, #b45309)" : undefined,
          }}
        >
          {company ? stateLabel(company) : ""}
        </div>
        <button className="nav-logout" onClick={logout}>تسجيل الخروج</button>
      </div>
    </aside>
  );
}
