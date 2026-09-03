"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listYears, listEmployees, listVehicles } from "@/lib/repo";
import { customersWithBalance, accountsWithBalance } from "@/lib/calc";
import { suppliersWithBalance, listPurchaseInvoices } from "@/lib/suppliers";
import { getCompany, isAdmin, signOut } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { stateLabel, subscriptionState } from "@/lib/subscription";
import type { Company } from "@/lib/types";

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

interface NavSection {
  /** معرّف ثابت لحفظ حالة الطيّ */
  id: string;
  title: string;
  icon: string;
  /** لون القسم — يميّز الرئيسي عن الفرعي بصرياً */
  accent: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: "master",
    title: "البيانات الأساسية",
    icon: "📁",
    accent: "#2563eb",
    items: [
      { label: "العملاء", href: "/customers", icon: "👥" },
      { label: "الموردون", href: "/suppliers", icon: "🏭" },
      { label: "الموظفون والسائقون", href: "/employees", icon: "🧑‍✈️" },
      { label: "السيارات", href: "/vehicles", icon: "🚚" },
      { label: "السنوات المالية", href: "/years", icon: "🗓️" },
    ],
  },
  {
    id: "treasury",
    title: "الخزائن والبنوك",
    icon: "🏦",
    accent: "#0d9488",
    items: [
      { label: "الخزائن", href: "/cashboxes", icon: "💵" },
      { label: "البنوك", href: "/banks", icon: "🏛️" },
    ],
  },
  {
    id: "ops",
    title: "العمليات اليومية",
    icon: "🔄",
    accent: "#7c3aed",
    items: [
      { label: "فواتير النقل", href: "/invoices", icon: "🧾" },
      { label: "فواتير المشتريات", href: "/purchases", icon: "🛒" },
      { label: "سندات القبض", href: "/receipts", icon: "⬇️" },
      { label: "سندات الدفع", href: "/payments", icon: "⬆️" },
      { label: "إشعارات مدين/دائن", href: "/notes", icon: "🧾" },
    ],
  },
  {
    id: "payroll",
    title: "الرواتب",
    icon: "💰",
    accent: "#d97706",
    items: [
      { label: "إدارة الرواتب", href: "/payroll", icon: "🧮" },
      { label: "متابعة السلفيات", href: "/advances", icon: "💳" },
      { label: "الخصومات", href: "/deductions", icon: "⛔" },
    ],
  },
  {
    id: "reports",
    title: "التقارير الذكية",
    icon: "📊",
    accent: "#0891b2",
    items: [
      { label: "أرباح وخسائر كل رحلة", href: "/reports/trips", icon: "📈" },
      { label: "كشف حساب عميل", href: "/reports/customer-statement", icon: "📄" },
      { label: "كشف حساب مورّد", href: "/reports/supplier-statement", icon: "📑" },
      { label: "أعمار الديون", href: "/reports/aging", icon: "⏳" },
      { label: "كشف حساب موظف/سائق", href: "/reports/employee-statement", icon: "🧾" },
      { label: "أداء السيارات", href: "/reports/vehicles", icon: "🚛" },
      { label: "الأرباح والخسائر (P&L)", href: "/reports/pnl", icon: "💹" },
    ],
  },
  {
    id: "system",
    title: "النظام",
    icon: "⚙️",
    accent: "#64748b",
    items: [
      { label: "الإعدادات", href: "/settings", icon: "🛠️" },
      { label: "الاشتراك والباقات", href: "/subscription", icon: "💳" },
      { label: "حول التطبيق", href: "/about", icon: "ℹ️" },
    ],
  },
];

