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
  supplier: "سداد لمورّد",
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

// ---------------------------------------------------------------------------
// تفقيط المبالغ بالعربية (لفاتورة العميل المطبوعة)
// ---------------------------------------------------------------------------
const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة",
  "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر",
  "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const u = rest % 10;
      const t = Math.floor(rest / 10);
      parts.push(u ? `${ONES[u]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(" و");
}

function groupWord(count: number, forms: [string, string, string, string]): string {
  // forms: [مفرد, مثنى, جمع (3-10), تمييز (11+)]
  if (count === 1) return forms[0];
  if (count === 2) return forms[1];
  if (count >= 3 && count <= 10) return `${below1000(count)} ${forms[2]}`;
  return `${below1000(count)} ${forms[3]}`;
}

/** تحويل رقم صحيح إلى كلمات عربية (حتى المليارات) */
export function numberToArabicWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "صفر";
  const chunks: { count: number; forms: [string, string, string, string] }[] = [
    { count: Math.floor(n / 1_000_000_000), forms: ["مليار", "ملياران", "مليارات", "مليار"] },
    { count: Math.floor((n % 1_000_000_000) / 1_000_000), forms: ["مليون", "مليونان", "ملايين", "مليون"] },
    { count: Math.floor((n % 1_000_000) / 1000), forms: ["ألف", "ألفان", "آلاف", "ألفاً"] },
  ];
  const words: string[] = [];
  for (const c of chunks) if (c.count) words.push(groupWord(c.count, c.forms));
  n = n % 1000;
  if (n) words.push(below1000(n));
  return words.join(" و");
}

/** تفقيط مبلغ مالي: "أربعة آلاف وخمسمائة جنيه و٥٠ قرشاً فقط لا غير" */
export function amountToArabicWords(amount: number, currency = "جنيه", fraction = "قرش"): string {
  const negative = amount < 0;
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const whole = Math.floor(rounded);
  const cents = Math.round((rounded - whole) * 100);
  let out = `${numberToArabicWords(whole)} ${currency}`;
  if (cents) out += ` و${numberToArabicWords(cents)} ${fraction}`;
  out += " فقط لا غير";
  return negative ? `سالب ${out}` : out;
}

// ---------------------------------------------------------------------------
// عرض أرصدة العملاء: «عليه» (مدين للشركة) / «له» (دائن) / «مسدَّد»
// ---------------------------------------------------------------------------
export type BalanceSide = "debit" | "credit" | "zero";

export function balanceSide(value: number): BalanceSide {
  const v = Math.round((Number(value) || 0) * 100) / 100;
  if (v > 0) return "debit";
  if (v < 0) return "credit";
  return "zero";
}

/** نص جانب الرصيد: عليه / له / مسدَّد */
export function balanceSideLabel(value: number): string {
  const s = balanceSide(value);
  return s === "debit" ? "عليه" : s === "credit" ? "له" : "مسدَّد";
}

/** رصيد منسّق مع بيان الجانب: «1,500.00 (عليه)» */
export function balanceText(value: number): string {
  const v = Math.abs(Math.round((Number(value) || 0) * 100) / 100);
  const s = balanceSide(value);
  if (s === "zero") return `${money(0)} (مسدَّد)`;
  return `${money(v)} (${s === "debit" ? "عليه" : "له"})`;
}
