// محرك التصدير والطباعة الموحّد — مكافئ لـ app/utils/exporter.py
// Excel (exceljs) + PDF (html2canvas + jsPDF) + طباعة (window.print)

export function esc(v: unknown): string {
  // يشمل الاقتباسات لأن هذه القيم تُحقن أحياناً داخل خصائص HTML
  // (مثل src/alt/style)، وبدونها يستطيع نص يحتوي " الخروج من الخاصية.
  return String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface DocOptions {
  showHeader?: boolean;
  showPhone?: boolean;
  showAddress?: boolean;
  showLogo?: boolean;
  logoUrl?: string;
  headerNote?: string;
  showDate?: boolean;
  showCount?: boolean;
  footerText?: string;
  showSignature?: boolean;
  signatureLabel?: string;
  /** اسم من قام بالطباعة (يظهر في ترويسة كل المطبوعات). */
  printedBy?: string;
  /** نص تاريخ/وقت الطباعة جاهز إن لم يُمرَّر. */
  printedAt?: string;
}

export function companyHeaderHtml(info: Record<string, string>, o: DocOptions = {}): string {
  const showPhone = o.showPhone !== false;
  const showAddress = o.showAddress !== false;
  const parts: string[] = [];
  if (o.showLogo && o.logoUrl) parts.push(`<img class="doc-logo" src="${esc(o.logoUrl)}" alt="">`);
  parts.push(`<div class="doc-company">${esc(info.company_name)}</div>`);
  const contact = [showPhone ? info.company_phone : "", showAddress ? info.company_address : ""].filter(Boolean).join(" | ");
  if (contact) parts.push(`<div class="doc-contact">${esc(contact)}</div>`);
  if (o.headerNote) parts.push(`<div class="doc-note">${esc(o.headerNote)}</div>`);
  return parts.join("");
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** توحيد الأرقام العربية/الفارسية إلى لاتينية لمقارنة نوع الخلية فقط. */
function asciiDigits(value: unknown): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .trim();
}

/** هل الخلية رقمية (مبلغ/تاريخ/نسبة)؟ تُستخدم لمحاذاة الأعمدة تلقائياً. */
export function isNumericCell(value: unknown): boolean {
  const s = asciiDigits(value);
  if (!s) return false;
  return (
    /^-?[\d,]+(\.\d+)?\s*%?$/.test(s) ||
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s) ||
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(s)
  );
}

/**
 * جدول مستند احترافي: رأس حقيقي داخل <thead> (يتكرر في كل صفحة مطبوعة/PDF)،
 * ومحاذاة ذكية لكل عمود (الأرقام والتواريخ وسطاً وبأرقام متساوية العرض،
 * والنصوص يميناً وتلتف بدل تمدد الصف خارج الورقة).
 * `centerFrom` يظل مدعوماً للتوافق مع النداءات القديمة.
 */
export function buildTableHtml(
  headers: string[],
  rows: (string | number)[][],
  centerFrom?: number | null
): string {
  const numericCol = headers.map((_, i) => {
    const sample = rows.slice(0, 40).map((r) => r[i]).filter((v) => String(v ?? "").trim() !== "");
    return sample.length > 0 && sample.every((v) => isNumericCell(v));
  });
  const alignOf = (i: number): "right" | "center" => {
    if (centerFrom != null && i >= centerFrom) return "center";
    return numericCol[i] ? "center" : "right";
  };
  const cellClass = (i: number): string => (numericCol[i] ? "doc-cell-num" : "doc-cell-text");

  const out: string[] = [
    "<table class='doc-table' dir='rtl' width='100%' cellspacing='0' cellpadding='0' style='border-collapse:collapse'>",
    "<thead><tr>",
  ];
  headers.forEach((h, i) => {
    out.push(`<th align='center' class='${numericCol[i] ? "doc-cell-num" : "doc-cell-text"}'>${esc(h)}</th>`);
  });
  out.push("</tr></thead><tbody>");
  rows.forEach((row) => {
    out.push("<tr>");
    headers.forEach((_, c) => {
      const value = row[c];
      out.push(`<td align='${alignOf(c)}' class='${cellClass(c)}'>${esc(value)}</td>`);
    });
    out.push("</tr>");
  });
  out.push("</tbody></table>");
  return out.join("");
}

