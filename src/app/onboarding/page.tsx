"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, getCompany, registerCurrentCompany, signOut } from "@/lib/auth";
import { notify } from "@/components/toast";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session) return router.replace("/login");
      try {
        if (await getCompany()) return router.replace("/customers");
      } catch (e) {
        // خطأ صلاحيات/شبكة: لا نُظهر نموذج «أنشئ شركتك» وكأن المستخدم بلا شركة،
        // لأن ذلك يدفعه لإنشاء شركة مكرّرة. نعرض السبب الحقيقي بدلاً من ذلك.
        setLoadError(e instanceof Error ? e.message : String(e));
        setChecking(false);
        return;
      }
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

  if (loadError) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 16 }}>
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div className="auth-brand">⚠️</div>
          <h1 className="auth-title">تعذّر التحقق من شركتك</h1>
          <p className="auth-sub">{loadError}</p>
          <p className="auth-sub">لا تُنشئ شركة جديدة قبل حلّ هذه المشكلة — قد تملك شركة بالفعل.</p>
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary auth-btn" onClick={() => window.location.reload()}>إعادة المحاولة</button>
            <button className="btn" onClick={async () => { await signOut(); router.replace("/login"); }}>تسجيل الخروج</button>
          </div>
        </div>
      </div>
    );
  }

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
