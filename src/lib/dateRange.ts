// التحقق الموحّد من نطاق التواريخ في كل التقارير والكشوف والتصدير.
//
// كان كل تقرير يبني استعلامه دون التحقق من أن «من تاريخ» <= «إلى تاريخ»،
// فيظهر الكشف فارغاً بلا أي تفسير (وقد يبدو كأن الفلتر لا يعمل). الآن:
//   • isValidDateRange: للواجهة (تعطيل الاستعلام وإظهار تحذير فوري).
//   • assertDateRange: لطبقة البيانات (رسالة عربية واضحة بدل نتيجة فارغة صامتة).

import { RuleError } from "./rules";

export const DATE_RANGE_ERROR = "تاريخ البداية يجب أن يكون قبل تاريخ النهاية.";
export const DATE_REQUIRED_ERROR = "حدّد تاريخ البداية والنهاية للفترة.";

/** هل النطاق صالح؟ (الفارغ يُعتبر غير مقيَّد لا خطأً). */
export function isValidDateRange(from?: string | null, to?: string | null): boolean {
  const a = String(from ?? "").trim();
  const b = String(to ?? "").trim();
  if (!a || !b) return true;
  return a <= b;
}

/**
 * حماية طبقة البيانات: يرفع خطأً عربياً واضحاً عند نطاق معكوس أو تاريخ غير صالح،
 * بدل تنفيذ استعلام يعيد صفراً من الحركات.
 */
/**
 * تحقق تقويمي فعلي من صيغة YYYY-MM-DD.
 * ملاحظة: لا نقيّد السنوات بنطاق الشركة (1900–2200) هنا لأن بعض التقارير تستخدم
 * حدوداً مفتوحة (مثل 1900-01-01 ← 2999-12-31) للتعبير عن «كل الحركات».
 */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function assertDateRange(from?: string | null, to?: string | null, opts: { required?: boolean } = {}): void {
  const a = String(from ?? "").trim();
  const b = String(to ?? "").trim();
  if (opts.required && (!a || !b)) throw new RuleError(DATE_REQUIRED_ERROR);
  if (a && !isIsoDate(a)) throw new RuleError("تاريخ البداية غير صالح.");
  if (b && !isIsoDate(b)) throw new RuleError("تاريخ النهاية غير صالح.");
  if (a && b && a > b) throw new RuleError(DATE_RANGE_ERROR);
}
