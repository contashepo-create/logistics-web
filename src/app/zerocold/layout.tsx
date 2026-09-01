"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ToastHost } from "@/components/toast";
import { Admin2FA } from "@/components/Admin2FA";
import { getSession, isAdmin, signOut } from "@/lib/auth";
import { authFetch } from "@/lib/apiClient";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const admin = await isAdmin();
      if (!admin) {
        setDenied(session.user?.email ?? "");
        setReady(true);
        return;
      }
      setAllowed(true);
      setReady(true);
    })();
  }, [router, pathname]);

  useEffect(() => { setNavOpen(false); }, [pathname]);

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div className="spinner" />
      </div>
    );
  }
  if (denied !== null) {
    return (
      <div className="blocked-screen">
        <div className="auth-card" style={{ maxWidth: 480 }}>
          <div className="auth-brand">🚫</div>
          <h1 className="auth-title">غير مصرح بالدخول</h1>
          <p className="auth-sub" style={{ lineHeight: 2 }}>
            لوحة المطوّر مقصورة على بريد المطوّر المصرّح به.<br />
            أنت مسجّل حالياً بالبريد: <b dir="ltr">{denied || "—"}</b>
          </p>
          <button className="btn btn-primary auth-btn" onClick={async () => { await signOut(); router.replace("/login"); }}>
            تسجيل الخروج والدخول بحساب المطوّر
          </button>
          <button className="btn auth-btn" style={{ marginTop: 8 }} onClick={() => router.replace("/customers")}>
            العودة للتطبيق
          </button>
        </div>
        <ToastHost />
      </div>
    );
  }
  if (!allowed) return null;

  // التحقق بخطوتين (رمز تليجرام) قبل عرض لوحة المطوّر
  if (!twoFactor) {
    return (
      <>
        <Admin2FA onVerified={() => setTwoFactor(true)} />
        <ToastHost />
      </>
    );
  }

  return (
    <div className="app-shell">
      {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden />}
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="sidebar-brand">🛡️ لوحة المطوّر</div>
        <nav style={{ flex: 1 }}>
          <div className="nav-section-title">الإدارة</div>
          <Link href="/zerocold" className={`nav-item ${pathname === "/zerocold" ? "active" : ""}`}>نظرة عامة</Link>
          <Link href="/zerocold/companies" className={`nav-item ${pathname.startsWith("/zerocold/companies") ? "active" : ""}`}>الشركات والمشتركون</Link>
          <Link href="/zerocold/features" className={`nav-item ${pathname.startsWith("/zerocold/features") ? "active" : ""}`}>مميزات إضافية</Link>
          <Link href="/zerocold/messages" className={`nav-item ${pathname.startsWith("/zerocold/messages") ? "active" : ""}`}>رسائل العملاء</Link>
          <Link href="/zerocold/complaints" className={`nav-item ${pathname.startsWith("/zerocold/complaints") ? "active" : ""}`}>الشكاوى</Link>
          <Link href="/zerocold/logs" className={`nav-item ${pathname.startsWith("/zerocold/logs") ? "active" : ""}`}>سجل النشاط</Link>
          <Link href="/zerocold/settings" className={`nav-item ${pathname.startsWith("/zerocold/settings") ? "active" : ""}`}>بيانات المطوّر والتطبيق</Link>
          <div className="nav-section-title">العودة</div>
          <Link href="/customers" className="nav-item">↩ العودة للتطبيق</Link>
        </nav>
        <div className="nav-user">
          <div style={{ marginBottom: 8 }}><ThemeToggle /></div>
          <button className="nav-logout" onClick={async () => {
            await authFetch("/api/zerocold/2fa/logout", { method: "POST" }).catch(() => undefined);
            await signOut();
            router.replace("/login");
          }}>تسجيل الخروج</button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="فتح القائمة">☰</button>
          <div className="topbar-title">لوحة المطوّر</div>
          <ThemeToggle compact />
        </header>
        <main className="app-content">{children}</main>
        <div className="statusbar">لوحة تحكم المطوّر — وصول مقصور على البريد المصرّح به</div>
      </div>
      <ToastHost />
    </div>
  );
}
