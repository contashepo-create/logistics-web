// إعدادات الطباعة لكل شركة — تُحفظ في عمود companies.print_settings (jsonb)
// وتُطبَّق على كل مخرجات الطباعة و PDF (التقارير، الجداول، كشوف الحسابات).

import { supabase } from "./supabase";
import { getCompany } from "./repo";

export type PaperSize = "A4" | "A5" | "Letter";
export type Orientation = "portrait" | "landscape";

export interface PrintSettings {
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

/** ورقة الأنماط المستخدمة في نافذة الطباعة و PDF. */
export function printCss(ps: PrintSettings): string {
  const { w, h } = paperDimensions(ps);
  return `
    @page { size: ${w}mm ${h}mm; margin: ${ps.margin_mm}mm; }
    body {
      font-family: 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;
      color: #10202f; font-size: ${ps.font_size_pt}pt; margin: 0; padding: ${ps.margin_mm}mm;
    }
    .doc-head { text-align: center; margin-bottom: 8px; }
    .doc-logo { max-height: 70px; margin-bottom: 6px; }
    .doc-company { font-size: ${ps.font_size_pt + 6}pt; font-weight: 700; }
    .doc-contact { font-size: ${ps.font_size_pt - 1}pt; color: #33475b; }
    .doc-note { font-size: ${ps.font_size_pt - 1}pt; color: #33475b; margin-top: 2px; }
    .doc-title { text-align: center; font-size: ${ps.font_size_pt + 3}pt; font-weight: 700; margin: 8px 0 2px; }
    .doc-sub { text-align: center; font-size: ${ps.font_size_pt - 0.5}pt; color: #33475b; margin-bottom: 8px; }
    .doc-meta { display: flex; justify-content: space-between; font-size: ${ps.font_size_pt - 1.5}pt; color: #5a6b7d; margin-bottom: 6px; }
    hr { border: none; border-top: 1px solid #b9c6d4; margin: 6px 0; }
    table { border-collapse: collapse; width: 100%; font-size: ${ps.font_size_pt}pt; }
    table td, table th { ${ps.grid_lines ? "border: 0.6pt solid #9fb0c2;" : "border: none;"} padding: 4px 6px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    ${ps.zebra ? "tbody tr:nth-child(even) td { background: #f2f6fa; }" : ""}
    .doc-foot { margin-top: 10px; font-size: ${ps.font_size_pt - 1}pt; color: #33475b; text-align: center; }
    .doc-sign { margin-top: 26px; text-align: left; font-size: ${ps.font_size_pt - 0.5}pt; }
    .doc-sign span { display: inline-block; border-top: 1px solid #64748b; padding-top: 4px; min-width: 180px; text-align: center; }
    .doc-watermark {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      font-size: 64pt; color: rgba(15,23,42,0.07); transform: rotate(-30deg);
      pointer-events: none; z-index: 0; font-weight: 700;
    }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  `;
}
