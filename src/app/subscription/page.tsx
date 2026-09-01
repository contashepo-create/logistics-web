"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSession, getCompany, getProfile, signOut } from "@/lib/auth";
import {
  PRICING, CURRENCY, CUSTOMER_PLAN_TYPES, planLabel, planPrice, vatOf, totalWithVat,
  subscriptionState, stateLabel, daysLeft, TRIAL_DAYS,
  listMyActivationRequests, cancelMyActivationRequest, requestKindLabel,
  type ActivationRequest,
} from "@/lib/subscription";
import { exportDataExcel, exportDataCsv, exportDataPdf } from "@/lib/dataExport";
import { notify, ToastHost } from "@/components/toast";
import { DeveloperCard, CopyrightLine, useAppSettings } from "@/components/DeveloperInfo";
import { money } from "@/lib/format";
import type { Company, Profile } from "@/lib/types";

export default function SubscriptionPage() {
  const router = useRouter();
  const [company, setCompany] = useState<Company | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
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
      setProfile(await getProfile());
      setRequests(await listMyActivationRequests().catch(() => []));
      setLoading(false);
    })();
  }, [router]);

  const state = useMemo(() => subscriptionState(company), [company]);
  const expired = state === "expired" || state === "suspended";
  const hasPending = requests.some((r) => r.status === "pending");
  const currentPlan = company?.plan_type;
  const canRequest = (p: "monthly" | "yearly") => {
    if (expired || state === "trial" || currentPlan === "open") return expired || state === "trial";
    if (p === currentPlan) return daysLeft(company) <= 4;
    // لا يمكن النزول من سنوي إلى شهري، والترقية من شهري إلى سنوي مسموحة.
    return currentPlan === "monthly" && p === "yearly";
  };
  const vatRate = Number(company?.vat_rate) >= 0 ? Number(company?.vat_rate) : PRICING.vatRate;

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

  const info: [string, string][] = [
    ["رقم العميل", company?.client_code ?? "—"],
    ["اسم الشركة", company?.name ?? "—"],
    ["مسؤول الحساب", profile?.name || "—"],
    ["البريد المسجّل", profile?.email || company?.email || "—"],
    ["الهاتف", company?.phone || "—"],
    ["الباقة الحالية", planLabel(company?.plan_type ?? "trial")],
    ["حالة الاشتراك", stateLabel(company)],
    ["بداية الاشتراك", company?.subscription_start || "—"],
    ["نهاية الاشتراك", company?.subscription_end || (company?.plan_type === "open" ? "مفتوح بلا تحديد" : "—")],
    ["نهاية التجربة", company?.trial_end || "—"],
    ["الأيام المتبقية", Number.isFinite(daysLeft(company)) ? `${daysLeft(company)} يوم` : "بلا حد"],
    ["حالة الحساب", company?.is_active ? "نشط" : "موقوف"],
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: 24 }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 10, flexWrap: "wrap" }}>
          <div>
            <div className="page-title">الاشتراك والباقات</div>
            <div className="page-sub">{company?.name}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!expired && <Link href="/customers" className="btn">↩ العودة للتطبيق</Link>}
            <Link href="/support" className="btn">💬 مراسلة المطوّر</Link>
            <Link href="/upgrade" className="btn btn-primary">⬆ ترقية / تجديد</Link>
            <button className="btn" onClick={async () => { await signOut(); router.replace("/login"); }}>تسجيل الخروج</button>
          </div>
        </div>

        {/* بطاقة رقم العميل */}
        <div className="page-card sub-idcard">
          <div>
            <div className="sub-idcard-k">رقم العميل الخاص بك</div>
            <div className="sub-idcard-v" dir="ltr">{company?.client_code ?? "—"}</div>
            <div className="sub-idcard-note">رقم فريد عشوائي (8 خانات) — اذكره عند التواصل مع الدعم أو عند التحويل.</div>
          </div>
          <span className={`badge ${expired ? "badge-off" : state === "trial" ? "badge-warn" : "badge-on"}`}>{stateLabel(company)}</span>
        </div>

        {state === "trial" && (
          <div className="page-card" style={{ marginTop: 12, borderRight: "4px solid var(--warning)" }}>
            أنت على <b>الباقة التجريبية المجانية ({TRIAL_DAYS} أيام)</b> — متبقٍ {daysLeft(company)} يوم.
            بعدها ستحتاج للاشتراك الشهري أو السنوي للاستمرار، وبياناتك تبقى محفوظة كما هي.
          </div>
        )}

        {expired && (
          <div className="page-card" style={{ marginTop: 12, background: "var(--danger-light)", border: "1px solid #fecaca", color: "var(--danger)" }}>
            <b>انتهت صلاحية الوصول.</b> جدّد اشتراكك من صفحة الترقية، أو حمّل نسخة من بياناتك الآن.
          </div>
        )}

        {/* بيانات الاشتراك التفصيلية */}
        <div className="page-card" style={{ marginTop: 16 }}>
          <div className="group-title">📄 بيانات اشتراكك</div>
          <div className="sub-info-grid">
            {info.map(([k, v]) => (
              <div className="sub-info-item" key={k}>
                <span className="k">{k}</span>
                <span className="v" dir={k === "رقم العميل" || k === "البريد المسجّل" ? "ltr" : undefined}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* الباقات والأسعار */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 16 }}>
          <div className="page-card" style={{ textAlign: "center" }}>
            <div className="group-title">الباقة التجريبية</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "var(--success)" }}>مجاناً</div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{TRIAL_DAYS} أيام كاملة بكل المزايا</div>
          </div>
          {CUSTOMER_PLAN_TYPES.map((p) => (
            <div key={p} className="page-card" style={{ textAlign: "center" }}>
              <div className="group-title">{planLabel(p)}</div>
              {p === "yearly" && (
                <div style={{ color: "var(--muted)", fontSize: 13, textDecoration: "line-through" }}>
                  {money(PRICING.yearlyBefore)} {CURRENCY}
                </div>
              )}
              <div style={{ fontSize: 30, fontWeight: 800, color: "var(--primary)" }}>
                {money(planPrice(p))} <span style={{ fontSize: 15 }}>{CURRENCY}</span>
              </div>
              {p === "yearly" && <div style={{ color: "var(--success)", fontSize: 13, fontWeight: 700 }}>وفّر {money(PRICING.yearlyDiscount)} {CURRENCY}</div>}
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                غير شامل الضريبة — ض.ق.م {vatRate}% ({money(planPrice(p) * vatRate / 100)} {CURRENCY})
              </div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>الإجمالي: {money(planPrice(p) * (1 + vatRate / 100))} {CURRENCY}</div>
              {currentPlan === p && state === "active" && daysLeft(company) > 4 ? (
                <div className="badge badge-on" style={{ marginTop: 12, display: "block" }}>باقتك الحالية — متبقي {daysLeft(company)} يوم</div>
              ) : canRequest(p) ? (
                <Link href={`/upgrade?plan=${p}`} className="btn btn-primary" style={{ marginTop: 12, width: "100%", display: "block", textAlign: "center" }}>
                  {expired ? "تجديد" : currentPlan === p ? "تجديد مبكر (خلال 4 أيام)" : "ترقية إلى هذه الباقة"}
                </Link>
              ) : (
                <div className="field-hint" style={{ marginTop: 12 }}>غير متاح حالياً — لا يمكن النزول أو تغيير الباقة قبل آخر 4 أيام.</div>
              )}
            </div>
          ))}
        </div>

        {/* بيانات المطوّر والدعم */}
        <div style={{ marginTop: 16 }}>
          <DeveloperCard title="👨‍💻 للاشتراك والتجديد — تواصل مع المطوّر" />
          {settings.payment_note && (
            <div className="page-card" style={{ marginTop: 12, color: "var(--muted)", lineHeight: 2 }}>{settings.payment_note}</div>
          )}
        </div>

        {/* تصدير البيانات */}
        <div className="page-card" style={{ marginTop: 16 }}>
          <div className="group-title">📥 تحميل بياناتك</div>
          <p className="page-sub" style={{ marginBottom: 12 }}>نسخة كاملة من جداول شركتك (متاحة دائماً حتى بعد انتهاء الاشتراك).</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={exporting !== null} onClick={() => doExport("excel")}>📊 Excel</button>
            <button className="btn" disabled={exporting !== null} onClick={() => doExport("pdf")}>📄 PDF</button>
            <button className="btn" disabled={exporting !== null} onClick={() => doExport("csv")}>📃 CSV</button>
          </div>
        </div>

        {/* الطلبات السابقة */}
        <div className="page-card" style={{ marginTop: 16 }}>
          <div className="group-title">📨 طلباتك</div>
          {hasPending && (
            <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 10, padding: 12, color: "var(--warning)", marginBottom: 12 }}>
              لديك طلب معلق قيد المراجعة.
            </div>
          )}
          {requests.length === 0 ? (
            <div className="exp-empty">لا توجد طلبات بعد. <Link href="/upgrade" className="auth-link">أرسل طلب ترقية أو تجديد</Link>.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>النوع</th><th>الباقة</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th><th>رد المطوّر</th><th></th></tr></thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{requestKindLabel(r.request_kind ?? "new")}</td>
                      <td>{planLabel(r.plan_type)}</td>
                      <td>{r.amount ? `${money(r.amount)} ${CURRENCY}` : "—"}</td>
                      <td>
                        <span className={`badge ${r.status === "approved" ? "badge-on" : r.status === "rejected" ? "badge-off" : "badge-warn"}`}>
                          {r.status === "approved" ? "تمت الموافقة" : r.status === "rejected" ? "مرفوض" : "قيد المراجعة"}
                        </span>
                      </td>
                      <td dir="ltr">{String(r.created_at).slice(0, 10)}</td>
                      <td>{r.admin_notes || "—"}</td>
                      <td>
                        {r.status === "pending" && (
                          <button className="btn btn-row-danger" onClick={async () => {
                            await cancelMyActivationRequest(r.id);
                            setRequests(await listMyActivationRequests());
                          }}>إلغاء</button>
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
