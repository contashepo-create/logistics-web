"use client";

import { Fragment, useEffect, useState } from "react";
import { listCompanies, setCompanyStatus, setSubscription, deleteCompany, companySummary, listActivationRequests, reviewActivationRequest, type CompanyRow } from "@/lib/admin";
import { notify } from "@/components/toast";
import { money, todayIso } from "@/lib/format";
import { planLabel, requestKindLabel, type ActivationRequest } from "@/lib/subscription";

function statusOf(c: CompanyRow): "active" | "trial" | "expired" | "suspended" {
  if (!c.is_active) return "suspended";
  if (c.trial_end && c.trial_end >= todayIso() && !c.subscription_end) return "trial";
  if (!c.subscription_end) return c.plan_type === "open" ? "active" : "expired";
  return c.subscription_end >= todayIso() ? "active" : "expired";
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "badge-on" },
  trial: { label: "تجريبي", cls: "badge-warn" },
  expired: { label: "منتهي", cls: "badge-off" },
  suspended: { label: "موقوف", cls: "badge-off" },
};

const PLAN_LABEL: Record<string, string> = { trial: "تجريبي", monthly: "شهري", yearly: "سنوي", open: "مفتوح" };

export default function AdminCompaniesPage() {
  const [rows, setRows] = useState<(CompanyRow & { summary?: Record<string, number> })[] | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [subEdit, setSubEdit] = useState<CompanyRow | null>(null);
  const [subForm, setSubForm] = useState({ plan_type: "open" as CompanyRow["plan_type"], end_date: "" });
  const [requests, setRequests] = useState<(ActivationRequest & { company_name: string })[] | null>(null);
  const [reqNotes, setReqNotes] = useState<Record<string, string>>({});

  const load = () => listCompanies().then(setRows).catch((e) => notify(e.message, "error"));
  const loadReqs = () => listActivationRequests().then(setRequests).catch((e) => notify(e.message, "error"));
  useEffect(() => { load(); loadReqs(); }, []);

  const filtered = (rows ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.owner_name, c.owner_email, c.email, c.client_code].some((s) => (s || "").toLowerCase().includes(q));
  });

  const toggle = async (c: CompanyRow) => {
    try {
      await setCompanyStatus(c.id, !c.is_active);
      notify(c.is_active ? "تم إيقاف الشركة." : "تم تفعيل الشركة.", "success");
      load();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  const openSub = (c: CompanyRow) => {
    setSubForm({ plan_type: c.plan_type, end_date: c.subscription_end ?? "" });
    setSubEdit(c);
  };

  const saveSub = async () => {
    if (!subEdit) return;
    if (subForm.plan_type !== "open" && subForm.plan_type !== "trial" && !subForm.end_date) {
      notify("حدد تاريخ الانتهاء للاشتراك.", "error");
      return;
    }
    try {
      await setSubscription(subEdit.id, subForm.plan_type, subForm.plan_type === "open" ? null : subForm.end_date || null);
      notify("تم تحديث الاشتراك.", "success");
      setSubEdit(null);
      load();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  const remove = async (c: CompanyRow) => {
    if (!window.confirm(`تحذير: سيُحذف كل بيانات «${c.name}» نهائياً (عملاء، فواتير، سندات، رواتب…).\n\nمتابعة؟`)) return;
    if (!window.confirm("تأكيد أخير — لا يمكن التراجع. متابعة؟")) return;
    try {
      await deleteCompany(c.id);
      notify("تم حذف الشركة.", "success");
      load();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  const toggleExpand = async (id: string) => {
    if (expanded === id) return setExpanded(null);
    const s = await companySummary(id);
    setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, summary: s } : r)) ?? null);
    setExpanded(id);
  };

  const review = async (req: ActivationRequest, approve: boolean) => {
    const notes = reqNotes[req.id] ?? "";
    try {
      await reviewActivationRequest(req.id, approve, notes);
      notify(approve ? "تمت الموافقة على الطلب وتم تفعيل الاشتراك." : "تم رفض الطلب.", "success");
      loadReqs();
      load();
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  const pending = (requests ?? []).filter((r) => r.status === "pending");
  const reviewed = (requests ?? []).filter((r) => r.status !== "pending");

  return (
    <div>
      <h1 className="page-title">الشركات والمشتركون</h1>
      <p className="page-sub">كل شركة معزولة تماماً، مع اشتراك واحد (شهري / سنوي / مفتوح)</p>

      {/* طلبات الاشتراك */}
      <div className="page-card" style={{ margin: "14px 0" }}>
        <div className="group-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>📨 طلبات الاشتراك ({pending.length} معلق)</span>
          <button className="btn btn-row" onClick={loadReqs}>🔄 تحديث</button>
        </div>
        {!requests ? (
          <div style={{ color: "var(--muted)", padding: 8 }}>جارٍ التحميل…</div>
        ) : requests.length === 0 ? (
          <div style={{ color: "var(--muted)", padding: 8 }}>لا توجد طلبات.</div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data-table">
              <thead>
                <tr><th>الشركة</th><th>النوع</th><th>الباقة</th><th>المبلغ</th><th>المُحوِّل</th><th>مرجع</th><th>الوصل</th><th>الحالة</th><th>ملاحظة المطوّر</th><th>إجراء</th></tr>
              </thead>
              <tbody>
                {(requests ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>{r.company_name}</td>
                    <td>{requestKindLabel(r.request_kind ?? "new")}</td>
                    <td>{planLabel(r.plan_type)}</td>
                    <td>{r.amount ? money(r.amount) : "—"}</td>
                    <td style={{ whiteSpace: "normal" }}>{r.payer_name || "—"}<br /><span dir="ltr" style={{ color: "var(--muted)", fontSize: 12 }}>{r.payer_phone || ""}</span></td>
                    <td dir="ltr">{r.transfer_ref || "—"}</td>
                    <td>{r.receipt_sent ? "📷 أُرسل على تليجرام" : "—"}</td>
                    <td>
                      <span className={`badge ${r.status === "approved" ? "badge-on" : r.status === "rejected" ? "badge-off" : "badge-warn"}`}>
                        {r.status === "approved" ? "موافق" : r.status === "rejected" ? "مرفوض" : "معلق"}
                      </span>
                      {r.notes && <div style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "normal", maxWidth: 220 }}>{r.notes}</div>}
                    </td>
                    <td>
                      {r.status === "pending" ? (
                        <input
                          className="input"
                          placeholder="ملاحظة (اختياري)"
                          value={reqNotes[r.id] ?? ""}
                          onChange={(e) => setReqNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                        />
                      ) : (r.admin_notes || "—")}
                    </td>
                    <td style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      {r.status === "pending" ? (
                        <>
                          <button className="btn btn-primary btn-row" onClick={() => review(r, true)}>✅ موافقة</button>
                          <button className="btn btn-danger btn-row" onClick={() => review(r, false)}>⛔ رفض</button>
                        </>
                      ) : <span style={{ color: "var(--muted)" }} dir="ltr">{String(r.reviewed_at ?? "").slice(0, 10)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!rows ? (
        <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>جارٍ التحميل…</div>
      ) : (
        <>
          <div style={{ margin: "14px 0 8px" }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="🔍 بحث بالاسم / البريد…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span style={{ color: "var(--muted)", marginRight: 10, fontSize: 13 }}>{filtered.length} من {rows.length}</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>رقم العميل</th><th>الشركة</th><th>المالك</th><th>البريد</th><th>الاشتراك</th><th>الانتهاء</th><th>الحالة</th><th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const st = statusOf(c);
                  const b = STATUS_BADGE[st];
                  return (
                    <Fragment key={c.id}>
                      <tr>
                        <td dir="ltr" style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{c.client_code ?? "—"}</td>
                        <td>{c.name}</td>
                        <td>{c.owner_name}</td>
                        <td dir="ltr">{c.owner_email}</td>
                        <td>{PLAN_LABEL[c.plan_type] ?? c.plan_type}</td>
                        <td dir="ltr">{c.subscription_end ?? "بلا تحديد"}</td>
                        <td><span className={`badge ${b.cls}`}>{b.label}</span></td>
                        <td style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                          <button className="btn btn-row" onClick={() => toggleExpand(c.id)}>📊</button>
                          <button className="btn btn-row" onClick={() => openSub(c)} title="الاشتراك">💳 الاشتراك</button>
                          <button className={`btn ${c.is_active ? "btn-danger" : "btn-primary"}`} onClick={() => toggle(c)}>
                            {c.is_active ? "⏸ إيقاف" : "▶ تفعيل"}
                          </button>
                          <button className="btn btn-row-danger" onClick={() => remove(c)} title="حذف">🗑</button>
                        </td>
                      </tr>
                      {expanded === c.id && c.summary && (
                        <tr>
                          <td colSpan={8} style={{ background: "#f8fafc" }}>
                            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: 8 }}>
                              {[
                                ["العملاء", c.summary.customers], ["الفواتير", c.summary.invoices],
                                ["النقلات", c.summary.trips], ["سندات القبض", c.summary.receipts],
                                ["سندات الدفع", c.summary.payments], ["الرواتب", c.summary.payrolls],
                              ].map(([l, v]) => <div key={l}><b>{l}:</b> {String(v)}</div>)}
                              <div><b>قيمة النقلات:</b> {money(c.summary.revenue)}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {subEdit && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSubEdit(null)}>
          <div className="modal-card" style={{ maxWidth: 460 }}>
            <div className="modal-header"><span>اشتراك: {subEdit.name}</span><button className="btn btn-row" onClick={() => setSubEdit(null)}>✕</button></div>
            <div className="modal-body" style={{ display: "grid", gap: 14 }}>
              <div>
                <label className="field-label">نوع الاشتراك</label>
                <select className="select" value={subForm.plan_type} onChange={(e) => setSubForm({ ...subForm, plan_type: e.target.value as CompanyRow["plan_type"] })}>
                  <option value="trial">تجريبي (7 أيام)</option>
                  <option value="monthly">شهري</option>
                  <option value="yearly">سنوي</option>
                  <option value="open">مفتوح (بلا تحديد)</option>
                </select>
              </div>
              {subForm.plan_type !== "open" && (
                <div>
                  <label className="field-label">تاريخ الانتهاء</label>
                  <input type="date" className="input" dir="ltr" value={subForm.end_date} onChange={(e) => setSubForm({ ...subForm, end_date: e.target.value })} />
                </div>
              )}
              <div className="modal-footer" style={{ padding: 0, border: "none" }}>
                <button className="btn btn-primary" onClick={saveSub}>💾 حفظ</button>
                <button className="btn" onClick={() => setSubEdit(null)}>إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