export function buildReportHtml(opts: {
  info: Record<string, string>;
  title: string;
  subtitle?: string;
  headers?: string[];
  rows?: (string | number)[][];
  summaryLines?: [string, string | number][];
  centerFrom?: number | null;
  footerNote?: string;
  doc?: DocOptions;
}): string {
  const { info, title, subtitle = "", headers, rows = [], summaryLines, centerFrom, footerNote } = opts;
  const o: DocOptions = opts.doc ?? {};
  const body: string[] = [];
  if (o.showHeader !== false) {
    body.push(`<div class='doc-head'>${companyHeaderHtml(info, o)}</div>`);
  }
  body.push(`<div class='doc-title'>${esc(title)}</div>`);
  if (subtitle) body.push(`<div class='doc-sub'>${esc(subtitle)}</div>`);
  // متطلبات إلزامية: كل المطبوعات تُظهر تاريخ/وقت الطباعة واسم الطابِع.
  if (o.showDate || o.printedBy || o.printedAt) {
    const at = o.printedAt ?? new Date().toLocaleString("ar-EG");
    const by = o.printedBy ? ` | طُبع بواسطة: ${esc(o.printedBy)}` : "";
    body.push(`<div class='doc-meta'><span>تاريخ ووقت الطباعة: ${esc(at)}${by}</span><span></span></div>`);
  }
  // الملخص على شكل بطاقات قيم واضحة بدل جدول صغير مشتّت.
  if (summaryLines && summaryLines.length) {
    body.push("<div class='doc-summary'>");
    for (const [k, v] of summaryLines) {
      body.push(
        `<div class='doc-summary-item'><span class='k'>${esc(k)}</span><span class='v'>${esc(v)}</span></div>`
      );
    }
    body.push("</div>");
  }
  if (headers) {
    body.push(buildTableHtml(headers, rows, centerFrom));
    if (o.showCount !== false) {
      body.push(`<div class='doc-count'>عدد السجلات: ${rows.length}</div>`);
    }
  }
  const note = opts.footerNote ?? o.footerText ?? info.company_vat_note ?? "";
  if (note) body.push(`<div class='doc-foot'>${esc(note)}</div>`);
  if (o.showSignature) {
    body.push(`<div class='doc-sign'><span>${esc(o.signatureLabel || "التوقيع والختم")}</span></div>`);
  }
  return body.join("");
}

function safeFilename(name: string): string {
  const clean = String(name).replace(/[\\/:*?"<>|]/g, "-").trim().replace(/^\.+/, "");
  return (clean || "export").slice(0, 120);
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
export async function exportExcel(opts: {
  info: Record<string, string>;
  title: string;
  headers: string[];
  rows: (string | number)[][];
  summaryLines?: [string, string | number][];
  defaultName?: string;
}): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const { info, title, headers, rows, summaryLines } = opts;
  const defaultName = safeFilename(opts.defaultName ?? `${title}.xlsx`);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("تقرير");
  ws.views = [{ rightToLeft: true }];

  const nCols = Math.max(headers.length, 2);
  ws.mergeCells(1, 1, 1, nCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = info.company_name ?? "";
  titleCell.font = { bold: true, size: 16, color: { argb: "1F4E79" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };

  ws.mergeCells(2, 1, 2, nCols);
  const subCell = ws.getCell(2, 1);
  subCell.value = title;
  subCell.font = { bold: true, size: 12 };
  subCell.alignment = { horizontal: "center" };

  let r = 3;
  if (summaryLines?.length) {
    for (const [k, v] of summaryLines) {
      ws.getCell(r, 1).value = k;
      ws.getCell(r, 1).font = { bold: true };
      const cell = ws.getCell(r, 2);
      cell.value = typeof v === "number" ? v : String(v);
      cell.alignment = { horizontal: "center" };
      r += 1;
    }
    r += 1;
  }

  headers.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E79" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
    };
  });
  ws.getRow(r).height = 22;
  const headerRow = r;
  r += 1;

  const numRe = /^-?[\d,]+(\.\d+)?$/;
  for (const row of rows) {
    row.forEach((v, i) => {
      const s = String(v ?? "");
      const cell = ws.getCell(r, i + 1);
      if (numRe.test(s.replace(/٫/g, "."))) {
        cell.value = Number(s.replace(/,/g, ""));
        cell.numFmt = "#,##0.00";
      } else {
        cell.value = s;
      }
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
      };
    });
    r += 1;
  }

  headers.forEach((h, i) => {
    let width = h.length;
    for (const row of rows) {
      if (i < row.length) width = Math.max(width, String(row[i] ?? "").length);
    }
    ws.getColumn(i + 1).width = Math.min(Math.max(width + 4, 10), 40);
  });

  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: headerRow }];

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), defaultName.endsWith(".xlsx") ? defaultName : `${defaultName}.xlsx`);
}

