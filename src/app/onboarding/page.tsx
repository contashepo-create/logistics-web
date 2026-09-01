"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, getCompany, registerCurrentCompany, signOut } from "@/lib/auth";
import { notify } from "@/components/toast";

const INITIAL_YEAR = new Date().getFullYear();

export default function OnboardingPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [yearStart, setYearStart] = useState(`${INITIAL_YEAR}-01-01`);
  const [yearEnd, setYearEnd] = useState(`${INITIAL_YEAR}-12-31`);
  const [ownerName, setOwnerName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session) return router.replace("/login");
      try {
        if (await getCompany()) return router.replace("/customers");
        // تحفظ صفحة التسجيل هذه القيم في metadata حتى لا تضيع خلال تأكيد البريد.
        const metadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;
        setCompanyName(String(metadata.company_name ?? ""));
        setOwnerName(String(metadata.name ?? ""));
        setAddress(String(metadata.owner_address ?? ""));
        setPhone(String(metadata.phone ?? ""));
        setYearStart(String(metadata.financial_year_start ?? `${INITIAL_YEAR}-01-01`));
        setYearEnd(String(metadata.financial_year_end ?? `${INITIAL_YEAR}-12-31`));
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
    setLoading(true);
    try {
      await registerCurrentCompany({ companyName, name: ownerName, address, phone, yearStart, yearEnd });
      notify("تم إنشاء شركتك وفتح السنة المالية بنجاح. أهلاً بك!", "success");
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
      <div className="auth-card" style={{ width: "min(620px, 100%)" }}>
        <div className="auth-brand">🏢</div>
        <h1 className="auth-title">استكمال ملف الشركة</h1>
        <p className="auth-sub">كل البيانات التالية مطلوبة، وتُنشأ الشركة والسنة المالية معاً دون ملف ناقص.</p>
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <div>
            <label className="field-label">اسم الشركة *</label>
            <input className="input-base" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="شركة النقل للخدمات اللوجستية" maxLength={120} autoComplete="organization" required autoFocus />
          </div>

          <div className="auth-required-section" aria-labelledby="onboarding-year-title">
            <div id="onboarding-year-title" className="auth-section-title">السنة المالية الأولى (إلزامية)</div>
            <div className="field-hint">اختر البداية والنهاية الآن؛ لا يمكن إنشاء شركة بلا سنة مالية مفتوحة.</div>
            <div className="two-col">
              <div>
                <label className="field-label">تاريخ البداية *</label>
                <input className="input-base" type="date" dir="ltr" value={yearStart} onChange={(e) => setYearStart(e.target.value)} min="1900-01-01" max="2200-12-31" required />
              </div>
              <div>
                <label className="field-label">تاريخ النهاية *</label>
                <input className="input-base" type="date" dir="ltr" value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} min="1900-01-01" max="2200-12-31" required />
              </div>
            </div>
          </div>

          <div>
            <label className="field-label">اسم المسؤول *</label>
            <input className="input-base" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={120} autoComplete="name" placeholder="أحمد محمد" required />
          </div>
          <div>
            <label className="field-label">عنوان المسؤول *</label>
            <input className="input-base" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} autoComplete="street-address" placeholder="المدينة، الحي، الشارع ورقم المبنى" required />
          </div>
          <div>
            <label className="field-label">رقم الهاتف *</label>
            <input className="input-base" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={24} autoComplete="tel" placeholder="05xxxxxxxx" required />
            <div className="field-hint">لن يُقبل رقم وهمي أو رقم مستخدم في حساب شركة أخرى.</div>
          </div>
          <button className="btn btn-primary auth-btn" disabled={loading}>{loading ? "جارٍ إنشاء الملف والسنة…" : "إنشاء الشركة وفتح السنة المالية"}</button>
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
