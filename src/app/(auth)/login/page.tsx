"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, isAdmin } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("أدخل البريد الإلكتروني وكلمة المرور.");
      return;
    }
    setLoading(true);
    try {
      const res = await signIn(email.trim(), password);
      if (!res.ok) {
        setError(translateAuthError(res.message));
        return;
      }
      // المطوّر إلى اللوحة، والمستخدم إلى تطبيقه
      router.replace((await isAdmin()) ? "/admin" : "/customers");
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <div className="auth-brand">🚛</div>
      <h1 className="auth-title">النظام المحاسبي لشركة النقل</h1>
      <p className="auth-sub">سجّل الدخول للمتابعة</p>

      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <div>
          <label className="field-label">البريد الإلكتروني</label>
          <input
            className="input-base"
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
          />
        </div>
        <div>
          <label className="field-label">كلمة المرور</label>
          <input
            className="input-base"
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button className="btn btn-primary auth-btn" disabled={loading}>
          {loading ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
        </button>
      </form>

      <p className="auth-foot">
        ليس لديك حساب؟{" "}
        <Link href="/register" className="auth-link">
          إنشاء حساب جديد
        </Link>
      </p>
    </div>
  );
}

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  if (m.includes("email not confirmed")) return "لم يتم تأكيد البريد الإلكتروني بعد. راجع بريدك.";
  return msg;
}
