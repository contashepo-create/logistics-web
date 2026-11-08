// أعمار ديون العملاء (ما لنا عليهم) — نفس منطق أعمار ديون الموردين:
// كل فاتورة تُوزَّع على شريحة عمرية حسب تاريخها، والسداد يُخصم بالأقدم أولاً (FIFO)،
// مع احتساب الرصيد الافتتاحي للعميل وإشعارات المدين/الدائن بنفس قواعد كشف الحساب.

import { supabase } from "./supabase";
import { listCustomers } from "./repo";
import { invoiceTotalsBatch, num } from "./calc";
import { buildAging, type AgingBucketRow } from "./suppliers";

export interface CustomerAgingRow extends AgingBucketRow {
  code: string;
  phone: string;
}

/**
 * أعمار ديون كل العملاء بأربعة استعلامات مجمّعة (بلا استعلام لكل عميل).
 * `asOf` هي التاريخ المرجعي لحساب العمر (افتراضياً اليوم).
 */
export async function customersAging(asOf: Date = new Date()): Promise<CustomerAgingRow[]> {
  const [customers, invRes, noteRes, recRes] = await Promise.all([
    listCustomers(),
    supabase.from("invoices").select("id, customer_id, date"),
    supabase.from("credit_debit_notes").select("customer_id, invoice_id, note_type, amount, vat_rate"),
    supabase
      .from("receipt_vouchers")
      .select("customer_id, amount")
      .eq("voucher_type", "customer"),
  ]);

  const invoicesRaw = (invRes.data ?? []) as { id: number; customer_id: number; date: string }[];
  const totals = await invoiceTotalsBatch(invoicesRaw.map((i) => i.id));

  // إشعارات المدين تزيد المستحق على الفاتورة، والدائن يحسمه (سالب)
  const noteAdj = new Map<number, number>();
  for (const n of (noteRes.data ?? []) as Record<string, unknown>[]) {
    const invoiceId = Number(n.invoice_id);
    if (!invoiceId) continue; // إشعار غير مرتبط بفاتورة: لا يعدّل عمر فاتورة بعينها
    const amount = num(n.amount);
    const total = amount + Math.round(((amount * num(n.vat_rate)) / 100 + Number.EPSILON) * 100) / 100;
    const sign = n.note_type === "debit" ? 1 : -1;
    noteAdj.set(invoiceId, (noteAdj.get(invoiceId) ?? 0) + sign * total);
  }

  const invoicesByCustomer = new Map<number, { date: string; total: number }[]>();
  for (const inv of invoicesRaw) {
    const cid = Number(inv.customer_id);
    if (!cid) continue;
    const base = totals.get(Number(inv.id))?.customer_total ?? 0;
    const adjusted = Math.round((num(base) + (noteAdj.get(Number(inv.id)) ?? 0) + Number.EPSILON) * 100) / 100;
    const list = invoicesByCustomer.get(cid) ?? [];
    list.push({ date: String(inv.date), total: adjusted });
    invoicesByCustomer.set(cid, list);
  }

  const paidByCustomer = new Map<number, number>();
  for (const r of (recRes.data ?? []) as Record<string, unknown>[]) {
    const cid = Number(r.customer_id);
    if (!cid) continue;
    paidByCustomer.set(cid, (paidByCustomer.get(cid) ?? 0) + num(r.amount));
  }

  const out: CustomerAgingRow[] = [];
  for (const c of customers) {
    const invoices = [...(invoicesByCustomer.get(c.id) ?? [])];
    const opening = Number(c.opening_balance) || 0;
    // رصيد افتتاحي مدين => فاتورة قديمة، ورصيد دائن => دفعة مقدَّمة تُخصم بالأقدمية
    let advance = 0;
    if (opening > 0) invoices.unshift({ date: c.created_at?.slice(0, 10) ?? "2000-01-01", total: opening });
    else if (opening < 0) advance = -opening;

    const bucket = buildAging(invoices, (paidByCustomer.get(c.id) ?? 0) + advance, asOf);
    if (bucket.total !== 0) {
      out.push({ id: c.id, name: c.name, code: c.code ?? "", phone: c.phone ?? "", ...bucket });
    }
  }

  return out.sort((a, b) => b.total - a.total);
}
