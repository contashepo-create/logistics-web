// Visual reference: contashepo-create/pro-acc@3cf0405
// (src/lib/invoice-templates.ts and the six invoice view layouts), adapted for transport data.
import type { PrintSettings, PrintTemplate } from "./print";

export interface InvoiceTemplateParty {
  name: string;
  nameEn?: string;
  code?: string;
  taxNumber?: string;
  commercialRegistration?: string;
  unifiedNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface InvoiceTemplateLine {
  description: string;
  detail?: string;
  /** أرقام الحاويات المرتبطة ببند النقل نفسه. */
  containerNumbers?: string[];
  quantity: number;
  unitAmount: number;
  taxableAmount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
}

export interface InvoiceTemplateModel {
  invoiceNumber: string;
  issueDate: string;
  invoiceTitleAr: string;
  invoiceTitleEn: string;
  currency: string;
  containerNumber?: string;
  seller: InvoiceTemplateParty;
  buyer: InvoiceTemplateParty;
  lines: InvoiceTemplateLine[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  amountInWords: string;
  notes?: string;
  printedBy?: string;
  printedAt?: string;
  qrDataUrl?: string;
  qrCaption?: string;
  footerText?: string;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value: number): string {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function color(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function labels(ps: PrintSettings) {
  const en = ps.label_language === "en";
  return (ar: string, english: string) => esc(en ? english : ar);
}

function visible(enabled: boolean, value?: unknown): boolean {
  return enabled && String(value ?? "").trim() !== "";
}

function logo(model: InvoiceTemplateModel, ps: PrintSettings, size = 58, radius = 12): string {
  if (!ps.show_logo || !ps.logo_url) return "";
  return `<img src="${esc(ps.logo_url)}" alt="${esc(model.seller.name)}" style="width:${size}px;height:${size}px;object-fit:contain;border:1px solid #e2e8f0;border-radius:${radius}px;padding:4px;background:#fff;"/>`;
}

function sellerBlock(model: InvoiceTemplateModel, ps: PrintSettings, accent: string): string {
  const l = labels(ps);
  const s = model.seller;
  return `<div style="font-size:11.5px;line-height:1.75;color:#475569;">
    ${visible(ps.invoice_show_company_name, s.name) ? `<div style="font-size:17px;line-height:1.35;font-weight:900;color:${accent};">${esc(s.name)}</div>` : ""}
    ${visible(ps.invoice_show_company_name, s.nameEn) ? `<div dir="ltr" style="font-size:11px;font-weight:700;color:#64748b;text-align:right;">${esc(s.nameEn)}</div>` : ""}
    ${visible(ps.invoice_show_company_tax_number, s.taxNumber) ? `<div>${l("الرقم الضريبي", "VAT No.")}: <b dir="ltr">${esc(s.taxNumber)}</b></div>` : ""}
    ${visible(ps.invoice_show_company_cr, s.commercialRegistration) ? `<div>${l("السجل التجاري", "CR No.")}: <b dir="ltr">${esc(s.commercialRegistration)}</b></div>` : ""}
    ${visible(ps.invoice_show_company_unified, s.unifiedNumber) ? `<div>${l("الرقم الموحّد", "Unified No.")}: <b dir="ltr">${esc(s.unifiedNumber)}</b></div>` : ""}
    ${visible(ps.invoice_show_company_address, s.address) ? `<div>${esc(s.address)}</div>` : ""}
    ${visible(ps.invoice_show_company_phone, s.phone) ? `<div>${l("هاتف", "Tel")}: <b dir="ltr">${esc(s.phone)}</b></div>` : ""}
    ${visible(ps.invoice_show_company_email, s.email) ? `<div dir="ltr" style="text-align:right;">${esc(s.email)}</div>` : ""}
    ${visible(ps.invoice_show_company_website, s.website) ? `<div dir="ltr" style="text-align:right;">${esc(s.website)}</div>` : ""}
  </div>`;
}

function buyerBlock(model: InvoiceTemplateModel, ps: PrintSettings, accent: string, boxed = true): string {
  const l = labels(ps);
  const b = model.buyer;
  const body = `<div style="font-size:11.5px;line-height:1.75;color:#475569;">
    ${visible(ps.invoice_show_customer_name, b.name) ? `<div style="font-size:14px;font-weight:900;color:#0f172a;">${esc(b.name)}</div>` : ""}
    ${visible(ps.invoice_show_customer_code, b.code) ? `<div>${l("كود العميل", "Customer code")}: <b>${esc(b.code)}</b></div>` : ""}
    ${visible(ps.invoice_show_customer_tax_number, b.taxNumber) ? `<div>${l("الرقم الضريبي", "VAT No.")}: <b dir="ltr">${esc(b.taxNumber)}</b></div>` : ""}
    ${visible(ps.invoice_show_customer_cr, b.commercialRegistration) ? `<div>${l("السجل التجاري", "CR No.")}: <b dir="ltr">${esc(b.commercialRegistration)}</b></div>` : ""}
    ${visible(ps.invoice_show_customer_address, b.address) ? `<div>${esc(b.address)}</div>` : ""}
    ${visible(ps.invoice_show_customer_phone, b.phone) ? `<div>${l("هاتف", "Tel")}: <b dir="ltr">${esc(b.phone)}</b></div>` : ""}
  </div>`;
  if (!boxed) return body;
  return `<div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="padding:6px 12px;background:${accent}0f;color:${accent};font-size:11px;font-weight:800;">${l("بيانات المشتري", "Buyer details")}</div>
    <div style="padding:10px 12px;">${body}</div>
  </div>`;
}

function titleBlock(model: InvoiceTemplateModel, ps: PrintSettings, accent: string, variant: "filled" | "outlined" | "plain" = "filled"): string {
  const l = labels(ps);
  const style = variant === "filled"
    ? `background:${accent};color:#fff;border-radius:11px;padding:9px 14px;`
    : variant === "outlined"
      ? `border:2px solid ${accent};color:${accent};padding:8px 14px;`
      : `color:${accent};border-bottom:2px solid ${accent};padding:4px 8px 8px;`;
  return `<div style="min-width:230px;text-align:center;">
    <div style="${style}"><div style="font-size:17px;font-weight:900;">${esc(ps.label_language === "en" ? model.invoiceTitleEn : model.invoiceTitleAr)}</div></div>
    <table style="width:100%;margin-top:7px;font-size:11.5px;border-collapse:collapse;">
      <tr><td style="padding:2px;color:#64748b;text-align:right;">${l("رقم الفاتورة", "Invoice No.")}</td><td dir="ltr" style="padding:2px;text-align:left;font-weight:900;">${esc(model.invoiceNumber)}</td></tr>
      <tr><td style="padding:2px;color:#64748b;text-align:right;">${l("تاريخ الإصدار", "Issue date")}</td><td dir="ltr" style="padding:2px;text-align:left;font-weight:700;">${esc(model.issueDate)}</td></tr>
      ${ps.invoice_show_currency ? `<tr><td style="padding:2px;color:#64748b;text-align:right;">${l("العملة", "Currency")}</td><td style="padding:2px;text-align:left;font-weight:700;">${esc(model.currency)}</td></tr>` : ""}
    </table>
  </div>`;
}

function lineContainers(line: InvoiceTemplateLine, ps: PrintSettings): string {
  const numbers = Array.isArray(line.containerNumbers) ? line.containerNumbers.filter(Boolean) : [];
  if (!numbers.length) return "";
  const caption = ps.label_language === "en" ? "Containers:" : "الحاويات:";
  const badges = numbers.map((number) =>
    `<span dir="ltr" style="display:inline-block;padding:1px 5px;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;color:#1e3a8a;font:700 9.5px monospace;">${esc(number)}</span>`
  ).join(" ");
  return `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px;font-size:9.5px;color:#64748b;"><span>${caption}</span>${badges}</div>`;
}

function invoiceTable(model: InvoiceTemplateModel, ps: PrintSettings, opts: { accent: string; dense?: boolean; classic?: boolean; elegant?: boolean; logistics?: boolean }): string {
  const l = labels(ps);
  const pad = opts.dense ? "5px 6px" : "8px 7px";
  const border = opts.classic ? "1px solid #475569" : "1px solid #e2e8f0";
  const headBg = opts.logistics ? "#1e293b" : opts.elegant ? opts.accent : opts.accent;
  const rows = model.lines.map((line, index) => `<tr style="${index % 2 && !opts.elegant ? "background:#f8fafc;" : ""}">
    <td style="padding:${pad};border:${border};text-align:center;color:#64748b;">${index + 1}</td>
    <td style="padding:${pad};border:${border};text-align:right;"><b style="color:#0f172a;">${esc(line.description)}</b>${line.detail ? `<div style="font-size:10px;color:#64748b;margin-top:2px;">${esc(line.detail)}</div>` : ""}${lineContainers(line, ps)}</td>
    <td style="padding:${pad};border:${border};text-align:center;">${money(line.quantity).replace(/\.00$/, "")}</td>
    <td style="padding:${pad};border:${border};text-align:center;white-space:nowrap;">${money(line.unitAmount)}</td>
    <td style="padding:${pad};border:${border};text-align:center;white-space:nowrap;">${money(line.taxableAmount)}</td>
    <td style="padding:${pad};border:${border};text-align:center;">${money(line.vatRate).replace(/\.00$/, "")}%</td>
    <td style="padding:${pad};border:${border};text-align:center;white-space:nowrap;">${money(line.vatAmount)}</td>
    <td style="padding:${pad};border:${border};text-align:center;font-weight:900;white-space:nowrap;">${money(line.total)}</td>
  </tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:${opts.dense ? "10px" : "11px"};">
    <thead><tr style="background:${headBg};color:#fff;">
      <th style="padding:${pad};border:${border};width:26px;">#</th>
      <th style="padding:${pad};border:${border};text-align:right;">${l("بيان خدمة النقل", "Transport service")}</th>
      <th style="padding:${pad};border:${border};">${l("العدد", "Qty")}</th>
      <th style="padding:${pad};border:${border};">${l("سعر الوحدة", "Unit price")}</th>
      <th style="padding:${pad};border:${border};">${l("الخاضع للضريبة", "Taxable")}</th>
      <th style="padding:${pad};border:${border};">${l("النسبة", "VAT %")}</th>
      <th style="padding:${pad};border:${border};">${l("الضريبة", "VAT amount")}</th>
      <th style="padding:${pad};border:${border};">${l("شامل الضريبة", "Total incl. VAT")}</th>
    </tr></thead><tbody>${rows}</tbody>
  </table>`;
}

function totals(model: InvoiceTemplateModel, ps: PrintSettings, accent: string, dark = false): string {
  const l = labels(ps);
  const fg = dark ? "#fff" : "#0f172a";
  const muted = dark ? "rgba(255,255,255,.75)" : "#64748b";
  return `<div style="color:${fg};font-size:12px;min-width:285px;">
    <div style="display:flex;justify-content:space-between;gap:20px;padding:5px 0;color:${muted};"><span>${l("الإجمالي الخاضع للضريبة", "Taxable subtotal")}</span><b>${money(model.subtotal)} ${esc(model.currency)}</b></div>
    <div style="display:flex;justify-content:space-between;gap:20px;padding:5px 0;color:${muted};"><span>${l(`ضريبة القيمة المضافة (${model.vatRate}%)`, `VAT (${model.vatRate}%)`)}</span><b>${money(model.vatAmount)} ${esc(model.currency)}</b></div>
    <div style="display:flex;justify-content:space-between;gap:20px;padding:9px 0 2px;border-top:2px solid ${dark ? "rgba(255,255,255,.35)" : accent};font-size:15px;font-weight:900;"><span>${l("الإجمالي المستحق شامل الضريبة", "Total due incl. VAT")}</span><span style="color:${dark ? "#fde047" : accent};">${money(model.total)} ${esc(model.currency)}</span></div>
  </div>`;
}

function qr(model: InvoiceTemplateModel, size = 105): string {
  if (!model.qrDataUrl) return "";
  return `<div style="text-align:center;"><img src="${esc(model.qrDataUrl)}" alt="QR" style="width:${size}px;height:${size}px;object-fit:contain;background:#fff;border:1px solid #e2e8f0;padding:4px;border-radius:9px;"/>${model.qrCaption ? `<div style="font-size:8.5px;color:#64748b;margin-top:3px;">${esc(model.qrCaption)}</div>` : ""}</div>`;
}

function notesAndWords(model: InvoiceTemplateModel, ps: PrintSettings, accent: string): string {
  const l = labels(ps);
  return `<div style="display:flex;gap:9px;flex:1;">
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:9px 11px;background:#f8fafc;">
      <div style="font-size:10px;color:${accent};font-weight:800;margin-bottom:3px;">${l("المبلغ كتابةً", "Amount in words")}</div>
      <div style="font-size:11px;font-weight:700;line-height:1.7;">${esc(model.amountInWords)}</div>
    </div>
    ${model.notes ? `<div style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:9px 11px;"><div style="font-size:10px;color:${accent};font-weight:800;margin-bottom:3px;">${l("ملاحظات", "Notes")}</div><div style="font-size:11px;line-height:1.7;">${esc(model.notes)}</div></div>` : ""}
  </div>`;
}

function signatures(ps: PrintSettings): string {
  const l = labels(ps);
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:28px;text-align:center;color:#475569;font-size:11px;">
    <div style="border-top:1px dashed #94a3b8;padding-top:6px;">${l("توقيع المستلم", "Receiver")}</div>
    <div style="border-top:1px dashed #94a3b8;padding-top:6px;">${l("عن الشركة", "For the company")}</div>
  </div>`;
}

function footer(model: InvoiceTemplateModel, ps: PrintSettings): string {
  const pieces = [model.footerText, ps.footer_text].filter(Boolean);
  if (ps.show_date && (model.printedBy || model.printedAt)) {
    pieces.push(`${ps.label_language === "en" ? "Printed by" : "طُبع بواسطة"}: ${model.printedBy || "—"} — ${model.printedAt || ""}`);
  }
  return pieces.length ? `<div style="margin-top:15px;border-top:1px solid #e2e8f0;padding-top:7px;text-align:center;font-size:9px;color:#64748b;">${pieces.map(esc).join("<br/>")}</div>` : "";
}

function renderModern(model: InvoiceTemplateModel, ps: PrintSettings, accent: string): string {
  return `<div data-invoice-template="modern" style="direction:rtl;color:#0f172a;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;background:#fff;">
    <div style="height:8px;background:linear-gradient(90deg,${accent},#4f46e5,${accent});"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:25px;padding:22px;border-bottom:1px solid #e2e8f0;">
      <div style="display:flex;align-items:flex-start;gap:12px;">${logo(model, ps, 64)}${sellerBlock(model, ps, accent)}</div>
      ${titleBlock(model, ps, accent, "filled")}
    </div>
    <div style="display:flex;justify-content:space-between;gap:18px;padding:14px 22px;background:#f8fafc;">${buyerBlock(model, ps, accent, false)}${model.containerNumber ? `<div style="font-size:11px;color:#64748b;text-align:left;">${ps.label_language === "en" ? "Container No." : "رقم الحاوية"}<br/><b dir="ltr" style="font-size:13px;color:#0f172a;">${esc(model.containerNumber)}</b></div>` : ""}</div>
    <div style="padding:18px 22px;">${invoiceTable(model, ps, { accent })}</div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 22px;background:#f8fafc;border-top:1px solid #e2e8f0;">${qr(model)}${notesAndWords(model, ps, accent)}${totals(model, ps, accent)}</div>
    <div style="padding:0 22px 15px;">${signatures(ps)}${footer(model, ps)}</div>
  </div>`;
}

function renderClassic(model: InvoiceTemplateModel, ps: PrintSettings, accent: string): string {
  const l = labels(ps);
  return `<div data-invoice-template="classic" style="direction:rtl;color:#111827;border:2px solid ${accent};padding:22px;background:#fff;">
    <div style="display:flex;justify-content:space-between;gap:25px;align-items:flex-start;border-bottom:2px solid ${accent};padding-bottom:16px;margin-bottom:16px;">
      <div style="display:flex;gap:12px;">${logo(model, ps, 62, 0)}${sellerBlock(model, ps, accent)}</div>
      ${titleBlock(model, ps, accent, "outlined")}
    </div>
    <div style="border:1px solid #475569;padding:11px;margin-bottom:15px;"><div style="font-size:10px;font-weight:900;margin-bottom:4px;">${l("بيانات المشتري", "BUYER DETAILS")}</div>${buyerBlock(model, ps, accent, false)}</div>
    ${invoiceTable(model, ps, { accent, classic: true })}
    <div style="display:grid;grid-template-columns:120px 1fr 300px;gap:14px;align-items:start;border:1px solid #475569;padding:12px;margin-top:15px;">${qr(model, 95)}${notesAndWords(model, ps, accent)}${totals(model, ps, accent)}</div>
    ${signatures(ps)}${footer(model, ps)}
  </div>`;
}

function renderCompact(model: InvoiceTemplateModel, ps: PrintSettings, accent: string): string {
  const l = labels(ps);
  return `<div data-invoice-template="compact" style="direction:rtl;color:#0f172a;border:1px solid #cbd5e1;border-radius:8px;padding:15px;background:#fff;">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #cbd5e1;padding-bottom:9px;">
      <div style="display:flex;align-items:center;gap:9px;">${logo(model, ps, 40, 7)}<div>${visible(ps.invoice_show_company_name, model.seller.name) ? `<b style="font-size:14px;color:${accent};">${esc(model.seller.name)}</b>` : ""}<div style="font-size:9.5px;color:#64748b;">${visible(ps.invoice_show_company_tax_number, model.seller.taxNumber) ? `${l("الضريبي", "VAT")}: ${esc(model.seller.taxNumber)}` : ""}${visible(ps.invoice_show_company_phone, model.seller.phone) ? ` — ${esc(model.seller.phone)}` : ""}</div></div></div>
      <div style="text-align:left;"><b style="font-size:14px;color:${accent};">${esc(ps.label_language === "en" ? model.invoiceTitleEn : model.invoiceTitleAr)}</b><div dir="ltr" style="font-size:11px;font-weight:800;">${esc(model.invoiceNumber)} | ${esc(model.issueDate)}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:7px 9px;margin:8px 0;font-size:10px;"><div>${l("العميل", "Client")}: <b>${esc(model.buyer.name)}</b></div><div>${model.containerNumber ? `${l("الحاوية", "Container")}: <b dir="ltr">${esc(model.containerNumber)}</b>` : `${l("البنود", "Items")}: <b>${model.lines.length}</b>`}</div></div>
    ${invoiceTable(model, ps, { accent, dense: true })}
    <div style="display:grid;grid-template-columns:85px 1fr 270px;gap:10px;align-items:center;border-top:1px solid #cbd5e1;margin-top:9px;padding-top:9px;">${qr(model, 70)}${notesAndWords(model, ps, accent)}${totals(model, ps, accent)}</div>
    ${footer(model, ps)}
  </div>`;
}

function renderElegant(model: InvoiceTemplateModel, ps: PrintSettings, accent: string): string {
  return `<div data-invoice-template="elegant" style="direction:rtl;color:#1e1b4b;border:1px solid ${accent}26;border-radius:24px;padding:24px;background:#fff;">
    <div style="text-align:center;border-bottom:1px solid ${accent}26;padding-bottom:17px;">${logo(model, ps, 62, 16)}<div style="font-size:23px;font-weight:900;color:${accent};margin-top:7px;">${esc(ps.label_language === "en" ? model.invoiceTitleEn : model.invoiceTitleAr)}</div><div dir="ltr" style="display:inline-block;margin-top:7px;padding:5px 15px;border-radius:999px;background:${accent}12;color:${accent};font-size:11px;font-weight:800;">${esc(model.invoiceNumber)} • ${esc(model.issueDate)}</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0;"><div style="padding:13px;border-radius:16px;background:${accent}0a;border:1px solid ${accent}20;">${sellerBlock(model, ps, accent)}</div><div style="padding:13px;border-radius:16px;background:${accent}0a;border:1px solid ${accent}20;">${buyerBlock(model, ps, accent, false)}</div></div>
    <div style="border:1px solid ${accent}26;border-radius:15px;overflow:hidden;">${invoiceTable(model, ps, { accent, elegant: true })}</div>
    <div style="display:grid;grid-template-columns:115px 1fr 310px;gap:16px;align-items:center;background:${accent};color:#fff;border-radius:16px;padding:16px;margin-top:16px;">${qr(model, 90)}<div style="font-size:11px;line-height:1.7;color:rgba(255,255,255,.85);">${esc(model.amountInWords)}${model.notes ? `<div style="margin-top:5px;">${esc(model.notes)}</div>` : ""}</div>${totals(model, ps, accent, true)}</div>
    ${signatures(ps)}${footer(model, ps)}
  </div>`;
}

function renderLogistics(model: InvoiceTemplateModel, ps: PrintSettings, accent: string): string {
  const l = labels(ps);
  return `<div data-invoice-template="logistics" style="direction:rtl;color:#0f172a;border-top:8px solid ${accent};border-radius:12px;padding:20px;background:#fff;box-shadow:0 0 0 1px #e2e8f0 inset;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #e2e8f0;padding-bottom:13px;"> <div style="display:flex;gap:11px;">${logo(model, ps, 55)}${sellerBlock(model, ps, accent)}</div>${titleBlock(model, ps, accent, "plain")}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:9px;margin:12px 0;font-size:10.5px;"><div>${l("العميل", "Client")}: <b>${esc(model.buyer.name)}</b></div><div>${l("رقم الحاوية", "Container No.")}: <b dir="ltr">${esc(model.containerNumber || "—")}</b></div><div>${l("عدد بنود النقل", "Transport lines")}: <b>${model.lines.length}</b></div></div>
    ${invoiceTable(model, ps, { accent, logistics: true })}
    <div style="display:grid;grid-template-columns:120px 1fr 300px;gap:14px;align-items:start;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:13px;">${qr(model, 95)}${notesAndWords(model, ps, accent)}${totals(model, ps, accent)}</div>
    ${signatures(ps)}${footer(model, ps)}
  </div>`;
}

function renderThermal(model: InvoiceTemplateModel, ps: PrintSettings): string {
  const l = labels(ps);
  const rows = model.lines.map((line) => `<tr><td style="padding:4px 0;border-bottom:1px dotted #777;text-align:right;">${esc(line.description)}<div style="font-size:8px;color:#555;">${money(line.quantity)} × ${money(line.unitAmount)}</div>${lineContainers(line, ps)}</td><td style="padding:4px 0;border-bottom:1px dotted #777;text-align:left;font-weight:800;">${money(line.total)}</td></tr>`).join("");
  return `<div data-invoice-template="thermal" style="direction:rtl;width:72mm;max-width:100%;margin:0 auto;color:#000;font-family:monospace;font-size:10px;background:#fff;">
    <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:7px;">${logo(model, ps, 44, 0)}<div style="font-size:14px;font-weight:900;">${esc(model.seller.name)}</div>${model.seller.taxNumber ? `<div>${l("الرقم الضريبي", "VAT")}: ${esc(model.seller.taxNumber)}</div>` : ""}<div style="font-size:12px;font-weight:900;border-top:1px dotted #000;margin-top:5px;padding-top:5px;">${esc(ps.label_language === "en" ? model.invoiceTitleEn : model.invoiceTitleAr)}</div><div dir="ltr">${esc(model.invoiceNumber)} — ${esc(model.issueDate)}</div></div>
    <div style="padding:6px 0;border-bottom:1px dashed #000;">${l("العميل", "Client")}: <b>${esc(model.buyer.name)}</b></div>
    <table style="width:100%;border-collapse:collapse;font-size:9.5px;"><thead><tr><th style="padding:5px 0;border-bottom:1px solid #000;text-align:right;">${l("الخدمة", "Service")}</th><th style="padding:5px 0;border-bottom:1px solid #000;text-align:left;">${l("الإجمالي", "Total")}</th></tr></thead><tbody>${rows}</tbody></table>
    <div style="padding:7px 0;border-bottom:1px dashed #000;"><div style="display:flex;justify-content:space-between;"><span>${l("قبل الضريبة", "Subtotal")}</span><b>${money(model.subtotal)}</b></div><div style="display:flex;justify-content:space-between;"><span>${l(`الضريبة ${model.vatRate}%`, `VAT ${model.vatRate}%`)}</span><b>${money(model.vatAmount)}</b></div><div style="display:flex;justify-content:space-between;border-top:1px solid #000;margin-top:3px;padding-top:3px;font-size:12px;font-weight:900;"><span>${l("الإجمالي", "Total")}</span><span>${money(model.total)} ${esc(model.currency)}</span></div></div>
    <div style="display:flex;justify-content:center;margin:8px 0;">${qr(model, 105)}</div>${model.notes ? `<div style="padding:5px 0;border-top:1px dashed #000;">${esc(model.notes)}</div>` : ""}${footer(model, ps)}
  </div>`;
}

/**
 * هياكل القوالب مقتبسة ومكيّفة من قوالب pro-acc الستة لتناسب بنود النقل،
 * مع إبقاء حقول VAT ورمز زاتكا تحت تحكم إعدادات وميزات هذا المشروع.
 */
export function renderInvoiceTemplate(model: InvoiceTemplateModel, ps: PrintSettings): string {
  const template: PrintTemplate = ps.template;
  const fallback: Record<PrintTemplate, string> = {
    modern: "#2563eb",
    classic: "#1e293b",
    compact: "#0d9488",
    elegant: "#7c3aed",
    logistics: "#b45309",
    thermal: "#000000",
    minimal: "#111827", // معرّف قديم؛ normalize يحوّله إلى compact.
  };
  const accent = color(ps.accent_color, fallback[template] || fallback.modern);
  if (template === "classic") return renderClassic(model, ps, accent);
  if (template === "compact") return renderCompact(model, ps, accent);
  if (template === "elegant") return renderElegant(model, ps, accent);
  if (template === "logistics") return renderLogistics(model, ps, accent);
  if (template === "thermal") return renderThermal(model, ps);
  return renderModern(model, ps, accent);
}
