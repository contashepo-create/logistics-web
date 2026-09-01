"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { getSession, getCompany } from "@/lib/auth";
import {
  PRICING, CURRENCY, planLabel, planPrice, vatOf, totalWithVat, subscriptionState,
  submitSubscriptionRequest, listMyActivationRequests, requestKindLabel,
  type RequestKind, type ActivationRequest,
} from "@/lib/subscription";
import { notify, ToastHost } from "@/components/toast";
import { DeveloperCard, useAppSettings } from "@/components/DeveloperInfo";
import { money } from "@/lib/format";
import { MAX_UPLOAD_MB } from "@/lib/uploadLimits";
import type { Company } from "@/lib/types";

const PAY_METHODS: { id: string; label: string }[] = [
  { id: "instapay", label: "إنستاباي" },
  { id: "vodafone_cash", label: "فودافون كاش" },
  { id: "bank_transfer", label: "تحويل بنكي" },
  { id: "cash", label: "نقداً" },
  { id: "other", label: "أخرى" },
];

function UpgradeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const settings = useAppSettings();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [requests, setRequests] = useState<ActivationRequest[]>([]);
  const [done, setDone] = useState(false);

  const initialPlan = params.get("plan") === "yearly" ? "yearly" : "monthly";
  const [f, setF] = useState({
    plan: initialPlan as "monthly" | "yearly",
    kind: "new" as RequestKind,
    payer_name: "", payer_phone: "", pay_method: "instapay", transfer_ref: "", notes: "",
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptErr, setReceiptErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!(await getSession())) return router.replace("/login");
      const c = await getCompany();
      if (!c) return router.replace("/onboarding");
      setCompany(c);
      const st = subscriptionState(c);
      setF((o) => ({ ...o, kind: st === "trial" || st === "none" ? "new" : st === "expired" ? "renew" : "upgrade" }));
      setRequests(await listMyActivationRequests().catch(() => []));
      setLoading(false);
    })();
  }, [router]);

  const net = planPrice(f.plan);
  const total = totalWithVat(net);
  const hasPending = useMemo(() => requests.some((r) => r.status === "pending"), [requests]);

  const pickReceipt = (file: File | null) => {
    setReceiptErr("");
    if (!file) return setReceipt(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setReceipt(null);
      return setReceiptErr("الصيغ المقبولة: JPG أو PNG أو WEBP فقط.");
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setReceipt(null);
      return setReceiptErr(`الحجم الأقصى ${MAX_UPLOAD_MB} ميجابايت.`);
    }
    setReceipt(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.payer_name.trim().length < 3) return notify("أدخل اسم مُحوِّل المبلغ.", "error");
    if (f.payer_phone.replace(/\D/g, "").length < 8) return notify("أدخل رقم هاتف صحيح.", "error");
    setSending(true);
    try {
      await submitSubscriptionRequest({
        plan_type: f.plan, request_kind: f.kind, amount: total,
        payer_name: f.payer_name, payer_phone: f.payer_phone,
        pay_method: f.pay_method, transfer_ref: f.transfer_ref, notes: f.notes,
        receipt,
      });
      setDone(true);
      setRequests(await listMyActivationRequests().catch(() => []));
      notify("تم إرسال الطلب وصورة الوصل إلى المطوّر.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><div className="spinner" /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: 24 }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="page-title">ترقية / تجديد الاشتراك</div>
            <div className="page-sub">{company?.name} — رقم العميل <b dir="ltr">{company?.client_code}</b></div>
          </div>
          <Link href="/subscription" className="btn">↩ صفحة الاشتراك</Link>
        </div>

        {done ? (
          <div className="page-card" style={{ textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 44 }}>✅</div>
            <h2 className="group-title">تم استلام طلبك</h2>
            <p className="page-sub">وصل الطلب إلى المطوّر مع صورة الوصل. سيتم تفعيل الباقة فور المراجعة، وتظهر الحالة في صفحة الاشتراك.</p>
            <Link href="/subscription" className="btn btn-primary" style={{ marginTop: 12 }}>متابعة حالة الطلب</Link>
          </div>
        ) : hasPending ? (
          <div className="page-card">
            <div className="group-title">⏳ لديك طلب قيد المراجعة</div>
            <p className="page-sub">لا يمكن إرسال طلب جديد قبل مراجعة الطلب الحالي. يمكنك إلغاؤه من صفحة الاشتراك ثم إعادة الإرسال.</p>
            <Link href="/subscription" className="btn">عرض الطلبات</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="page-card upg-form">
            <div className="inv-sec-title"><span>1️⃣ اختر الباقة ونوع الطلب</span></div>
            <div className="form-grid-2">
              <div className="field">
                <label className="field-label">نوع الطلب <span className="req">*</span></label>
                <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as RequestKind })}>
                  <option value="new">اشتراك جديد (بعد التجربة)</option>
                  <option value="upgrade">ترقية الباقة</option>
                  <option value="renew">تجديد الاشتراك الحالي</option>
                </select>
              </div>
              <div className="field">
                <label className="field-label">الباقة <span className="req">*</span></label>
                <select className="select" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value as "monthly" | "yearly" })}>
                  <option value="monthly">{planLabel("monthly")} — {money(PRICING.monthly)} {CURRENCY}</option>
                  <option value="yearly">{planLabel("yearly")} — {money(PRICING.yearly)} {CURRENCY} (وفّر {money(PRICING.yearlyDiscount)})</option>
                </select>
              </div>
            </div>

            <div className="upg-total">
              <div><span>سعر الباقة (غير شامل الضريبة)</span><b>{money(net)} {CURRENCY}</b></div>
              <div><span>ضريبة القيمة المضافة {PRICING.vatRate}%</span><b>{money(vatOf(net))} {CURRENCY}</b></div>
              <div className="grand"><span>المبلغ المطلوب تحويله</span><b>{money(total)} {CURRENCY}</b></div>
            </div>

            <div className="inv-sec-title"><span>2️⃣ بيانات التحويل</span></div>
            <div className="form-grid-2">
              <div className="field">
                <label className="field-label">اسم مُحوِّل المبلغ <span className="req">*</span></label>
                <input className="input" value={f.payer_name} maxLength={120} onChange={(e) => setF({ ...f, payer_name: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">هاتف المُحوِّل <span className="req">*</span></label>
                <input className="input" dir="ltr" value={f.payer_phone} maxLength={24} onChange={(e) => setF({ ...f, payer_phone: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">طريقة الدفع <span className="req">*</span></label>
                <select className="select" value={f.pay_method} onChange={(e) => setF({ ...f, pay_method: e.target.value })}>
                  {PAY_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">رقم عملية التحويل</label>
                <input className="input" dir="ltr" value={f.transfer_ref} maxLength={80} onChange={(e) => setF({ ...f, transfer_ref: e.target.value })} />
              </div>
            </div>

            <div className="inv-sec-title"><span>3️⃣ صورة الوصل</span></div>
            <div className="field">
              <label className="field-label">أرفق صورة الوصل (تُرسل مباشرة إلى تليجرام المطوّر)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="input-base"
                onChange={(e) => pickReceipt(e.target.files?.[0] ?? null)} />
              <div className="field-hint">
                🔒 لا تُخزَّن أي صورة على الموقع إطلاقاً — تُمرَّر من الذاكرة إلى تليجرام المطوّر ثم تُهمَل.
                الصيغ: JPG/PNG/WEBP، الحد {MAX_UPLOAD_MB} ميجابايت.
              </div>
              {receipt && <div style={{ color: "var(--success)", fontSize: 12.5, marginTop: 4 }}>✔ {receipt.name}</div>}
              {receiptErr && <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 4 }}>{receiptErr}</div>}
            </div>

            <div className="field">
              <label className="field-label">ملاحظات</label>
              <textarea className="textarea" maxLength={800} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })}
                placeholder="مثال: تم التحويل اليوم الساعة 3 عصراً من محفظة …" />
            </div>

            <button className="btn btn-primary" disabled={sending} style={{ width: "100%" }}>
              {sending ? "جارٍ الإرسال…" : "📨 إرسال الطلب للمطوّر"}
            </button>
          </form>
        )}

        <div style={{ marginTop: 16 }}>
          <DeveloperCard title="💳 بيانات التحويل والتواصل" />
          {settings.payment_note && (
            <div className="page-card" style={{ marginTop: 12, color: "var(--muted)", lineHeight: 2 }}>{settings.payment_note}</div>
          )}
        </div>

        {requests.length > 0 && (
          <div className="page-card" style={{ marginTop: 16 }}>
            <div className="group-title">سجل طلباتك</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>النوع</th><th>الباقة</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th></tr></thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{requestKindLabel(r.request_kind ?? "new")}</td>
                      <td>{planLabel(r.plan_type)}</td>
                      <td>{r.amount ? `${money(r.amount)} ${CURRENCY}` : "—"}</td>
                      <td>{r.status === "approved" ? "تمت الموافقة" : r.status === "rejected" ? "مرفوض" : "قيد المراجعة"}</td>
                      <td dir="ltr">{String(r.created_at).slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <ToastHost />
    </div>
  );
}

export default function UpgradePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><div className="spinner" /></div>}>
      <UpgradeInner />
    </Suspense>
  );
}
