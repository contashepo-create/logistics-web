// تقرير العميل الشامل: كل ما يتعلق بالعميل في مستند واحد قابل للتصدير والطباعة.
//
//   البيانات الأساسية + المؤشرات + الفواتير ونقلاتها وخدماتها + سندات القبض
//   وتخصيصها + الإشعارات + تركيبة الرصيد المستحق (أعمار الديون) + الكشف التفصيلي.
//
// كل الأرقام مشتقة من نفس محرك الحسابات (calc) المستخدم في الشاشات، فلا توجد
// أي أرقام موازية أو مخزّنة — التقرير مطابق دائماً للأرصدة المعروضة.

import { supabase } from "./supabase";
import { translateDbError } from "./db";
import { RuleError, positiveId } from "./rules";
import {
  customerAllocations,
  customerBalance,
  customerStatement,
  invoiceNumberLabel,
  invoiceTotalsBatch,
  num,
  voucherNumberLabel,
  type CustomerStatementResult,
  type StatementFilters,
} from "./calc";
import { itemsUsageReport } from "./items";
import type { Customer } from "./types";

export interface CustomerReportInvoice {
  id: number;
  number: number;
  label: string;
  date: string;
  notes: string;
  vat_rate: number;
  /** الإجمالي قبل الضريبة (نقلات + مصروفات يتحمّلها العميل) */
  subtotal: number;
  vat_amount: number;
  total: number;
  paid: number;
  remaining: number;
  status: "paid" | "partial" | "open";
  trips_count: number;
  legs: string[];
  /** هل الفاتورة داخل الفترة المطلوبة؟ */
  in_range: boolean;
}

export interface CustomerReportTrip {
  trip_id: number;
  invoice_number: number;
  invoice_label: string;
  date: string;
  item_name: string;
  from_loc: string;
  to_loc: string;
  route: string;
  qty: number;
  unit_price: number;
  amount: number;
  containers: string[];
  vehicle_name: string;
  driver_name: string;
  notes: string;
}

export interface CustomerReportService {
  item_id: number | null;
  name: string;
  unit: string;
  /** خط الخدمة (من ← إلى) إن كانت خدمة خط، وإلا فهي خدمة عامة */
  from_loc: string;
  to_loc: string;
  trips_count: number;
  qty_total: number;
  revenue: number;
  vat_amount: number;
  total: number;
}

export interface CustomerReportReceipt {
  id: number;
  label: string;
  date: string;
  amount: number;
  description: string;
  /** على أي فواتير وُزِّع السداد بالأقدمية (FIFO) */
  allocations: string;
  /** «خزينة: الاسم» أو «بنك: الاسم» — يُترك فارغاً إن تعذّر جلب الاسم */
  account_name?: string;
}

export interface CustomerReportNote {
  id: number;
  label: string;
  type: "credit" | "debit";
  date: string;
  amount: number;
  vat_amount: number;
  total: number;
  reason: string;
  invoice_number: number | null;
  trips: string[];
}

export interface CustomerReportAgingBucket {
  bucket: string;
  count: number;
  amount: number;
}

/**
 * مخرجات التقرير الشامل. نطاق كل قسم واضح حتى لا يلتبس على القارئ:
 *   • summary / statement / services: حركات الفترة [from, to].
 *   • invoices / trips: كل فواتير العميل حتى نهاية الفترة (وفيها علم in_range)
 *     لأن نقلاتها وخدماتها هي شرح تركيبة الرصيد المتبقي.
 *   • receipts / notes: مستندات الفترة فقط.
 *   • open_items / aging: تركيبة المستحق على أساس كل الفواتير حتى تاريخ النهاية.
 */
