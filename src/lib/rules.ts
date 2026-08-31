// القواعد العامة على مستوى النظام — مكافئ لـ app/core/rules.py

import { supabase } from "./supabase";
import type { FinancialYear } from "./types";

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

/** تقنية دفاعية: كل مبلغ يُخزَّن مقرباً لمنزلتين عشريتين وضمن سقف منطقي. */
export function roundMoney(x: unknown): number {
  let v: number;
  try {
    v = Math.round(Number(x ?? 0) * 100) / 100;
  } catch {
    throw new RuleError("قيمة مبلغ غير صالحة.");
  }
  if (!Number.isFinite(v)) throw new RuleError("قيمة مبلغ غير صالحة.");
  if (Math.abs(v) > 999_999_999_999) {
    throw new RuleError("المبلغ خارج النطاق المسموح (الحد 999,999,999,999).");
  }
  return v;
}

/** تحديد طول النصوص لمنع إغراق قاعدة البيانات. */
export function txt(value: unknown, field: string, maxLen = 5000): string {
  const s = String(value ?? "");
  if (s.length > maxLen) {
    throw new RuleError(`حقل ${field} طويل جداً (الحد ${maxLen} محرفاً).`);
  }
  return s;
}

export function ensurePositive(amount: unknown, field = "المبلغ"): void {
  const v = roundMoney(amount);
  if (v <= 0) throw new RuleError(`يجب إدخال ${field} أكبر من صفر.`);
}

export function ensureNotBlank(value: unknown, field: string): void {
  if (value == null || !String(value).trim()) {
    throw new RuleError(`يجب إدخال ${field}.`);
  }
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// ---------------------------------------------------------------------------
// قاعدة السنوات المالية
// ---------------------------------------------------------------------------
export async function openYears(): Promise<FinancialYear[]> {
  const { data, error } = await supabase
    .from("financial_years")
    .select("*")
    .eq("status", "open")
    .order("date_from");
  if (error) throw new RuleError("تعذر قراءة السنوات المالية المفتوحة.");
  return (data ?? []) as FinancialYear[];
}

export function dateInOpenYear(dateStr: string, years: FinancialYear[]): boolean {
  if (!isValidIsoDate(dateStr)) {
    throw new RuleError("تاريخ غير صالح، يجب أن يكون بصيغة سنة-شهر-يوم.");
  }
  return years.some((y) => y.date_from <= dateStr && y.date_to >= dateStr);
}

export async function ensureDateInOpenYear(dateStr: string): Promise<void> {
  const years = await openYears();
  if (!dateInOpenYear(dateStr, years)) {
    throw new RuleError(
      "لا يمكن تسجيل حركة بهذا التاريخ:\n" +
        "التاريخ خارج نطاق أي سنة مالية مفتوحة.\n" +
        "يرجى فتح سنة مالية تشمل هذا التاريخ أولاً (قسم السنوات المالية)."
    );
  }
}

export async function ensureMovementEditable(
  oldDate: string,
  newDate?: string | null
): Promise<void> {
  const years = await openYears();
  if (!dateInOpenYear(oldDate, years)) {
    throw new RuleError(
      "لا يمكن تعديل أو حذف حركة بتاريخ قديم خارج السنة المالية المفتوحة.\n" +
        `تاريخ الحركة: ${oldDate}`
    );
  }
  if (newDate != null && newDate !== oldDate) {
    if (!dateInOpenYear(newDate, years)) {
      throw new RuleError(
        "لا يمكن تسجيل حركة بهذا التاريخ:\n" +
          "التاريخ خارج نطاق أي سنة مالية مفتوحة.\n" +
          "يرجى فتح سنة مالية تشمل هذا التاريخ أولاً (قسم السنوات المالية)."
      );
    }
  }
}

export async function hasOpenYear(): Promise<boolean> {
  const years = await openYears();
  return years.length > 0;
}
