// إعدادات الطباعة لكل شركة — تُحفظ في عمود companies.print_settings (jsonb)
// وتُطبَّق على كل مخرجات الطباعة و PDF (التقارير، الجداول، كشوف الحسابات).

import { supabase } from "./supabase";
import { getCompany, invalidateCompanyCache } from "./repo";
import { translateDbError } from "./db";
import { safeField, safeUrl } from "./security";

export type PaperSize = "A4" | "A5" | "Letter";
export type Orientation = "portrait" | "landscape";
/** القوالب الستة المنقولة والمكيّفة من مشروع pro-acc. */
export type PrintTemplate = "modern" | "classic" | "compact" | "elegant" | "logistics" | "thermal" | "minimal";

export interface PrintSettings {
  /** القالب الاحترافي المستخدم في الفواتير */
  template: PrintTemplate;
  /** لغة تسميات الحقول في المطبوعات: عربي أو إنجليزي فقط (لا تُعرض معاً) */
  label_language: "ar" | "en";
  /** اللون الرئيسي للقالب */
  accent_color: string;
  paper: PaperSize;
  orientation: Orientation;
  margin_mm: number;
  font_size_pt: number;
  /** ترويسة الشركة (الاسم/الهاتف/العنوان) أعلى كل مستند */
  show_header: boolean;
  show_phone: boolean;
  show_address: boolean;
  /** شعار الشركة (رابط صورة) */
  show_logo: boolean;
  logo_url: string;
  /** نص إضافي أسفل الترويسة */
  header_note: string;
  /** تاريخ ووقت الطباعة */
  show_date: boolean;
  /** عدد السجلات أسفل الجدول */
  show_count: boolean;
  /** تذييل + خانة التوقيع */
  footer_text: string;
  show_signature: boolean;
  signature_label: string;
  /** تنسيق الجدول */
  zebra: boolean;
  grid_lines: boolean;
  header_color: string;
  /** علامة مائية اختيارية */
  watermark: string;

  // ---------- بيانات الفاتورة المطبوعة (تظهر/تختفي حسب تفعيلك) ----------
  invoice_show_company_name: boolean;
  invoice_show_company_tax_number: boolean;
  invoice_show_company_cr: boolean;
  invoice_show_company_address: boolean;
  invoice_show_company_phone: boolean;
  invoice_show_company_email: boolean;
  invoice_show_company_website: boolean;
  invoice_show_company_unified: boolean;
  invoice_show_customer_name: boolean;
  invoice_show_customer_code: boolean;
  invoice_show_customer_tax_number: boolean;
  invoice_show_customer_cr: boolean;
  invoice_show_customer_address: boolean;
  invoice_show_customer_phone: boolean;
  invoice_show_barcode: boolean;
  invoice_show_currency: boolean;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  template: "modern",
  label_language: "ar",
  accent_color: "#1d4ed8",
  paper: "A4",
  orientation: "portrait",
  margin_mm: 12,
  font_size_pt: 10,
  show_header: true,
  show_phone: true,
  show_address: true,
  show_logo: false,
  logo_url: "",
  header_note: "",
  show_date: true,
  show_count: true,
  footer_text: "",
  show_signature: false,
  signature_label: "التوقيع والختم",
  zebra: true,
  grid_lines: true,
  header_color: "#1f4e79",
  watermark: "",
  invoice_show_company_name: true,
  invoice_show_company_tax_number: true,
  invoice_show_company_cr: true,
  invoice_show_company_address: true,
  invoice_show_company_phone: true,
  invoice_show_company_email: false,
  invoice_show_company_website: false,
  invoice_show_company_unified: false,
  invoice_show_customer_name: true,
  invoice_show_customer_code: true,
  invoice_show_customer_tax_number: true,
  invoice_show_customer_cr: true,
  invoice_show_customer_address: true,
  invoice_show_customer_phone: true,
  // يتحكم المطوّر فعلياً في الطباعة عبر ميزة tax_invoice؛ والافتراضي الآمن متوقف.
  invoice_show_barcode: false,
  invoice_show_currency: true,
};

export const PAPER_SIZES: { value: PaperSize; label: string }[] = [
  { value: "A4", label: "A4 (21 × 29.7 سم)" },
  { value: "A5", label: "A5 (14.8 × 21 سم)" },
  { value: "Letter", label: "Letter (21.6 × 27.9 سم)" },
];

export interface PrintTemplateDef {
  id: PrintTemplate;
  name: string;
  description: string;
  /** لون افتراضي مقترح للقالب */
  accent: string;
}

