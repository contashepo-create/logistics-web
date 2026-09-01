"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth";
import {
  checkSignupEmail,
  checkPassword,
  ALLOWED_EMAIL_HINT,
  safeAddress,
  safeCompanyName,
  safeFinancialYear,
  safePersonName,
  safePhone,
} from "@/lib/security";
import { notify } from "@/components/toast";
import PasswordInput from "@/components/PasswordInput";

const INITIAL_YEAR = new Date().getFullYear();

export default function RegisterPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [yearStart, setYearStart] = useState(`${INITIAL_YEAR}-01-01`);
  const [yearEnd, setYearEnd] = useState(`${INITIAL_YEAR}-12-31`);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
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
    let cleanCompany: string;
    let cleanName: string;
    let cleanAddress: string;
    let cleanPhone: string;
    let financialYear: ReturnType<typeof safeFinancialYear>;
    try {
      cleanCompany = safeCompanyName(companyName);
      financialYear = safeFinancialYear(yearStart, yearEnd);
      cleanName = safePersonName(name, "اسم المسؤول");
      cleanAddress = safeAddress(address, "عنوان المسؤول");
      cleanPhone = safePhone(phone, true);
    } catch (validationError) {
      return setError(validationError instanceof Error ? validationError.message : "تحقق من البيانات المطلوبة.");
    }
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
        name: cleanName,
        companyName: cleanCompany,
        address: cleanAddress,
        phone: cleanPhone,
        yearStart: financialYear.dateFrom,
        yearEnd: financialYear.dateTo,
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
        const detail = (res as { message?: string }).message;
        notify(detail ? `تم إنشاء حساب الدخول، لكن تعذّر إنشاء ملف الشركة: ${translateAuthError(detail)} يمكنك تصحيح البيانات الآن.` : "تم إنشاء حسابك — أكمل بيانات الشركة.", detail ? "warning" : "success");
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
          <label className="field-label">اسم الشركة <span aria-hidden="true">*</span></label>
          <input className="input-base" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="شركة النقل للخدمات اللوجستية" maxLength={120} autoComplete="organization" required autoFocus />
        </div>

        <div className="auth-required-section" aria-labelledby="financial-year-title">
          <div id="financial-year-title" className="auth-section-title">السنة المالية الأولى (إلزامية)</div>
          <div className="field-hint">لن يُنشأ ملف الشركة قبل فتح سنة مالية صالحة.</div>
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
          <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="أحمد محمد" maxLength={120} autoComplete="name" required />
        </div>
        <div>
          <label className="field-label">عنوان المسؤول *</label>
          <input className="input-base" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="المدينة، الحي، الشارع ورقم المبنى" maxLength={300} autoComplete="street-address" required />
        </div>
        <div>
          <label className="field-label">رقم الهاتف *</label>
          <input className="input-base" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" dir="ltr" maxLength={24} autoComplete="tel" required />
          <div className="field-hint">يجب أن يكون رقماً حقيقياً وغير مستخدم في حساب شركة أخرى.</div>
        </div>
        <div>
          <label className="field-label">البريد الإلكتروني</label>
          <input className="input-base" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" maxLength={120} autoComplete="email" required />
          <div className="field-hint">يُقبل التسجيل ببريد حقيقي من: {ALLOWED_EMAIL_HINT} — البريد المؤقت/الوهمي مرفوض.</div>
        </div>
        <div className="two-col">
          <div>
            <label className="field-label">كلمة المرور</label>
            <PasswordInput className="input-base" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8 أحرف على الأقل" autoComplete="new-password" required />
          </div>
          <div>
            <label className="field-label">تأكيد كلمة المرور</label>
            <PasswordInput className="input-base" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" showLabel="إظهار تأكيد كلمة المرور" hideLabel="إخفاء تأكيد كلمة المرور" required />
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
  if (m.includes("phone") || m.includes("هاتف") || m.includes("الهاتف"))
    return "رقم الهاتف مستخدم بالفعل في حساب شركة أخرى.";
  if (m.includes("already registered") || m.includes("already exists") || m.includes("duplicate") || (m.includes("البريد") && m.includes("مستخدم بالفعل")))
    return "هذا البريد الإلكتروني مسجّل بالفعل.";
  if (m.includes("password")) return "كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل مع أرقام.";
  if (m.includes("gmail") || m.includes("outlook") || m.includes("مسموح") || m.includes("يُقبل"))
    return "يُقبل التسجيل ببريد Gmail أو Yahoo أو Hotmail أو Outlook أو iCloud فقط.";
  if (m.includes("invalid") && m.includes("email")) return "البريد الإلكتروني غير صالح.";
  return msg;
}
