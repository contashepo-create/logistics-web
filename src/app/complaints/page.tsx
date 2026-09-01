"use client";

import { useState } from "react";
import Link from "next/link";
import { ToastHost, notify } from "@/components/toast";
import { CopyrightLine } from "@/components/DeveloperInfo";

interface Thread {
  ticket: string;
  subject: string;
  status: "open" | "answered" | "closed";
  created_at: string;
  messages: { sender: "visitor" | "admin"; body: string; created_at: string }[];
}

const statusLabel = (s: Thread["status"]) =>
  s === "answered" ? "تم الرد" : s === "closed" ? "مغلقة" : "قيد المراجعة";

async function api(payload: Record<string, unknown>) {
  const res = await fetch("/api/complaints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.success) throw new Error(out?.message || "تعذّر تنفيذ الطلب.");
  return out;
}

export default function ComplaintsPage() {
  const [tab, setTab] = useState<"new" | "track">("new");

  // نموذج شكوى جديدة
  const [f, setF] = useState({ name: "", email: "", phone: "", subject: "", body: "", website: "" });
  const [sending, setSending] = useState(false);
  const [ticket, setTicket] = useState("");

  // تتبّع
  const [t, setT] = useState({ ticket: "", email: "", body: "" });
  const [thread, setThread] = useState<Thread | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const out = await api({ action: "create", ...f });
      setTicket(out.ticket as string);
      setF({ name: "", email: "", phone: "", subject: "", body: "", website: "" });
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSending(false);
    }
  };

  const track = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await api({ action: "track", ticket: t.ticket, email: t.email });
      setThread(out.complaint as Thread);
    } catch (err) {
      setThread(null);
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const reply = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await api({ action: "reply", ticket: t.ticket, email: t.email, body: t.body });
      setThread(out.complaint as Thread);
      setT({ ...t, body: "" });
      notify("تم إرسال ردك.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ct-page">
      <div className="ct-wrap">
        <div className="ct-head">
          <div>
            <h1 className="page-title">📮 الشكاوى والاقتراحات</h1>
            <p className="page-sub">أرسل شكواك أو اقتراحك وتابعها برقم تتبّع خاص بك — بلا حساب.</p>
          </div>
          <Link href="/" className="btn">↩ الصفحة الرئيسية</Link>
        </div>

        <div className="tabs-head" style={{ marginBottom: 14 }}>
          <button className={tab === "new" ? "active" : ""} onClick={() => setTab("new")}>شكوى جديدة</button>
          <button className={tab === "track" ? "active" : ""} onClick={() => setTab("track")}>تتبّع شكوى</button>
        </div>

        {tab === "new" && (
          ticket ? (
            <div className="page-card" style={{ textAlign: "center", padding: 30 }}>
              <div style={{ fontSize: 44 }}>✅</div>
              <h2 className="group-title">تم تسجيل شكواك</h2>
              <p className="page-sub">احتفظ برقم التتبّع التالي — ستحتاجه مع بريدك لمتابعة الشكوى والرد عليها:</p>
              <div className="ct-ticket" dir="ltr">{ticket}</div>
              <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => { setTab("track"); setT({ ...t, ticket }); setTicket(""); }}>
                متابعة الشكوى الآن
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="page-card" style={{ display: "grid", gap: 12 }}>
              <div className="form-grid-2">
                <div className="field">
                  <label className="field-label">الاسم <span className="req">*</span></label>
                  <input className="input" required minLength={3} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">البريد الإلكتروني <span className="req">*</span></label>
                  <input className="input" dir="ltr" type="email" required maxLength={120} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                  <div className="field-hint">يُستخدم للتحقق عند تتبّع الشكوى.</div>
                </div>
                <div className="field">
                  <label className="field-label">الهاتف</label>
                  <input className="input" dir="ltr" maxLength={24} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">الموضوع <span className="req">*</span></label>
                  <input className="input" required minLength={4} maxLength={140} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label className="field-label">تفاصيل الشكوى <span className="req">*</span></label>
                <textarea className="textarea" rows={6} required minLength={10} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
                <div className="field-hint">نصوص فقط — لا يُسمح بإرفاق صور أو ملفات. الحد الأقصى 4000 حرف.</div>
              </div>
              {/* حقل فخّ ضد الروبوتات — مخفي عن المستخدم */}
              <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="ct-hp"
                value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
              <button className="btn btn-primary" disabled={sending}>{sending ? "جارٍ الإرسال…" : "إرسال الشكوى"}</button>
            </form>
          )
        )}

        {tab === "track" && (
          <>
            <form onSubmit={track} className="page-card" style={{ display: "grid", gap: 12 }}>
              <div className="form-grid-2">
                <div className="field">
                  <label className="field-label">رقم الشكوى <span className="req">*</span></label>
                  <input className="input" dir="ltr" placeholder="CT-XXXXXXXXXX" required value={t.ticket} onChange={(e) => setT({ ...t, ticket: e.target.value.toUpperCase() })} />
                </div>
                <div className="field">
                  <label className="field-label">البريد المسجّل بالشكوى <span className="req">*</span></label>
                  <input className="input" dir="ltr" type="email" required value={t.email} onChange={(e) => setT({ ...t, email: e.target.value })} />
                </div>
              </div>
              <div className="field-hint">🔒 لا تُعرض أي شكوى إلا بمطابقة الرقم والبريد معاً — لا يمكن الوصول لشكوى غيرك بتغيير رقم أو اثنين.</div>
              <button className="btn btn-primary" disabled={busy}>عرض الشكوى</button>
            </form>

            {thread && (
              <div className="page-card" style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div className="group-title">{thread.subject}</div>
                  <span className={`badge ${thread.status === "answered" ? "badge-on" : thread.status === "closed" ? "badge-off" : "badge-warn"}`}>
                    {statusLabel(thread.status)}
                  </span>
                </div>
                <div className="chat-box" style={{ marginTop: 10 }}>
                  {thread.messages.map((m, i) => (
                    <div key={i} className={`chat-msg ${m.sender === "visitor" ? "mine" : "theirs"}`}>
                      <div className="chat-body">{m.body}</div>
                      <div className="chat-meta">{m.sender === "visitor" ? "أنت" : "فريق الدعم"} · <span dir="ltr">{new Date(m.created_at).toLocaleString("ar-EG")}</span></div>
                    </div>
                  ))}
                </div>
                {thread.status !== "closed" && (
                  <form onSubmit={reply} style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    <textarea className="textarea" rows={3} maxLength={2000} value={t.body} onChange={(e) => setT({ ...t, body: e.target.value })} placeholder="اكتب ردك…" />
                    <button className="btn btn-primary" disabled={busy || t.body.trim().length < 2}>إرسال الرد</button>
                  </form>
                )}
              </div>
            )}
          </>
        )}

        <CopyrightLine className="sub-copy" />
      </div>
      <ToastHost />
    </div>
  );
}
