"use client";

import { useEffect, useMemo, useState } from "react";
import { PageFrame, Field, Input, Select, Button } from "@/components/ui";
import { companyInfo, saveCompanySettings } from "@/lib/repo";
import { notify } from "@/components/toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DEFAULT_PRINT_SETTINGS,
  PAPER_SIZES,
  ORIENTATIONS,
  getPrintSettings,
  savePrintSettings,
  printCss,
  paperDimensions,
  PRINT_TEMPLATES,
  getTemplate,
  type PrintSettings,
  type PrintTemplate,
} from "@/lib/print";
import { buildReportHtml, printHtml } from "@/lib/exporter";
import {
  ENTITY_TYPES, TAX_STATUSES, SA_REGIONS, COUNTRIES,
  formatNationalAddress, validateTaxProfile,
} from "@/lib/tax";
import { docOptions } from "@/lib/exportHelper";

type Tab = "company" | "print" | "appearance" | "about";

const TABS: { key: Tab; label: string }[] = [
  { key: "company", label: "🏢 بيانات الشركة" },
  { key: "print", label: "🖨️ إعدادات الطباعة" },
  { key: "appearance", label: "🎨 المظهر" },
  { key: "about", label: "ℹ️ معلومات النظام" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("company");

  // بيانات الشركة
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [currency, setCurrency] = useState("");
  const [vatNote, setVatNote] = useState("");
  const [vatRate, setVatRate] = useState("15");
  /** بقية بيانات المنشأة (ضريبية + عنوان وطني) في كائن واحد. */
  const [org, setOrg] = useState<Record<string, string>>({
    company_name_en: "", company_email: "", company_website: "",
    company_tax_number: "", company_commercial_reg: "", company_unified_number: "",
    company_entity_type: "establishment", company_tax_status: "taxable",
    company_country: "SA", company_region: "", company_city: "", company_district: "",
    company_street: "", company_building_no: "", company_postal_code: "",
    company_additional_no: "", company_address_note: "",
  });
  const setOrgField = (k: string, v: string) => setOrg((p) => ({ ...p, [k]: v }));

  // الطباعة
  const [ps, setPs] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [savingPrint, setSavingPrint] = useState(false);

  useEffect(() => {
    companyInfo().then((info) => {
      setName(info.company_name);
      setPhone(info.company_phone);
      setAddress(info.company_address);
      setCurrency(info.currency);
      setVatNote(info.company_vat_note);
      setVatRate(info.vat_rate ?? "15");
      setOrg((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(prev)) if (info[k] !== undefined) next[k] = info[k];
        return next;
      });
    });
    getPrintSettings().then(setPs);
  }, []);

  const saveCompany = async () => {
    const problems = validateTaxProfile({
      tax_number: org.company_tax_number,
      commercial_reg: org.company_commercial_reg,
      postal_code: org.company_postal_code,
      building_no: org.company_building_no,
      additional_no: org.company_additional_no,
      tax_status: org.company_tax_status,
    });
    if (problems.length) {
      notify(problems[0], "error");
      return;
    }
    try {
      // طلب تحديث واحد لجميع الأعمدة بدل ~19 طلباً متتالياً (سبب بطء الحفظ)
      await saveCompanySettings({
        company_name: name,
        company_phone: phone,
        company_address: address,
        currency: currency,
        company_vat_note: vatNote,
        vat_rate: vatRate || "15",
        ...org,
      });
      notify("تم حفظ الإعدادات بنجاح.", "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const set = <K extends keyof PrintSettings>(k: K, v: PrintSettings[K]) => setPs((p) => ({ ...p, [k]: v }));

  const savePrint = async () => {
    setSavingPrint(true);
    try {
      await savePrintSettings(ps);
      notify("تم حفظ إعدادات الطباعة — ستُطبَّق على كل التقارير والفواتير.", "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSavingPrint(false);
    }
  };

  /** صفحة تجريبية بنفس محرك الطباعة الفعلي. */
  const testPrint = async () => {
    const info = await companyInfo();
    const html = buildReportHtml({
      info,
      title: "صفحة تجريبية لإعدادات الطباعة",
      subtitle: "هذه معاينة حقيقية بنفس محرّك طباعة التقارير",
      headers: ["#", "البيان", "المبلغ", "التاريخ"],
      rows: Array.from({ length: 8 }, (_, i) => [i + 1, `سطر تجريبي رقم ${i + 1}`, (1000 * (i + 1)).toLocaleString("en-US"), "2026-01-0" + ((i % 9) + 1)]),
      summaryLines: [["الإجمالي", "36,000.00"], ["عدد السطور", "8"]],
      centerFrom: 1,
      doc: docOptions(ps),
    });
    printHtml(html, "صفحة تجريبية", { css: printCss(ps), watermark: ps.watermark });
  };

  /** نفس محرّك الطباعة، لكن داخل إطار معاينة بدل نافذة الطباعة. */
  const previewHtml = useMemo(() => {
    const body = buildReportHtml({
      info: {
        company_name: name || "اسم الشركة",
        company_phone: phone,
        company_address: address,
        currency: currency || "ر.س",
        company_vat_note: vatNote,
        vat_rate: vatRate,
      },
      title: "معاينة مباشرة لإعدادات الطباعة",
      subtitle: "تتغيّر فوراً مع كل تعديل — لا حاجة للحفظ أولاً",
      headers: ["#", "البيان", "المبلغ", "التاريخ"],
      rows: Array.from({ length: 5 }, (_, i) => [
        i + 1,
        `سطر تجريبي رقم ${i + 1}`,
        (1000 * (i + 1)).toLocaleString("en-US"),
        `2026-01-0${(i % 9) + 1}`,
      ]),
      summaryLines: [["الإجمالي", "15,000.00"], ["عدد السطور", "5"]],
      centerFrom: 1,
      doc: docOptions(ps),
    });
    const wm = ps.watermark
      ? `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
            font-size:60px;color:rgba(0,0,0,.07);transform:rotate(-30deg);pointer-events:none">${ps.watermark}</div>`
      : "";
    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
      <style>${printCss(ps)}
        body{margin:0;padding:10px;background:#fff}
      </style></head><body>${wm}${body}</body></html>`;
  }, [ps, name, phone, address, currency, vatNote, vatRate]);

  const dims = paperDimensions(ps);

  return (
    <PageFrame title="إعدادات النظام" subtitle="بيانات الشركة، الطباعة، والمظهر">
      <div className="tabs-head" style={{ overflowX: "auto" }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------------- بيانات الشركة ---------------- */}
      {tab === "company" && (
        <>
          <div className="group-box" style={{ marginTop: 0 }}>
            <div className="group-title">🏢 بيانات المنشأة (تظهر في ترويسة كل التقارير والفواتير)</div>
            <div className="form-grid-2">
              <Field label="اسم المنشأة" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="الاسم بالإنجليزية"><Input dir="ltr" value={org.company_name_en} onChange={(e) => setOrgField("company_name_en", e.target.value)} /></Field>
            </div>
            <div className="form-grid-3">
              <Field label="الهاتف"><Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" /></Field>
              <Field label="البريد الإلكتروني"><Input dir="ltr" value={org.company_email} onChange={(e) => setOrgField("company_email", e.target.value)} /></Field>
              <Field label="الموقع الإلكتروني"><Input dir="ltr" value={org.company_website} onChange={(e) => setOrgField("company_website", e.target.value)} /></Field>
            </div>
            <div className="form-grid-3">
              <Field label="رمز العملة"><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
              <Field label="نسبة ضريبة القيمة المضافة %"><Input value={vatRate} onChange={(e) => setVatRate(e.target.value)} dir="ltr" inputMode="decimal" /></Field>
              <Field label="عبارة أسفل الفواتير"><Input value={vatNote} onChange={(e) => setVatNote(e.target.value)} /></Field>
            </div>
          </div>

          <div className="group-box">
            <div className="group-title">🧾 البيانات الضريبية والسجلات الرسمية</div>
            <div className="form-grid-3">
              <Field label="الرقم الضريبي (15 رقماً)">
                <Input dir="ltr" inputMode="numeric" maxLength={15} placeholder="3XXXXXXXXXXXXX3"
                  value={org.company_tax_number} onChange={(e) => setOrgField("company_tax_number", e.target.value)} />
                <span className="field-hint">يظهر في الفاتورة الضريبية ورمز الاستجابة السريعة.</span>
              </Field>
              <Field label="رقم السجل التجاري (10 أرقام)">
                <Input dir="ltr" inputMode="numeric" maxLength={10}
                  value={org.company_commercial_reg} onChange={(e) => setOrgField("company_commercial_reg", e.target.value)} />
              </Field>
              <Field label="الرقم الموحّد للمنشأة">
                <Input dir="ltr" inputMode="numeric" maxLength={10}
                  value={org.company_unified_number} onChange={(e) => setOrgField("company_unified_number", e.target.value)} />
              </Field>
            </div>
            <div className="form-grid-2">
              <Field label="نوع المنشأة">
                <Select value={org.company_entity_type} onChange={(e) => setOrgField("company_entity_type", e.target.value)}>
                  {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
              <Field label="الحالة الضريبية">
                <Select value={org.company_tax_status} onChange={(e) => setOrgField("company_tax_status", e.target.value)}>
                  {TAX_STATUSES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
            </div>
          </div>

          <div className="group-box">
            <div className="group-title">📍 العنوان الوطني التفصيلي</div>
            <div className="form-grid-3">
              <Field label="الدولة">
                <Select value={org.company_country} onChange={(e) => setOrgField("company_country", e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </Select>
              </Field>
              <Field label="المنطقة">
                <Input list="org-regions" value={org.company_region} onChange={(e) => setOrgField("company_region", e.target.value)} />
                <datalist id="org-regions">{SA_REGIONS.map((r) => <option key={r} value={r} />)}</datalist>
              </Field>
              <Field label="المدينة"><Input value={org.company_city} onChange={(e) => setOrgField("company_city", e.target.value)} /></Field>
            </div>
            <div className="form-grid-2">
              <Field label="الحي"><Input value={org.company_district} onChange={(e) => setOrgField("company_district", e.target.value)} /></Field>
              <Field label="الشارع"><Input value={org.company_street} onChange={(e) => setOrgField("company_street", e.target.value)} /></Field>
            </div>
            <div className="form-grid-3">
              <Field label="رقم المبنى (4 أرقام)"><Input dir="ltr" inputMode="numeric" maxLength={4} value={org.company_building_no} onChange={(e) => setOrgField("company_building_no", e.target.value)} /></Field>
              <Field label="الرمز البريدي (5 أرقام)"><Input dir="ltr" inputMode="numeric" maxLength={5} value={org.company_postal_code} onChange={(e) => setOrgField("company_postal_code", e.target.value)} /></Field>
              <Field label="الرقم الإضافي (4 أرقام)"><Input dir="ltr" inputMode="numeric" maxLength={4} value={org.company_additional_no} onChange={(e) => setOrgField("company_additional_no", e.target.value)} /></Field>
            </div>
            <Field label="العنوان المختصر (سطر واحد يظهر في الترويسة)">
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            {formatNationalAddress({
              country: org.company_country, region: org.company_region, city: org.company_city,
              district: org.company_district, street: org.company_street,
              building_no: org.company_building_no, postal_code: org.company_postal_code,
              additional_no: org.company_additional_no,
            }) && (
              <div className="field-hint" style={{ marginTop: 6 }}>
                العنوان المُجمّع: <b>{formatNationalAddress({
                  country: org.company_country, region: org.company_region, city: org.company_city,
                  district: org.company_district, street: org.company_street,
                  building_no: org.company_building_no, postal_code: org.company_postal_code,
                  additional_no: org.company_additional_no,
                })}</b>
              </div>
            )}
          </div>

          <div className="group-box btn-group">
            <Button variant="primary" onClick={saveCompany}>💾 حفظ بيانات المنشأة</Button>
          </div>
        </>
      )}

      {/* ---------------- إعدادات الطباعة ---------------- */}
      {tab === "print" && (
        <>
          <div className="print-settings-layout">
            <div className="print-settings-forms">
          <div className="group-box" style={{ marginTop: 0 }}>
            <div className="group-title">🎨 قالب الطباعة</div>
            <p className="page-sub" style={{ marginBottom: 10 }}>
              اختر قالب فاتورة العميل هنا — التقارير والسندات تستخدم قالباً احترافياً موحّداً تلقائياً.
            </p>
            <div className="tpl-grid">
              {PRINT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`tpl-card${ps.template === t.id ? " active" : ""}`}
                  onClick={() => setPs((p) => ({ ...p, template: t.id as PrintTemplate, accent_color: t.accent }))}
                >
                  <span className="tpl-swatch" style={{ background: t.accent }} />
                  <span className="tpl-name">{t.name}</span>
                  <span className="tpl-desc">{t.description}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginTop: 14 }}>
              <Field label="اللون الرئيسي للقالب">
                <div className="color-row">
                  <input type="color" className="color-input" value={ps.accent_color}
                    onChange={(e) => set("accent_color", e.target.value)} aria-label="اللون الرئيسي" />
                  <Input dir="ltr" value={ps.accent_color} onChange={(e) => set("accent_color", e.target.value)} />
                </div>
              </Field>
              <Field label="لون رأس الجدول">
                <div className="color-row">
                  <input type="color" className="color-input" value={ps.header_color}
                    onChange={(e) => set("header_color", e.target.value)} aria-label="لون رأس الجدول" />
                  <Input dir="ltr" value={ps.header_color} onChange={(e) => set("header_color", e.target.value)} />
                </div>
              </Field>
              <Field label="ألوان جاهزة">
                <div className="color-presets">
                  {["#1d4ed8", "#0f766e", "#b45309", "#9d174d", "#334155", "#111827"].map((c) => (
                    <button key={c} type="button" className="color-dot" style={{ background: c }}
                      title={c} aria-label={`اللون ${c}`}
                      onClick={() => setPs((p) => ({ ...p, accent_color: c, header_color: c }))} />
                  ))}
                </div>
              </Field>
            </div>
            <div className="page-sub" style={{ marginTop: 8 }}>
              القالب الحالي: <b>{getTemplate(ps.template).name}</b>
            </div>
          </div>

          <div className="group-box">
            <div className="group-title">📄 الورق والهوامش</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <Field label="حجم الورق">
                <Select value={ps.paper} onChange={(e) => set("paper", e.target.value as PrintSettings["paper"])}>
                  {PAPER_SIZES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="اتجاه الصفحة">
                <Select value={ps.orientation} onChange={(e) => set("orientation", e.target.value as PrintSettings["orientation"])}>
                  {ORIENTATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label="الهوامش (مم)">
                <Input type="number" min={0} max={40} dir="ltr" value={ps.margin_mm}
                  onChange={(e) => set("margin_mm", Number(e.target.value))} />
              </Field>
              <Field label="حجم الخط (نقطة)">
                <Input type="number" min={6} max={18} step={0.5} dir="ltr" value={ps.font_size_pt}
                  onChange={(e) => set("font_size_pt", Number(e.target.value))} />
              </Field>
            </div>
            <div className="page-sub" style={{ marginTop: 8 }}>
              المقاس الفعلي للصفحة: <b dir="ltr">{dims.w} × {dims.h} mm</b>
            </div>
          </div>

          <div className="group-box">
            <div className="group-title">🏷️ الترويسة</div>
            <div style={{ display: "grid", gap: 10 }}>
              <Check label="إظهار ترويسة الشركة أعلى كل مستند" checked={ps.show_header} onChange={(v) => set("show_header", v)} />
              <Check label="إظهار هاتف الشركة" checked={ps.show_phone} onChange={(v) => set("show_phone", v)} />
              <Check label="إظهار عنوان الشركة" checked={ps.show_address} onChange={(v) => set("show_address", v)} />
              <Check label="إظهار شعار الشركة" checked={ps.show_logo} onChange={(v) => set("show_logo", v)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <Field label="رابط الشعار (URL)"><Input dir="ltr" value={ps.logo_url} placeholder="https://…/logo.png" onChange={(e) => set("logo_url", e.target.value)} /></Field>
              <Field label="نص إضافي أسفل الترويسة"><Input value={ps.header_note} onChange={(e) => set("header_note", e.target.value)} /></Field>
            </div>
          </div>

          <div className="group-box">
            <div className="group-title">🧾 الجدول والمحتوى</div>
            <div style={{ display: "grid", gap: 10 }}>
              <Check label="خطوط شبكية حول الخلايا" checked={ps.grid_lines} onChange={(v) => set("grid_lines", v)} />
              <Check label="تظليل الصفوف بالتناوب" checked={ps.zebra} onChange={(v) => set("zebra", v)} />
              <Check label="إظهار تاريخ ووقت الطباعة" checked={ps.show_date} onChange={(v) => set("show_date", v)} />
              <Check label="إظهار عدد السجلات أسفل الجدول" checked={ps.show_count} onChange={(v) => set("show_count", v)} />
            </div>
          </div>

          <div className="group-box">
            <div className="group-title">📝 بيانات فاتورة العميل (تحكّم بكل بند على حدة)</div>
            <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
              <Field label="لغة تسميات الحقول في الفاتورة">
                <Select value={ps.label_language} onChange={(e) => set("label_language", e.target.value as PrintSettings["label_language"])}>
                  <option value="ar">العربية فقط</option>
                  <option value="en">English only</option>
                </Select>
              </Field>
              <span className="field-hint" style={{ marginTop: -4 }}>تُعرض التسمية بلغة واحدة فقط — لن تظهر «هاتف / Tel» معاً.</span>
            </div>
            <div className="tpl-grid">
              <Check label="اسم المنشأة" checked={ps.invoice_show_company_name} onChange={(v) => set("invoice_show_company_name", v)} />
              <Check label="الرقم الضريبي للمنشأة" checked={ps.invoice_show_company_tax_number} onChange={(v) => set("invoice_show_company_tax_number", v)} />
              <Check label="السجل التجاري للمنشأة" checked={ps.invoice_show_company_cr} onChange={(v) => set("invoice_show_company_cr", v)} />
              <Check label="عنوان المنشأة" checked={ps.invoice_show_company_address} onChange={(v) => set("invoice_show_company_address", v)} />
              <Check label="هاتف المنشأة" checked={ps.invoice_show_company_phone} onChange={(v) => set("invoice_show_company_phone", v)} />
              <Check label="بريد المنشأة" checked={ps.invoice_show_company_email} onChange={(v) => set("invoice_show_company_email", v)} />
              <Check label="موقع المنشأة" checked={ps.invoice_show_company_website} onChange={(v) => set("invoice_show_company_website", v)} />
              <Check label="الرقم الموحّد للمنشأة" checked={ps.invoice_show_company_unified} onChange={(v) => set("invoice_show_company_unified", v)} />
              <Check label="اسم العميل" checked={ps.invoice_show_customer_name} onChange={(v) => set("invoice_show_customer_name", v)} />
              <Check label="كود العميل" checked={ps.invoice_show_customer_code} onChange={(v) => set("invoice_show_customer_code", v)} />
              <Check label="الرقم الضريبي للعميل" checked={ps.invoice_show_customer_tax_number} onChange={(v) => set("invoice_show_customer_tax_number", v)} />
              <Check label="السجل التجاري للعميل" checked={ps.invoice_show_customer_cr} onChange={(v) => set("invoice_show_customer_cr", v)} />
              <Check label="عنوان العميل" checked={ps.invoice_show_customer_address} onChange={(v) => set("invoice_show_customer_address", v)} />
              <Check label="هاتف العميل" checked={ps.invoice_show_customer_phone} onChange={(v) => set("invoice_show_customer_phone", v)} />
              <Check label="رمز العملة" checked={ps.invoice_show_currency} onChange={(v) => set("invoice_show_currency", v)} />
              <Check label="الباركود (يُطبع فقط عند اكتمال بيانات الشركة والعميل)" checked={ps.invoice_show_barcode} onChange={(v) => set("invoice_show_barcode", v)} />
            </div>
          </div>

          <div className="group-box">
            <div className="group-title">✍️ التذييل والتوقيع</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="نص التذييل (يظهر أسفل كل مستند)"><Input value={ps.footer_text} onChange={(e) => set("footer_text", e.target.value)} /></Field>
              <Field label="مسمى خانة التوقيع"><Input value={ps.signature_label} onChange={(e) => set("signature_label", e.target.value)} /></Field>
              <Field label="علامة مائية (اتركها فارغة لإلغائها)"><Input value={ps.watermark} onChange={(e) => set("watermark", e.target.value)} placeholder="مثال: نسخة غير رسمية" /></Field>
            </div>
            <div style={{ marginTop: 10 }}>
              <Check label="إظهار خانة التوقيع والختم" checked={ps.show_signature} onChange={(v) => set("show_signature", v)} />
            </div>
          </div>

          <div className="group-box btn-group">
            <Button variant="primary" onClick={savePrint} disabled={savingPrint}>
              {savingPrint ? "جارٍ الحفظ…" : "💾 حفظ إعدادات الطباعة"}
            </Button>
            <Button onClick={testPrint}>🖨️ طباعة صفحة تجريبية</Button>
            <Button onClick={() => setPs(DEFAULT_PRINT_SETTINGS)}>↺ استعادة الافتراضي</Button>
          </div>
            </div>

            {/* ---------- المعاينة الحيّة ---------- */}
            <aside className="print-preview-pane">
              <div className="group-box" style={{ marginTop: 0 }}>
                <div className="group-title">👁️ معاينة مباشرة</div>
                <div className="page-sub" style={{ marginBottom: 8 }}>
                  {getTemplate(ps.template).name} — {dims.w} × {dims.h} mm
                </div>
                <iframe
                  className="print-preview-frame"
                  title="معاينة الطباعة"
                  sandbox=""
                  srcDoc={previewHtml}
                />
              </div>
            </aside>
          </div>
        </>
      )}

      {/* ---------------- المظهر ---------------- */}
      {tab === "appearance" && (
        <div className="group-box" style={{ marginTop: 0 }}>
          <div className="group-title">🎨 الوضع الفاتح / الداكن</div>
          <p className="page-sub" style={{ marginBottom: 12 }}>
            يُطبَّق على كل الشاشات ويُحفظ في هذا المتصفّح. عند أول زيارة يتبع النظام إعداد جهازك تلقائياً.
          </p>
          <div style={{ maxWidth: 260 }}><ThemeToggle /></div>
        </div>
      )}

      {/* ---------------- معلومات النظام ---------------- */}
      {tab === "about" && (
        <div className="group-box" style={{ marginTop: 0 }}>
          <div className="group-title">معلومات النظام</div>
          <ul style={{ lineHeight: 2, color: "var(--muted)", paddingInlineStart: 20 }}>
            <li>النظام المحاسبي المتكامل لشركة النقل — الإصدار 2.0.0</li>
            <li>قاعدة البيانات: Supabase (PostgreSQL) مع عزل كامل لبيانات كل شركة.</li>
            <li>يعمل على المتصفّح في الحاسب والجوال بلا تثبيت.</li>
          </ul>
        </div>
      )}
    </PageFrame>
  );
}

/** مربع اختيار موحّد بمساحة لمس مناسبة للجوال. */
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
