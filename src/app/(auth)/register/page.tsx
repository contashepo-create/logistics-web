"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth";
import { checkSignupEmail, checkPassword, ALLOWED_EMAIL_HINT } from "@/lib/security";
import { notify } from "@/components/toast";

export default function RegisterPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!companyName.trim()) return setError("أدخل اسم الشركة.");
    if (!name.trim()) return setError("أدخل اسم المسؤول.");
    const em = checkSignupEmail(email);
    if (!em.ok) return setError(em.message);
    const pw = checkPassword(password);
    if (!pw.ok) return setError(pw.message);
    if (password !== confirm) return setError("كلمتا المرور غير متطابقتين.");

    setLoading(true);
    try {
      const res = await signUp({
        email: em.email,
        password,
        name: name.trim(),
        companyName: companyName.trim(),
        phone: phone.trim(),
      });
      if (!res.ok) {
        setError(translateAuthError(res.message));
        return;
      }
      if (res.needsVerification) {
        setVerification(true);
        return;
      }
      if ((res as { needsOnboarding?: boolean }).needsOnboarding) {
        notify("تم إنشاء حسابك — أكمل بيانات الشركة.", "success");
        router.replace("/onboarding");
        return;
      }
      notify("تم إنشاء الحساب بنجاح. أهلاً بك!", "success");
      router.replace("/customers");
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  };

  if (verification) {
    return (
      <div className="auth-card">
        <div className="auth-brand">📬</div>
        <h1 className="auth-title">تحقق من بريدك الإلكتروني</h1>
        <p className="auth-sub">
          أرسلنا رابط تأكيد إلى <b dir="ltr">{email}</b>. افتح الرابط لإكمال التسجيل ثم سجّل
          الدخول.
        </p>
        <Link href="/login" className="btn btn-primary auth-btn" style={{ display: "block", textAlign: "center" }}>
          الذهاب لتسجيل الدخول
        </Link>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <div className="auth-brand">🚛</div>
      <h1 className="auth-title">إنشاء حساب جديد</h1>
      <p className="auth-sub">سجّل شركتك وابدأ فوراً بتجربة مجانية ٧ أيام — بياناتك معزولة تماماً</p>

      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <div>
          <label className="field-label">اسم الشركة</label>
          <input className="input-base" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="شركة النقل للخدمات اللوجستية" autoFocus />
        </div>
        <div className="two-col">
          <div>
            <label className="field-label">اسم المسؤول</label>
            <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="أحمد محمد" />
          </div>
          <div>
            <label className="field-label">الهاتف (اختياري)</label>
            <input className="input-base" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" dir="ltr" />
          </div>
        </div>
        <div>
          <label className="field-label">البريد الإلكتروني</label>
          <input className="input-base" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" autoComplete="email" />
          <div className="field-hint">يُقبل التسجيل ببريد حقيقي من: {ALLOWED_EMAIL_HINT} — البريد المؤقت/الوهمي مرفوض.</div>
        </div>
        <div className="two-col">
          <div>
            <label className="field-label">كلمة المرور</label>
            <input className="input-base" type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 أحرف على الأقل" />
          </div>
          <div>
            <label className="field-label">تأكيد كلمة المرور</label>
            <input className="input-base" type="password" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button className="btn btn-primary auth-btn" disabled={loading}>
          {loading ? "جارٍ إنشاء الحساب…" : "إنشاء الحساب"}
        </button>
      </form>

      <p className="auth-foot">
        لديك حساب بالفعل؟{" "}
        <Link href="/login" className="auth-link">
          تسجيل الدخول
        </Link>
      </p>
    </div>
  );
}

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already registered") || m.includes("already exists"))
    return "هذا البريد الإلكتروني مسجّل بالفعل.";
  if (m.includes("password")) return "كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل مع أرقام.";
  if (m.includes("gmail") || m.includes("outlook") || m.includes("مسموح") || m.includes("يُقبل"))
    return "يُقبل التسجيل ببريد Gmail أو Yahoo أو Hotmail أو Outlook أو iCloud فقط.";
  if (m.includes("invalid") && m.includes("email")) return "البريد الإلكتروني غير صالح.";
  return msg;
}