export interface CustomerFullReport {
  customer: Customer | null;
  from: string;
  to: string;
  generated_at: string;
  summary: {
    opening: number;
    invoiced: number;
    collected: number;
    notes_debit: number;
    notes_credit: number;
    closing: number;
    invoices_count: number;
    receipts_count: number;
    notes_count: number;
    trips_count: number;
    qty_total: number;
    services_count: number;
    avg_invoice: number;
    /** متبقٍ على فواتير العميل بالأقدمية (لا يشمل الرصيد الافتتاحي) */
    outstanding: number;
    /** أقدم/أحدث حركة **داخل الفترة** (فواتير + سندات + إشعارات) */
    first_movement: string | null;
    last_movement: string | null;
    last_invoice_date: string | null;
    days_since_last_invoice: number | null;
  };
  statement: CustomerStatementResult;
  invoices: CustomerReportInvoice[];
  trips: CustomerReportTrip[];
  services: CustomerReportService[];
  receipts: CustomerReportReceipt[];
  notes: CustomerReportNote[];
  aging: CustomerReportAgingBucket[];
  open_items: { number: number; date: string; total: number; paid: number; remaining: number; age_days: number }[];
}

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * تقرير شامل عن العميل خلال فترة (افتراضياً كل الحركات حتى تاريخ النهاية).
 * يعيد null إن لم يكن العميل موجوداً.
 */
