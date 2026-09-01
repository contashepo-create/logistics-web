"use client";

import { useEffect, useState } from "react";
import { notify } from "@/components/toast";
import { listCompanies, type CompanyRow } from "@/lib/admin";
import { listSupportMessages, sendSupportMessage, type SupportMessage } from "@/lib/support";

export default function AdminMessagesPage() {
  const [companies, setCompanies] = useState<CompanyRow[] | null>(null);
  const [all, setAll] = useState<SupportMessage[]>([]);
  const [active, setActive] = useState<string>("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [cs, ms] = await Promise.all([listCompanies(), listSupportMessages()]);
      setCompanies(cs);
      setAll(ms);
      if (!active && ms.length) setActive(ms[ms.length - 1].company_id);
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const thread = all.filter((m) => m.company_id === active);
  const byCompany = new Map<string, SupportMessage[]>();
  for (const m of all) {
    if (!byCompany.has(m.company_id)) byCompany.set(m.company_id, []);
    byCompany.get(m.company_id)!.push(m);
  }
  const nameOf = (id: string) => companies?.find((c) => c.id === id)?.name ?? id.slice(0, 8);
  const codeOf = (id: string) => companies?.find((c) => c.id === id)?.client_code ?? "—";

  const send = async () => {
    if (!active || body.trim().length < 2) return;
    setBusy(true);
    try {
      await sendSupportMessage(body, { companyId: active, asAdmin: true });
      setBody("");
      await load();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h1 className="page-title">💬 رسائل العملاء</h1>
      <p className="page-sub">قناة مباشرة بينك وبين كل شركة — نصوص فقط، معقّمة ومحدودة المعدل.</p>

      <div className="msg-layout">
        <div className="page-card msg-list">
          <div className="group-title">المحادثات ({byCompany.size})</div>
          {byCompany.size === 0 ? <div className="exp-empty">لا رسائل بعد.</div> : (
            [...byCompany.entries()].map(([cid, ms]) => (
              <button key={cid} className={`msg-item ${active === cid ? "active" : ""}`} onClick={() => setActive(cid)}>
                <b>{nameOf(cid)}</b>
                <span dir="ltr" className="muted">{codeOf(cid)}</span>
                <span className="msg-preview">{ms[ms.length - 1].body.slice(0, 40)}</span>
              </button>
            ))
          )}
        </div>

        <div className="page-card" style={{ flex: 1, minWidth: 0 }}>
          {!active ? <div className="exp-empty">اختر محادثة.</div> : (
            <>
              <div className="group-title">{nameOf(active)} — <span dir="ltr">{codeOf(active)}</span></div>
              <div className="chat-box">
                {thread.map((m) => (
                  <div key={m.id} className={`chat-msg ${m.sender === "admin" ? "mine" : "theirs"}`}>
                    <div className="chat-body">{m.body}</div>
                    <div className="chat-meta">{m.sender === "admin" ? "أنت (المطوّر)" : "العميل"} · <span dir="ltr">{new Date(m.created_at).toLocaleString("ar-EG")}</span></div>
                  </div>
                ))}
              </div>
              <textarea className="textarea" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="اكتب ردك للعميل…" style={{ marginTop: 10 }} />
              <button className="btn btn-primary" disabled={busy || body.trim().length < 2} onClick={send} style={{ marginTop: 8 }}>إرسال</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
