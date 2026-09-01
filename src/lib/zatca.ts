// امتثال فاتورة زاتكا (هيئة الزكاة والضريبة والجمارك — المملكة العربية السعودية).
//
//  • رمز الاستجابة السريعة بصيغة TLV مُرمّزة Base64 (المرحلة الأولى — الفوترة الإلكترونية).
//  • تمييز الفاتورة الضريبية (B2B) عن الفاتورة الضريبية المبسّطة (B2C).
//  • حقول ثنائية اللغة عربي/إنجليزي كما تتطلب اللائحة.
//
// التاجات المعتمدة في QR:
//   1 = اسم البائع، 2 = الرقم الضريبي للبائع، 3 = الطابع الزمني (ISO 8601)،
//   4 = الإجمالي شامل الضريبة، 5 = مبلغ ضريبة القيمة المضافة.

export type ZatcaInvoiceType = "standard" | "simplified";

export interface ZatcaQrInput {
  /** اسم البائع كما في السجل */
  sellerName: string;
  /** الرقم الضريبي للبائع (15 رقماً) */
  vatNumber: string;
  /** طابع زمني ISO 8601 لوقت إصدار الفاتورة */
  timestamp: string;
  /** الإجمالي شامل ضريبة القيمة المضافة */
  totalWithVat: number;
  /** مبلغ ضريبة القيمة المضافة */
  vatAmount: number;
}

/** ترميز قيمة واحدة بصيغة TLV: [tag][length][value] بترميز UTF-8. */
export function tlv(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 255) throw new Error("قيمة TLV أطول من 255 بايت.");
  const out = new Uint8Array(bytes.length + 2);
  out[0] = tag;
  out[1] = bytes.length;
  out.set(bytes, 2);
  return out;
}

/** تحويل بايتات إلى Base64 (يعمل في المتصفح وفي Node). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  if (typeof btoa === "function") return btoa(bin);
  return Buffer.from(bytes).toString("base64");
}

/** تنسيق المبلغ كنص برقمين عشريين كما تشترط زاتكا. */
export function zatcaAmount(v: number): string {
  return (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
}

/** الطابع الزمني بصيغة ISO 8601 (UTC) بلا أجزاء الميلي ثانية. */
export function zatcaTimestamp(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const iso = (isNaN(date.getTime()) ? new Date() : date).toISOString();
  return iso.replace(/\.\d{3}Z$/, "Z");
}

/**
 * توليد محتوى رمز الاستجابة السريعة المعتمد من زاتكا (سلسلة Base64).
 * يُطبع كما هو داخل رمز QR على الفاتورة.
 */
export function buildZatcaQr(input: ZatcaQrInput): string {
  const parts = [
    tlv(1, String(input.sellerName ?? "").trim()),
    tlv(2, String(input.vatNumber ?? "").replace(/\D/g, "")),
    tlv(3, zatcaTimestamp(input.timestamp)),
    tlv(4, zatcaAmount(input.totalWithVat)),
    tlv(5, zatcaAmount(input.vatAmount)),
  ];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.length;
  }
  return bytesToBase64(merged);
}

/** فكّ سلسلة QR إلى تاجاتها — يُستخدم في الاختبار والتشخيص. */
export function parseZatcaQr(b64: string): Record<number, string> {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const out: Record<number, string> = {};
  let i = 0;
  while (i + 1 < bytes.length) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    const value = bytes.slice(i + 2, i + 2 + len);
    out[tag] = new TextDecoder().decode(value);
    i += 2 + len;
  }
  return out;
}

/**
 * نوع الفاتورة وفق زاتكا:
 *  • ضريبية (Standard/B2B) عندما يكون المشتري منشأة خاضعة ولها رقم ضريبي.
 *  • مبسّطة (Simplified/B2C) فيما عدا ذلك.
 */
export function zatcaInvoiceType(buyer: { tax_number?: string; tax_status?: string } | null): ZatcaInvoiceType {
  const vat = String(buyer?.tax_number ?? "").replace(/\D/g, "");
  const taxable = (buyer?.tax_status ?? "taxable") === "taxable";
  return vat.length === 15 && taxable ? "standard" : "simplified";
}

export const ZATCA_TYPE_LABEL: Record<ZatcaInvoiceType, { ar: string; en: string }> = {
  standard: { ar: "فاتورة ضريبية", en: "Tax Invoice" },
  simplified: { ar: "فاتورة ضريبية مبسّطة", en: "Simplified Tax Invoice" },
};

/** الحقول الإلزامية الناقصة في فاتورة زاتكا (فارغة = مكتملة). */
export function zatcaMissingFields(opts: {
  sellerName?: string;
  sellerVat?: string;
  sellerAddress?: string;
  buyerName?: string;
  buyerVat?: string;
  type: ZatcaInvoiceType;
  date?: string;
}): string[] {
  const missing: string[] = [];
  if (!String(opts.sellerName ?? "").trim()) missing.push("اسم البائع");
  if (String(opts.sellerVat ?? "").replace(/\D/g, "").length !== 15) missing.push("الرقم الضريبي للبائع (15 رقماً)");
  if (!String(opts.sellerAddress ?? "").trim()) missing.push("عنوان البائع");
  if (!String(opts.date ?? "").trim()) missing.push("تاريخ الإصدار");
  if (opts.type === "standard") {
    if (!String(opts.buyerName ?? "").trim()) missing.push("اسم المشتري");
    if (String(opts.buyerVat ?? "").replace(/\D/g, "").length !== 15) missing.push("الرقم الضريبي للمشتري");
  }
  return missing;
}

/** توليد صورة QR بصيغة Data URL (تُستخدم داخل HTML الطباعة). */
export async function zatcaQrDataUrl(payload: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
  });
}
