// محرك التصدير والطباعة الموحّد — مكافئ لـ app/utils/exporter.py
// Excel (exceljs) + PDF (html2canvas + jsPDF) + طباعة (window.print)

export function esc(v: unknown): string {
  return String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

export function buildTableHtml(
  headers: string[],
  rows: (string | number)[][],
  centerFrom?: number | null
): string {
  const out: string[] = [
    "<table dir='rtl' width='100%' border='0.5' cellspacing='0' cellpadding='4' style='font-size:10pt;border-collapse:collapse'>",
    "<tr bgcolor='#1f4e79'>",
  ];
  for (const h of headers) {
    out.push(`<td align='center'><b><font color='white'>${esc(h)}</font></b></td>`);
  }
  out.push("</tr>");
  rows.forEach((row, i) => {
    const bg = i % 2 ? "#f2f6fa" : "white";
    out.push(`<tr bgcolor='${bg}'>`);
    row.forEach((cell, c) => {
      const align = centerFrom != null && c >= centerFrom ? "center" : "right";
      out.push(`<td align='${align}'>${esc(cell)}</td>`);
    });
    out.push("</tr>");
  });
  out.push("</table>");
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
    body.push(`<div class='doc-head'>${companyHeaderHtml(info, o)}</div><hr>`);
  }
  body.push(`<div class='doc-title'>${esc(title)}</div>`);
  if (subtitle) body.push(`<div class='doc-sub'>${esc(subtitle)}</div>`);
  if (o.showDate) {
    body.push(`<div class='doc-meta'><span>تاريخ الطباعة: ${new Date().toLocaleString("ar-EG")}</span><span></span></div>`);
  }
  if (summaryLines && summaryLines.length) {
    body.push(
      "<table dir='rtl' width='60%' align='center' border='0.5' cellspacing='0' cellpadding='3' style='font-size:10pt;border-collapse:collapse'>"
    );
    for (const [k, v] of summaryLines) {
      body.push(`<tr><td align='right'>${esc(k)}</td><td align='center'><b>${esc(v)}</b></td></tr>`);
    }
    body.push("</table><br>");
  }
  if (headers) {
    body.push(buildTableHtml(headers, rows, centerFrom));
    if (o.showCount !== false) {
      body.push(`<div align='left' style='font-size:9pt'>عدد السجلات: ${rows.length}</div>`);
    }
  }
  const note = footerNote ?? o.footerText ?? info.company_vat_note ?? "";
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
// PDF (عبر html2canvas لضمان دعم العربية RTL)
// ---------------------------------------------------------------------------
export async function exportPdfHtml(html: string, defaultName: string): Promise<void> {
  const [html2canvasMod, jsPDFMod] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const html2canvas = html2canvasMod.default;
  const jsPDF = jsPDFMod.default;

  const container = document.createElement("div");
  container.dir = "rtl";
  container.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;background:white;padding:24px;" +
    "font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;color:#1d2a38;";
  container.innerHTML = html;
  document.body.appendChild(container);

  const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
  document.body.removeChild(container);

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const pageW = 210;
  const pageH = 297;
  const imgH = (canvas.height * pageW) / canvas.width;
  let heightLeft = imgH;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, pageW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, pageW, imgH);
    heightLeft -= pageH;
  }
  const name = safeFilename(defaultName);
  pdf.save(name.endsWith(".pdf") ? name : `${name}.pdf`);
}

/**
 * فتح نافذة طباعة بتنسيق ورقي كامل يعتمد إعدادات الطباعة الخاصة بالشركة.
 * ps اختيارية للحفاظ على التوافق مع الاستدعاءات القديمة.
 */
export function printHtml(html: string, title: string, ps?: PrintSettingsLike): void {
  const w = window.open("", "_blank", "width=900,height=650");
  if (!w) return;
  const css = ps
    ? ps.css
    : `body { font-family: 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif; color:#1d2a38; padding:24px; }
       table { border-collapse: collapse; }
       @media print { body { padding: 0; } }`;
  const watermark = ps?.watermark ? `<div class="doc-watermark">${esc(ps.watermark)}</div>` : "";
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${css}</style></head><body>${watermark}${html}
    <script>window.onload=function(){setTimeout(function(){window.print();},250);}</script></body></html>`);
  w.document.close();
}

/** ما يحتاجه محرك الطباعة من إعدادات (يُمرَّر من lib/print.ts). */
export interface PrintSettingsLike { css: string; watermark?: string }
