"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ToastHost } from "@/components/toast";
import { getSession, getCompany, signOut } from "@/lib/auth";
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
  "/invoices/new": "إصدار فاتورة نقل",
  "/notes": "إشعارات مدين/دائن",
  "/receipts": "سندات القبض",
  "/payments": "سندات الدفع",
  "/payroll": "إدارة الرواتب",
  "/settings": "الإعدادات",
  "/reports/trips": "أرباح وخسائر كل رحلة",
  "/reports/customer-statement": "كشف حساب عميل",
  "/reports/employee-statement": "كشف حساب موظف/سائق",
  "/reports/vehicles": "أداء السيارات",
  "/reports/pnl": "الأرباح والخسائر",
};

/**
 * نتيجة فحص الجلسة والاشتراك تُحفظ على مستوى الوحدة: بعد نجاحها مرة واحدة لا
 * يُحجب الانتقال بين الأقسام بشاشة تحميل مجدّداً — يُعاد الفحص في الخلفية فقط.
 */
let gatePassed = false;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "ready" | "error">(gatePassed ? "ready" : "loading");
  const [errorMsg, setErrorMsg] = useState("");
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

      // نميّز بين «لا توجد شركة» (تهيئة مطلوبة) و«فشل الطلب» (صلاحيات/شبكة).
      // بلا هذا التمييز كان خطأ 403 يُقرأ كأنه غياب شركة، فيُعاد التوجيه إلى
      // /onboarding بلا نهاية رغم امتلاك المستخدم شركة بالفعل.
      let company;
      try {
        company = await getCompany();
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setState("error");
        }
        return;
      }

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

      gatePassed = true;
      if (!cancelled) setState("ready");
    })();

    return () => { cancelled = true; };
  // الفحص مرة واحدة لكل تحميل للتطبيق — لا يُعاد عند كل انتقال بين الأقسام
  }, [router]);

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

  // فشل الوصول للبيانات — نعرض السبب بدل إعادة التوجيه في حلقة
  if (state === "error") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}>
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div className="auth-brand">⚠️</div>
          <h1 className="auth-title">تعذّر تحميل بيانات شركتك</h1>
          <p className="auth-sub">{errorMsg}</p>
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary auth-btn" onClick={() => window.location.reload()}>
              إعادة المحاولة
            </button>
            <button className="btn" onClick={async () => { await signOut(); router.replace("/login"); }}>
              تسجيل الخروج
            </button>
          </div>
        </div>
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
