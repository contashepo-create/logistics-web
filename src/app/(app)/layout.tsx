"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { ToastHost } from "@/components/toast";
import { getSession, getCompany, isAdmin } from "@/lib/auth";
import { subscriptionState } from "@/lib/subscription";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const session = await getSession();
      if (!session) {
        if (!cancelled) router.replace("/login");
        return;
      }

      // المطوّر يذهب للوحة التحكم وليس للتطبيق
      if (await isAdmin()) {
        if (!cancelled) router.replace("/admin");
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

  if (state === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <main style={{ flex: 1, padding: 20 }}>{children}</main>
        <div className="statusbar">النظام المحاسبي المتكامل لشركة النقل — الإصدار 2.0.0 (عزل الشركات + اشتراك)</div>
      </div>
      <ToastHost />
    </div>
  );
}