export const PRINT_TEMPLATES: PrintTemplateDef[] = [
  { id: "modern", name: "عصري (Modern)", description: "تصميم تقني عصري ببطاقات معلومات وشريط ترويسة أنيق.", accent: "#2563eb" },
  { id: "classic", name: "كلاسيكي (Classic)", description: "قالب محاسبي رسمي بإطارات واضحة وجدول كامل الحدود.", accent: "#1e293b" },
  { id: "compact", name: "مدمج (Compact)", description: "قالب اقتصادي عالي الكفاءة يضغط المساحات في ورقة واحدة.", accent: "#0d9488" },
  { id: "elegant", name: "فاخر (Elegant)", description: "قالب راقٍ بخطوط دقيقة وزوايا ناعمة وهوية بصرية قوية.", accent: "#7c3aed" },
  { id: "logistics", name: "تشغيلي للنقل (Logistics)", description: "نسخة مكيّفة لقطاع النقل تعرض المسار والحاوية والكمية بوضوح.", accent: "#b45309" },
  { id: "thermal", name: "إيصال حراري (80mm)", description: "تصميم إيصال ضيق للطباعة السريعة مع إجماليات ورمز QR.", accent: "#000000" },
];

export function getTemplate(id: string): PrintTemplateDef {
  return PRINT_TEMPLATES.find((t) => t.id === id) ?? PRINT_TEMPLATES[0];
}

export const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: "portrait", label: "طولي (Portrait)" },
  { value: "landscape", label: "عرضي (Landscape)" },
];

const PRINT_BOOLEAN_KEYS: (keyof PrintSettings)[] = [
  "show_header", "show_phone", "show_address", "show_logo", "show_date", "show_count",
  "show_signature", "zebra", "grid_lines", "invoice_show_company_name",
  "invoice_show_company_tax_number", "invoice_show_company_cr", "invoice_show_company_address",
  "invoice_show_company_phone", "invoice_show_company_email", "invoice_show_company_website",
  "invoice_show_company_unified", "invoice_show_customer_name", "invoice_show_customer_code",
  "invoice_show_customer_tax_number", "invoice_show_customer_cr", "invoice_show_customer_address",
  "invoice_show_customer_phone", "invoice_show_barcode", "invoice_show_currency",
];

function normalizedPrintText(value: unknown, label: string, max: number, fallback: string, strict: boolean): string {
  try { return safeField(value, { label, max }); }
  catch (error) {
    if (strict) throw error;
    return fallback;
  }
}

function normalizedColor(value: unknown, label: string, fallback: string, strict: boolean): string {
  const color = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (strict) throw new Error(`${label} يجب أن يكون لوناً سداسياً صالحاً مثل #1d4ed8.`);
  return fallback;
}

function normalizedNumber(value: unknown, label: string, min: number, max: number, fallback: number, strict: boolean): number {
  const n = Number(value);
  if (Number.isFinite(n) && n >= min && n <= max) return n;
  if (strict) throw new Error(`${label} خارج النطاق المسموح (${min} إلى ${max}).`);
  return fallback;
}