export async function customerFullReport(
  customerId: number,
  dFrom: string,
  dTo: string,
  filters?: StatementFilters
): Promise<CustomerFullReport | null> {
  const id = positiveId(customerId, "العميل");

  const { data: custRow, error: custError } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (custError) throw new RuleError(translateDbError(custError.message));
  if (!custRow) return null;

  const [statement, alloc] = await Promise.all([
    customerStatement(id, dFrom, dTo, filters),
    customerAllocations(id),
  ]);

  // الفواتير حتى نهاية الفترة (تُستخدم للفواتير والتركيبة وأعمار الديون)
  const { data: invRows, error: invError } = await supabase
    .from("invoices")
    .select("id, number, date, vat_rate, notes")
    .eq("customer_id", id)
    .lte("date", dTo)
    .order("date")
    .order("number");
  if (invError) throw new RuleError(translateDbError(invError.message));
  const invoicesRaw = (invRows ?? []) as {
    id: number; number: number; date: string; vat_rate: number; notes: string;
  }[];
  const invIds = invoicesRaw.map((i) => i.id);
  const totalsMap = await invoiceTotalsBatch(invIds);

  // نقلات الفواتير + الخدمات + السيارات والسائقين
  const tripsRaw = invIds.length
    ? ((await supabase
        .from("invoice_trips")
        .select("id, invoice_id, item_id, vehicle_id, driver_id, from_loc, to_loc, qty, unit_price, price, container_numbers, notes")
        .in("invoice_id", invIds)
        .order("id")).data ?? []) as Record<string, any>[]
    : [];

  const itemIds = [...new Set(tripsRaw.map((t) => t.item_id).filter((x): x is number => x != null))];
  const vehicleIds = [...new Set(tripsRaw.map((t) => t.vehicle_id).filter((x): x is number => x != null))];
  const driverIds = [...new Set(tripsRaw.map((t) => t.driver_id).filter((x): x is number => x != null))];

  const [itemsRes, vehRes, empRes, receiptsRes, notesRes, servicesReport] = await Promise.all([
    itemIds.length
      ? supabase.from("items").select("id, name, unit, from_loc, to_loc").in("id", itemIds)
      : Promise.resolve({ data: [] as Record<string, any>[] }),
    vehicleIds.length
      ? supabase.from("vehicles").select("id, plate_number").in("id", vehicleIds)
      : Promise.resolve({ data: [] as Record<string, any>[] }),
    driverIds.length
      ? supabase.from("employees").select("id, name").in("id", driverIds)
      : Promise.resolve({ data: [] as Record<string, any>[] }),
    supabase
      .from("receipt_vouchers")
      .select("id, number, date, amount, description, account_kind, account_id")
      .eq("voucher_type", "customer")
      .eq("customer_id", id)
      .gte("date", dFrom)
      .lte("date", dTo)
      .order("date")
      .order("id"),
    supabase
      .from("credit_debit_notes")
      .select("id, number, note_type, date, amount, vat_rate, reason, invoice_id")
      .eq("customer_id", id)
      .gte("date", dFrom)
      .lte("date", dTo)
      .order("date")
      .order("id"),
    itemsUsageReport(dFrom, dTo, { customerId: id }),
  ]);

  const receiptsRaw = (receiptsRes.data ?? []) as Record<string, any>[];
  const notesRaw = (notesRes.data ?? []) as Record<string, any>[];

  // أسماء حسابات سندات القبض (خزينة/بنك) — المعرّف مشترك بين الجدولين،
  // فيكون المفتاح `النوع:المعرّف` حتى لا يختلط بنك بخزينة له نفس الرقم.
  const receiptCashboxIds = [...new Set(receiptsRaw
    .filter((r) => r.account_kind === "cashbox" && r.account_id != null)
    .map((r) => Number(r.account_id)))];
  const receiptBankIds = [...new Set(receiptsRaw
    .filter((r) => r.account_kind === "bank" && r.account_id != null)
    .map((r) => Number(r.account_id)))];
  const [receiptCashboxes, receiptBanks] = await Promise.all([
    receiptCashboxIds.length
      ? supabase.from("cashboxes").select("id, name").in("id", receiptCashboxIds)
      : Promise.resolve({ data: [] as Record<string, any>[] }),
    receiptBankIds.length
      ? supabase.from("banks").select("id, name").in("id", receiptBankIds)
      : Promise.resolve({ data: [] as Record<string, any>[] }),
  ]);
  const receiptAccountName = new Map<string, string>();
  for (const a of (receiptCashboxes.data ?? []) as { id: number; name: string }[]) {
    receiptAccountName.set(`cashbox:${Number(a.id)}`, String(a.name ?? ""));
  }
  for (const a of (receiptBanks.data ?? []) as { id: number; name: string }[]) {
    receiptAccountName.set(`bank:${Number(a.id)}`, String(a.name ?? ""));
  }

  // مسارات المرتجعات المرتبطة بكل إشعار دائن (credit_note_trips ← invoice_trips)
  const noteTrips = new Map<number, string[]>();
  if (notesRaw.length) {
    const { data: links } = await supabase
      .from("credit_note_trips")
      .select("credit_note_id, trip_id")
      .in("credit_note_id", notesRaw.map((n) => Number(n.id)));
    const linkedTripIds = [...new Set((links ?? []).map((l) => Number(l.trip_id)))];
    if (linkedTripIds.length) {
      const { data: linkedTrips } = await supabase
        .from("invoice_trips")
        .select("id, from_loc, to_loc")
        .in("id", linkedTripIds);
      const routeById = new Map(
        ((linkedTrips ?? []) as { id: number; from_loc: string; to_loc: string }[])
          .map((t) => [Number(t.id), `${t.from_loc || "—"} ← ${t.to_loc || "—"}`])
      );
      for (const link of links ?? []) {
        const route = routeById.get(Number(link.trip_id));
        if (!route) continue;
        const key = Number(link.credit_note_id);
        noteTrips.set(key, [...(noteTrips.get(key) ?? []), route]);
      }
    }
  }

  const itemName = new Map(
    ((itemsRes.data ?? []) as { id: number; name: string; unit: string; from_loc: string; to_loc: string }[])
      .map((i) => [Number(i.id), i])
  );
  const vehicleName = new Map(
    ((vehRes.data ?? []) as { id: number; plate_number: string }[]).map((v) => [Number(v.id), v.plate_number])
  );
  const driverName = new Map(
    ((empRes.data ?? []) as { id: number; name: string }[]).map((e) => [Number(e.id), e.name])
  );
  const invByLocalId = new Map(invoicesRaw.map((i) => [i.id, i]));
  const legsByInvoice = new Map<number, string[]>();
  for (const t of tripsRaw) {
    const legs = legsByInvoice.get(Number(t.invoice_id)) ?? [];
    legs.push(`${t.from_loc || "—"} ← ${t.to_loc || "—"}`);
    legsByInvoice.set(Number(t.invoice_id), legs);
  }
  const tripsCountByInvoice = new Map<number, number>();
  for (const t of tripsRaw) {
    const key = Number(t.invoice_id);
    tripsCountByInvoice.set(key, (tripsCountByInvoice.get(key) ?? 0) + 1);
  }

  const inRange = (date: string) => date >= dFrom && date <= dTo;

  const invoices: CustomerReportInvoice[] = invoicesRaw.map((inv) => {
    const totals = totalsMap.get(inv.id) ?? { trips_total: 0, billable_total: 0, vat_amount: 0, customer_total: 0 };
    const paidInfo = alloc.byInvoice.get(inv.id);
    const total = round2(totals.customer_total);
    const paid = round2(paidInfo?.paid ?? 0);
    const remaining = round2(Math.max(0, total - paid));
    return {
      id: inv.id,
      number: inv.number,
      label: invoiceNumberLabel(inv.number),
      date: inv.date,
      notes: String(inv.notes ?? ""),
      vat_rate: num(inv.vat_rate),
      subtotal: round2(num(totals.trips_total) + num(totals.billable_total)),
      vat_amount: round2(totals.vat_amount),
      total,
      paid,
      remaining,
      status: remaining <= 0.0001 ? "paid" : paid > 0.0001 ? "partial" : "open",
      trips_count: tripsCountByInvoice.get(inv.id) ?? 0,
      legs: legsByInvoice.get(inv.id) ?? [],
      in_range: inRange(inv.date),
    };
  });

  const allTrips: CustomerReportTrip[] = tripsRaw.map((t) => {
    const inv = invByLocalId.get(Number(t.invoice_id));
    const item = t.item_id != null ? itemName.get(Number(t.item_id)) : undefined;
    const containers = Array.isArray(t.container_numbers)
      ? (t.container_numbers as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    return {
      trip_id: Number(t.id),
      invoice_number: num(inv?.number),
      invoice_label: inv ? invoiceNumberLabel(inv.number) : "—",
      date: String(inv?.date ?? ""),
      item_name: item?.name ?? "غير محدد",
      from_loc: String(t.from_loc ?? ""),
      to_loc: String(t.to_loc ?? ""),
      route: `${t.from_loc || "—"} ← ${t.to_loc || "—"}`,
      qty: num(t.qty) || 1,
      unit_price: round2(num(t.unit_price)),
      amount: round2(num(t.price)),
      containers,
      vehicle_name: t.vehicle_id != null ? vehicleName.get(Number(t.vehicle_id)) ?? "" : "",
      driver_name: t.driver_id != null ? driverName.get(Number(t.driver_id)) ?? "" : "",
      notes: String(t.notes ?? ""),
    };
  });

  // تجميع الخدمات لهذا العميل من سطور الاستخدام (نفس مصدر تقارير الخدمات)
  const customerLines = servicesReport.lines.filter((line) => invByLocalId.has(line.invoice_id));
  const servicesMap = new Map<number, CustomerReportService>();
  for (const line of customerLines) {
    const key = line.item_id ?? 0;
    let row = servicesMap.get(key);
    if (!row) {
      const item = itemName.get(line.item_id ?? 0);
      row = {
        item_id: line.item_id,
        name: line.item_name,
        unit: item?.unit ?? "",
        from_loc: String(item?.from_loc ?? ""),
        to_loc: String(item?.to_loc ?? ""),
        trips_count: 0,
        qty_total: 0,
        revenue: 0,
        vat_amount: 0,
        total: 0,
      };
      servicesMap.set(key, row);
    }
    row.trips_count += 1;
    row.qty_total = round2(row.qty_total + line.qty);
    row.revenue = round2(row.revenue + line.amount);
    row.vat_amount = round2(row.vat_amount + line.vat_amount);
    row.total = round2(row.total + line.total);
  }
  const services = [...servicesMap.values()].sort((a, b) => b.revenue - a.revenue);

  const receipts: CustomerReportReceipt[] = receiptsRaw.map((r) => {
    const parts = alloc.byReceipt.get(Number(r.id)) ?? [];
    const kind = r.account_kind === "cashbox" ? "خزينة" : r.account_kind === "bank" ? "بنك" : "";
    const name = r.account_kind && r.account_id != null
      ? receiptAccountName.get(`${r.account_kind}:${Number(r.account_id)}`) ?? ""
      : "";
    return {
      id: Number(r.id),
      label: voucherNumberLabel("RV", num(r.number)),
      date: String(r.date),
      amount: round2(num(r.amount)),
      description: String(r.description ?? ""),
      allocations: parts.length
        ? parts.map((p) => `${invoiceNumberLabel(p.number)} (${p.amount.toFixed(2)})`).join("، ")
        : "دفعة تحت الحساب",
      account_name: kind ? (name ? `${kind}: ${name}` : kind) : "",
    };
  });

  const notes: CustomerReportNote[] = notesRaw.map((n) => {
    const amount = round2(num(n.amount));
    const vat = round2((amount * num(n.vat_rate)) / 100);
    return {
      id: Number(n.id),
      label: voucherNumberLabel(n.note_type === "debit" ? "DN" : "CN", num(n.number)),
      type: n.note_type === "debit" ? "debit" : "credit",
      date: String(n.date),
      amount,
      vat_amount: vat,
      total: round2(amount + vat),
      reason: String(n.reason ?? ""),
      invoice_number: n.invoice_id ? invByLocalId.get(Number(n.invoice_id))?.number ?? null : null,
      trips: noteTrips.get(Number(n.id)) ?? [],
    };
  });

  // تركيبة الرصيد المستحق وأعمار الديون (بالأقدمية)
  const openItems = [...alloc.byInvoice.entries()]
    .filter(([invoiceId, info]) => info.remaining > 0.0001 && invByLocalId.has(invoiceId))
    .map(([invoiceId, info]) => ({
      number: info.number,
      date: info.date,
      total: round2(info.total),
      paid: round2(info.paid),
      remaining: round2(info.remaining),
      age_days: daysBetween(info.date, dTo),
    }))
    .sort((a, b) => (a.date === b.date ? a.number - b.number : a.date < b.date ? -1 : 1));

  const buckets: CustomerReportAgingBucket[] = [
    { bucket: "حتى 30 يوم", count: 0, amount: 0 },
    { bucket: "31 – 60 يوم", count: 0, amount: 0 },
    { bucket: "61 – 90 يوم", count: 0, amount: 0 },
    { bucket: "أكثر من 90 يوم", count: 0, amount: 0 },
  ];
  for (const item of openItems) {
    const idx = item.age_days <= 30 ? 0 : item.age_days <= 60 ? 1 : item.age_days <= 90 ? 2 : 3;
    buckets[idx].count += 1;
    buckets[idx].amount = round2(buckets[idx].amount + item.remaining);
  }

  // حركات الفترة فقط (فاتورة داخل الفترة + سند + إشعار) — أما open_items/aging
  // فتبقى على أساس كل الفواتير حتى نهاية الفترة لأنها تركيبة الرصيد المستحق.
  const allDates = [
    ...invoices.filter((i) => i.in_range).map((i) => i.date),
    ...receipts.map((r) => r.date),
    ...notes.map((n) => n.date),
  ].filter(Boolean).sort();
  const lastInvoice = invoicesRaw.length ? invoicesRaw[invoicesRaw.length - 1] : null;
  const outstanding = round2(openItems.reduce((a, i) => a + i.remaining, 0));
  const inRangeInvoices = invoices.filter((i) => i.in_range);

  return {
    customer: custRow as Customer,
    from: dFrom,
    to: dTo,
    generated_at: new Date().toISOString(),
    summary: {
      opening: statement.opening,
      invoiced: statement.invoiced,
      collected: statement.collected,
      notes_debit: statement.notes_debit,
      notes_credit: statement.notes_credit,
      closing: statement.closing,
      invoices_count: inRangeInvoices.length,
      receipts_count: receipts.length,
      notes_count: notes.length,
      trips_count: allTrips.filter((t) => inRange(t.date)).length,
      qty_total: round2(allTrips.filter((t) => inRange(t.date)).reduce((a, t) => a + t.qty, 0)),
      services_count: services.filter((s) => s.trips_count > 0).length,
      avg_invoice: inRangeInvoices.length
        ? round2(inRangeInvoices.reduce((a, i) => a + i.total, 0) / inRangeInvoices.length)
        : 0,
      outstanding,
      first_movement: allDates.length ? allDates[0] : null,
      last_movement: allDates.length ? allDates[allDates.length - 1] : null,
      last_invoice_date: lastInvoice?.date ?? null,
      days_since_last_invoice: lastInvoice ? daysBetween(lastInvoice.date, dTo) : null,
    },
    statement,
    invoices,
    trips: allTrips,
    services,
    receipts,
    notes,
    aging: buckets,
    open_items: openItems,
  };
}

/** الرصيد اللحظي الكامل للعميل (يشمل كل الحركات بلا قيود تاريخ). */
export async function customerBalanceNow(customerId: number): Promise<number> {
  return customerBalance(customerId);
}

/** وصف مالي مختصر لجانب الرصيد. */
export function balanceSideLabel(balance: number): string {
  if (balance > 0.0001) return "مستحق على العميل";
  if (balance < -0.0001) return "مستحق للعميل";
  return "لا توجد مديونية";
}