// ---------------------------------------------------------------------------
// PDF (html2canvas + jsPDF) عبر محرّك تقسيم صفحات حقيقي — انظر pdfDoc.ts
// ---------------------------------------------------------------------------
export type { PdfDocOptions } from "./pdfDoc";
export { renderPdfDocument } from "./pdfDoc";

/**
 * تصدير المستند إلى PDF احترافي: صفحات مقسّمة على مقاس الورق، بلا قطع صفوف،
 * مع تكرار رأس الجدول وتذييل يحمل رقم الصفحة ومن طبع ومتى.
 * `doc` اختياري: عند تمريره تُطبَّق أنماط الشركة (الورق/الاتجاه/الهوامش/الألوان).
 */
export async function exportPdfHtml(
  html: string,
  defaultName: string,
  doc?: import("./pdfDoc").PdfDocOptions
): Promise<void> {
  const { renderPdfDocument } = await import("./pdfDoc");
  const name = safeFilename(defaultName);
  await renderPdfDocument(html, name.endsWith(".pdf") ? name : `${name}.pdf`, doc);
}

/**
 * يفتح نافذة المعاينة فور نقرة المستخدم قبل أي جلب بيانات، لتفادي حجب النافذة
 * ولإعطاء استجابة مرئية مباشرة بدلاً من انتظار تجهيز الفاتورة وQR.
 */
export function openPrintPreview(title = "معاينة الطباعة"): Window | null {
  if (typeof window === "undefined") return null;
  const w = window.open("", "_blank", "width=900,height=650,scrollbars=yes,resizable=yes");
  if (!w) return null;
  w.document.open();
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#334155;font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif}.loading{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 36px;box-shadow:0 12px 35px rgba(15,23,42,.08);text-align:center}.spinner{width:28px;height:28px;margin:0 auto 12px;border:3px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:s .75s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head>
    <body><div class="loading"><div class="spinner"></div><b>جارٍ تجهيز معاينة الفاتورة…</b><div style="font-size:12px;color:#64748b;margin-top:5px">ستظهر صفحة الطباعة خلال لحظات</div></div></body></html>`);
  w.document.close();
  w.focus();
  return w;
}

/**
 * فتح نافذة طباعة بتنسيق ورقي كامل يعتمد إعدادات الطباعة الخاصة بالشركة.
 * يمكن تمرير نافذة سبق فتحها كي تظهر المعاينة فور النقر.
 */
export function printHtml(html: string, title: string, ps?: PrintSettingsLike, previewWindow?: Window | null): void {
  const w = previewWindow && !previewWindow.closed
    ? previewWindow
    : window.open("", "_blank", "width=900,height=650,scrollbars=yes,resizable=yes");
  if (!w) return;
  const css = ps
    ? ps.css
    : `body { font-family: 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif; color:#1d2a38; padding:24px; }
       table { border-collapse: collapse; }
       @media print { body { padding: 0; } }`;
  const watermark = ps?.watermark ? `<div class="doc-watermark">${esc(ps.watermark)}</div>` : "";
  // الهوامش على مستوى @page فقط؛ body padding للعرض على الشاشة ويلغى عند الطباعة
  // حتى لا تتضاعف الهوامش (كانت تُطبع الصفحة بهوامش مضاعفة فتتزاحم الصفوف).
  const screenCss = `@media print { body { padding: 0 !important; } thead { display: table-header-group; } }`;
  w.document.open();
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <style>${css}${screenCss}</style></head><body>${watermark}${html}
    <script>window.onload=function(){setTimeout(function(){window.focus();window.print();},150);}</script></body></html>`);
  w.document.close();
}

/** ما يحتاجه محرك الطباعة من إعدادات (يُمرَّر من lib/print.ts). */
export interface PrintSettingsLike { css: string; watermark?: string }
