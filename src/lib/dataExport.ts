// تصدير بيانات الشركة بشكل احترافي (Excel متعدد الأوراق + PDF/طباعة).
// يُستخدم في صفحة الاشتراك لتحميل بيانات العميل بعد انتهاء اشتراكه.

import { exportCompanyData } from "./subscription";
import { money } from "./format";

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
    const ws = wb.addWorksheet(t.label.slice(0, 31));
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
      let w = c.length;
      for (const r of rows) w = Math.max(w, String(r[c] ?? "").length);
      ws.getColumn(i + 1).width = Math.min(Math.max(w + 4, 10), 40);
    });
    ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 2 }];
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

  let html = `<div dir="rtl" style="font-family:'IBM Plex Sans Arabic',sans-serif;color:#111;">
    <h2 style="color:#2563eb;text-align:center;">${companyName} — نسخة بيانات النظام</h2>
    <p style="text-align:center;color:#555;">تصدير كامل لبيانات الشركة</p>`;

  for (const t of TABLES) {
    const rows = (data[t.key] ?? []) as Row[];
    const cols = columnsOf(rows);
    html += `<h3 style="color:#1d4ed8;border-bottom:1px solid #cbd5e1;">${t.label} (${rows.length})</h3>`;
    if (!rows.length) {
      html += `<p style="color:#888;">لا توجد بيانات</p>`;
      continue;
    }
    html += `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%;font-size:11px;">
      <tr style="background:#2563eb;color:#fff;">${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;
    for (const r of rows) {
      html += `<tr>${cols.map((c) => `<td>${String(cellValue(r[c]))}</td>`).join("")}</tr>`;
    }
    html += `</table><br>`;
  }
  html += `</div>`;

  const { exportPdfHtml } = await import("./exporter");
  await exportPdfHtml(html, `${safeFilename(companyName)}-بيانات-النظام.pdf`);
}