function normalize(raw: unknown, strict = false): PrintSettings {
  if (raw != null && (typeof raw !== "object" || Array.isArray(raw))) {
    if (strict) throw new Error("إعدادات الطباعة يجب أن تكون كائناً صالحاً.");
    return { ...DEFAULT_PRINT_SETTINGS };
  }
  const o = (raw ?? {}) as Partial<PrintSettings> & { template?: string };
  const requested = o.template === "minimal" ? "compact" : o.template;
  const template = PRINT_TEMPLATES.some((t) => t.id === requested)
    ? requested as PrintTemplate
    : DEFAULT_PRINT_SETTINGS.template;
  if (strict && o.template != null && template !== requested) throw new Error("قالب الطباعة غير صالح.");

  const settings: PrintSettings = {
    ...DEFAULT_PRINT_SETTINGS,
    template,
    label_language: o.label_language === "ar" || o.label_language === "en" ? o.label_language : DEFAULT_PRINT_SETTINGS.label_language,
    paper: PAPER_SIZES.some((p) => p.value === o.paper) ? o.paper as PaperSize : DEFAULT_PRINT_SETTINGS.paper,
    orientation: o.orientation === "portrait" || o.orientation === "landscape" ? o.orientation : DEFAULT_PRINT_SETTINGS.orientation,
    accent_color: normalizedColor(o.accent_color, "اللون الرئيسي", DEFAULT_PRINT_SETTINGS.accent_color, strict),
    header_color: normalizedColor(o.header_color, "لون رأس الجدول", DEFAULT_PRINT_SETTINGS.header_color, strict),
    margin_mm: normalizedNumber(o.margin_mm ?? DEFAULT_PRINT_SETTINGS.margin_mm, "هامش الطباعة", 0, 40, DEFAULT_PRINT_SETTINGS.margin_mm, strict),
    font_size_pt: normalizedNumber(o.font_size_pt ?? DEFAULT_PRINT_SETTINGS.font_size_pt, "حجم الخط", 6, 18, DEFAULT_PRINT_SETTINGS.font_size_pt, strict),
    logo_url: "",
    header_note: normalizedPrintText(o.header_note ?? "", "ملاحظة الترويسة", 500, "", strict),
    footer_text: normalizedPrintText(o.footer_text ?? "", "نص التذييل", 500, "", strict),
    signature_label: normalizedPrintText(o.signature_label ?? DEFAULT_PRINT_SETTINGS.signature_label, "مسمى التوقيع", 100, DEFAULT_PRINT_SETTINGS.signature_label, strict),
    watermark: normalizedPrintText(o.watermark ?? "", "العلامة المائية", 80, "", strict),
  };
  try { settings.logo_url = safeUrl(o.logo_url ?? "", "رابط الشعار"); }
  catch (error) {
    if (strict) throw error;
    settings.logo_url = "";
  }
  for (const key of PRINT_BOOLEAN_KEYS) {
    const incoming = o[key];
    if (typeof incoming === "boolean") (settings as unknown as Record<string, unknown>)[key] = incoming;
    else if (strict && incoming != null) throw new Error(`قيمة إعداد الطباعة «${String(key)}» يجب أن تكون true أو false.`);
  }
  if (strict && o.label_language != null && o.label_language !== "ar" && o.label_language !== "en") throw new Error("لغة تسميات الطباعة غير صالحة.");
  if (strict && o.paper != null && !PAPER_SIZES.some((p) => p.value === o.paper)) throw new Error("حجم ورق الطباعة غير صالح.");
  if (strict && o.orientation != null && o.orientation !== "portrait" && o.orientation !== "landscape") throw new Error("اتجاه الطباعة غير صالح.");
  return settings;
}

/** قراءة إعدادات الطباعة للشركة الحالية (مع الافتراضيات). */
export async function getPrintSettings(): Promise<PrintSettings> {
  try {
    const c = await getCompany();
    return normalize((c as unknown as Record<string, unknown> | null)?.print_settings);
  } catch {
    return { ...DEFAULT_PRINT_SETTINGS };
  }
}

/** حفظ إعدادات الطباعة للشركة الحالية. */
export async function savePrintSettings(ps: PrintSettings): Promise<void> {
  const c = await getCompany();
  if (!c) throw new Error("لا توجد شركة مرتبطة بحسابك.");
  const { error } = await supabase.from("companies").update({ print_settings: normalize(ps, true) }).eq("id", c.id);
  invalidateCompanyCache();
  if (error) throw new Error(translateDbError(error.message));
}

/** أبعاد الورق بالمليمتر (عرض × ارتفاع) بعد مراعاة الاتجاه. */
export function paperDimensions(ps: PrintSettings): { w: number; h: number } {
  const base: Record<PaperSize, [number, number]> = { A4: [210, 297], A5: [148, 210], Letter: [216, 279] };
  const [w, h] = base[ps.paper] ?? base.A4;
  return ps.orientation === "landscape" ? { w: h, h: w } : { w, h };
}

