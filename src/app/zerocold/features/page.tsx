"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  createAdditionalUser,
  deleteAdditionalUser,
  getCompanyExtras,
  listCompanies,
  setAdditionalUserStatus,
  setCompanyFeature,
  type CompanyExtras,
  type CompanyRow,
  type CompanyUserRow,
} from "@/lib/admin";
import { notify } from "@/components/toast";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { ALLOWED_EMAIL_HINT } from "@/lib/security";

const EMPTY_EXTRAS: CompanyExtras = {
  features: { tax_invoice: false, additional_user: false },
  users: [],
};

function FeaturesContent() {
  const searchParams = useSearchParams();
  const requestedCompany = searchParams.get("company") ?? "";
  const [companies, setCompanies] = useState<CompanyRow[] | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [extras, setExtras] = useState<CompanyExtras>(EMPTY_EXTRAS);
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [busy, setBusy] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });

  useEffect(() => {
    listCompanies()
      .then((rows) => {
        setCompanies(rows);
        const requestedExists = rows.some((c) => c.id === requestedCompany);
        setCompanyId(requestedExists ? requestedCompany : rows[0]?.id ?? "");
      })
      .catch((e) => notify(e instanceof Error ? e.message : String(e), "error"));
  }, [requestedCompany]);

  const loadExtras = async (id: string) => {
    if (!id) {
      setExtras(EMPTY_EXTRAS);
      return;
    }
    setLoadingExtras(true);
    try {
      setExtras(await getCompanyExtras(id));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
      setExtras(EMPTY_EXTRAS);
    } finally {
      setLoadingExtras(false);
    }
  };

  useEffect(() => { void loadExtras(companyId); }, [companyId]);

  const company = useMemo(() => companies?.find((c) => c.id === companyId) ?? null, [companies, companyId]);
  const owner = extras.users.find((u) => u.role === "owner");
  const additional = extras.users.find((u) => u.role === "additional");
  const additionalEnabled = Boolean(additional?.is_active && extras.features.additional_user);

  const toggleTaxInvoice = async () => {
    if (!company) return;
    const enabled = !extras.features.tax_invoice;
    setBusy("tax");
    try {
      await setCompanyFeature(company.id, "tax_invoice", enabled);
      setExtras((old) => ({ ...old, features: { ...old.features, tax_invoice: enabled } }));
      notify(enabled ? "تم تفعيل جميع خصائص الفاتورة الضريبية لهذه الشركة." : "تم إيقاف الفاتورة الضريبية والباركود لهذه الشركة.", "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy("");
    }
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;
    setBusy("create-user");
    try {
      await createAdditionalUser({ companyId: company.id, ...form });
      notify("تم إنشاء المستخدم الإضافي وبريده مؤكد، ويمكنه تسجيل الدخول مباشرة.", "success");
      setShowAdd(false);
      setForm({ name: "", email: "", phone: "", password: "" });
      await loadExtras(company.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy("");
    }
  };

  const toggleUser = async (user: CompanyUserRow) => {
    if (!company) return;
    const active = !user.is_active;
    setBusy("user-status");
    try {
      await setAdditionalUserStatus(company.id, user.id, active);
      notify(active ? "تم تفعيل المستخدم الإضافي." : "تم إيقاف المستخدم الإضافي.", "success");
      await loadExtras(company.id);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy("");
    }
  };

  const removeUser = async (user: CompanyUserRow) => {
    if (!company) return;
    if (!window.confirm(`سيُحذف حساب «${user.name}» نهائياً ولن يستطيع تسجيل الدخول. هل تريد المتابعة؟`)) return;
    setBusy("delete-user");
    try {
      await deleteAdditionalUser(company.id, user.id);
      notify("تم حذف المستخدم الإضافي.", "success");
      await loadExtras(company.id);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={{ maxWidth: 1050 }}>
      <h1 className="page-title">مميزات إضافية</h1>
      <p className="page-sub">
        جميع المميزات غير مفعّلة افتراضياً. اختر الشركة ثم فعّل ما تحتاجه يدوياً.
      </p>

      <div className="page-card" style={{ margin: "16px 0" }}>
        <Field label="الشركة / المؤسسة">
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={!companies?.length}>
            {!companies?.length && <option value="">لا توجد شركات</option>}
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.client_code ? `${c.client_code} — ` : ""}{c.name}</option>
            ))}
          </Select>
        </Field>
        {company && (
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12, color: "var(--muted)", fontSize: 13 }}>
            <span>المالك: <b style={{ color: "var(--text)" }}>{owner?.name || company.owner_name}</b></span>
            <span dir="ltr">{owner?.email || company.owner_email}</span>
            <span>رقم العميل: <b dir="ltr">{company.client_code ?? "—"}</b></span>
          </div>
        )}
      </div>

      {loadingExtras ? (
        <div className="spinner" />
      ) : company ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <section className="page-card" style={{ borderTop: `4px solid ${extras.features.tax_invoice ? "#16a34a" : "#94a3b8"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div className="group-title" style={{ margin: 0 }}>🧾 الفاتورة الضريبية</div>
                <p className="page-sub" style={{ marginTop: 7, lineHeight: 1.8 }}>
                  حساب الضريبة مستمر دائماً. التفعيل يشغّل التحقق الضريبي وطباعة رمز QR عند اكتمال البيانات.
                </p>
              </div>
              <span className={`badge ${extras.features.tax_invoice ? "badge-on" : "badge-off"}`}>
                {extras.features.tax_invoice ? "مفعّلة" : "متوقفة"}
              </span>
            </div>
            {!extras.features.tax_invoice && (
              <div style={{ padding: 10, borderRadius: 8, background: "rgba(245, 158, 11, .12)", color: "#92400e", lineHeight: 1.7, marginBottom: 12, fontSize: 13 }}>
                الباركود لن يُطبع، وسيظهر لصاحب الشركة فقط تنبيه أن الفاتورة لا تطابق معايير زاتكا.
              </div>
            )}
            <Button variant={extras.features.tax_invoice ? "danger" : "primary"} onClick={toggleTaxInvoice} disabled={busy !== ""}>
              {busy === "tax" ? "جارٍ الحفظ…" : extras.features.tax_invoice ? "إلغاء التفعيل" : "تفعيل الفاتورة الضريبية"}
            </Button>
          </section>

          <section className="page-card" style={{ borderTop: `4px solid ${additionalEnabled ? "#16a34a" : "#94a3b8"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div className="group-title" style={{ margin: 0 }}>👤 المستخدم الإضافي</div>
                <p className="page-sub" style={{ marginTop: 7, lineHeight: 1.8 }}>
                  حساب واحد إضافي ببريد مؤكد يصل إلى بيانات الشركة نفسها.
                </p>
              </div>
              <span className={`badge ${additionalEnabled ? "badge-on" : "badge-off"}`}>
                {additionalEnabled ? "مفعّل" : "غير مفعّل"}
              </span>
            </div>

            {additional ? (
              <div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 12, lineHeight: 1.9 }}>
                  <div><b>{additional.name}</b></div>
                  <div dir="ltr" style={{ textAlign: "right", color: "var(--muted)" }}>{additional.email}</div>
                  <div dir="ltr" style={{ textAlign: "right", color: "var(--muted)" }}>{additional.phone || "—"}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button variant={additional.is_active ? "danger" : "primary"} onClick={() => toggleUser(additional)} disabled={busy !== ""}>
                    {busy === "user-status" ? "جارٍ الحفظ…" : additional.is_active ? "إيقاف المستخدم" : "إعادة التفعيل"}
                  </Button>
                  <Button variant="row-danger" onClick={() => removeUser(additional)} disabled={busy !== ""}>
                    {busy === "delete-user" ? "جارٍ الحذف…" : "حذف الحساب"}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ color: "var(--muted)", fontSize: 13 }}>لا يوجد مستخدم إضافي لهذه الشركة.</p>
                <Button variant="primary" onClick={() => setShowAdd(true)}>إضافة مستخدم إضافي</Button>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {showAdd && company && (
        <Modal title={`إضافة مستخدم إلى ${company.name}`} onClose={() => busy === "" && setShowAdd(false)} width={620}>
          <form onSubmit={addUser} style={{ display: "grid", gap: 13 }}>
            <Field label="الاسم" required>
              <Input value={form.name} maxLength={120} autoComplete="off" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="البريد الإلكتروني" required hint={`النطاقات المقبولة: ${ALLOWED_EMAIL_HINT}`}>
              <Input type="email" dir="ltr" value={form.email} autoComplete="off" onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="الهاتف" required>
              <Input type="tel" dir="ltr" value={form.phone} maxLength={24} autoComplete="off" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="كلمة المرور" required hint="8 أحرف على الأقل وتحتوي على حروف وأرقام. لن تُحفظ أو تظهر بعد الإنشاء.">
              <div style={{ display: "flex", gap: 8 }}>
                <Input
                  type={showPassword ? "text" : "password"}
                  dir="ltr"
                  value={form.password}
                  minLength={8}
                  maxLength={72}
                  autoComplete="new-password"
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <Button type="button" variant="row" onClick={() => setShowPassword((v) => !v)}>{showPassword ? "إخفاء" : "إظهار"}</Button>
              </div>
            </Field>
            <div style={{ padding: 10, borderRadius: 8, background: "rgba(37, 99, 235, .08)", lineHeight: 1.7, fontSize: 13 }}>
              سيُعتبر البريد مؤكداً فوراً لأن الحساب يُنشأ يدوياً من لوحة المطوّر.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Button type="submit" variant="primary" disabled={busy !== ""}>
                {busy === "create-user" ? "جارٍ إنشاء الحساب…" : "إنشاء وتفعيل المستخدم"}
              </Button>
              <Button type="button" onClick={() => setShowAdd(false)} disabled={busy !== ""}>إلغاء</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function AdminFeaturesPage() {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <FeaturesContent />
    </Suspense>
  );
}
