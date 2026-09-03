// محرك الحسابات: الأرصدة اللحظية، كشوف الحساب، التقارير، ولقطات الإغلاق.
// مكافئ حرفي لـ app/core/calc.py — الأرصدة تُحسب دائماً من الحركات.

import { supabase } from "./supabase";
import { PAYMENT_TYPES, EXPENSE_TYPES, PURCHASE_EXPENSE_CATEGORIES, money, periodLabel } from "./format";
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

/** صافي مشتريات الفاتورة قبل ضريبة المدخلات، حتى لا تُعامل الضريبة كمصروف P&L. */
function purchaseNetFromRow(row: Record<string, unknown>): number {
  const included = Boolean(row.vat_included);
  let net = 0;
  for (const raw of (row.purchase_items ?? []) as Record<string, unknown>[]) {
    const gross = num(raw.qty) * num(raw.unit_price);
    const rate = num(raw.vat_rate) / 100;
    net += included && rate > -1 ? gross / (1 + rate) : gross;
  }
  return round2(net);
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
  let notesQuery = supabase.from("credit_debit_notes").select("note_type, amount, vat_rate").eq("customer_id", customerId);
  if (before) notesQuery = notesQuery.lt("date", before);
  const { data: notes } = await notesQuery;
  const noteEffect = sum((notes ?? []).map((n) => {
    const total = num(n.amount) + round2(num(n.amount) * num(n.vat_rate) / 100);
    return n.note_type === "debit" ? total : -total;
  }));

  return round2(opening + inv - rec + noteEffect);
}

/**
 * أرصدة كل العملاء دفعة واحدة.
 * تُنفَّذ بأربعة استعلامات مجمّعة بدل استعلام لكل عميل (كان N+1 يُبطئ الصفحة كثيراً).
 */
export async function customersWithBalance(): Promise<(Customer & { balance: number })[]> {
  const [custRes, invRes, recRes, noteRes] = await Promise.all([
    supabase.from("customers").select("*").order("code"),
    supabase.from("invoices").select("id, customer_id, vat_rate"),
    supabase.from("receipt_vouchers").select("customer_id, amount").eq("voucher_type", "customer"),
    supabase.from("credit_debit_notes").select("customer_id, note_type, amount, vat_rate"),
  ]);

  const rows = (custRes.data ?? []) as Customer[];
  const invs = (invRes.data ?? []) as { id: number; customer_id: number; vat_rate: number }[];
  const invIds = invs.map((i) => i.id);

  let trips: { id: number; invoice_id: number; price: number }[] = [];
  if (invIds.length) {
    const { data } = await supabase.from("invoice_trips").select("id, invoice_id, price").in("invoice_id", invIds);
    trips = (data ?? []) as typeof trips;
  }

  // إجمالي كل فاتورة قبل الضريبة = النقلات + المصروفات التي يتحمّلها العميل
  const subByInv = new Map<number, number>();
  const invOfTrip = new Map<number, number>();
  for (const t of trips) {
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
      const iid = invOfTrip.get((e as { trip_id: number }).trip_id);
      if (iid != null) subByInv.set(iid, (subByInv.get(iid) ?? 0) + num((e as { amount: number }).amount));
    }
  }

  const invTotalByCustomer = new Map<number, number>();
  for (const inv of invs) {
    const sub = subByInv.get(inv.id) ?? 0;
    const withVat = sub + round2((sub * num(inv.vat_rate)) / 100);
    invTotalByCustomer.set(inv.customer_id, (invTotalByCustomer.get(inv.customer_id) ?? 0) + withVat);
  }

  const paidByCustomer = new Map<number, number>();
  for (const r of recRes.data ?? []) {
    const cid = (r as { customer_id: number }).customer_id;
    paidByCustomer.set(cid, (paidByCustomer.get(cid) ?? 0) + num((r as { amount: number }).amount));
  }

  const noteEffectByCustomer = new Map<number, number>();
  for (const n of noteRes.data ?? []) {
    const cid = (n as { customer_id: number }).customer_id;
    const amount = num((n as { amount: number }).amount);
    const vatRate = num((n as { vat_rate: number }).vat_rate);
    const total = amount + round2((amount * vatRate) / 100);
    const sign = (n as { note_type: string }).note_type === "debit" ? 1 : -1;
    noteEffectByCustomer.set(cid, (noteEffectByCustomer.get(cid) ?? 0) + sign * total);
  }

  return rows.map((r) => ({
    ...r,
    balance: round2(num(r.opening_balance) + (invTotalByCustomer.get(r.id) ?? 0) - (paidByCustomer.get(r.id) ?? 0) + (noteEffectByCustomer.get(r.id) ?? 0)),
  }));
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