/** ورقة الأنماط المستخدمة في نافذة الطباعة و PDF (تختلف بحسب القالب). */
export function printCss(input: PrintSettings): string {
  // دفاع إضافي لأن القيم تُدمج في CSS داخل نافذة الطباعة.
  const ps = normalize(input);
  const { w, h } = paperDimensions(ps);
  const fs = ps.font_size_pt;
  const accent = ps.accent_color || "#1d4ed8";
  const t = ps.template ?? "modern";
  const thermal = t === "thermal";

  // فروق القوالب: كثافة، حدود، ألوان الرؤوس، وشكل الترويسة
  const pad = thermal ? "2px 3px" : t === "compact" ? "2.5px 5px" : t === "elegant" ? "6px 8px" : "4px 6px";
  const scale = thermal ? -1.5 : t === "compact" ? -0.7 : t === "elegant" ? 0.4 : 0;
  const size = (d = 0) => `${(fs + scale + d).toFixed(1)}pt`;

  const gridBorder =
    thermal ? "border: none; border-bottom: 0.6pt dashed #111827;"
    : t === "elegant" ? "border: none; border-bottom: 0.5pt solid #cbd5e1;"
    : t === "classic" ? "border: 0.9pt solid #334155;"
    : ps.grid_lines ? "border: 0.6pt solid #9fb0c2;" : "border: none;";

  const theadStyle =
    thermal ? "background: transparent; color: #111827; border-bottom: 1.2pt solid #111827;"
    : t === "elegant" ? `background: ${accent}; color: #fff;`
    : t === "logistics" ? `background: #1e293b; color: #fff;`
    : `background: ${accent}; color: #fff;`;

  const headBlock =
    t === "modern"
      ? `.doc-head { text-align: center; padding-bottom: 6px; border-bottom: 2.5pt solid ${accent}; }`
      : t === "classic"
      ? `.doc-head { text-align: center; padding: 6px; border: 1pt solid ${accent}; }`
      : t === "elegant"
      ? `.doc-head { text-align: center; padding-bottom: 8px; border-bottom: 0.6pt solid ${accent}; letter-spacing: .4px; }`
      : t === "logistics"
      ? `.doc-head { text-align: center; padding: 6px; border-top: 5pt solid ${accent}; }`
      : thermal
      ? ".doc-head { text-align: center; padding-bottom: 4px; border-bottom: 1pt dashed #111827; }"
      : `.doc-head { text-align: center; margin-bottom: 4px; }`;

  const zebra = ps.zebra && t !== "elegant" && !thermal
    ? "tbody tr:nth-child(even) td { background: #f2f6fa; }" : "";

  const pageSize = thermal ? "80mm 297mm" : `${w}mm ${h}mm`;
  const pageMargin = thermal ? 4 : ps.margin_mm;
  return `
    @page { size: ${pageSize}; margin: ${pageMargin}mm; }
    body {
      font-family: 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;
      color: #10202f; font-size: ${size()}; margin: 0; padding: ${pageMargin}mm;
      ${t === "elegant" ? "line-height: 1.85;" : ""}
      ${thermal ? "width:72mm;box-sizing:border-box;color:#000;" : ""}
    }
    ${headBlock}
    .doc-logo { max-height: ${thermal ? 40 : t === "compact" ? 46 : 70}px; margin-bottom: 6px; }
    .doc-company { font-size: ${size(t === "compact" || thermal ? 3 : 6)}; font-weight: 800; color: ${thermal ? "#111827" : accent}; }
    .doc-contact { font-size: ${size(-1)}; color: #33475b; }
    .doc-note { font-size: ${size(-1)}; color: #33475b; margin-top: 2px; }
    .doc-title {
      text-align: center; font-size: ${size(3)}; font-weight: 800; margin: ${t === "compact" ? "5px 0 2px" : "10px 0 2px"};
      ${t === "modern" ? `color: ${accent};` : ""}
      ${t === "elegant" ? "letter-spacing: 1px; font-weight: 600;" : ""}
    }
    .doc-sub { text-align: center; font-size: ${size(-0.5)}; color: #33475b; margin-bottom: 8px; }
    .doc-meta { display: flex; justify-content: space-between; font-size: ${size(-1.5)}; color: #5a6b7d; margin-bottom: 6px; }
    hr { border: none; border-top: 1px solid #b9c6d4; margin: 6px 0; }
    table { border-collapse: collapse; width: 100%; font-size: ${size()}; }
    table td, table th { ${gridBorder} padding: ${pad}; }
    thead { display: table-header-group; }
    thead th { ${theadStyle} font-weight: 800; }
    tr { page-break-inside: avoid; }
    ${zebra}
    .doc-foot { margin-top: 10px; font-size: ${size(-1)}; color: #33475b; text-align: center; }
    .doc-sign { margin-top: ${t === "compact" ? 16 : 26}px; text-align: left; font-size: ${size(-0.5)}; }
    .doc-sign span { display: inline-block; border-top: 1px solid #64748b; padding-top: 4px; min-width: 180px; text-align: center; }
    .doc-watermark {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      font-size: 64pt; color: rgba(15,23,42,0.07); transform: rotate(-30deg);
      pointer-events: none; z-index: 0; font-weight: 700;
    }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  `;
}
