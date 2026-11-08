// تصدير بيانات الشركة بشكل احترافي (Excel متعدد الأوراق + PDF/طباعة).
// يُستخدم في صفحة الاشتراك لتحميل بيانات العميل بعد انتهاء اشتراكه.

import { exportCompanyData } from "./subscription";
import { money } from "./format";
import { buildTableHtml, esc, excelColumnWidth, exportPdfHtml, sanitizeSheetName } from "./exporter";
import { getPrintSettings, pdfDocOptions } from "./print";

type Row = Record<string, unknown>;

const TABLES: { key: string; label: string }[] = [
  { key: "customers", label: "العملاء" },
  { key: "employees", label: "الموظفون والسائقون" },
  { key: "vehicles", label: "السيارات" },
  { key: "cashboxes", label: "الخزائن" },
  { key: "banks", label: "البنوك" },
  { key: "financial_years", label: "السنوات المالية" },
  { key: "invoices", label: "فواتير النقل" },
  { key: "invoice_trips", label: "نقلات الفواتير" },
  { key: "trip_expenses", label: "مصروفات النقلات" },
  { key: "receipt_vouchers", label: "سندات القبض" },
  { key: "payment_vouchers", label: "سندات الدفع" },
  { key: "payrolls", label: "الرواتب" },
  { key: "advance_settlements", label: "تسويات السلف" },
];

/** قسم واحد من أقسام نسخة البيانات (عنوان + رؤوس + صفوف). */
export interface BackupSection {
  label: string;
  headers: string[];
  rows: (string | number)[][];
}

/**
 * مستند نسخة البيانات بصيغة المستندات الموحّدة (.doc-*) بدل جدول مرسوم يدوياً،
 * فيستفيد من تنسيق الطباعة المختار وتقسيم الصفحات وتكرار رؤوس كل جدول.
 */
export function backupReportHtml(opts: {
  companyName: string;
  printedAt: string;
  printedBy?: string;
  sections: BackupSection[];
}): string {
  const { companyName, printedAt, printedBy, sections } = opts;
  const meta = `تاريخ ووقت الطباعة: ${esc(printedAt)}${printedBy ? ` | طُبع بواسطة: ${esc(printedBy)}` : ""}`;
  const body: string[] = [
    `<div class='doc-head'><div class='doc-company'>${esc(companyName)}</div></div>`,
    "<div class='doc-title'>نسخة بيانات النظام</div>",
    `<div class='doc-sub'>${esc(meta)}</div>`,
  ];
  for (const section of sections) {
    body.push("<div class='doc-section'>");
    body.push(`<div class='doc-section-title'>${esc(section.label)} (${section.rows.length})</div>`);
    body.push(
      section.rows.length
        ? buildTableHtml(section.headers, section.rows)
        : "<div class='doc-sub'>لا توجد بيانات</div>"
    );
    body.push("</div>");
  }
  return body.join("");
}

function columnsOf(rows: Row[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  return Array.from(keys);
}

function cellValue(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function safeFilename(name: string): string {
  const clean = String(name).replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 120);
  return clean || "export";
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportDataExcel(): Promise<void> {
  const data = await exportCompanyData();
  const company = (data.company ?? {}) as Row;
  const companyName = String(company.name ?? "الشركة");
  const ExcelJS = (await import("exceljs")).default;

  const wb = new ExcelJS.Workbook();
  for (const t of TABLES) {
    const rows = (data[t.key] ?? []) as Row[];
    const cols = columnsOf(rows);
    const ws = wb.addWorksheet(sanitizeSheetName(t.label));
    ws.views = [{ rightToLeft: true }];

    // صف العنوان
    const headerRow = ws.addRow([`${companyName} — ${t.label}`]);
    ws.mergeCells(1, 1, 1, Math.max(cols.length, 1));
    headerRow.getCell(1).font = { bold: true, size: 14, color: { argb: "1F4E79" } };
    headerRow.getCell(1).alignment = { horizontal: "center" };

    // رؤوس الأعمدة
    const headRow = ws.addRow(cols);
    headRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "2563EB" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    for (const r of rows) {
      ws.addRow(cols.map((c) => cellValue(r[c])));
    }

    cols.forEach((c, i) => {
      ws.getColumn(i + 1).width = excelColumnWidth(rows.map((r) => r[c]), c.length);
    });
    if (rows.length) {
      ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: Math.max(cols.length, 1) } };
    }
    ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 2 }];
    ws.pageSetup = {
      paperSize: 9,
      orientation: cols.length > 6 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      printTitlesRow: "2:2",
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.25 },
    };
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safeFilename(companyName)}-بيانات-النظام.xlsx`);
}

export async function exportDataCsv(): Promise<void> {
  const data = await exportCompanyData();
  const companyName = String(((data.company ?? {}) as Row).name ?? "الشركة");
  const lines: string[] = [];
  lines.push(`\uFEFF${companyName} — نسخة البيانات (CSV)`);
  lines.push("");
  for (const t of TABLES) {
    const rows = (data[t.key] ?? []) as Row[];
    const cols = columnsOf(rows);
    lines.push(`# ${t.label}`);
    lines.push(cols.join(","));
    for (const r of rows) {
      lines.push(cols.map((c) => JSON.stringify(cellValue(r[c]))).join(","));
    }
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${safeFilename(companyName)}-بيانات-النظام.csv`);
}

export async function exportDataPdf(): Promise<void> {
  const data = await exportCompanyData();
  const company = (data.company ?? {}) as Row;
  const companyName = String(company.name ?? "الشركة");
  const { printMeta } = await import("./exportHelper");
  const [meta, ps] = await Promise.all([printMeta(), getPrintSettings()]);

  const sections: BackupSection[] = TABLES.map((t) => {
    const rows = (data[t.key] ?? []) as Row[];
    const headers = columnsOf(rows);
    return {
      label: t.label,
      headers,
      rows: rows.map((r) => headers.map((h) => cellValue(r[h]))),
    };
  });

  const html = backupReportHtml({ companyName, printedAt: meta.printedAt, printedBy: meta.printedBy, sections });
  const title = `${companyName} — نسخة بيانات النظام`;
  await exportPdfHtml(html, `${safeFilename(companyName)}-بيانات-النظام.pdf`, pdfDocOptions(ps, {
    title,
    printedBy: meta.printedBy,
    printedAt: meta.printedAt,
  }));
}