/** أرصدة كل الخزائن (أو البنوك) بأربعة استعلامات مجمّعة بدل استعلام لكل حساب. */
export async function accountsWithBalance(
  kind: string
): Promise<((Cashbox | Bank) & { balance: number })[]> {
  const tbl = accountTable(kind);
  const [accRes, recRes, payRes, salRes] = await Promise.all([
    supabase.from(tbl).select("*").order("code"),
    supabase.from("receipt_vouchers").select("account_id, amount").eq("account_kind", kind),
    supabase.from("payment_vouchers").select("account_id, amount").eq("account_kind", kind),
    supabase.from("payrolls").select("account_id, net_salary").eq("account_kind", kind),
  ]);

  const rows = (accRes.data ?? []) as (Cashbox | Bank)[];
  const acc = (list: unknown[], field: string) => {
    const m = new Map<number, number>();
    for (const r of list ?? []) {
      const row = r as Record<string, unknown>;
      const id = Number(row.account_id);
      m.set(id, (m.get(id) ?? 0) + num(row[field]));
    }
    return m;
  };
  const recMap = acc(recRes.data ?? [], "amount");
  const payMap = acc(payRes.data ?? [], "amount");
  const salMap = acc(salRes.data ?? [], "net_salary");

  return rows.map((r) => ({
    ...r,
    balance: round2(num(r.opening_balance) + (recMap.get(r.id) ?? 0) - (payMap.get(r.id) ?? 0) - (salMap.get(r.id) ?? 0)),
  }));
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
/** تجميع إجماليات فاتورة من أرقام مُحمّلة مسبقاً (يُستخدم في الحسابات المجمّعة). */
function totalsFrom(vatRate: number, tripsTotal: number, billableTotal: number, expensesTotal: number, later: number) {
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

  return totalsFrom(vatRate, tripsTotal, billableTotal, expensesTotal, later);
}

/** إجماليات مجموعة فواتير دفعة واحدة (يمنع N+1 في الكشوف والتقارير). */
export async function invoiceTotalsBatch(invoiceIds: number[]): Promise<Map<number, ReturnType<typeof totalsFrom>>> {
  const out = new Map<number, ReturnType<typeof totalsFrom>>();
  if (!invoiceIds.length) return out;

  const { data: invRows } = await supabase.from("invoices").select("id, vat_rate").in("id", invoiceIds);
  const vatMap = new Map((invRows ?? []).map((i) => [i.id, num(i.vat_rate)]));
  const { data: tripRows } = await supabase.from("invoice_trips").select("id, invoice_id, price").in("invoice_id", invoiceIds);
  const trips = (tripRows ?? []) as { id: number; invoice_id: number; price: number }[];
  const tripIds = trips.map((t) => t.id);
  const invOfTrip = new Map(trips.map((t) => [t.id, t.invoice_id]));
  const agg = new Map<number, { trips: number; billable: number; expenses: number; later: number }>();
  const bucket = (id: number) => {
    let b = agg.get(id);
    if (!b) { b = { trips: 0, billable: 0, expenses: 0, later: 0 }; agg.set(id, b); }
    return b;
  };
  for (const t of trips) bucket(t.invoice_id).trips += num(t.price);

  if (tripIds.length) {
    const [expRes, payRes] = await Promise.all([
      supabase.from("trip_expenses").select("trip_id, amount, source").in("trip_id", tripIds),
      supabase.from("payment_vouchers").select("trip_id, amount").eq("voucher_type", "trip").is("source_expense_id", null).in("trip_id", tripIds),
    ]);
    for (const e of (expRes.data ?? []) as { trip_id: number; amount: number; source?: string }[]) {
      const iid = invOfTrip.get(e.trip_id);
      if (iid == null) continue;
      const b = bucket(iid);
      if (e.source === "customer") b.billable += num(e.amount);
      else b.expenses += num(e.amount);
    }
    for (const p of (payRes.data ?? []) as { trip_id: number; amount: number }[]) {
      const iid = invOfTrip.get(p.trip_id);
      if (iid != null) bucket(iid).later += num(p.amount);
    }
  }

  for (const iid of invoiceIds) {
    const b = agg.get(iid) ?? { trips: 0, billable: 0, expenses: 0, later: 0 };
    out.set(iid, totalsFrom(vatMap.get(iid) ?? 0, b.trips, b.billable, b.expenses, b.later));
  }
  return out;
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
  trip_summaries: { id: number; route: string; container_numbers: string[] }[];
}

/**
 * قائمة الفواتير مع إجمالياتها.
 * تُجلب كل البيانات بخمسة استعلامات مجمّعة ثم تُحسب الإجماليات محلياً،
 * بدل تنفيذ 4 استعلامات لكل فاتورة (كان يُبطئ الشاشة بشدة عند كثرة الفواتير).
 */
export async function invoiceList(
  dFrom?: string | null,
  dTo?: string | null,
  customerId?: number | null
): Promise<InvoiceListItem[]> {
  let q = supabase.from("invoices").select("*").order("date", { ascending: false }).order("number", { ascending: false });
  if (dFrom) q = q.gte("date", dFrom);
  if (dTo) q = q.lte("date", dTo);
  if (customerId) q = q.eq("customer_id", customerId);

  const [invRes, custRes] = await Promise.all([q, supabase.from("customers").select("id, code, name")]);
  const invs = (invRes.data ?? []) as Invoice[];
  const custMap = new Map(((custRes.data ?? []) as { id: number; code: string; name: string }[]).map((c) => [c.id, c]));
  if (!invs.length) return [];

  const invIds = invs.map((i) => i.id);
  const { data: tripRows } = await supabase.from("invoice_trips")
    .select("id, invoice_id, from_loc, to_loc, price, container_numbers")
    .in("invoice_id", invIds)
    .order("id");
  const trips = (tripRows ?? []) as {
    id: number; invoice_id: number; from_loc?: string; to_loc?: string;
    price: number; container_numbers?: string[];
  }[];
  const tripIds = trips.map((t) => t.id);
  const invOfTrip = new Map(trips.map((t) => [t.id, t.invoice_id]));
  const containersByInvoice = new Map<number, string[]>();
  const tripSummariesByInvoice = new Map<number, { id: number; route: string; container_numbers: string[] }[]>();
  for (const trip of trips) {
    const containers = Array.isArray(trip.container_numbers) ? trip.container_numbers.filter(Boolean) : [];
    const summaries = tripSummariesByInvoice.get(trip.invoice_id) ?? [];
    summaries.push({
      id: trip.id,
      route: `${trip.from_loc || "—"} ← ${trip.to_loc || "—"}`,
      container_numbers: containers,
    });
    tripSummariesByInvoice.set(trip.invoice_id, summaries);
    if (containers.length) {
      const current = containersByInvoice.get(trip.invoice_id) ?? [];
      current.push(...containers);
      containersByInvoice.set(trip.invoice_id, current);
    }
  }

  let exps: { trip_id: number; amount: number; source?: string }[] = [];
  let pays: { trip_id: number; amount: number }[] = [];
  if (tripIds.length) {
    const [expRes, payRes] = await Promise.all([
      supabase.from("trip_expenses").select("trip_id, amount, source").in("trip_id", tripIds),
      supabase.from("payment_vouchers").select("trip_id, amount").eq("voucher_type", "trip").is("source_expense_id", null).in("trip_id", tripIds),
    ]);
    exps = (expRes.data ?? []) as typeof exps;
    pays = (payRes.data ?? []) as typeof pays;
  }

  const agg = new Map<number, { trips: number; billable: number; cost: number; later: number; count: number }>();
  const bucket = (id: number) => {
    let b = agg.get(id);
    if (!b) { b = { trips: 0, billable: 0, cost: 0, later: 0, count: 0 }; agg.set(id, b); }
    return b;
  };
  for (const t of trips) { const b = bucket(t.invoice_id); b.trips += num(t.price); b.count += 1; }
  for (const e of exps) {
    const iid = invOfTrip.get(e.trip_id);
    if (iid == null) continue;
    const b = bucket(iid);
    if (e.source === "customer") b.billable += num(e.amount); else b.cost += num(e.amount);
  }
  for (const pmt of pays) {
    const iid = invOfTrip.get(pmt.trip_id);
    if (iid != null) bucket(iid).later += num(pmt.amount);
  }

  return invs.map((inv) => {
    const b = agg.get(inv.id) ?? { trips: 0, billable: 0, cost: 0, later: 0, count: 0 };
    const cust = custMap.get(inv.customer_id);
    const tripContainers = containersByInvoice.get(inv.id) ?? [];
    return {
      ...inv,
      container_number: tripContainers.length ? tripContainers.join("، ") : inv.container_number,
      customer_name: cust?.name ?? "—",
      customer_code: cust?.code ?? "—",
      trips_count: b.count,
      trip_summaries: tripSummariesByInvoice.get(inv.id) ?? [],
      ...totalsFrom(num(inv.vat_rate), b.trips, b.billable, b.cost, b.later),
    };
  });
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

  // العميل والنقلات مستقلان بعد معرفة رأس الفاتورة، لذلك يُجلبان معاً.
  const [custRes, tripsRes] = await Promise.all([
    supabase.from("customers").select("*").eq("id", inv.customer_id).single(),
    supabase.from("invoice_trips").select("*").eq("invoice_id", invoiceId).order("id"),
  ]);
  const cust = custRes.data;
  const trips = tripsRes.data ?? [];
  const tripIds = trips.map((t) => t.id);
  const vehicleIds = trips.map((t) => t.vehicle_id).filter((x): x is number => x != null);
  const driverIds = trips.map((t) => t.driver_id).filter((x): x is number => x != null);

  // كل البيانات التابعة تُجلب بالتوازي. وكانت invoiceTotals تعيد قراءة النقلات
  // والمصروفات مرة ثانية، لذلك نحسب الإجماليات هنا من النتائج نفسها.
  const [expRes, vehRes, empRes, payRes] = await Promise.all([
    tripIds.length
      ? supabase.from("trip_expenses").select("*").in("trip_id", tripIds).order("id")
      : Promise.resolve({ data: [] }),
    vehicleIds.length
      ? supabase.from("vehicles").select("id, plate_number").in("id", vehicleIds)
      : Promise.resolve({ data: [] }),
    driverIds.length
      ? supabase.from("employees").select("id, name").in("id", driverIds)
      : Promise.resolve({ data: [] }),
    tripIds.length
      ? supabase.from("payment_vouchers").select("amount").eq("voucher_type", "trip").is("source_expense_id", null).in("trip_id", tripIds)
      : Promise.resolve({ data: [] }),
  ]);

  const exps = (expRes.data ?? []) as TripExpense[];
  const expByTrip = new Map<number, TripExpense[]>();
  let billableTotal = 0;
  let expensesTotal = 0;
  for (const e of exps) {
    const tid = Number(e.trip_id);
    const list = expByTrip.get(tid) ?? [];
    list.push(e);
    expByTrip.set(tid, list);
    if (e.source === "customer") billableTotal += num(e.amount);
    else expensesTotal += num(e.amount);
  }

  const vehMap = new Map(((vehRes.data ?? []) as { id: number; plate_number: string }[]).map((v) => [v.id, v.plate_number]));
  const empMap = new Map(((empRes.data ?? []) as { id: number; name: string }[]).map((e) => [e.id, e.name]));
  const tripList: InvoiceTrip[] = trips.map((t) => ({
    ...t,
    container_numbers: Array.isArray(t.container_numbers) ? t.container_numbers : [],
    vehicle_name: vehMap.get(t.vehicle_id ?? 0) ?? null,
    driver_name: empMap.get(t.driver_id ?? 0) ?? null,
    expenses: expByTrip.get(t.id) ?? [],
  }));

  const totals = totalsFrom(
    num(inv.vat_rate),
    sum(trips.map((t) => num(t.price))),
    billableTotal,
    expensesTotal,
    sum((payRes.data ?? []).map((p) => num(p.amount))),
  );
  return {
    ...inv,
    customer: (cust as Customer) ?? null,
    trips: tripList,
    customer_name: cust?.name ?? "—",
    customer_code: cust?.code ?? "—",
    trips_count: tripList.length,
    trip_summaries: tripList.map((trip) => ({
      id: Number(trip.id),
      route: `${trip.from_loc || "—"} ← ${trip.to_loc || "—"}`,
      container_numbers: trip.container_numbers,
    })),
    ...totals,
  };
}

export interface InvoiceOption {
  id: number;
  number: number;
  date: string;
  customer_name: string;
  total: number;
  paid: number;
  remaining: number;
}

export async function invoiceOptions(): Promise<InvoiceOption[]> {
  const [invRes, custRes] = await Promise.all([
    supabase.from("invoices").select("*").order("date").order("number"),
    supabase.from("customers").select("id, name"),
  ]);
  const invs = invRes.data;
  const custs = custRes.data;
  const custMap = new Map((custs ?? []).map((c) => [c.id, c.name]));
  if (!invs?.length) return [];

  const invIds = (invs as Invoice[]).map((i) => i.id);
  const { data: tripRows } = await supabase.from("invoice_trips").select("id, invoice_id, price").in("invoice_id", invIds);
  const trips = (tripRows ?? []) as { id: number; invoice_id: number; price: number }[];
  const tripIds = trips.map((t) => t.id);
  const invOfTrip = new Map(trips.map((t) => [t.id, t.invoice_id]));

  let exps: { trip_id: number; amount: number; source?: string }[] = [];
  if (tripIds.length) {
    const { data: expRows } = await supabase.from("trip_expenses").select("trip_id, amount, source").in("trip_id", tripIds);
    exps = (expRows ?? []) as typeof exps;
  }

  // أساس كل فاتورة: النقلات + المصروفات التي يتحمّلها العميل، ثم الضريبة
  const baseByInv = new Map<number, { trips: number; billable: number }>();
  const bucket = (id: number) => {
    let b = baseByInv.get(id);
    if (!b) { b = { trips: 0, billable: 0 }; baseByInv.set(id, b); }
    return b;
  };
  for (const t of trips) bucket(t.invoice_id).trips += num(t.price);
  for (const e of exps) {
    const iid = invOfTrip.get(e.trip_id);
    if (iid == null) continue;
    if (e.source === "customer") bucket(iid).billable += num(e.amount);
  }

  const vatMap = new Map((invs as Invoice[]).map((i) => [i.id, num(i.vat_rate)]));
  const queue = new Map<number, { invoice_id: number; number: number; date: string; total: number; paid: number }[]>();
  for (const inv of invs as Invoice[]) {
    const b = baseByInv.get(inv.id) ?? { trips: 0, billable: 0 };
    const sub = b.trips + b.billable;
    const total = round2(sub + round2((sub * (vatMap.get(inv.id) ?? 0)) / 100));
    const q = queue.get(inv.customer_id) ?? [];
    q.push({ invoice_id: inv.id, number: inv.number, date: inv.date, total, paid: 0 });
    queue.set(inv.customer_id, q);
  }

  // الإشعارات والتحصيلات مستقلان في الجلب؛ تُطبّق الإشعارات أولاً ثم يوزع
  // التحصيل على القيم المعدّلة، لكن لا حاجة لانتظار استعلام قبل بدء الآخر.
  const [noteRes, receiptRes] = await Promise.all([
    supabase.from("credit_debit_notes").select("invoice_id, customer_id, note_type, amount, vat_rate"),
    supabase.from("receipt_vouchers").select("id, customer_id, amount, date").eq("voucher_type", "customer").order("date").order("id"),
  ]);
  const noteRows = noteRes.data;
  const recRows = receiptRes.data;
  for (const n of (noteRows ?? []) as { invoice_id: number; customer_id: number; note_type: string; amount: number; vat_rate: number }[]) {
    const totalAdj = num(n.amount) + round2((num(n.amount) * num(n.vat_rate)) / 100);
    const sign = n.note_type === "debit" ? 1 : -1;
    const q = queue.get(n.customer_id) ?? [];
    const target = q.find((x) => x.invoice_id === n.invoice_id);
    if (target) target.total = round2(target.total + sign * totalAdj);
  }

  // توزيع سندات القبض بالأقدمية على فواتير كل عميل
  for (const r of (recRows ?? []) as { customer_id: number; amount: number; date: string }[]) {
    const q = queue.get(r.customer_id);
    if (!q) continue;
    let left = num(r.amount);
    for (const inv of q) {
      if (left <= 0.0001) break;
      const due = round2(inv.total - inv.paid);
      if (due <= 0.0001) continue;
      const take = Math.min(due, left);
      inv.paid = round2(inv.paid + take);
      left = round2(left - take);
    }
  }

  return (invs as Invoice[])
    .map((inv) => {
      const q = queue.get(inv.customer_id) ?? [];
      const item = q.find((x) => x.invoice_id === inv.id) ?? { total: 0, paid: 0 };
      return {
        id: inv.id,
        number: inv.number,
        date: inv.date,
        customer_name: custMap.get(inv.customer_id) ?? "—",
        total: round2(item.total),
        paid: round2(item.paid),
        remaining: round2(item.total - item.paid),
      };
    })
    .sort((a, b) => (a.date === b.date ? b.number - a.number : a.date < b.date ? 1 : -1));
}

export async function tripInvoiceId(tripId: number | null): Promise<number | null> {
  if (!tripId) return null;
  const { data } = await supabase.from("invoice_trips").select("invoice_id").eq("id", tripId).maybeSingle();
  return data ? Number(data.invoice_id) : null;
}

export async function tripOptionsByInvoice(invoiceId: number): Promise<{ id: number; label: string; revenue: number }[]> {
  const { data: trips } = await supabase
    .from("invoice_trips")
    .select("id, from_loc, to_loc, price")
    .eq("invoice_id", invoiceId)
    .order("id");
  return (trips ?? []).map((t, index) => ({
    id: t.id,
    // خيار قصير مقصود: التفاصيل المالية والتشغيلية لا تُفرد داخل نموذج الصرف.
    label: `نقلة ${index + 1} — ${t.from_loc || "—"} ← ${t.to_loc || "—"}`,
    revenue: num(t.price),
  }));
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
): Promise<{ opening: number; rows: StmtRow[]; closing: number; invoiced: number; collected: number; notes_debit: number; notes_credit: number }> {
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
  const totalsMap = await invoiceTotalsBatch((invs ?? []).map((i) => i.id));
  for (const inv of invs ?? []) {
    const totals = totalsMap.get(inv.id) ?? { customer_total: 0 };
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

  // إشعارات الدائن والمدين — مدين يزيد المستحق، دائن يحسمه
  const { data: notes } = await supabase
    .from("credit_debit_notes")
    .select("id, number, note_type, date, amount, vat_rate, reason")
    .eq("customer_id", customerId)
    .gte("date", dFrom)
    .lte("date", dTo)
    .order("date")
    .order("id");
  for (const n of notes ?? []) {
    const total = num(n.amount) + round2((num(n.amount) * num(n.vat_rate)) / 100);
    const isDebit = n.note_type === "debit";
    rows.push({
      date: n.date,
      doc: `${isDebit ? "إشعار مدين" : "إشعار دائن"} ${voucherNumberLabel(isDebit ? "DN" : "CN", n.number)}`,
      desc: n.reason || (isDebit ? "مبلغ إضافي على العميل" : "تخفيض أو حسم للعميل"),
      debit: isDebit ? total : 0,
      credit: isDebit ? 0 : total,
      kind: isDebit ? "note_debit" : "note_credit",
    });
  }

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const order: Record<string, number> = { invoice: 0, note_debit: 1, note_credit: 1, receipt: 2 };
    return (order[a.kind] ?? 0) - (order[b.kind] ?? 0);
  });
  let balance = opening;
  for (const r of rows) {
    balance = round2(balance + r.debit - r.credit);
    r.balance = balance;
  }
  return {
    opening: round2(opening),
    rows,
    closing: round2(balance),
    invoiced: round2(rows.filter((r) => r.kind === "invoice").reduce((a, r) => a + r.debit, 0)),
    collected: round2(rows.filter((r) => r.kind === "receipt").reduce((a, r) => a + r.credit, 0)),
    notes_debit: round2(rows.filter((r) => r.kind === "note_debit").reduce((a, r) => a + r.debit, 0)),
    notes_credit: round2(rows.filter((r) => r.kind === "note_credit").reduce((a, r) => a + r.credit, 0)),
  };
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

// ---------------------------------------------------------------------------
// تخصيص تحصيلات العميل على فواتيره بالأقدمية (FIFO)
// ملاحظة: لا تُعرض «حالة الفاتورة» للمستخدم — التخصيص لأغراض بيان الكشف فقط.
// ---------------------------------------------------------------------------
export interface AllocationPart { invoice_id: number; number: number; date: string; amount: number }
export interface CustomerAllocations {
  /** لكل سند قبض: على أي فواتير وُزّع */
  byReceipt: Map<number, AllocationPart[]>;
  /** لكل فاتورة: المسدَّد منها والمتبقي */
  byInvoice: Map<number, { number: number; date: string; total: number; paid: number; remaining: number }>;
  /** دفعات غير مخصَّصة (زيادة عن قيمة الفواتير) */
  unallocated: number;
}

export async function customerAllocations(customerId: number): Promise<CustomerAllocations> {
  const { data: invs } = await supabase
    .from("invoices")
    .select("id, number, date")
    .eq("customer_id", customerId)
    .order("date")
    .order("number");

  const queue: { invoice_id: number; number: number; date: string; total: number; paid: number }[] = [];
  const totalsMap = await invoiceTotalsBatch((invs ?? []).map((i) => i.id));
  for (const inv of invs ?? []) {
    const t = totalsMap.get(inv.id) ?? { customer_total: 0 };
    queue.push({ invoice_id: inv.id, number: inv.number, date: inv.date, total: t.customer_total, paid: 0 });
  }

  // الإشعارات تعدّل القيمة المستحقة لكل فاتورة: إشعار مدين يزيدها، ودائن يحسمها
  const { data: noteRows } = await supabase
    .from("credit_debit_notes")
    .select("invoice_id, note_type, amount, vat_rate")
    .eq("customer_id", customerId);
  const noteAdj = new Map<number, number>();
  for (const n of noteRows ?? []) {
    const total = num(n.amount) + round2((num(n.amount) * num(n.vat_rate)) / 100);
    const sign = n.note_type === "debit" ? 1 : -1;
    noteAdj.set(n.invoice_id, (noteAdj.get(n.invoice_id) ?? 0) + sign * total);
  }
  for (const inv of queue) inv.total = round2(inv.total + (noteAdj.get(inv.invoice_id) ?? 0));

  const { data: recs } = await supabase
    .from("receipt_vouchers")
    .select("id, number, date, amount")
    .eq("voucher_type", "customer")
    .eq("customer_id", customerId)
    .order("date")
    .order("id");

  const byReceipt = new Map<number, AllocationPart[]>();
  let unallocated = 0;
  for (const r of recs ?? []) {
    let left = num(r.amount);
    const parts: AllocationPart[] = [];
    for (const inv of queue) {
      if (left <= 0.0001) break;
      const due = round2(inv.total - inv.paid);
      if (due <= 0.0001) continue;
      const take = Math.min(due, left);
      inv.paid = round2(inv.paid + take);
      left = round2(left - take);
      parts.push({ invoice_id: inv.invoice_id, number: inv.number, date: inv.date, amount: take });
    }
    if (left > 0.0001) unallocated = round2(unallocated + left);
    byReceipt.set(r.id, parts);
  }

  const byInvoice = new Map<number, { number: number; date: string; total: number; paid: number; remaining: number }>();
  for (const inv of queue) {
    byInvoice.set(inv.invoice_id, {
      number: inv.number, date: inv.date, total: round2(inv.total),
      paid: round2(inv.paid), remaining: round2(inv.total - inv.paid),
    });
  }
  return { byReceipt, byInvoice, unallocated };
}

// ---------------------------------------------------------------------------
// كشف حساب العميل الاحترافي (تفصيلي وجاهز للإرسال للمطابقة)
// ---------------------------------------------------------------------------
export interface CustomerStatementRow {
  date: string;
  doc: string;
  desc: string;
  detail: string;
  debit: number;
  credit: number;
  balance: number;
  kind: string;
}
export interface CustomerStatementFull {
  customer: Customer | null;
  from: string;
  to: string;
  opening: number;
  rows: CustomerStatementRow[];
  invoiced: number;
  collected: number;
  notes_debit: number;
  notes_credit: number;
  closing: number;
  /** فواتير عليها متبقٍ (بالأقدمية) لبيان تركيبة الرصيد */
  openItems: { number: number; date: string; total: number; paid: number; remaining: number }[];
}

export async function customerStatementFull(
  customerId: number,
  dFrom: string,
  dTo: string
): Promise<CustomerStatementFull> {
  const { data: cust } = await supabase.from("customers").select("*").eq("id", customerId).single();
  const opening = await customerBalance(customerId, dFrom);
  const alloc = await customerAllocations(customerId);

  const rows: CustomerStatementRow[] = [];

  const { data: invs } = await supabase
    .from("invoices")
    .select("id, number, date, notes")
    .eq("customer_id", customerId)
    .gte("date", dFrom)
    .lte("date", dTo)
    .order("date")
    .order("number");

  const totalsMap = await invoiceTotalsBatch((invs ?? []).map((i) => i.id));
  const invIds = (invs ?? []).map((i) => i.id);
  const legsByInv = new Map<number, string>();
  if (invIds.length) {
    const { data: tripRows } = await supabase.from("invoice_trips").select("invoice_id, from_loc, to_loc, qty").in("invoice_id", invIds).order("id");
    for (const x of tripRows ?? []) {
      const legs = `${x.from_loc || "—"} ← ${x.to_loc || "—"}${num(x.qty) > 1 ? ` ×${num(x.qty)}` : ""}`;
      const prev = legsByInv.get(x.invoice_id);
      legsByInv.set(x.invoice_id, prev ? `${prev}، ${legs}` : legs);
    }
  }
  for (const inv of invs ?? []) {
    const t = totalsMap.get(inv.id) ?? { trips_total: 0, billable_total: 0, vat_amount: 0, customer_total: 0 };
    const vatPart = t.vat_amount > 0 ? ` • ضريبة ${t.vat_amount.toFixed(2)}` : "";
    rows.push({
      date: inv.date,
      doc: `فاتورة ${invoiceNumberLabel(inv.number)}`,
      desc: legsByInv.get(inv.id) || "خدمات نقل",
      detail: `قيمة قبل الضريبة ${(t.trips_total + t.billable_total).toFixed(2)}${vatPart}`,
      debit: t.customer_total,
      credit: 0,
      balance: 0,
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
    const parts = alloc.byReceipt.get(r.id) ?? [];
    const detail = parts.length
      ? "سداد: " + parts.map((p) => `${invoiceNumberLabel(p.number)} (${p.amount.toFixed(2)})`).join("، ")
      : "دفعة تحت الحساب";
    rows.push({
      date: r.date,
      doc: `سند قبض ${voucherNumberLabel("RV", r.number)}`,
      desc: r.description || "تحصيل من العميل",
      detail,
      debit: 0,
      credit: num(r.amount),
      balance: 0,
      kind: "receipt",
    });
  }

  // إشعارات الدائن والمدين
  const { data: notes } = await supabase
    .from("credit_debit_notes")
    .select("id, number, note_type, date, amount, vat_rate, reason")
    .eq("customer_id", customerId)
    .gte("date", dFrom)
    .lte("date", dTo)
    .order("date")
    .order("id");
  for (const n of notes ?? []) {
    const total = num(n.amount) + round2((num(n.amount) * num(n.vat_rate)) / 100);
    const isDebit = n.note_type === "debit";
    rows.push({
      date: n.date,
      doc: `${isDebit ? "إشعار مدين" : "إشعار دائن"} ${voucherNumberLabel(isDebit ? "DN" : "CN", n.number)}`,
      desc: n.reason || (isDebit ? "مبلغ إضافي على العميل" : "تخفيض أو حسم للعميل"),
      detail: isDebit ? "إشعار تصحيحي: يزيد المستحق على العميل" : "إشعار تصحيحي: يخفض المستحق على العميل",
      debit: isDebit ? total : 0,
      credit: isDebit ? 0 : total,
      balance: 0,
      kind: isDebit ? "note_debit" : "note_credit",
    });
  }

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const order: Record<string, number> = { invoice: 0, note_debit: 1, note_credit: 1, receipt: 2 };
    return (order[a.kind] ?? 0) - (order[b.kind] ?? 0);
  });

  let balance = opening;
  for (const r of rows) {
    balance = round2(balance + r.debit - r.credit);
    r.balance = balance;
  }

  const openItems = [...alloc.byInvoice.values()]
    .filter((i) => i.remaining > 0.0001)
    .sort((a, b) => (a.date === b.date ? a.number - b.number : a.date < b.date ? -1 : 1));

  return {
    customer: (cust ?? null) as Customer | null,
    from: dFrom,
    to: dTo,
    opening: round2(opening),
    rows,
    invoiced: round2(rows.filter((r) => r.kind === "invoice").reduce((a, r) => a + r.debit, 0)),
    collected: round2(rows.filter((r) => r.kind === "receipt").reduce((a, r) => a + r.credit, 0)),
    notes_debit: round2(rows.filter((r) => r.kind === "note_debit").reduce((a, r) => a + r.debit, 0)),
    notes_credit: round2(rows.filter((r) => r.kind === "note_credit").reduce((a, r) => a + r.credit, 0)),
    closing: round2(balance),
    openItems,
  };
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

  const tripIds = (trips ?? []).map((t) => t.id);
  const [expRows, payRows] = await Promise.all([
    tripIds.length
      ? supabase.from("trip_expenses").select("trip_id, expense_type, amount, source, notes").in("trip_id", tripIds).order("id")
      : Promise.resolve({ data: [] }),
    tripIds.length
      ? supabase.from("payment_vouchers").select("trip_id, number, date, amount, description").eq("voucher_type", "trip").is("source_expense_id", null).in("trip_id", tripIds).gte("date", dFrom ?? "0001-01-01").lte("date", dTo ?? "9999-12-31").order("date").order("id")
      : Promise.resolve({ data: [] }),
  ]);

  const expByTrip = new Map<number, { expense_type: string; amount: number; source?: string; notes?: string }[]>();
  const payByTrip = new Map<number, { number: number; date: string; amount: number; description?: string }[]>();
  const billableByTrip = new Map<number, number>();
  const directByTrip = new Map<number, number>();
  const laterByTrip = new Map<number, number>();
  for (const e of (expRows.data ?? []) as { trip_id: number; expense_type: string; amount: number; source?: string; notes?: string }[]) {
    const list = expByTrip.get(e.trip_id) ?? [];
    list.push(e);
    expByTrip.set(e.trip_id, list);
    if (e.source === "customer") billableByTrip.set(e.trip_id, (billableByTrip.get(e.trip_id) ?? 0) + num(e.amount));
    else directByTrip.set(e.trip_id, (directByTrip.get(e.trip_id) ?? 0) + num(e.amount));
  }
  for (const p of (payRows.data ?? []) as { trip_id: number; number: number; date: string; amount: number; description?: string }[]) {
    const list = payByTrip.get(p.trip_id) ?? [];
    list.push(p);
    payByTrip.set(p.trip_id, list);
    laterByTrip.set(p.trip_id, (laterByTrip.get(p.trip_id) ?? 0) + num(p.amount));
  }

  return (trips ?? []).map((t) => {
    const inv = invMap.get(t.invoice_id);
    const billable = billableByTrip.get(t.id) ?? 0;
    const revenue = round2(num(t.price) + billable);
    const direct = round2(directByTrip.get(t.id) ?? 0);
    const later = round2(laterByTrip.get(t.id) ?? 0);
    const net = round2(revenue - direct - later);

    const expDetail = (expByTrip.get(t.id) ?? [])
      .map((e) => `${EXPENSE_TYPES[e.expense_type] ?? e.expense_type}${e.notes ? ` (${e.notes})` : ""}: ${num(e.amount).toFixed(2)}`)
      .join(" + ");
    const payDetail = (payByTrip.get(t.id) ?? [])
      .map((e) => `سند ${voucherNumberLabel("PV", e.number)} ${e.date}: ${num(e.amount).toFixed(2)}${e.description ? ` (${e.description})` : ""}`)
      .join(" + ");

    return {
      trip_id: t.id,
      invoice: invoiceNumberLabel(inv?.number ?? 0),
      date: inv?.date ?? "—",
      customer: custMap.get(inv?.customer_id ?? 0) ?? "—",
      route: `${t.from_loc || "—"} ← ${t.to_loc || "—"}`,
      vehicle: vehMap.get(t.vehicle_id ?? 0) ?? "—",
      driver: empMap.get(t.driver_id ?? 0) ?? "—",
      revenue,
      direct,
      later,
      net,
      expense_detail: expDetail || "—",
      payment_detail: payDetail || "—",
    };
  });
}

// ---------------------------------------------------------------------------
// تقرير 3: كشف حساب موظف/سائق
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// أرشيف السلفيات: متى صُرفت، وكم خُصم، ومن أي مسير/شهر، وما المتبقي
// ---------------------------------------------------------------------------
export interface AdvanceSettlementRow {
  payroll_id: number;
  payroll_number: number;
  payroll_date: string;
  period_year: number;
  period_month: number;
  period_label: string;
  amount: number;
}
export interface AdvanceArchiveRow {
  id: number;
  number: number;
  date: string;
  amount: number;
  settled: number;
  remaining: number;
  status: "open" | "partial" | "closed";
  account_label: string;
  description: string;
  settlements: AdvanceSettlementRow[];
  /** تاريخ آخر خصم (إن وُجد) */
  last_settled_date: string | null;
}

export async function advanceArchive(employeeId: number): Promise<AdvanceArchiveRow[]> {
  const { data: advs } = await supabase
    .from("payment_vouchers")
    .select("*")
    .eq("voucher_type", "advance")
    .eq("employee_id", employeeId)
    .order("date")
    .order("id");

  const out: AdvanceArchiveRow[] = [];
  for (const a of advs ?? []) {
    const { data: rows } = await supabase
      .from("advance_settlements")
      .select("amount, payroll_id, payrolls(number, date, period_year, period_month)")
      .eq("payment_voucher_id", a.id)
      .order("payroll_id");

    const settlements: AdvanceSettlementRow[] = (rows ?? []).map((r) => {
      const p = (Array.isArray(r.payrolls) ? (r.payrolls as any[])[0] : (r.payrolls as any)) ?? {};
      return {
        payroll_id: r.payroll_id,
        payroll_number: num(p.number),
        payroll_date: p.date ?? "",
        period_year: num(p.period_year),
        period_month: num(p.period_month),
        period_label: p.period_year ? periodLabel(num(p.period_year), num(p.period_month)) : "—",
        amount: num(r.amount),
      };
    });
    settlements.sort((x, y) => (x.payroll_date < y.payroll_date ? -1 : x.payroll_date > y.payroll_date ? 1 : 0));

    const settled = round2(sum(settlements.map((x) => x.amount)));
    const amount = num(a.amount);
    const remaining = round2(amount - settled);
    out.push({
      id: a.id,
      number: num(a.number),
      date: a.date,
      amount,
      settled,
      remaining,
      status: settled <= 0.009 ? "open" : remaining <= 0.009 ? "closed" : "partial",
      account_label: await accountName(a.account_kind, a.account_id),
      description: a.description ?? "",
      settlements,
      last_settled_date: settlements.length ? settlements[settlements.length - 1].payroll_date : null,
    });
  }
  return out;
}

export interface AdvanceTrackingRow {
  id: number;
  number: number;
  date: string;
  employee_id: number;
  employee_name: string;
  account_label: string;
  amount: number;
  settled: number;
  remaining: number;
  status: "open" | "partial" | "closed";
  last_settled_date: string | null;
  settlement_details: string;
  description: string;
}

/** شاشة مرجعية مجمّعة لكل السلف؛ لا تُنشئ أو تعدّل أي سلفة. */
export async function listAdvanceTracking(options: {
  dFrom?: string | null;
  dTo?: string | null;
  employeeId?: number | null;
  status?: "open" | "partial" | "closed" | null;
} = {}): Promise<AdvanceTrackingRow[]> {
  let advanceQuery = supabase
    .from("payment_vouchers")
    .select("id, number, date, employee_id, account_kind, account_id, amount, description")
    .eq("voucher_type", "advance")
    .order("date", { ascending: false })
    .order("number", { ascending: false });
  if (options.dFrom) advanceQuery = advanceQuery.gte("date", options.dFrom);
  if (options.dTo) advanceQuery = advanceQuery.lte("date", options.dTo);
  if (options.employeeId) advanceQuery = advanceQuery.eq("employee_id", options.employeeId);

  const [advanceRes, employeeRes, cashboxRes, bankRes, settlementRes, payrollRes] = await Promise.all([
    advanceQuery,
    supabase.from("employees").select("id, name"),
    supabase.from("cashboxes").select("id, name"),
    supabase.from("banks").select("id, name"),
    supabase.from("advance_settlements").select("payment_voucher_id, payroll_id, amount"),
    supabase.from("payrolls").select("id, number, date, period_year, period_month"),
  ]);

  const employeeMap = new Map((employeeRes.data ?? []).map((e) => [Number(e.id), String(e.name)]));
  const cashboxMap = new Map((cashboxRes.data ?? []).map((a) => [Number(a.id), String(a.name)]));
  const bankMap = new Map((bankRes.data ?? []).map((a) => [Number(a.id), String(a.name)]));
  const payrollMap = new Map((payrollRes.data ?? []).map((p) => [Number(p.id), p]));
  const settlementMap = new Map<number, { amount: number; payroll_id: number }[]>();
  for (const row of settlementRes.data ?? []) {
    const id = Number(row.payment_voucher_id);
    const list = settlementMap.get(id) ?? [];
    list.push({ amount: num(row.amount), payroll_id: Number(row.payroll_id) });
    settlementMap.set(id, list);
  }

  const rows: AdvanceTrackingRow[] = (advanceRes.data ?? []).map((advance) => {
    const settlements = settlementMap.get(Number(advance.id)) ?? [];
    const settled = round2(sum(settlements.map((s) => s.amount)));
    const amount = round2(num(advance.amount));
    const remaining = round2(amount - settled);
    const status: AdvanceTrackingRow["status"] = settled <= 0.009 ? "open" : remaining <= 0.009 ? "closed" : "partial";
    const details = settlements.map((settlement) => {
      const payroll = payrollMap.get(settlement.payroll_id);
      return payroll
        ? `PAY-${String(payroll.number).padStart(5, "0")} (${periodLabel(Number(payroll.period_year), Number(payroll.period_month))}): ${money(settlement.amount)}`
        : money(settlement.amount);
    });
    const dates = settlements.map((s) => String(payrollMap.get(s.payroll_id)?.date ?? "")).filter(Boolean).sort();
    const accountName = advance.account_kind === "cashbox"
      ? cashboxMap.get(Number(advance.account_id))
      : bankMap.get(Number(advance.account_id));
    return {
      id: Number(advance.id),
      number: Number(advance.number),
      date: String(advance.date),
      employee_id: Number(advance.employee_id),
      employee_name: employeeMap.get(Number(advance.employee_id)) ?? "—",
      account_label: `${advance.account_kind === "cashbox" ? "خزينة" : "بنك"}: ${accountName ?? "—"}`,
      amount,
      settled,
      remaining,
      status,
      last_settled_date: dates.length ? dates[dates.length - 1] : null,
      settlement_details: details.join(" | "),
      description: String(advance.description ?? ""),
    };
  });
  return options.status ? rows.filter((row) => row.status === options.status) : rows;
}

/** إجماليات أرشيف السلف لموظف */
export function advanceArchiveTotals(rows: AdvanceArchiveRow[]): {
  total: number; settled: number; remaining: number; open_count: number;
} {
  return {
    total: round2(sum(rows.map((r) => r.amount))),
    settled: round2(sum(rows.map((r) => r.settled))),
    remaining: round2(sum(rows.map((r) => r.remaining))),
    open_count: rows.filter((r) => r.remaining > 0.009).length,
  };
}

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
      .select("amount, payroll_id, payrolls(date, number, period_year, period_month)")
      .eq("payment_voucher_id", r.id)
      .order("payroll_id");
    const settlements = (srows ?? []).map((s) => ({
      amount: num(s.amount),
      payroll_id: s.payroll_id,
      pdate: Array.isArray(s.payrolls) ? (s.payrolls as any[])[0]?.date : (s.payrolls as any)?.date,
      pnum: Array.isArray(s.payrolls) ? (s.payrolls as any[])[0]?.number : (s.payrolls as any)?.number,
      period: (() => {
        const p2: any = Array.isArray(s.payrolls) ? (s.payrolls as any[])[0] : (s.payrolls as any);
        return p2?.period_year ? periodLabel(num(p2.period_year), num(p2.period_month)) : "";
      })(),
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

    let purchaseQ = supabase
      .from("purchase_invoices")
      .select("vat_included, purchase_items(qty, unit_price, vat_rate)")
      .eq("vehicle_id", v.id);
    if (dFrom) purchaseQ = purchaseQ.gte("date", dFrom);
    if (dTo) purchaseQ = purchaseQ.lte("date", dTo);
    const { data: vehiclePurchases } = await purchaseQ;
    const purchases = sum((vehiclePurchases ?? []).map((p) => purchaseNetFromRow(p as Record<string, unknown>)));

    out.push({
      vehicle_id: v.id,
      code: v.code,
      plate: v.plate_number,
      vtype: v.vehicle_type,
      trips: tripsCount,
      revenue: round2(revenue),
      direct: round2(direct),
      maintenance: round2(maintenance),
      purchases: round2(purchases),
      net: round2(revenue - direct - maintenance - purchases),
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

  // فواتير المشتريات تُثبت كمصروف عند تاريخ الفاتورة سواء كانت نقدية أو آجلة.
  // السداد النقدي التلقائي لا يُعاد احتسابه حتى لا يتكرر المصروف.
  const { data: purchaseRows } = await between(
    supabase.from("purchase_invoices").select("expense_category, vat_included, purchase_items(qty, unit_price, vat_rate)"),
    "date"
  );
  const purchaseByCategory: Record<string, number> = Object.fromEntries(
    Object.keys(PURCHASE_EXPENSE_CATEGORIES).map((key) => [key, 0])
  );
  for (const raw of purchaseRows ?? []) {
    const row = raw as Record<string, unknown>;
    const category = String(row.expense_category ?? "other");
    const key = category in PURCHASE_EXPENSE_CATEGORIES ? category : "other";
    purchaseByCategory[key] = round2((purchaseByCategory[key] ?? 0) + purchaseNetFromRow(row));
  }
  const purchaseExpenses = round2(sum(Object.values(purchaseByCategory)));

  // سحب نقدي لصاحب المنشأة (مصاريف خاصة به) — يُخصم من الأرباح كسحب مالك/مصروف خاص
  const { data: ownerRows } = await between(
    supabase.from("payment_vouchers").select("amount").eq("voucher_type", "owner"),
    "date"
  );
  const ownerWithdrawals = sum((ownerRows ?? []).map((r) => num(r.amount)));

  // سندات الرحلات اليدوية (المتولّدة تلقائياً محتسبة ضمن direct أعلاه)
  const { data: tripPayRows } = await between(
    supabase.from("payment_vouchers").select("amount").eq("voucher_type", "trip").is("source_expense_id", null),
    "date"
  );
  const tripPayments = sum((tripPayRows ?? []).map((r) => num(r.amount)));

  // إشعارات المدين والدائن: مدين = إيراد إضافي، دائن = حسم/تخفيض إيراد
  const { data: noteRows } = await between(
    supabase.from("credit_debit_notes").select("note_type, amount, vat_rate"),
    "date"
  );
  let notesDebit = 0;
  let notesCredit = 0;
  for (const n of noteRows ?? []) {
    const total = num(n.amount) + round2((num(n.amount) * num(n.vat_rate)) / 100);
    if (n.note_type === "debit") notesDebit += total;
    else notesCredit += total;
  }
  const noteNet = round2(notesDebit - notesCredit);

  const totalRev = round2(transport + otherRev + noteNet);
  const totalExp = round2(direct + tripPayments + salaries + advances + maintenance + general + purchaseExpenses + ownerWithdrawals);
  return {
    transport_revenue: round2(transport),
    other_revenue: round2(otherRev),
    credit_notes_adjust: round2(-notesCredit),
    debit_notes_adjust: round2(notesDebit),
    notes_adjust: noteNet,
    total_revenue: totalRev,
    direct_expenses: round2(direct),
    trip_payments: round2(tripPayments),
    salaries: round2(salaries),
    advances: round2(advances),
    maintenance: round2(maintenance),
    general_expenses: round2(general),
    purchase_expenses: purchaseExpenses,
    ...Object.fromEntries(Object.entries(purchaseByCategory).map(([key, value]) => [`purchase_${key}`, round2(value)])),
    owner_withdrawals: round2(ownerWithdrawals),
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
