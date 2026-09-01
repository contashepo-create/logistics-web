// محرك الحسابات: الأرصدة اللحظية، كشوف الحساب، التقارير، ولقطات الإغلاق.
// مكافئ حرفي لـ app/core/calc.py — الأرصدة تُحسب دائماً من الحركات.

import { supabase } from "./supabase";
import { PAYMENT_TYPES, periodLabel } from "./format";
import type {
  Bank,
  Cashbox,
  Customer,
  Employee,
  FinancialYear,
  Invoice,
  InvoiceTrip,
  Payroll,
  PaymentVoucher,
  ReceiptVoucher,
  TripExpense,
  Vehicle,
} from "./types";

/** تحويل القيم الرقمية (قد تأتي كسلسلة من PostgREST) إلى عدد. */
export function num(x: unknown): number {
  const v = Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function round2(x: number): number {
  // Number.EPSILON يعوّض خطأ التمثيل الثنائي (مثل 1.005) كما في rules.roundMoney
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// أرصدة العملاء
// ---------------------------------------------------------------------------
export async function customerBalance(
  customerId: number,
  before?: string | null
): Promise<number> {
  const { data: c } = await supabase
    .from("customers")
    .select("opening_balance")
    .eq("id", customerId)
    .single();
  const opening = c ? num(c.opening_balance) : 0;

  let invQuery = supabase
    .from("invoices")
    .select("id, vat_rate")
    .eq("customer_id", customerId);
  if (before) invQuery = invQuery.lt("date", before);
  const { data: invs } = await invQuery;
  const invIds = (invs ?? []).map((r) => r.id);

  // إجمالي الفاتورة على العميل = قيمة النقلات + المصروفات التي يتحمّلها العميل + الضريبة
  let inv = 0;
  if (invIds.length) {
    const { data: trips } = await supabase
      .from("invoice_trips")
      .select("id, invoice_id, price")
      .in("invoice_id", invIds);
    const subByInv = new Map<number, number>();
    const invOfTrip = new Map<number, number>();
    for (const t of trips ?? []) {
      invOfTrip.set(t.id, t.invoice_id);
      subByInv.set(t.invoice_id, (subByInv.get(t.invoice_id) ?? 0) + num(t.price));
    }
    const tripIds = [...invOfTrip.keys()];
    if (tripIds.length) {
      const { data: exps } = await supabase
        .from("trip_expenses")
        .select("trip_id, amount, source")
        .eq("source", "customer")
        .in("trip_id", tripIds);
      for (const e of exps ?? []) {
        const iid = invOfTrip.get(e.trip_id);
        if (iid != null) subByInv.set(iid, (subByInv.get(iid) ?? 0) + num(e.amount));
      }
    }
    const vatMap = new Map((invs ?? []).map((r) => [r.id, num(r.vat_rate)]));
    for (const [iid, sub] of subByInv) {
      const rate = vatMap.get(iid) ?? 0;
      inv += sub + round2((sub * rate) / 100);
    }
  }

  let recQuery = supabase
    .from("receipt_vouchers")
    .select("amount")
    .eq("voucher_type", "customer")
    .eq("customer_id", customerId);
  if (before) recQuery = recQuery.lt("date", before);
  const { data: recs } = await recQuery;
  const rec = sum((recs ?? []).map((r) => num(r.amount)));

  return round2(opening + inv - rec);
}

export async function customersWithBalance(): Promise<(Customer & { balance: number })[]> {
  const { data } = await supabase.from("customers").select("*").order("code");
  const rows = (data ?? []) as Customer[];
  const out = [];
  for (const r of rows) {
    out.push({ ...r, balance: await customerBalance(r.id) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// أرصدة الخزائن والبنوك
// ---------------------------------------------------------------------------
export function accountTable(kind: string): string {
  return kind === "cashbox" ? "cashboxes" : "banks";
}

export function accountKindLabel(kind: string): string {
  return kind === "cashbox" ? "خزينة" : "بنك";
}

export async function accountBalance(
  kind: string,
  accountId: number,
  before?: string | null
): Promise<number> {
  const tbl = accountTable(kind);
  const { data: a } = await supabase.from(tbl).select("opening_balance").eq("id", accountId).single();
  const opening = a ? num(a.opening_balance) : 0;

  let recQuery = supabase
    .from("receipt_vouchers")
    .select("amount")
    .eq("account_kind", kind)
    .eq("account_id", accountId);
  if (before) recQuery = recQuery.lt("date", before);
  const { data: recs } = await recQuery;
  const rec = sum((recs ?? []).map((r) => num(r.amount)));

  let payQuery = supabase
    .from("payment_vouchers")
    .select("amount")
    .eq("account_kind", kind)
    .eq("account_id", accountId);
  if (before) payQuery = payQuery.lt("date", before);
  const { data: pays } = await payQuery;
  const pay = sum((pays ?? []).map((r) => num(r.amount)));

  let salQuery = supabase
    .from("payrolls")
    .select("net_salary")
    .eq("account_kind", kind)
    .eq("account_id", accountId);
  if (before) salQuery = salQuery.lt("date", before);
  const { data: sals } = await salQuery;
  const sal = sum((sals ?? []).map((r) => num(r.net_salary)));

  return round2(opening + rec - pay - sal);
}

export async function accountName(kind: string, accountId: number): Promise<string> {
  const tbl = accountTable(kind);
  const { data } = await supabase.from(tbl).select("name").eq("id", accountId).single();
  return data ? data.name : "—";
}

export async function accountsWithBalance(
  kind: string
): Promise<((Cashbox | Bank) & { balance: number })[]> {
  const tbl = accountTable(kind);
  const { data } = await supabase.from(tbl).select("*").order("code");
  const rows = (data ?? []) as (Cashbox | Bank)[];
  const out = [];
  for (const r of rows) {
    out.push({ ...r, balance: await accountBalance(kind, r.id) });
  }
  return out;
}

export async function allAccounts(): Promise<
  { kind: string; id: number; label: string; code: string }[]
> {
  const out: { kind: string; id: number; label: string; code: string }[] = [];
  const { data: cbs } = await supabase.from("cashboxes").select("id, code, name").order("code");
  for (const r of cbs ?? []) out.push({ kind: "cashbox", id: r.id, label: `خزينة: ${r.name}`, code: r.code });
  const { data: bks } = await supabase.from("banks").select("id, code, name").order("code");
  for (const r of bks ?? []) out.push({ kind: "bank", id: r.id, label: `بنك: ${r.name}`, code: r.code });
  return out;
}

// ---------------------------------------------------------------------------
// حسابات الفواتير والرحلات
// ---------------------------------------------------------------------------
export async function invoiceTotals(invoiceId: number): Promise<{
  trips_total: number;
  billable_total: number;
  expenses_total: number;
  expected_profit: number;
  later_payments: number;
  actual_profit: number;
  customer_total: number;
  vat_rate: number;
  vat_amount: number;
}> {
  const { data: inv } = await supabase
    .from("invoices")
    .select("vat_rate")
    .eq("id", invoiceId)
    .single();
  const vatRate = inv ? num(inv.vat_rate) : 0;

  const { data: trips } = await supabase
    .from("invoice_trips")
    .select("id, price")
    .eq("invoice_id", invoiceId);
  const tripIds = (trips ?? []).map((t) => t.id);
  const tripsTotal = sum((trips ?? []).map((t) => num(t.price)));

  // المصروف المُعاد تحميله على العميل ليس تكلفة — يُضاف لقيمة الفاتورة
  let expensesTotal = 0;
  let billableTotal = 0;
  if (tripIds.length) {
    const { data: exps } = await supabase
      .from("trip_expenses")
      .select("amount, source")
      .in("trip_id", tripIds);
    for (const e of exps ?? []) {
      if ((e as { source?: string }).source === "customer") billableTotal += num(e.amount);
      else expensesTotal += num(e.amount);
    }
  }

  // السندات المتولّدة تلقائياً من مصروفات الفاتورة مستبعدة (وإلا احتُسبت مرتين)
  let later = 0;
  if (tripIds.length) {
    const { data: pays } = await supabase
      .from("payment_vouchers")
      .select("amount")
      .eq("voucher_type", "trip")
      .is("source_expense_id", null)
      .in("trip_id", tripIds);
    later = sum((pays ?? []).map((p) => num(p.amount)));
  }

  const revenue = tripsTotal + billableTotal;
  const expected = round2(revenue - expensesTotal);
  const vatAmount = round2((revenue * vatRate) / 100);
  return {
    trips_total: round2(tripsTotal),
    billable_total: round2(billableTotal),
    expenses_total: round2(expensesTotal),
    expected_profit: expected,
    later_payments: round2(later),
    actual_profit: round2(expected - later),
    vat_rate: round2(vatRate),
    vat_amount: vatAmount,
    customer_total: round2(revenue + vatAmount),
  };
}

export async function tripProfit(
  tripId: number,
  pFrom?: string | null,
  pTo?: string | null
): Promise<{ price: number; direct: number; later: number; net: number }> {
  const { data: t } = await supabase.from("invoice_trips").select("price").eq("id", tripId).single();
  const basePrice = t ? num(t.price) : 0;
  const { data: exps } = await supabase.from("trip_expenses").select("amount, source").eq("trip_id", tripId);
  let direct = 0;
  let billable = 0;
  for (const e of exps ?? []) {
    if ((e as { source?: string }).source === "customer") billable += num(e.amount);
    else direct += num(e.amount);
  }
  const price = basePrice + billable;

  let payQuery = supabase
    .from("payment_vouchers")
    .select("amount")
    .eq("voucher_type", "trip")
    .is("source_expense_id", null)
    .eq("trip_id", tripId);
  if (pFrom) payQuery = payQuery.gte("date", pFrom);
  if (pTo) payQuery = payQuery.lte("date", pTo);
  const { data: pays } = await payQuery;
  const later = sum((pays ?? []).map((p) => num(p.amount)));

  return { price, direct, later, net: round2(price - direct - later) };
}

export interface InvoiceListItem extends Invoice {
  customer_name: string;
  customer_code: string;
  trips_total: number;
  /** مصروفات يتحمّلها العميل (تُضاف لقيمة الفاتورة) */
  billable_total: number;
  expenses_total: number;
  expected_profit: number;
  later_payments: number;
  actual_profit: number;
  customer_total: number;
  vat_rate: number;
  vat_amount: number;
  trips_count: number;
}

export async function invoiceList(
  dFrom?: string | null,
  dTo?: string | null,
  customerId?: number | null
): Promise<InvoiceListItem[]> {
  let q = supabase.from("invoices").select("*").order("date", { ascending: false }).order("number", { ascending: false });
  if (dFrom) q = q.gte("date", dFrom);
  if (dTo) q = q.lte("date", dTo);
  if (customerId) q = q.eq("customer_id", customerId);
  const { data } = await q;
  const invs = (data ?? []) as Invoice[];

  const { data: custs } = await supabase.from("customers").select("id, code, name");
  const custMap = new Map((custs ?? []).map((c) => [c.id, c]));

  const out: InvoiceListItem[] = [];
  for (const inv of invs) {
    const totals = await invoiceTotals(inv.id);
    const { data: trips } = await supabase.from("invoice_trips").select("id").eq("invoice_id", inv.id);
    const cust = custMap.get(inv.customer_id);
    out.push({
      ...inv,
      customer_name: cust?.name ?? "—",
      customer_code: cust?.code ?? "—",
      trips_count: (trips ?? []).length,
      ...totals,
    });
  }
  return out;
}

export function invoiceNumberLabel(n: number): string {
  return `INV-${String(n).padStart(5, "0")}`;
}

export function voucherNumberLabel(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(5, "0")}`;
}

export interface InvoiceFull extends InvoiceListItem {
  customer: Customer | null;
  trips: InvoiceTrip[];
}

export async function getInvoiceFull(invoiceId: number): Promise<InvoiceFull | null> {
  const { data } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (!data) return null;
  const inv = data as Invoice;

  const { data: cust } = await supabase.from("customers").select("*").eq("id", inv.customer_id).single();
  const { data: trips } = await supabase
    .from("invoice_trips")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("id");

  const tripList: InvoiceTrip[] = [];
  for (const t of trips ?? []) {
    const { data: exps } = await supabase
      .from("trip_expenses")
      .select("*")
      .eq("trip_id", t.id)
      .order("id");
    tripList.push({
      ...t,
      expenses: (exps ?? []) as TripExpense[],
    });
  }

  const totals = await invoiceTotals(invoiceId);
  return {
    ...inv,
    customer: (cust as Customer) ?? null,
    trips: tripList,
    customer_name: cust?.name ?? "—",
    customer_code: cust?.code ?? "—",
    trips_count: tripList.length,
    ...totals,
  };
}

export async function tripsOptions(): Promise<{ id: number; label: string }[]> {
  const { data: trips } = await supabase
    .from("invoice_trips")
    .select("*")
    .order("id");
  const { data: invs } = await supabase.from("invoices").select("id, number, date, customer_id").order("date", { ascending: false }).order("number", { ascending: false });
  const { data: custs } = await supabase.from("customers").select("id, name");
  const { data: vehs } = await supabase.from("vehicles").select("id, plate_number");
  const { data: emps } = await supabase.from("employees").select("id, name");

  const invMap = new Map((invs ?? []).map((i) => [i.id, i]));
  const custMap = new Map((custs ?? []).map((c) => [c.id, c.name]));
  const vehMap = new Map((vehs ?? []).map((v) => [v.id, v.plate_number]));
  const empMap = new Map((emps ?? []).map((e) => [e.id, e.name]));

  const out: { id: number; label: string }[] = [];
  for (const t of trips ?? []) {
    const inv = invMap.get(t.invoice_id);
    const label =
      `${invoiceNumberLabel(inv?.number ?? 0)} | ${inv?.date ?? "—"} | ` +
      `${custMap.get(inv?.customer_id ?? 0) ?? "—"} | ${t.from_loc || "—"} ← ${t.to_loc || "—"}` +
      ` | ${vehMap.get(t.vehicle_id ?? 0) ?? "—"} | ${empMap.get(t.driver_id ?? 0) ?? "—"}`;
    out.push({ id: t.id, label });
  }
  return out;
}

// ---------------------------------------------------------------------------
// كشوف الحساب
// ---------------------------------------------------------------------------
export async function customerStatement(
  customerId: number,
  dFrom: string,
  dTo: string
): Promise<{ opening: number; rows: StmtRow[]; closing: number }> {
  const opening = await customerBalance(customerId, dFrom);

  const { data: invs } = await supabase
    .from("invoices")
    .select("id, number, date")
    .eq("customer_id", customerId)
    .gte("date", dFrom)
    .lte("date", dTo)
    .order("date")
    .order("id");

  const rows: StmtRow[] = [];
  for (const inv of invs ?? []) {
    const totals = await invoiceTotals(inv.id);
    rows.push({
      date: inv.date,
      doc: `فاتورة نقل ${invoiceNumberLabel(inv.number)}`,
      desc: "نقلات مسجلة على العميل",
      debit: totals.customer_total,
      credit: 0,
      kind: "invoice",
    });
  }

  const { data: recs } = await supabase
    .from("receipt_vouchers")
    .select("id, number, date, amount, description")
    .eq("voucher_type", "customer")
    .eq("customer_id", customerId)
    .gte("date", dFrom)
    .lte("date", dTo)
    .order("date")
    .order("id");

  for (const r of recs ?? []) {
    rows.push({
      date: r.date,
      doc: `سند قبض ${voucherNumberLabel("RV", r.number)}`,
      desc: r.description || "تحصيل من العميل",
      debit: 0,
      credit: num(r.amount),
      kind: "receipt",
    });
  }

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const order: Record<string, number> = { invoice: 0, receipt: 1 };
    return (order[a.kind] ?? 0) - (order[b.kind] ?? 0);
  });
  let balance = opening;
  for (const r of rows) {
    balance = round2(balance + r.debit - r.credit);
    r.balance = balance;
  }
  return { opening: round2(opening), rows, closing: round2(balance) };
}

export interface StmtRow {
  date: string;
  doc: string;
  desc: string;
  debit: number;
  credit: number;
  kind: string;
  balance?: number;
}

export async function accountStatement(
  kind: string,
  accountId: number,
  dFrom: string,
  dTo: string
): Promise<{ opening: number; rows: AccountStmtRow[]; closing: number }> {
  const opening = await accountBalance(kind, accountId, dFrom);
  const rows: AccountStmtRow[] = [];

  const { data: recs } = await supabase
    .from("receipt_vouchers")
    .select("id, number, date, amount, description, voucher_type, customer_id")
    .eq("account_kind", kind)
    .eq("account_id", accountId)
    .gte("date", dFrom)
    .lte("date", dTo)
    .order("date")
    .order("id");

  const { data: custs } = await supabase.from("customers").select("id, name");
  const custMap = new Map((custs ?? []).map((c) => [c.id, c.name]));

  for (const r of recs ?? []) {
    const desc =
      r.voucher_type === "customer"
        ? `تحصيل من العميل: ${custMap.get(r.customer_id ?? 0) ?? "—"}`
        : `إيرادات أخرى: ${r.description || "—"}`;
    rows.push({
      date: r.date,
      doc: `سند قبض ${voucherNumberLabel("RV", r.number)}`,
      desc,
      in: num(r.amount),
      out: 0,
      balance: 0,
      kind: "receipt",
    });
  }

  const { data: pays } = await supabase
    .from("payment_vouchers")
    .select("*")
    .eq("account_kind", kind)
    .eq("account_id", accountId)
    .gte("date", dFrom)
    .lte("date", dTo)
    .order("date")
    .order("id");

  for (const r of pays ?? []) {
    rows.push({
      date: r.date,
      doc: `سند دفع ${voucherNumberLabel("PV", r.number)}`,
      desc:
        (PAYMENT_TYPES[r.voucher_type] ?? r.voucher_type) +
        (r.description ? ` — ${r.description}` : ""),
      in: 0,
      out: num(r.amount),
      balance: 0,
      kind: "payment",
    });
  }

  const { data: sals } = await supabase
    .from("payrolls")
    .select("*, employees(name)")
    .eq("account_kind", kind)
    .eq("account_id", accountId)
    .gte("date", dFrom)
    .lte("date", dTo)
    .order("date")
    .order("id");

  for (const r of sals ?? []) {
    const empName = Array.isArray(r.employees) ? (r.employees as any[])[0]?.name : (r.employees as any)?.name;
    rows.push({
      date: r.date,
      doc: `راتب ${voucherNumberLabel("PAY", r.number)}`,
      desc: `راتب ${empName ?? "—"} عن ${periodLabel(r.period_year, r.period_month)}`,
      in: 0,
      out: num(r.net_salary),
      balance: 0,
      kind: "payroll",
    });
  }

  rows.sort((a, b) => {
    const order = { receipt: 0, payment: 1, payroll: 2 } as Record<string, number>;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return order[a.kind] - order[b.kind];
  });

  let balance = opening;
  for (const r of rows) {
    balance = round2(balance + r.in - r.out);
    r.balance = balance;
  }
  return { opening: round2(opening), rows, closing: round2(balance) };
}

export interface AccountStmtRow {
  date: string;
  doc: string;
  desc: string;
  in: number;
  out: number;
  balance: number;
  kind: string;
}

// ---------------------------------------------------------------------------
// تقرير 1: أرباح الفواتير والرحلات
// ---------------------------------------------------------------------------
export async function tripProfitsReport(
  dFrom?: string | null,
  dTo?: string | null,
  customerId?: number | null
): Promise<Record<string, unknown>[]> {
  let q = supabase.from("invoices").select("id, number, date, customer_id");
  if (dFrom) q = q.gte("date", dFrom);
  if (dTo) q = q.lte("date", dTo);
  if (customerId) q = q.eq("customer_id", customerId);
  q = q.order("date").order("number");
  const { data: invs } = await q;
  const invIds = (invs ?? []).map((i) => i.id);

  if (!invIds.length) return [];

  const { data: trips } = await supabase
    .from("invoice_trips")
    .select("*")
    .in("invoice_id", invIds)
    .order("id");
  const { data: custs } = await supabase.from("customers").select("id, name");
  const { data: vehs } = await supabase.from("vehicles").select("id, plate_number");
  const { data: emps } = await supabase.from("employees").select("id, name");

  const invMap = new Map((invs ?? []).map((i) => [i.id, i]));
  const custMap = new Map((custs ?? []).map((c) => [c.id, c.name]));
  const vehMap = new Map((vehs ?? []).map((v) => [v.id, v.plate_number]));
  const empMap = new Map((emps ?? []).map((e) => [e.id, e.name]));

  const out: Record<string, unknown>[] = [];
  for (const t of trips ?? []) {
    const inv = invMap.get(t.invoice_id);
    const p = await tripProfit(t.id, dFrom, dTo);
    out.push({
      trip_id: t.id,
      invoice: invoiceNumberLabel(inv?.number ?? 0),
      date: inv?.date ?? "—",
      customer: custMap.get(inv?.customer_id ?? 0) ?? "—",
      route: `${t.from_loc || "—"} ← ${t.to_loc || "—"}`,
      vehicle: vehMap.get(t.vehicle_id ?? 0) ?? "—",
      driver: empMap.get(t.driver_id ?? 0) ?? "—",
      revenue: p.price,
      direct: p.direct,
      later: p.later,
      net: p.net,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// تقرير 3: كشف حساب موظف/سائق
// ---------------------------------------------------------------------------
export async function employeeStatement(
  employeeId: number,
  dFrom?: string | null,
  dTo?: string | null
): Promise<{
  salaries: Payroll[];
  advances: (PaymentVoucher & { settled: number; remaining: number; settlements: any[] })[];
  allowances: Record<string, unknown>[];
  totals: Record<string, number>;
}> {
  let salQ = supabase.from("payrolls").select("*").eq("employee_id", employeeId).order("date").order("id");
  if (dFrom) salQ = salQ.gte("date", dFrom);
  if (dTo) salQ = salQ.lte("date", dTo);
  const { data: salaries } = await salQ;

  let advQ = supabase
    .from("payment_vouchers")
    .select("*")
    .eq("voucher_type", "advance")
    .eq("employee_id", employeeId)
    .order("date")
    .order("id");
  if (dFrom) advQ = advQ.gte("date", dFrom);
  if (dTo) advQ = advQ.lte("date", dTo);
  const { data: advs } = await advQ;

  const advances = [];
  for (const r of advs ?? []) {
    const { data: settles } = await supabase
      .from("advance_settlements")
      .select("amount")
      .eq("payment_voucher_id", r.id);
    const settled = sum((settles ?? []).map((s) => num(s.amount)));
    const { data: srows } = await supabase
      .from("advance_settlements")
      .select("amount, payroll_id, payrolls(date, number)")
      .eq("payment_voucher_id", r.id)
      .order("payroll_id");
    const settlements = (srows ?? []).map((s) => ({
      amount: num(s.amount),
      payroll_id: s.payroll_id,
      pdate: Array.isArray(s.payrolls) ? (s.payrolls as any[])[0]?.date : (s.payrolls as any)?.date,
      pnum: Array.isArray(s.payrolls) ? (s.payrolls as any[])[0]?.number : (s.payrolls as any)?.number,
    }));
    advances.push({
      ...r,
      settled,
      remaining: round2(num(r.amount) - settled),
      settlements,
    });
  }

  let tripQ = supabase
    .from("invoice_trips")
    .select("id, from_loc, to_loc, price, invoice_id")
    .eq("driver_id", employeeId)
    .order("id");
  if (dFrom || dTo) {
    // الفلترة على تاريخ الفاتورة تتم بعد جلب النقلات
  }
  const { data: trips } = await tripQ;
  const { data: allInvs } = await supabase.from("invoices").select("id, number, date");

  const invMap = new Map((allInvs ?? []).map((i) => [i.id, i]));
  const allowances: Record<string, unknown>[] = [];
  for (const t of trips ?? []) {
    const inv = invMap.get(t.invoice_id);
    const invDate = inv?.date ?? "";
    if (dFrom && invDate < dFrom) continue;
    if (dTo && invDate > dTo) continue;
    const { data: exps } = await supabase
      .from("trip_expenses")
      .select("amount")
      .eq("trip_id", t.id)
      .eq("expense_type", "trip");
    const tripAllowance = sum((exps ?? []).map((e) => num(e.amount)));
    allowances.push({
      id: t.id,
      from_loc: t.from_loc,
      to_loc: t.to_loc,
      price: num(t.price),
      inv_number: inv?.number ?? 0,
      inv_date: invDate,
      trip_allowance: tripAllowance,
      route: `${t.from_loc || "—"} ← ${t.to_loc || "—"}`,
    });
  }

  const salList = (salaries ?? []) as Payroll[];
  const totals = {
    salaries_net: sum(salList.map((s) => num(s.net_salary))),
    salaries_additions: sum(salList.map((s) => num(s.additions))),
    salaries_deductions: sum(salList.map((s) => num(s.advance_deduction) + num(s.other_deductions))),
    advances_total: sum(advances.map((a) => num(a.amount))),
    advances_remaining: sum(advances.map((a) => num(a.remaining))),
    allowances_total: sum(allowances.map((a) => num(a.trip_allowance))),
  };
  return { salaries: salList, advances, allowances, totals };
}

// ---------------------------------------------------------------------------
// تقرير 4: أداء السيارات
// ---------------------------------------------------------------------------
export async function vehicleReport(
  dFrom?: string | null,
  dTo?: string | null,
  vehicleId?: number | null
): Promise<Record<string, unknown>[]> {
  let vehQ = supabase.from("vehicles").select("*").order("code");
  const { data: vehicles } = await vehQ;

  const out: Record<string, unknown>[] = [];
  for (const v of vehicles ?? []) {
    if (vehicleId && v.id !== vehicleId) continue;

    let tripQ = supabase
      .from("invoice_trips")
      .select("id, price, invoice_id")
      .eq("vehicle_id", v.id);
    const { data: trips } = await tripQ;
    const tripIds = (trips ?? []).map((t) => t.id);

    // فلترة بتاريخ الفاتورة
    const { data: invs } = await supabase
      .from("invoices")
      .select("id, date")
      .in("id", (trips ?? []).map((t) => t.invoice_id));
    const invDateMap = new Map((invs ?? []).map((i) => [i.id, i.date]));
    const filteredTrips = (trips ?? []).filter((t) => {
      const d = invDateMap.get(t.invoice_id) ?? "";
      if (dFrom && d < dFrom) return false;
      if (dTo && d > dTo) return false;
      return true;
    });
    const filteredIds = filteredTrips.map((t) => t.id);

    const revenue = sum(filteredTrips.map((t) => num(t.price)));
    const tripsCount = filteredTrips.length;

    let direct = 0;
    if (filteredIds.length) {
      const { data: exps } = await supabase
        .from("trip_expenses")
        .select("amount")
        .in("trip_id", filteredIds);
      direct = sum((exps ?? []).map((e) => num(e.amount)));
    }

    let payQ = supabase
      .from("payment_vouchers")
      .select("amount")
      .eq("voucher_type", "vehicle")
      .eq("vehicle_id", v.id);
    if (dFrom) payQ = payQ.gte("date", dFrom);
    if (dTo) payQ = payQ.lte("date", dTo);
    const { data: pays } = await payQ;
    const maintenance = sum((pays ?? []).map((p) => num(p.amount)));

    out.push({
      vehicle_id: v.id,
      code: v.code,
      plate: v.plate_number,
      vtype: v.vehicle_type,
      trips: tripsCount,
      revenue: round2(revenue),
      direct: round2(direct),
      maintenance: round2(maintenance),
      net: round2(revenue - direct - maintenance),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// تقرير 5: الأرباح والخسائر الشامل
// ---------------------------------------------------------------------------
export async function pnlReport(
  dFrom?: string | null,
  dTo?: string | null
): Promise<Record<string, number>> {
  const between = <T,>(q: T, col: string): T => {
    let r = q as any;
    if (dFrom) r = r.gte(col, dFrom);
    if (dTo) r = r.lte(col, dTo);
    return r as T;
  };

  // إيرادات النقلات (قبل الضريبة) + ضريبة القيمة المضافة المحصلة في الفترة
  let invQ = supabase.from("invoices").select("id, vat_rate, date");
  invQ = between(invQ, "date");
  const { data: invs } = await invQ;
  const invIds = (invs ?? []).map((i) => i.id);
  let transport = 0;
  let vatCollected = 0;
  let direct = 0;
  if (invIds.length) {
    const { data: trips } = await supabase
      .from("invoice_trips")
      .select("id, invoice_id, price")
      .in("invoice_id", invIds);
    const subByInv = new Map<number, number>();
    const invOfTrip = new Map<number, number>();
    for (const t of trips ?? []) {
      invOfTrip.set(t.id, t.invoice_id);
      subByInv.set(t.invoice_id, (subByInv.get(t.invoice_id) ?? 0) + num(t.price));
    }
    // المصروف الذي يتحمّله العميل إيراد إضافي (يدخل وعاء الضريبة)، وما عداه تكلفة مباشرة
    const tripIds = [...invOfTrip.keys()];
    if (tripIds.length) {
      const { data: exps } = await supabase
        .from("trip_expenses")
        .select("trip_id, amount, source")
        .in("trip_id", tripIds);
      for (const e of exps ?? []) {
        if ((e as { source?: string }).source === "customer") {
          const iid = invOfTrip.get(e.trip_id);
          if (iid != null) subByInv.set(iid, (subByInv.get(iid) ?? 0) + num(e.amount));
        } else {
          direct += num(e.amount);
        }
      }
    }
    const vatMap = new Map((invs ?? []).map((i) => [i.id, num(i.vat_rate)]));
    for (const [iid, sub] of subByInv) {
      const rate = vatMap.get(iid) ?? 0;
      transport += sub;
      vatCollected += round2((sub * rate) / 100);
    }
  }

  // الإيرادات الأخرى
  const { data: otherRows } = await between(
    supabase.from("receipt_vouchers").select("amount").eq("voucher_type", "other"),
    "date"
  );
  const otherRev = sum((otherRows ?? []).map((r) => num(r.amount)));

  const { data: salRows } = await between(supabase.from("payrolls").select("net_salary"), "date");
  const salaries = sum((salRows ?? []).map((r) => num(r.net_salary)));

  const { data: advRows } = await between(
    supabase.from("payment_vouchers").select("amount").eq("voucher_type", "advance"),
    "date"
  );
  const advances = sum((advRows ?? []).map((r) => num(r.amount)));

  const { data: maintRows } = await between(
    supabase.from("payment_vouchers").select("amount").eq("voucher_type", "vehicle"),
    "date"
  );
  const maintenance = sum((maintRows ?? []).map((r) => num(r.amount)));

  const { data: genRows } = await between(
    supabase.from("payment_vouchers").select("amount").eq("voucher_type", "general"),
    "date"
  );
  const general = sum((genRows ?? []).map((r) => num(r.amount)));

  // سندات الرحلات اليدوية (المتولّدة تلقائياً محتسبة ضمن direct أعلاه)
  const { data: tripPayRows } = await between(
    supabase.from("payment_vouchers").select("amount").eq("voucher_type", "trip").is("source_expense_id", null),
    "date"
  );
  const tripPayments = sum((tripPayRows ?? []).map((r) => num(r.amount)));

  const totalRev = round2(transport + otherRev);
  const totalExp = round2(direct + tripPayments + salaries + advances + maintenance + general);
  return {
    transport_revenue: round2(transport),
    other_revenue: round2(otherRev),
    total_revenue: totalRev,
    direct_expenses: round2(direct),
    trip_payments: round2(tripPayments),
    salaries: round2(salaries),
    advances: round2(advances),
    maintenance: round2(maintenance),
    general_expenses: round2(general),
    total_expenses: totalExp,
    net: round2(totalRev - totalExp),
    vat_collected: round2(vatCollected),
  };
}

// ---------------------------------------------------------------------------
// لقطة إغلاق السنة المالية
// ---------------------------------------------------------------------------
export async function yearSnapshotData(yearId: number): Promise<Record<string, unknown>> {
  const { data: y } = await supabase.from("financial_years").select("*").eq("id", yearId).single();
  if (!y) return {};
  const pnl = await pnlReport(y.date_from, y.date_to);

  const { data: custs } = await supabase.from("customers").select("*").order("code");
  const customers = [];
  for (const c of custs ?? []) {
    customers.push({ code: c.code, name: c.name, balance: round2(await customerBalance(c.id)) });
  }

  const { data: cbs } = await supabase.from("cashboxes").select("*").order("code");
  const cashboxes = [];
  for (const c of cbs ?? []) {
    cashboxes.push({ code: c.code, name: c.name, balance: round2(await accountBalance("cashbox", c.id)) });
  }

  const { data: bks } = await supabase.from("banks").select("*").order("code");
  const banks = [];
  for (const b of bks ?? []) {
    banks.push({ code: b.code, name: b.name, balance: round2(await accountBalance("bank", b.id)) });
  }

  return {
    created_at: new Date().toISOString().slice(0, 16).replace("T", " "),
    year: y.year,
    date_from: y.date_from,
    date_to: y.date_to,
    customers,
    cashboxes,
    banks,
    pnl: Object.fromEntries(Object.entries(pnl).map(([k, v]) => [k, round2(v)])),
  };
}
