"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSession, getCompany, signOut } from "@/lib/auth";
import {
  PRICING, CUSTOMER_PLAN_TYPES, planLabel, planPrice, subscriptionState, stateLabel,
  submitActivationRequest, listMyActivationRequests, cancelMyActivationRequest, uploadReceipt,
  type ActivationRequest,
} from "@/lib/subscription";
import { exportDataExcel, exportDataCsv, exportDataPdf } from "@/lib/dataExport";
import { notify, ToastHost } from "@/components/toast";
import { DeveloperCard, CopyrightLine, useAppSettings } from "@/components/DeveloperInfo";
import { money } from "@/lib/format";
import type { Company } from "@/lib/types";

const VAT = 15;

export default function SubscriptionPage() {
  const router = useRouter();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  const [notes, setNotes] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<ActivationRequest[]>([]);
  const [exporting, setExporting] = useState<"excel" | "csv" | "pdf" | null>(null);
  const settings = useAppSettings();

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session) return router.replace("/login");
      const c = await getCompany();
      if (!c) return router.replace("/onboarding");
      setCompany(c);
      setRequests(await listMyActivationRequests().catch(() => []));
      setLoading(false);
    })();
  }, [router]);

  const state = useMemo(() => subscriptionState(company), [company]);
  const expired = state === "expired" || state === "suspended";
  const hasPending = requests.some((r) => r.status === "pending");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let receiptUrl: string | null = null;
      if (receiptFile) receiptUrl = await uploadReceipt(receiptFile);
      const req = await submitActivationRequest({ plan_type: plan, receipt_url: receiptUrl, notes });

      // إشعار المطوّر عبر الخادم (يعتمد على بيانات حقيقية من قاعدة البيانات)
      try {
        await fetch("/api/zerocold/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_id: req.id }),
        });
      } catch { /* تجاهل فشل الإشعار */ }

      notify("تم إرسال طلب الاشتراك. سيُراجعه المطوّر قريباً.", "success");
      setRequests(await listMyActivationRequests());
      setNotes("");
      setReceiptFile(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const doExport = async (kind: "excel" | "csv" | "pdf") => {
    setExporting(kind);
    try {
      if (kind === "excel") await exportDataExcel();
      else if (kind === "csv") await exportDataCsv();
      else await exportDataPdf();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" /></div>;
  }

  const totalFor = (p: "monthly" | "yearly") => planPrice(p);
  const vatFor = (p: "monthly" | "yearly") => Math.round(totalFor(p) * VAT) / 100;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: 24 }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div className="page-title">الاشتراك والباقات</div>
            <div className="page-sub">{company?.name}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {state !== "expired" && state !== "suspended" && <Link href="/customers" className="btn">↩ العودة للتطبيق</Link>}
            <button className="btn" onClick={async () => { await signOut(); router.replace("/login"); }}>تسجيل الخروج</button>
          </div>
        </div>

        {/* حالة الاشتراك */}
        <div className="page-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className={`badge ${expired ? "badge-off" : state === "trial" ? "badge-warn" : "badge-on"}`}>
              {stateLabel(company)}
            </span>
            {state === "trial" && <span style={{ color: "var(--muted)", fontSize: 13 }}>بعد انتهاء التجربة ستحتاج للاشتراك للاستمرار.</span>}
          </div>

          {expired && (
            <div style={{ marginTop: 14, background: "var(--danger-light)", border: "1px solid #fecaca", borderRadius: 12, padding: 16, color: "var(--danger)" }}>
              <b>انتهت صلاحية الوصول.</b> لتجديد اشتراكك أرسل طلباً أدناه وسيتواصل معك المطوّر، أو حمّل نسخة من بياناتك الآن.
            </div>
          )}
        </div>

        {/* بيانات المطوّر والدعم */}
        <div style={{ marginBottom: 16 }}>
          <DeveloperCard title="👨‍💻 للاشتراك والتجديد — تواصل مع المطوّر" />
          {settings.payment_note && (
            <div className="page-card" style={{ marginTop: 12, color: "var(--muted)", lineHeight: 2 }}>
              {settings.payment_note}
            </div>
          )}
        </div>

        {/* تصدير البيانات */}
        <div className="page-card" style={{ marginBottom: 16 }}>
          <div className="group-title">📥 تحميل بياناتك</div>
          <p className="page-sub" style={{ marginBottom: 12 }}>نسخة احترافية كاملة من جداول بيانات شركتك (متاحة دائماً حتى بعد انتهاء الاشتراك).</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={exporting !== null} onClick={() => doExport("excel")}>📊 Excel</button>
            <button className="btn" disabled={exporting !== null} onClick={() => doExport("pdf")}>📄 PDF</button>
            <button className="btn" disabled={exporting !== null} onClick={() => doExport("csv")}>📃 CSV</button>
          </div>
        </div>

        {/* الباقات */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 16 }}>
          {CUSTOMER_PLAN_TYPES.map((p) => (
            <div key={p} className="page-card" style={{ textAlign: "center", border: plan === p ? "2px solid var(--primary)" : undefined }}>
              <div className="group-title">{planLabel(p)}</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: "var(--primary)" }}>{money(totalFor(p))} <span style={{ fontSize: 15 }}>ر.س</span></div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>+ ضريبة القيمة المضافة {VAT}% ({money(vatFor(p))} ر.س)</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>الإجمالي شامل الضريبة: {money(totalFor(p) + vatFor(p))} ر.س</div>
              <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={() => setPlan(p)}>اختيار</button>
            </div>
          ))}
        </div>

        {/* طلب الاشتراك */}
        <div className="page-card">
          <div className="group-title">📨 طلب اشتراك / تجديد</div>
          {hasPending ? (
            <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 10, padding: 14, color: "var(--warning)" }}>
              لديك طلب معلق قيد المراجعة. سيتواصل معك المطوّر فور الموافقة.
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
              <div>
                <label className="field-label">الباقة</label>
                <select className="select" value={plan} onChange={(e) => setPlan(e.target.value as "monthly" | "yearly")}>
                  <option value="monthly">شهري — {money(PRICING.monthly)} ر.س</option>
                  <option value="yearly">سنوي — {money(PRICING.yearly)} ر.س</option>
                </select>
              </div>
              <div>
                <label className="field-label">صورة الوصل (تُرسل للمطوّر عبر تليجرام)</label>
                <input type="file" accept="image/*" className="input-base" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
              </div>
              <div>
                <label className="field-label">ملاحظات (اختياري)</label>
                <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: تم التحويل من بنك الراجحي" />
              </div>
              <button className="btn btn-primary" disabled={submitting}>{submitting ? "جارٍ الإرسال…" : "إرسال الطلب"}</button>
            </form>
          )}

          {requests.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="group-title">طلباتك السابقة</div>
              <table className="data-table">
                <thead><tr><th>الباقة</th><th>الحالة</th><th>التاريخ</th><th>ملاحظات المطوّر</th><th></th></tr></thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{planLabel(r.plan_type)}</td>
                      <td>
                        <span className={`badge ${r.status === "approved" ? "badge-on" : r.status === "rejected" ? "badge-off" : "badge-warn"}`}>
                          {r.status === "approved" ? "تمت الموافقة" : r.status === "rejected" ? "مرفوض" : "قيد المراجعة"}
                        </span>
                      </td>
                      <td dir="ltr">{r.created_at.slice(0, 10)}</td>
                      <td>{r.admin_notes || "—"}</td>
                      <td>
                        {r.status === "pending" && (
                          <button className="btn btn-row-danger" onClick={async () => { await cancelMyActivationRequest(r.id); setRequests(await listMyActivationRequests()); }}>إلغاء</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <CopyrightLine className="sub-copy" />
      </div>
      <ToastHost />
    </div>
  );
}
