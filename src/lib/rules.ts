// القواعد العامة على مستوى النظام — مكافئ لـ app/core/rules.py

import { supabase } from "./supabase";
import type { FinancialYear } from "./types";
import { safeField, safeIsoDate, safeNumber } from "./security";

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

/** تقنية دفاعية: كل مبلغ يُخزَّن مقرباً لمنزلتين عشريتين وضمن سقف منطقي. */
export function roundMoney(x: unknown): number {
  const raw = Number(x ?? 0);
  if (!Number.isFinite(raw)) throw new RuleError("قيمة مبلغ غير صالحة.");
  // Number.EPSILON يعوّض خطأ التمثيل الثنائي للكسور العشرية (مثل 1.005 → 1.004999…)
  // كي تُقرَّب حالات «النصف» (x.xx5) للأعلى بشكل صحيح.
  const v = Math.round((raw + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(v)) throw new RuleError("قيمة مبلغ غير صالحة.");
  if (Math.abs(v) > 999_999_999_999) {
    throw new RuleError("المبلغ خارج النطاق المسموح (الحد 999,999,999,999).");
  }
  return v;
}

/** تحقق وتعقيم مركزي لكل نص قبل وصوله إلى Supabase. */
export function txt(value: unknown, field: string, maxLen = 5000): string {
  try {
    return safeField(value, { label: field, max: maxLen });
  } catch (error) {
    throw new RuleError(error instanceof Error ? error.message : `قيمة حقل ${field} غير صالحة.`);
  }
}

/** معرّف قاعدة بيانات موجب وصحيح؛ يمنع NaN والكسور والمعرّفات خارج النطاق. */
export function positiveId(value: unknown, field = "المعرّف"): number {
  try {
    return safeNumber(value, { label: field, integer: true, min: 1, max: Number.MAX_SAFE_INTEGER });
  } catch (error) {
    throw new RuleError(error instanceof Error ? error.message : `قيمة ${field} غير صالحة.`);
  }
}

/** رقم عشري محدود وصالح للاستخدام في الحقول غير المالية. */
export function boundedNumber(value: unknown, field: string, min: number, max: number, integer = false): number {
  try {
    return safeNumber(value, { label: field, min, max, integer });
  } catch (error) {
    throw new RuleError(error instanceof Error ? error.message : `قيمة ${field} غير صالحة.`);
  }
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
  try {
    safeIsoDate(s);
    return true;
  } catch {
    return false;
  }
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

// ---------------------------------------------------------------------------
// قاعدة: لا يُسمح بأن يصبح رصيد خزينة أو بنك سالباً
// ---------------------------------------------------------------------------
function accTable(kind: string): string {
  return kind === "cashbox" ? "cashboxes" : "banks";
}

/** الرصيد الحالي لحساب نقدي، مع إمكانية استثناء حركات (سند/راتب) قيد التعديل. */
export async function currentAccountBalance(
  kind: string,
  accountId: number,
  exclude?: { paymentId?: number | null; payrollId?: number | null; sourceExpenseIds?: number[] }
): Promise<number> {
  const { data: acc } = await supabase
    .from(accTable(kind))
    .select("opening_balance")
    .eq("id", accountId)
    .single();
  let bal = Number(acc?.opening_balance ?? 0);

  const { data: recs } = await supabase
    .from("receipt_vouchers")
    .select("amount")
    .eq("account_kind", kind)
    .eq("account_id", accountId);
  for (const r of recs ?? []) bal += Number(r.amount ?? 0);

  const { data: pays } = await supabase
    .from("payment_vouchers")
    .select("id, amount, source_expense_id")
    .eq("account_kind", kind)
    .eq("account_id", accountId);
  for (const p of pays ?? []) {
    if (exclude?.paymentId && p.id === exclude.paymentId) continue;
    if (exclude?.sourceExpenseIds?.length && p.source_expense_id != null
        && exclude.sourceExpenseIds.includes(Number(p.source_expense_id))) continue;
    bal -= Number(p.amount ?? 0);
  }

  const { data: sals } = await supabase
    .from("payrolls")
    .select("id, net_salary")
    .eq("account_kind", kind)
    .eq("account_id", accountId);
  for (const s of sals ?? []) {
    if (exclude?.payrollId && s.id === exclude.payrollId) continue;
    bal -= Number(s.net_salary ?? 0);
  }

  return Math.round((bal + Number.EPSILON) * 100) / 100;
}

/** يرفض أي حركة صرف تجعل رصيد الخزينة/البنك سالباً. */
export async function ensureSufficientFunds(
  kind: string,
  accountId: number,
  outflow: number,
  exclude?: { paymentId?: number | null; payrollId?: number | null; sourceExpenseIds?: number[] }
): Promise<void> {
  const amount = roundMoney(outflow);
  if (amount <= 0) return;
  const balance = await currentAccountBalance(kind, accountId, exclude);
  if (amount > balance + 0.0001) {
    const { data: acc } = await supabase.from(accTable(kind)).select("name").eq("id", accountId).single();
    const label = kind === "cashbox" ? "الخزينة" : "البنك";
    throw new RuleError(
      `الرصيد لا يكفي: ${label} «${acc?.name ?? ""}» رصيده ${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
        ` والمطلوب صرفه ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.\n` +
        "لا يُسمح بجعل الرصيد سالباً — سجّل إيداعاً أولاً أو اختر جهة صرف أخرى."
    );
  }
}
