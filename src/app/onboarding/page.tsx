"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, getCompany, isAdmin, registerCurrentCompany, signOut } from "@/lib/auth";
import { notify } from "@/components/toast";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session) return router.replace("/login");
      if (await isAdmin()) return router.replace("/admin");
      if (await getCompany()) return router.replace("/customers");
      setChecking(false);
    })();
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return notify("أدخل اسم الشركة.", "error");
    setLoading(true);
    try {
      await registerCurrentCompany({ companyName: name.trim() });
      notify("تم إنشاء شركتك بنجاح. أهلاً بك!", "success");
      router.replace("/customers");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}>
      <div className="auth-card">
        <div className="auth-brand">🏢</div>
        <h1 className="auth-title">أنشئ شركتك</h1>
        <p className="auth-sub">أدخل اسم شركتك للبدء — بياناتك معزولة تماماً</p>
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <div>
            <label className="field-label">اسم الشركة</label>
            <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="شركة النقل للخدمات اللوجستية" autoFocus />
          </div>
          <button className="btn btn-primary auth-btn" disabled={loading}>{loading ? "جارٍ الإنشاء…" : "إنشاء الشركة"}</button>
        </form>
        <p className="auth-foot">
          <button className="auth-link" style={{ background: "none", border: "none", cursor: "pointer" }} onClick={async () => { await signOut(); router.replace("/login"); }}>
            تسجيل الخروج
          </button>
        </p>
      </div>
    </div>
  );
}
