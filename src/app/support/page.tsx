"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSession, getCompany } from "@/lib/auth";
import { listSupportMessages, sendSupportMessage, type SupportMessage } from "@/lib/support";
import { notify, ToastHost } from "@/components/toast";
import type { Company } from "@/lib/types";

export default function SupportPage() {
  const router = useRouter();
  const [company, setCompany] = useState<Company | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => setMsgs(await listSupportMessages().catch(() => []));

  useEffect(() => {
    (async () => {
      if (!(await getSession())) return router.replace("/login");
      const c = await getCompany();
      if (!c) return router.replace("/onboarding");
      setCompany(c);
      await load();
      setLoading(false);
    })();
  }, [router]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);

  // تحديث دوري خفيف (بلا اتصال دائم)
  useEffect(() => {
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (body.trim().length < 2) return;
    setSending(true);
    try {
      await sendSupportMessage(body);
      setBody("");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><div className="spinner" /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: 24 }}>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
          <div>
            <div className="page-title">💬 مراسلة المطوّر</div>
            <div className="page-sub">{company?.name} — رقم العميل <b dir="ltr">{company?.client_code}</b></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/subscription" className="btn">الاشتراك</Link>
            <Link href="/customers" className="btn">↩ التطبيق</Link>
          </div>
        </div>

        <div className="page-card chat-box">
          {msgs.length === 0 ? (
            <div className="exp-empty">ابدأ المحادثة — اكتب استفسارك أو مشكلتك وسيصلك الرد هنا.</div>
          ) : (
            msgs.map((m) => (
              <div key={m.id} className={`chat-msg ${m.sender === "client" ? "mine" : "theirs"}`}>
                <div className="chat-body">{m.body}</div>
                <div className="chat-meta">
                  {m.sender === "client" ? "أنت" : "المطوّر"} · <span dir="ltr">{new Date(m.created_at).toLocaleString("ar-EG")}</span>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={send} className="page-card" style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <textarea className="textarea" rows={3} maxLength={2000} value={body}
            onChange={(e) => setBody(e.target.value)} placeholder="اكتب رسالتك للمطوّر… (2000 حرف كحد أقصى)" />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="field-hint">🔒 الرسائل نصية فقط — لا يُسمح بإرفاق ملفات أو صور، وكل نص يُعقَّم قبل حفظه.</span>
            <button className="btn btn-primary" disabled={sending || body.trim().length < 2}>{sending ? "جارٍ الإرسال…" : "إرسال"}</button>
          </div>
        </form>
      </div>
      <ToastHost />
    </div>
  );
}
