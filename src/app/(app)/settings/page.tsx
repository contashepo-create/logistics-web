"use client";

import { useEffect, useState } from "react";
import { PageFrame, Field, Input, Select, Button } from "@/components/ui";
import { getSetting, setSetting, companyInfo } from "@/lib/repo";
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
  type PrintSettings,
} from "@/lib/print";
import { buildReportHtml, printHtml } from "@/lib/exporter";
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
    });
    getPrintSettings().then(setPs);
  }, []);

  const saveCompany = async () => {
    try {
      await setSetting("company_name", name);
      await setSetting("company_phone", phone);
      await setSetting("company_address", address);
      await setSetting("currency", currency);
      await setSetting("company_vat_note", vatNote);
      await setSetting("vat_rate", vatRate || "15");
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
        <div className="group-box" style={{ marginTop: 0 }}>
          <div className="group-title">بيانات الشركة (تظهر في ترويسة كل التقارير والفواتير)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="اسم الشركة"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="هاتف الشركة"><Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" /></Field>
            <Field label="عنوان الشركة"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            <Field label="رمز العملة"><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
            <Field label="نسبة ضريبة القيمة المضافة %"><Input value={vatRate} onChange={(e) => setVatRate(e.target.value)} dir="ltr" inputMode="decimal" /></Field>
            <Field label="عبارة أسفل الفواتير"><Input value={vatNote} onChange={(e) => setVatNote(e.target.value)} /></Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="primary" onClick={saveCompany}>💾 حفظ بيانات الشركة</Button>
          </div>
        </div>
      )}

      {/* ---------------- إعدادات الطباعة ---------------- */}
      {tab === "print" && (
        <>
          <div className="group-box" style={{ marginTop: 0 }}>
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
