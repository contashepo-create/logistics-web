"use client";

import { useEffect, useState } from "react";
import { notify } from "./toast";

/**
 * بوابة التحقق بخطوتين للوحة المطوّر: يُرسل رمز عبر تليجرام ثم يُتحقق منه.
 * تعتمد على مسارات /api/admin/2fa (send/verify/status) بصلاحية المطوّر فقط.
 */
export function Admin2FA({ onVerified }: { onVerified: () => void }) {
  const [checking, setChecking] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/2fa/status");
        const data = await res.json();
        if (data.verified) onVerified();
      } catch {
        // ابقَ على شاشة التحقق
      } finally {
        setChecking(false);
      }
    })();
  }, [onVerified]);

  const send = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/admin/2fa/send", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) notify("تم إرسال الرمز إلى تليجرام.", "success");
      else notify(data.message || "تعذّر الإرسال.", "error");
    } catch {
      notify("تعذّر الاتصال بالخادم.", "error");
    } finally {
      setSending(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    try {
      const res = await fetch("/api/admin/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        notify("تم التحقق بنجاح.", "success");
        onVerified();
      } else {
        notify(data.message || "رمز غير صحيح.", "error");
      }
    } catch {
      notify("تعذّر الاتصال بالخادم.", "error");
    } finally {
      setVerifying(false);
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
    <div className="blocked-screen">
      <div className="auth-card" style={{ maxWidth: 440 }}>
        <div className="auth-brand">🔐</div>
        <h1 className="auth-title">التحقق بخطوتين</h1>
        <p className="auth-sub" style={{ lineHeight: 2 }}>
          للدخول إلى لوحة المطوّر أدخل رمز التحقق المرسل إلى تليجرام.
        </p>
        <form onSubmit={verify} style={{ display: "grid", gap: 12 }}>
          <button type="button" className="btn auth-btn" onClick={send} disabled={sending}>
            {sending ? "جارٍ الإرسال…" : "📨 إرسال الرمز إلى تليجرام"}
          </button>
          <input
            className="input-base"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="رمز التحقق (6 أرقام)"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            style={{ textAlign: "center", letterSpacing: 6, fontSize: 20 }}
          />
          <button type="submit" className="btn btn-primary auth-btn" disabled={verifying || code.length !== 6}>
            {verifying ? "جارٍ التحقق…" : "تحقق"}
          </button>
        </form>
      </div>
    </div>
  );
}
