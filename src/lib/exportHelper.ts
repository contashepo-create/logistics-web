import { companyInfo } from "./repo";
import { buildReportHtml, exportExcel, exportPdfHtml, printHtml } from "./exporter";

export type ExportMode = "excel" | "pdf" | "print";

export async function exportPage(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  summaryLines?: [string, string | number][];
  mode: ExportMode;
}): Promise<void> {
  const info = await companyInfo();
  const { title, subtitle = "", headers, rows, summaryLines, mode } = opts;
  if (mode === "excel") {
    await exportExcel({ info, title, headers, rows, summaryLines, defaultName: `${title}.xlsx` });
  } else {
    const html = buildReportHtml({ info, title, subtitle, headers, rows, summaryLines, centerFrom: 1 });
    if (mode === "pdf") await exportPdfHtml(html, `${title}.pdf`);
    else printHtml(html, title);
  }
}
