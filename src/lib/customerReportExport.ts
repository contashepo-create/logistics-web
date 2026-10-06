// تصدير التقرير الشامل للعميل: Excel متعدد الأوراق + PDF + طباعة.
// الأقسام مبنية في دوال نقية قابلة للاختبار، ثم تُصيَّر إلى ملف/صفحة واحدة.

import { buildReportHtml, buildTableHtml, exportPdfHtml, printHtml } from "./exporter";
import { docOptions, printMeta } from "./exportHelper";
import { getPrintSettings, printCss } from "./print";
import { companyInfo } from "./repo";
import { money } from "./format";
import { invoiceNumberLabel } from "./calc";
import { balanceSideLabel, type CustomerFullReport } from "./customerReport";

export interface ReportSheet {
  /** اسم الورقة/القسم */
  label: string;
  headers: string[];
  rows: (string | number)[][];
}

const STATUS_LABEL: Record<string, string> = { paid: "مسددة", partial: "مسددة جزئياً", open: "غير مسددة" };
const NOTE_TYPE_LABEL: Record<string, string> = { debit: "إشعار مدين", credit: "إشعار دائن" };
const yesNo = (b: boolean) => (b ? "نعم" : "لا");

function customerDataLines(rep: CustomerFullReport): [string, string][] {
  const c = rep.customer;
  if (!c) return [];
  const rows: [string, string][] = [
    ["اسم العميل", c.name || "—"],
    ["الكود", c.code || "—"],
    ["الهاتف", c.phone || "—"],
    ["العنوان", c.address || "—"],
  ];
  if (c.tax_number) rows.push(["الرقم الضريبي", c.tax_number]);
  if (c.commercial_reg) rows.push(["السجل التجاري", c.commercial_reg]);
  const geo = [c.country, c.region, c.city, c.district, c.street].filter(Boolean).join(" - ");
  if (geo) rows.push(["العنوان التفصيلي", geo]);
  const building = [c.building_no, c.postal_code, c.additional_no].filter(Boolean).join(" / ");
  if (building) rows.push(["رقم المبنى / الرمز البريدي / الرقم الإضافي", building]);
  rows.push(["الرصيد الافتتاحي المسجّل", money(c.opening_balance)]);
  if (c.notes) rows.push(["ملاحظات العميل", c.notes]);
  return rows;
}

