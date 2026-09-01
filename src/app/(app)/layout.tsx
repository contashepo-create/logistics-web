"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ToastHost } from "@/components/toast";
import { getSession, getCompany } from "@/lib/auth";
import { SUPABASE_CONFIGURED } from "@/lib/supabase";
import { subscriptionState } from "@/lib/subscription";
import { ThemeToggle } from "@/components/ThemeToggle";

/** عناوين الشاشات للشريط العلوي في الجوال. */
const TITLES: Record<string, string> = {
  "/customers": "العملاء",
  "/employees": "الموظفون والسائقون",
  "/vehicles": "السيارات",
  "/years": "السنوات المالية",
  "/cashboxes": "الخزائن",
  "/banks": "البنوك",
  "/invoices": "فواتير النقل",
  "/receipts": "سندات القبض",
  "/payments": "سندات الدفع",
  "/payroll": "إدارة الرواتب",
  "/settings": "الإعدادات",
  "/reports/trips": "أرباح الفواتير والرحلات",
  "/reports/customer-statement": "كشف حساب عميل",
  "/reports/employee-statement": "كشف حساب موظف/سائق",
  "/reports/vehicles": "أداء السيارات",
  "/reports/pnl": "الأرباح والخسائر",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "ready">("loading");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // بلا إعدادات Supabase لا يمكن التحقق من الجلسة — صفحة الدخول تشرح المطلوب
      if (!SUPABASE_CONFIGURED) {
        if (!cancelled) router.replace("/login");
        return;
      }

      const session = await getSession();
      if (!session) {
        if (!cancelled) router.replace("/login");
        return;
      }

      const company = await getCompany();
      if (!company) {
        if (!cancelled) router.replace("/onboarding");
        return;
      }

      const st = subscriptionState(company);
      // منتهي/موقوف → صفحة الاشتراك (تحميل البيانات + طلب تجديد)
      if (st === "expired" || st === "suspended") {
        if (!cancelled) router.replace("/subscription");
        return;
      }

      if (!cancelled) setState("ready");
    })();

    return () => { cancelled = true; };
  }, [router, pathname]);

  // إغلاق القائمة المنزلقة عند تغيير الصفحة أو تكبير الشاشة
  useEffect(() => { setNavOpen(false); }, [pathname]);
  useEffect(() => {
    const onResize = () => { if (window.innerWidth > 1024) setNavOpen(false); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    document.body.style.overflow = navOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [navOpen]);

  if (state === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div className="spinner" />
      </div>
    );
  }

  const title = TITLES[pathname] ?? "النظام المحاسبي";

  return (
    <div className="app-shell">
      {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden />}
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="app-main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="فتح القائمة">☰</button>
          <div className="topbar-title">{title}</div>
          <ThemeToggle compact />
        </header>
        <main className="app-content">{children}</main>
        <div className="statusbar">النظام المحاسبي المتكامل لشركة النقل — الإصدار 2.0.0 (عزل الشركات + اشتراك)</div>
      </div>
      <ToastHost />
    </div>
  );
}
