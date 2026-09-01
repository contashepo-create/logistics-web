// إعدادات الطباعة لكل شركة — تُحفظ في عمود companies.print_settings (jsonb)
// وتُطبَّق على كل مخرجات الطباعة و PDF (التقارير، الجداول، كشوف الحسابات).

import { supabase } from "./supabase";
import { getCompany } from "./repo";

export type PaperSize = "A4" | "A5" | "Letter";
export type Orientation = "portrait" | "landscape";
/** قوالب الطباعة الاحترافية الخمسة */
export type PrintTemplate = "modern" | "classic" | "elegant" | "compact" | "minimal";

export interface PrintSettings {
  /** القالب الاحترافي المستخدم في كل المستندات */
  template: PrintTemplate;
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
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  template: "modern",
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
  { id: "modern",  name: "عصري (Modern)",   description: "ترويسة ملوّنة بشريط تدرّج، رؤوس جداول ملوّنة، وحواف دائرية — الأنسب للعملاء.", accent: "#1d4ed8" },
  { id: "classic", name: "كلاسيكي (Classic)", description: "إطار كامل وخطوط شبكية واضحة بنمط الفواتير التقليدية الرسمية.", accent: "#1f4e79" },
  { id: "elegant", name: "أنيق (Elegant)",  description: "خطوط رفيعة، مسافات واسعة، وخط عنوان مميز — مظهر راقٍ وهادئ.", accent: "#0f766e" },
  { id: "compact", name: "مضغوط (Compact)", description: "كثافة عالية لعدد سجلات أكبر في الصفحة — الأنسب للتقارير الطويلة.", accent: "#334155" },
  { id: "minimal", name: "بسيط (Minimal)",  description: "بلا ألوان تقريباً وبأقل خطوط ممكنة — مثالي للطباعة بالأبيض والأسود.", accent: "#111827" },
];

export function getTemplate(id: string): PrintTemplateDef {
  return PRINT_TEMPLATES.find((t) => t.id === id) ?? PRINT_TEMPLATES[0];
}

export const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: "portrait", label: "طولي (Portrait)" },
  { value: "landscape", label: "عرضي (Landscape)" },
];

function normalize(raw: unknown): PrintSettings {
  const o = (raw ?? {}) as Partial<PrintSettings>;
  return {
    ...DEFAULT_PRINT_SETTINGS,
    ...o,
    margin_mm: clamp(Number(o.margin_mm ?? DEFAULT_PRINT_SETTINGS.margin_mm), 0, 40),
    font_size_pt: clamp(Number(o.font_size_pt ?? DEFAULT_PRINT_SETTINGS.font_size_pt), 6, 18),
  };
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
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
  const { error } = await supabase.from("companies").update({ print_settings: normalize(ps) }).eq("id", c.id);
  if (error) throw new Error(error.message);
}

/** أبعاد الورق بالمليمتر (عرض × ارتفاع) بعد مراعاة الاتجاه. */
export function paperDimensions(ps: PrintSettings): { w: number; h: number } {
  const base: Record<PaperSize, [number, number]> = { A4: [210, 297], A5: [148, 210], Letter: [216, 279] };
  const [w, h] = base[ps.paper] ?? base.A4;
  return ps.orientation === "landscape" ? { w: h, h: w } : { w, h };
}

/** ورقة الأنماط المستخدمة في نافذة الطباعة و PDF (تختلف بحسب القالب). */
export function printCss(ps: PrintSettings): string {
  const { w, h } = paperDimensions(ps);
  const fs = ps.font_size_pt;
  const accent = ps.accent_color || "#1d4ed8";
  const t = ps.template ?? "modern";

  // فروق القوالب: كثافة، حدود، ألوان الرؤوس، وشكل الترويسة
  const pad = t === "compact" ? "2.5px 5px" : t === "elegant" ? "6px 8px" : "4px 6px";
  const scale = t === "compact" ? -0.7 : t === "elegant" ? 0.4 : 0;
  const size = (d = 0) => `${(fs + scale + d).toFixed(1)}pt`;

  const gridBorder =
    t === "minimal" ? "border: none; border-bottom: 0.4pt solid #d5dde5;"
    : t === "elegant" ? "border: none; border-bottom: 0.5pt solid #cbd5e1;"
    : ps.grid_lines ? "border: 0.6pt solid #9fb0c2;" : "border: none;";

  const theadStyle =
    t === "minimal" ? `background: transparent; color: #111827; border-bottom: 1.2pt solid #111827;`
    : t === "elegant" ? `background: transparent; color: ${accent}; border-bottom: 1.2pt solid ${accent};`
    : t === "classic" ? `background: ${accent}; color: #fff;`
    : t === "compact" ? `background: ${accent}; color: #fff;`
    : `background: ${accent}; color: #fff;`;

  const headBlock =
    t === "modern"
      ? `.doc-head { text-align: center; padding-bottom: 6px; border-bottom: 2.5pt solid ${accent}; }`
      : t === "classic"
      ? `.doc-head { text-align: center; padding: 6px; border: 1pt solid ${accent}; }`
      : t === "elegant"
      ? `.doc-head { text-align: center; padding-bottom: 8px; border-bottom: 0.6pt solid ${accent}; letter-spacing: .4px; }`
      : `.doc-head { text-align: center; margin-bottom: 4px; }`;

  const zebra = ps.zebra && t !== "minimal" && t !== "elegant"
    ? "tbody tr:nth-child(even) td { background: #f2f6fa; }" : "";

  return `
    @page { size: ${w}mm ${h}mm; margin: ${ps.margin_mm}mm; }
    body {
      font-family: 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;
      color: #10202f; font-size: ${size()}; margin: 0; padding: ${ps.margin_mm}mm;
      ${t === "elegant" ? "line-height: 1.85;" : ""}
    }
    ${headBlock}
    .doc-logo { max-height: ${t === "compact" ? 46 : 70}px; margin-bottom: 6px; }
    .doc-company { font-size: ${size(t === "compact" ? 3 : 6)}; font-weight: 800; color: ${t === "minimal" ? "#111827" : accent}; }
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