/** أقسام التقرير الشامل: قسم لكل نوع من بيانات العميل (كل ما يخصه). */
export function customerReportSheets(rep: CustomerFullReport): ReportSheet[] {
  const s = rep.summary;
  const sheets: ReportSheet[] = [];

  sheets.push({
    label: "بيانات العميل",
    headers: ["البيان", "القيمة"],
    rows: [
      ...customerDataLines(rep),
      ["", ""],
      ["— الملخص المالي للفترة —", `${rep.from} ← ${rep.to}`],
      ["رصيد افتتاحي (حتى بداية الفترة)", money(s.opening)],
      ["إجمالي الفواتير", money(s.invoiced)],
      ["إجمالي المقبوضات", money(s.collected)],
      ["إشعارات مدينة", money(s.notes_debit)],
      ["إشعارات دائنة", money(s.notes_credit)],
      ["رصيد الإقفال", money(s.closing)],
      ["حالة الرصيد", balanceSideLabel(s.closing)],
      ["متبقٍ على الفواتير (بدون الرصيد الافتتاحي)", money(s.outstanding)],
      ["— مؤشرات —", ""],
      ["عدد الفواتير", s.invoices_count],
      ["عدد سندات القبض", s.receipts_count],
      ["عدد الإشعارات", s.notes_count],
      ["عدد النقلات", s.trips_count],
      ["إجمالي الكميات", s.qty_total],
      ["عدد الخدمات المستخدمة", s.services_count],
      ["متوسط قيمة الفاتورة", money(s.avg_invoice)],
      ["أول حركة في الفترة", s.first_movement ?? "—"],
      ["آخر حركة في الفترة", s.last_movement ?? "—"],
      ["تاريخ آخر فاتورة", s.last_invoice_date ?? "—"],
      ["أيام منذ آخر فاتورة", s.days_since_last_invoice ?? "—"],
    ],
  });

  sheets.push({
    label: "كشف الحساب",
    headers: ["التاريخ", "نوع المستند", "الرقم", "البيان", "مدين", "دائن", "الرصيد"],
    rows: rep.statement.rows.map((r) => [
      r.date,
      r.doc,
      r.number != null ? String(r.number) : "—",
      r.desc + (r.detail ? ` — ${r.detail}` : ""),
      r.debit ? money(r.debit) : "",
      r.credit ? money(r.credit) : "",
      r.balance != null ? money(r.balance) : "",
    ]),
  });

  sheets.push({
    label: "الفواتير",
    headers: ["رقم الفاتورة", "التاريخ", "عدد النقلات", "الخطوط", "قبل الضريبة", "الضريبة", "الإجمالي", "المسدد", "المتبقي", "الحالة", "داخل الفترة"],
    rows: rep.invoices.map((v) => [
      invoiceNumberLabel(v.number),
      v.date,
      v.trips_count,
      v.legs.length ? v.legs.join(" ، ") : "—",
      money(v.subtotal),
      money(v.vat_amount),
      money(v.total),
      money(v.paid),
      money(v.remaining),
      STATUS_LABEL[v.status] ?? v.status,
      yesNo(v.in_range),
    ]),
  });

  sheets.push({
    label: "النقلات",
    headers: ["الفاتورة", "التاريخ", "الخدمة", "من", "إلى", "الخط", "الكمية", "سعر الوحدة", "الإجمالي", "الحاويات", "السيارة", "السائق", "ملاحظات"],
    rows: rep.trips.map((t) => [
      t.invoice_label,
      t.date,
      t.item_name,
      t.from_loc || "—",
      t.to_loc || "—",
      t.route || "—",
      t.qty,
      money(t.unit_price),
      money(t.amount),
      t.containers.length ? t.containers.join("، ") : "—",
      t.vehicle_name || "—",
      t.driver_name || "—",
      t.notes || "—",
    ]),
  });

  sheets.push({
    label: "الخدمات",
    headers: ["الخدمة", "الوحدة", "الخط", "عدد النقلات", "إجمالي الكميات", "الإيراد", "الضريبة", "الإجمالي"],
    rows: rep.services.map((sv) => [
      sv.name,
      sv.unit || "—",
      sv.from_loc && sv.to_loc ? `${sv.from_loc} ← ${sv.to_loc}` : "خدمة عامة",
      sv.trips_count,
      sv.qty_total,
      money(sv.revenue),
      money(sv.vat_amount),
      money(sv.total),
    ]),
  });

  sheets.push({
    label: "سندات القبض",
    headers: ["الرقم", "التاريخ", "المبلغ", "البيان", "الحساب", "توزيع السداد"],
    rows: rep.receipts.map((r) => [
      r.label,
      r.date,
      money(r.amount),
      r.description || "—",
      r.account_name || "—",
      r.allocations || "—",
    ]),
  });

  sheets.push({
    label: "الإشعارات المدينة والدائنة",
    headers: ["الرقم", "النوع", "التاريخ", "المبلغ", "الضريبة", "الإجمالي", "السبب", "الفاتورة", "النقلات"],
    rows: rep.notes.map((n) => [
      n.label,
      NOTE_TYPE_LABEL[n.type] ?? n.type,
      n.date,
      money(n.amount),
      money(n.vat_amount),
      money(n.total),
      n.reason || "—",
      n.invoice_number != null ? invoiceNumberLabel(n.invoice_number) : "—",
      n.trips.length ? n.trips.join(" ، ") : "—",
    ]),
  });

  sheets.push({
    label: "الديون والأعمار",
    headers: ["البند", "العدد", "المبلغ"],
    rows: [
      ...rep.aging.map((a) => [a.bucket, a.count, money(a.amount)]),
      ["الإجمالي", rep.aging.reduce((sum, a) => sum + a.count, 0), money(s.outstanding)],
    ],
  });

  sheets.push({
    label: "الفواتير المفتوحة",
    headers: ["رقم الفاتورة", "التاريخ", "الإجمالي", "المسدد", "المتبقي", "العمر بالأيام"],
    rows: rep.open_items.map((o) => [
      invoiceNumberLabel(o.number),
      o.date,
      money(o.total),
      money(o.paid),
      money(o.remaining),
      o.age_days,
    ]),
  });

  return sheets;
}

/** سطور مختصرة تظهر أعلى كل تصدير/طباعة. */
export function customerReportSummaryLines(rep: CustomerFullReport): [string, string | number][] {
  const s = rep.summary;
  return [
    ["الفترة", `${rep.from} ← ${rep.to}`],
    ["رصيد افتتاحي", money(s.opening)],
    ["إجمالي الفواتير", money(s.invoiced)],
    ["إجمالي المقبوضات", money(s.collected)],
    ["إشعارات مدينة / دائنة", `${money(s.notes_debit)} / ${money(s.notes_credit)}`],
    ["رصيد الإقفال", `${money(s.closing)} (${balanceSideLabel(s.closing)})`],
    ["عدد الفواتير / السندات / الإشعارات", `${s.invoices_count} / ${s.receipts_count} / ${s.notes_count}`],
    ["عدد النقلات / إجمالي الكميات", `${s.trips_count} / ${s.qty_total}`],
  ];
}

