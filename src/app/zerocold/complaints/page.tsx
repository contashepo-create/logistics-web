"use client";

import { useEffect, useState } from "react";
import { notify } from "@/components/toast";
import { authFetch } from "@/lib/apiClient";

interface Complaint {
  id: string; ticket: string; name: string; email: string; phone: string;
  subject: string; body: string; status: "open" | "answered" | "closed"; created_at: string;
}
interface Msg { sender: "visitor" | "admin"; body: string; created_at: string }

async function api(payload: Record<string, unknown>) {
  const res = await authFetch("/api/zerocold/complaints", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.success) throw new Error(out?.message || "تعذّر تنفيذ الطلب.");
  return out;
}

export default function AdminComplaintsPage() {
  const [rows, setRows] = useState<Complaint[] | null>(null);
  const [open, setOpen] = useState<Complaint | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api({ action: "list" }).then((o) => setRows(o.complaints as Complaint[]))
    .catch((e) => notify(e.message, "error"));
  useEffect(() => { load(); }, []);

  const openThread = async (c: Complaint) => {
    setOpen(c); setReply("");
    try { setMsgs((await api({ action: "thread", id: c.id })).messages as Msg[]); }
    catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  const send = async () => {
    if (!open || reply.trim().length < 2) return;
    setBusy(true);
    try {
      await api({ action: "reply", id: open.id, body: reply });
      setReply("");
      setMsgs((await api({ action: "thread", id: open.id })).messages as Msg[]);
      load();
      notify("تم إرسال الرد.", "success");
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { setBusy(false); }
  };

  const setStatus = async (c: Complaint, status: string) => {
    try { await api({ action: "status", id: c.id, status }); load(); }
    catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <div>
      <h1 className="page-title">📮 الشكاوى</h1>
      <p className="page-sub">شكاوى الزوار والعملاء — الرد يظهر فوراً للمُشتكي عبر رقم التتبع.</p>

      {!rows ? <div className="exp-empty">جارٍ التحميل…</div> : rows.length === 0 ? (
        <div className="exp-empty">لا توجد شكاوى.</div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead><tr><th>رقم التتبع</th><th>الموضوع</th><th>المُرسل</th><th>البريد</th><th>الحالة</th><th>التاريخ</th><th>إجراء</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td dir="ltr" style={{ fontFamily: "ui-monospace, monospace" }}>{c.ticket}</td>
                  <td style={{ whiteSpace: "normal", maxWidth: 240 }}>{c.subject}</td>
                  <td>{c.name}</td>
                  <td dir="ltr">{c.email}</td>
                  <td>
                    <span className={`badge ${c.status === "answered" ? "badge-on" : c.status === "closed" ? "badge-off" : "badge-warn"}`}>
                      {c.status === "answered" ? "تم الرد" : c.status === "closed" ? "مغلقة" : "جديدة"}
                    </span>
                  </td>
                  <td dir="ltr">{String(c.created_at).slice(0, 10)}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                    <button className="btn btn-row" onClick={() => openThread(c)}>💬 فتح</button>
                    {c.status !== "closed"
                      ? <button className="btn btn-row" onClick={() => setStatus(c, "closed")}>إغلاق</button>
                      : <button className="btn btn-row" onClick={() => setStatus(c, "open")}>إعادة فتح</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className="modal-card" style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <span>{open.subject} — <span dir="ltr">{open.ticket}</span></span>
              <button className="btn btn-row" onClick={() => setOpen(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: "grid", gap: 12 }}>
              <div className="sub-info-grid">
                <div className="sub-info-item"><span className="k">المُرسل</span><span className="v">{open.name}</span></div>
                <div className="sub-info-item"><span className="k">البريد</span><span className="v" dir="ltr">{open.email}</span></div>
                <div className="sub-info-item"><span className="k">الهاتف</span><span className="v" dir="ltr">{open.phone || "—"}</span></div>
              </div>
              <div className="chat-box">
                {msgs.map((m, i) => (
                  <div key={i} className={`chat-msg ${m.sender === "admin" ? "mine" : "theirs"}`}>
                    <div className="chat-body">{m.body}</div>
                    <div className="chat-meta">{m.sender === "admin" ? "أنت (المطوّر)" : "المُشتكي"} · <span dir="ltr">{new Date(m.created_at).toLocaleString("ar-EG")}</span></div>
                  </div>
                ))}
              </div>
              <textarea className="textarea" rows={3} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="اكتب ردك…" />
              <button className="btn btn-primary" disabled={busy || reply.trim().length < 2} onClick={send}>إرسال الرد</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
