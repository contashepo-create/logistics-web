// أدوات التنسيق: الأرقام العربية، المبالغ، التواريخ، أسماء الشهور.
// مكافئ حرفي لـ app/utils/fmt.py

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};
const PERSIAN_DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

export const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export const EXPENSE_TYPES: Record<string, string> = {
  trip: "تريب",
  fuel: "بنزين",
  card: "كارتة",
  other: "أخرى",
};

export const EXPENSE_SOURCES: Record<string, string> = {
  cash: "نقداً من خزينة/بنك",
  driver: "من عهدة السائق",
  supplier: "آجل على مورد",
  customer: "يتحمّله العميل",
};

/** شرح مختصر لأثر كل مصدر تمويل — يظهر تحت الحقل في شاشة الفاتورة. */
export const EXPENSE_SOURCE_HINTS: Record<string, string> = {
  cash: "يُنشأ سند دفع تلقائي ويُخصم فوراً من رصيد الخزينة/البنك.",
  driver: "يُقيَّد على حساب السائق (يُخصم من عهدته/مستحقاته) بلا تحريك خزينة.",
  supplier: "التزام آجل على المورد يُسدَّد لاحقاً بسند دفع يدوي.",
  customer: "لا يُعد تكلفة — يُضاف على الفاتورة ويزيد المستحق على العميل.",
};

export const PAYMENT_TYPES: Record<string, string> = {
  trip: "مصروف يخص رحلة",
  advance: "سلفة موظف/سائق",
  vehicle: "مصروف لسيارة",
  general: "مصروف عام",
};

export const VEHICLE_EXPENSES: Record<string, string> = {
  maintenance: "صيانة",
  tires: "كاوتش",
  other: "أخرى",
};

export const RECEIPT_TYPES: Record<string, string> = {
  customer: "تحصيل من عميل",
  other: "إيرادات أخرى",
};

export const EMP_TYPES: Record<string, string> = {
  driver: "سائق",
  admin: "إداري",
};

export function normalizeDigits(text: string | null | undefined): string {
  if (text == null) return "";
  let s = String(text);
  for (const [ar, en] of Object.entries(ARABIC_DIGITS)) s = s.split(ar).join(en);
  for (const [ar, en] of Object.entries(PERSIAN_DIGITS)) s = s.split(ar).join(en);
  return s;
}

export function parseFloatSafe(text: unknown, def = 0): number {
  if (text == null) return def;
  let s = normalizeDigits(String(text)).replace(/,/g, "").replace(/،/g, "").trim();
  if (!s) return def;
  s = s.replace(/٫/g, "."); // فاصلة عشرية عربية
  const v = Number(s);
  if (!Number.isFinite(v)) throw new Error(`قيمة رقمية غير صالحة: ${String(text)}`);
  return v;
}

export function money(x: unknown): string {
  let v = Number(x ?? 0);
  if (!Number.isFinite(v)) v = 0;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function monthName(month: number): string {
  return month >= 1 && month <= 12 ? MONTHS_AR[month - 1] : String(month);
}

export function periodLabel(year: number, month: number): string {
  return `${monthName(month)} ${year}`;
}

export function clean(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