function esc(v: unknown): string {
  return String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tableFor(sheet: ReportSheet): string {
  if (!sheet.rows.length) return `<div style="color:#64748b;font-size:11px;margin:4px 0 12px">لا توجد بيانات في هذا القسم.</div>`;
  return buildTableHtml(sheet.headers, sheet.rows, null);
}

/** HTML التقرير الشامل (يُستخدم في PDF والطباعة). */
export async function customerReportHtml(rep: CustomerFullReport): Promise<string> {
  const [info, ps, meta] = await Promise.all([companyInfo(), getPrintSettings(), printMeta()]);
  const sheets = customerReportSheets(rep);
  const title = `التقرير الشامل عن العميل - ${rep.customer?.name ?? ""}`;
  const subtitle = `كود العميل: ${rep.customer?.code ?? "—"} | الفترة: من ${rep.from} إلى ${rep.to} | تاريخ التقرير: ${rep.generated_at}`;
  const body = sheets
    .map((sh) => `<div class="doc-section"><h3 class="doc-section-title">${esc(sh.label)}</h3>${tableFor(sh)}</div>`)
    .join("");
  const head = buildReportHtml({
    info,
    title,
    subtitle,
    summaryLines: customerReportSummaryLines(rep),
    doc: docOptions(ps, meta.printedBy, meta.printedAt),
  });
  const style = "<style>.doc-section-title{color:#1f4e79;border-bottom:1px solid #cbd5e1;margin:16px 0 6px;font-size:13px}.doc-section{page-break-inside:auto}</style>";
  return head + style + body;
}

function safeName(rep: CustomerFullReport): string {
  const base = `التقرير الشامل - ${rep.customer?.name ?? "العميل"} - ${rep.from} إلى ${rep.to}`;
  return base.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Excel متعدد الأوراق: ورقة لكل قسم من أقسام التقرير. */
export async function exportCustomerReportExcel(rep: CustomerFullReport): Promise<void> {
  const [info, ExcelJSMod] = await Promise.all([companyInfo(), import("exceljs")]);
  const ExcelJS = ExcelJSMod.default;
  const wb = new ExcelJS.Workbook();
  const companyName = info.company_name ?? "الشركة";
  const name = safeName(rep);

  for (const sh of customerReportSheets(rep)) {
    const ws = wb.addWorksheet(sh.label.slice(0, 31));
    ws.views = [{ rightToLeft: true }];
    const nCols = Math.max(sh.headers.length, 2);

    ws.mergeCells(1, 1, 1, nCols);
    const t = ws.getCell(1, 1);
    t.value = `${companyName} — التقرير الشامل عن العميل: ${rep.customer?.name ?? ""}`;
    t.font = { bold: true, size: 14, color: { argb: "1F4E79" } };
    t.alignment = { horizontal: "center" };

    ws.mergeCells(2, 1, 2, nCols);
    const sub = ws.getCell(2, 1);
    sub.value = `${sh.label} | الفترة: من ${rep.from} إلى ${rep.to}`;
    sub.font = { bold: true, size: 11 };
    sub.alignment = { horizontal: "center" };

    const headRow = ws.getRow(3);
    sh.headers.forEach((h, i) => {
      const cell = headRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F4E79" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });
    headRow.height = 22;

    const numRe = /^-?[\d,]+(\.\d+)?$/;
    let r = 4;
    for (const row of sh.rows) {
      row.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        const s = String(v ?? "");
        if (numRe.test(s.replace(/,/g, ""))) {
          cell.value = Number(s.replace(/,/g, ""));
          cell.numFmt = "#,##0.00";
        } else {
          cell.value = s;
        }
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      });
      r += 1;
    }

    sh.headers.forEach((h, i) => {
      let width = h.length;
      for (const row of sh.rows) if (i < row.length) width = Math.max(width, String(row[i] ?? "").length);
      ws.getColumn(i + 1).width = Math.min(Math.max(width + 4, 10), 45);
    });
    ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 3 }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${name}.xlsx`
  );
}

export async function exportCustomerReportPdf(rep: CustomerFullReport): Promise<void> {
  const html = await customerReportHtml(rep);
  await exportPdfHtml(html, `${safeName(rep)}.pdf`);
}

export async function printCustomerReport(rep: CustomerFullReport): Promise<void> {
  const [html, ps] = await Promise.all([customerReportHtml(rep), getPrintSettings()]);
  printHtml(html, safeName(rep), { css: printCss(ps), watermark: ps.watermark });
}
