"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ToastHost } from "@/components/toast";
import { Admin2FA } from "@/components/Admin2FA";
import { getSession, isAdmin, signOut } from "@/lib/auth";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const admin = await isAdmin();
      if (!admin) {
        router.replace("/customers");
        return;
      }
      setAllowed(true);
      setReady(true);
    })();
  }, [router, pathname]);

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div className="spinner" />
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
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--bg)" }}>
      <aside className="sidebar">
        <div className="sidebar-brand">🛡️ لوحة المطوّر</div>
        <nav style={{ flex: 1 }}>
          <div className="nav-section-title">الإدارة</div>
          <Link href="/admin" className={`nav-item ${pathname === "/admin" ? "active" : ""}`}>نظرة عامة</Link>
          <Link href="/admin/companies" className={`nav-item ${pathname.startsWith("/admin/companies") ? "active" : ""}`}>الشركات والمشتركون</Link>
          <Link href="/admin/logs" className={`nav-item ${pathname.startsWith("/admin/logs") ? "active" : ""}`}>سجل النشاط</Link>
          <div className="nav-section-title">العودة</div>
          <Link href="/customers" className="nav-item">↩ العودة للتطبيق</Link>
        </nav>
        <div className="nav-user">
          <button className="nav-logout" onClick={async () => { await signOut(); router.replace("/login"); }}>تسجيل الخروج</button>
        </div>
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <main style={{ flex: 1, padding: 16 }}>{children}</main>
        <div className="statusbar">لوحة تحكم المطوّر — وصول مقصور على البريد المصرّح به</div>
      </div>
      <ToastHost />
    </div>
  );
}