const STORAGE_KEY = "nav.collapsed";

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: years } = useQuery({ queryKey: ["years"], queryFn: listYears });
  const openList = (years ?? []).filter((y) => y.status === "open").map((y) => String(y.year));
  const [company, setCompany] = useState<Company | null>(null);
  const [admin, setAdmin] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getCompany().then(setCompany);
    isAdmin().then(setAdmin);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* تجاهل */
    }
  }, []);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* تجاهل */
      }
      return next;
    });
  };

  const logout = async () => {
    await signOut();
    router.replace("/login");
  };

  const state = company ? subscriptionState(company) : null;

  // ——— جلب مسبق عند مرور المؤشر على الرابط ———
  // يبدأ تحميل بيانات القسم قبل الضغط، فتُفتح الشاشة ببيانات جاهزة غالباً.
  const qc = useQueryClient();
  const PREFETCH: Record<string, { key: unknown[]; fn: () => Promise<unknown> }> = useMemo(() => ({
    "/customers": { key: ["customers"], fn: customersWithBalance },
    "/suppliers": { key: ["suppliers"], fn: suppliersWithBalance },
    "/employees": { key: ["employees"], fn: () => listEmployees() },
    "/vehicles": { key: ["vehicles"], fn: listVehicles },
    "/years": { key: ["years"], fn: listYears },
    "/cashboxes": { key: ["cashbox"], fn: () => accountsWithBalance("cashbox") },
    "/banks": { key: ["bank"], fn: () => accountsWithBalance("bank") },
    "/purchases": { key: ["purchases"], fn: listPurchaseInvoices },
  }), []);

  const prefetch = (href: string) => {
    const entry = PREFETCH[href];
    if (!entry) return;
    qc.prefetchQuery({ queryKey: entry.key, queryFn: entry.fn, staleTime: 120_000 });
  };

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-brand">
        <span className="brand-logo">🚛</span>
        <span className="brand-text">
          النظام المحاسبي
          <small>لشركات النقل واللوجستيات</small>
        </span>
      </div>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section) => {
          const isCollapsed = !!collapsed[section.id];
          const hasActive = section.items.some((i) => pathname === i.href);
          return (
            <section
              key={section.id}
              className={`nav-group${hasActive ? " has-active" : ""}`}
              style={{ ["--nav-accent" as string]: section.accent }}
            >
              <button
                type="button"
                className="nav-group-head"
                onClick={() => toggle(section.id)}
                aria-expanded={!isCollapsed}
              >
                <span className="nav-group-icon">{section.icon}</span>
                <span className="nav-group-title">{section.title}</span>
                <span className={`nav-group-caret${isCollapsed ? " closed" : ""}`}>⌄</span>
              </button>

              {!isCollapsed && (
                <div className="nav-group-body">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      onMouseEnter={() => prefetch(item.href)}
                      onFocus={() => prefetch(item.href)}
                      className={`nav-item ${pathname === item.href ? "active" : ""}`}
                    >
                      <span className="nav-item-icon">{item.icon}</span>
                      <span className="nav-item-label">{item.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {admin && (
          <section className="nav-group nav-group-admin" style={{ ["--nav-accent" as string]: "#dc2626" }}>
            <div className="nav-group-head static">
              <span className="nav-group-icon">🛡️</span>
              <span className="nav-group-title">الإدارة</span>
            </div>
            <div className="nav-group-body">
              <Link
                href="/zerocold"
                onClick={onClose}
                className={`nav-item ${pathname.startsWith("/zerocold") ? "active" : ""}`}
              >
                <span className="nav-item-icon">🧭</span>
                <span className="nav-item-label">لوحة المطوّر</span>
              </Link>
            </div>
          </section>
        )}
      </nav>

      <div className="sidebar-foot">
        <div className="nav-year-info">
          <span className="nav-year-dot" data-ok={openList.length > 0} />
          السنوات المفتوحة: {openList.length ? openList.join("، ") : "لا يوجد ⚠️"}
        </div>

        <div className="nav-user">
          <div className="nav-user-company" title={company?.name ?? ""}>
            {company?.name || "شركتي"}
          </div>
          <div className={`nav-user-plan plan-${state ?? "none"}`}>{company ? stateLabel(company) : ""}</div>
          <div className="nav-user-actions">
            <ThemeToggle />
            <button className="nav-logout" onClick={logout}>
              🚪 خروج
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
