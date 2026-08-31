"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SUPABASE_CONFIGURED } from "@/lib/supabase";
import { getSession, isAdmin } from "@/lib/auth";

/**
 * الصفحة الجذر ليست صفحة عملاء — هي موزِّع (router):
 *  • بلا جلسة        → /login
 *  • المطوّر          → /admin
 *  • مستخدم عادي     → /customers (أول شاشة في التطبيق)
 */
export default function Home() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setError("إعدادات Supabase غير مضبوطة في بيئة النشر.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession();
        if (cancelled) return;
        if (!session) {
          router.replace("/login");
          return;
        }
        const admin = await isAdmin();
        if (cancelled) return;
        router.replace(admin ? "/admin" : "/customers");
      } catch {
        if (!cancelled) setError("تعذّر الاتصال بالخادم. حاول إعادة التحميل.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg)",
        }}
      >
        <div style={{ maxWidth: 560, textAlign: "center", lineHeight: 1.9 }}>
          <h2 style={{ marginBottom: 12 }}>⚙️ النظام بحاجة إلى إعداد</h2>
          <p>{error}</p>
          <p style={{ opacity: 0.8, fontSize: 14 }}>
            أضف المتغيّرين <code>NEXT_PUBLIC_SUPABASE_URL</code> و
            <code> NEXT_PUBLIC_SUPABASE_ANON_KEY</code> في إعدادات المشروع
            (Vercel → Settings → Environment Variables) ثم أعد النشر.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div className="spinner" />
    </div>
  );
}
