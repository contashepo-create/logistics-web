"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import {
  listCompanies,
  setCompanyStatus,
  setSubscription,
  deleteCompany,
  listActivationRequests,
  reviewActivationRequest,
  resetCompanyData,
  updateCompanyIdentity,
  type CompanyRow,
} from "@/lib/admin";
import { notify } from "@/components/toast";
import { money } from "@/lib/format";
import { planLabel, requestKindLabel, subscriptionState, type ActivationRequest } from "@/lib/subscription";
import type { Company } from "@/lib/types";

/** الحالة تُشتق من نفس المنطق المستخدم في واجهة العميل (مصدر واحد للحقيقة). */
function statusOf(c: CompanyRow): "active" | "trial" | "expired" | "suspended" | "none" {
  return subscriptionState(c as unknown as Company);
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "badge-on" },
  trial: { label: "تجريبي", cls: "badge-warn" },
  expired: { label: "منتهي", cls: "badge-off" },
  suspended: { label: "موقوف", cls: "badge-off" },
  none: { label: "بدون اشتراك", cls: "badge-off" },
};

const PLAN_LABEL: Record<string, string> = { trial: "تجريبي", monthly: "شهري", yearly: "سنوي", open: "مفتوح" };

export default function AdminCompaniesPage() {
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [subEdit, setSubEdit] = useState<CompanyRow | null>(null);
  const [subForm, setSubForm] = useState({ plan_type: "open" as CompanyRow["plan_type"], end_date: "" });
  const [requests, setRequests] = useState<(ActivationRequest & { company_name: string })[] | null>(null);
  const [reqNotes, setReqNotes] = useState<Record<string, string>>({});
  const [identityEdit, setIdentityEdit] = useState<CompanyRow | null>(null);
  const [identityForm, setIdentityForm] = useState({ name: "", phone: "", email: "", newPassword: "" });
  const [resetTarget, setResetTarget] = useState<CompanyRow | null>(null);
  const [resetForm, setResetForm] = useState({ confirmName: "", developerPassword: "" });
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [resetting, setResetting] = useState(false);

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

  const openIdentity = (c: CompanyRow) => {
    setIdentityForm({
      name: c.name ?? "",
      phone: c.phone || c.owner_phone || "",
      email: c.owner_email && c.owner_email !== "—" ? c.owner_email : c.email || "",
      newPassword: "",
    });
    setIdentityEdit(c);
  };

  const saveIdentity = async () => {
    if (!identityEdit || savingIdentity) return;
    setSavingIdentity(true);
    try {
      await updateCompanyIdentity({
        companyId: identityEdit.id,
        name: identityForm.name,
        phone: identityForm.phone,
        email: identityForm.email,
        newPassword: identityForm.newPassword,
      });
      notify("تم تحديث الشركة وحساب المالك.", "success");
      setIdentityEdit(null);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSavingIdentity(false);
    }
  };

  const openReset = (c: CompanyRow) => {
    setResetForm({ confirmName: "", developerPassword: "" });
    setResetTarget(c);
  };

  const confirmReset = async () => {
    if (!resetTarget || resetting) return;
    setResetting(true);
    try {
      const result = await resetCompanyData({
        companyId: resetTarget.id,
        confirmName: resetForm.confirmName,
        developerPassword: resetForm.developerPassword,
      });
      notify(`تم تصفير بيانات العمل وحذف ${result.deleted_rows ?? 0} سجلاً، وإنشاء سنة ${result.new_financial_year}.`, "success");
      setResetTarget(null);
      setResetForm({ confirmName: "", developerPassword: "" });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setResetting(false);
    }
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
                          <button className="btn btn-row" onClick={() => openIdentity(c)} title="تعديل بيانات الشركة والحساب">✏️ تعديل</button>
                          <button className="btn btn-row" onClick={() => openSub(c)} title="الاشتراك">💳 الاشتراك</button>
                          <Link className="btn btn-row" href={`/zerocold/features?company=${encodeURIComponent(c.id)}`} title="المميزات والمستخدمون">✨ المميزات</Link>
                          <button className="btn btn-reset" onClick={() => openReset(c)} title="تصفير بيانات العمل مع بقاء الشركة">↺ تصفير البيانات</button>
                          <button className={`btn ${c.is_active ? "btn-danger" : "btn-primary"}`} onClick={() => toggle(c)}>
                            {c.is_active ? "⏸ إيقاف" : "▶ تفعيل"}
                          </button>
                          <button className="btn btn-row-danger" onClick={() => remove(c)} title="حذف الشركة بالكامل">🗑</button>
                        </td>
                      </tr>
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

      {identityEdit && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !savingIdentity && setIdentityEdit(null)}>
          <form className="modal-card" style={{ maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); void saveIdentity(); }}>
            <div className="modal-header">
              <span>تعديل الشركة وحساب المالك</span>
              <button type="button" className="btn btn-row" onClick={() => setIdentityEdit(null)} disabled={savingIdentity}>✕</button>
            </div>
            <div className="modal-body admin-form-grid">
              <div className="admin-info-note">
                تغيير البريد أو الهاتف يُزامَن مع حساب مالك الشركة. اترك كلمة المرور فارغة إذا لم ترد تغييرها.
              </div>
              <label>
                <span className="field-label">اسم الشركة</span>
                <input className="input" value={identityForm.name} onChange={(e) => setIdentityForm((p) => ({ ...p, name: e.target.value }))} required maxLength={120} />
              </label>
              <label>
                <span className="field-label">الهاتف</span>
                <input className="input" dir="ltr" inputMode="tel" value={identityForm.phone} onChange={(e) => setIdentityForm((p) => ({ ...p, phone: e.target.value }))} required autoComplete="tel" />
              </label>
              <label>
                <span className="field-label">بريد تسجيل دخول المالك</span>
                <input className="input" dir="ltr" type="email" value={identityForm.email} onChange={(e) => setIdentityForm((p) => ({ ...p, email: e.target.value }))} required autoComplete="email" />
              </label>
              <label>
                <span className="field-label">كلمة مرور جديدة للعميل (اختياري)</span>
                <input className="input" dir="ltr" type="password" value={identityForm.newPassword} onChange={(e) => setIdentityForm((p) => ({ ...p, newPassword: e.target.value }))} minLength={8} maxLength={72} autoComplete="new-password" placeholder="حروف وأرقام — 8 أحرف على الأقل" />
              </label>
              <div className="modal-footer" style={{ padding: 0, border: "none" }}>
                <button type="submit" className="btn btn-primary" disabled={savingIdentity}>{savingIdentity ? "جارٍ الحفظ…" : "💾 حفظ التعديلات"}</button>
                <button type="button" className="btn" onClick={() => setIdentityEdit(null)} disabled={savingIdentity}>إلغاء</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {resetTarget && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !resetting && setResetTarget(null)}>
          <form className="modal-card reset-modal" onSubmit={(e) => { e.preventDefault(); void confirmReset(); }}>
            <div className="modal-header reset-modal-head">
              <span>⚠️ تصفير بيانات عمل الشركة</span>
              <button type="button" className="btn btn-row" onClick={() => setResetTarget(null)} disabled={resetting}>✕</button>
            </div>
            <div className="modal-body admin-form-grid">
              <div className="reset-warning">
                <strong>ستُحذف نهائياً بيانات العمل الخاصة بـ «{resetTarget.name}»</strong>
                <p>يشمل ذلك العملاء والفواتير والنقلات والموردين والمشتريات والموظفين والرواتب والسندات والمصروفات والأرصدة.</p>
                <p>لن تُحذف الشركة أو بياناتها الأساسية أو حساباتها أو اشتراكها أو مميزاتها أو طلباتها ورسائل الدعم والشكاوى. ستُنشأ سنة مالية فارغة للسنة الحالية.</p>
              </div>
              <label>
                <span className="field-label">اكتب اسم الشركة كما يظهر للتأكيد</span>
                <input className="input" value={resetForm.confirmName} onChange={(e) => setResetForm((p) => ({ ...p, confirmName: e.target.value }))} autoComplete="off" placeholder={resetTarget.name} required />
              </label>
              <label>
                <span className="field-label">كلمة مرور المطوّر</span>
                <input className="input" dir="ltr" type="password" value={resetForm.developerPassword} onChange={(e) => setResetForm((p) => ({ ...p, developerPassword: e.target.value }))} autoComplete="current-password" required />
              </label>
              <div className="modal-footer" style={{ padding: 0, border: "none" }}>
                <button type="submit" className="btn btn-danger" disabled={resetting || resetForm.confirmName !== resetTarget.name || !resetForm.developerPassword}>
                  {resetting ? "جارٍ التصفير…" : "تصفير بيانات العمل نهائياً"}
                </button>
                <button type="button" className="btn" onClick={() => setResetTarget(null)} disabled={resetting}>إلغاء</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
