import { companyInfo } from "./repo";
import { buildReportHtml, exportExcel, exportPdfHtml, printHtml, type DocOptions } from "./exporter";
import { getPrintSettings, printCss, type PrintSettings } from "./print";

export type ExportMode = "excel" | "pdf" | "print";

/** تحويل إعدادات الطباعة إلى خيارات المستند. */
export function docOptions(ps: PrintSettings): DocOptions {
  return {
    showHeader: ps.show_header,
    showPhone: ps.show_phone,
    showAddress: ps.show_address,
    showLogo: ps.show_logo,
    logoUrl: ps.logo_url,
    headerNote: ps.header_note,
    showDate: ps.show_date,
    showCount: ps.show_count,
    footerText: ps.footer_text,
    showSignature: ps.show_signature,
    signatureLabel: ps.signature_label,
  };
}

/** تصدير/طباعة جدول صفحة كاملة وفق إعدادات الطباعة الخاصة بالشركة. */
export async function exportPage(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  summaryLines?: [string, string | number][];
  mode: ExportMode;
}): Promise<void> {
  const [info, ps] = await Promise.all([companyInfo(), getPrintSettings()]);
  const { title, subtitle = "", headers, rows, summaryLines, mode } = opts;
  if (mode === "excel") {
    await exportExcel({ info, title, headers, rows, summaryLines, defaultName: `${title}.xlsx` });
    return;
  }
  const html = buildReportHtml({ info, title, subtitle, headers, rows, summaryLines, centerFrom: 1, doc: docOptions(ps) });
  if (mode === "pdf") await exportPdfHtml(html, `${title}.pdf`);
  else printHtml(html, title, { css: printCss(ps), watermark: ps.watermark });
}
