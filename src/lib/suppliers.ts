// دورة الموردين الكاملة: مورّد ← فاتورة مشتريات بالضريبة ← سند دفع ← رصيد وكشف حساب وأعمار ديون.
// كل الاستعلامات معزولة تلقائياً بـ company_id عبر RLS.

import { supabase } from "./supabase";
import { translateDbError } from "./db";
import { RuleError, boundedNumber, ensureDateInOpenYear, positiveId, roundMoney, txt } from "./rules";
import { normalizeTaxProfile, validateTaxProfile } from "./tax";
import { isPlausibleIdentityText, safeEmail, safeIsoDate, safePhone } from "./security";
import { PURCHASE_EXPENSE_CATEGORIES } from "./format";

export interface Supplier {
  id: number;
  code: string;
  name: string;
  name_en: string;
  phone: string;
  email: string;
  contact_person: string;
  address: string;
  opening_balance: number;
  notes: string;
  tax_number: string;
  commercial_reg: string;
  entity_type: string;
  tax_status: string;
  country: string;
  region: string;
  city: string;
  district: string;
  street: string;
  building_no: string;
  postal_code: string;
  additional_no: string;
  payment_terms: number;
  created_at?: string;
}

export interface PurchaseItem {
  id?: number;
  item_name: string;
  unit: string;
  qty: number;
  unit_price: number;
  vat_rate: number;
  notes?: string;
}

export type PurchaseType = "credit" | "cash";

export interface PurchaseInvoice {
  id: number;
  number: number;
  date: string;
  purchase_type: PurchaseType;
  supplier_id: number | null;
  supplier_ref: string;
  expense_category: string;
  vehicle_id: number | null;
  account_kind: "cashbox" | "bank" | null;
  account_id: number | null;
  vat_rate: number;
  vat_included: boolean;
  notes: string;
  items?: PurchaseItem[];
  supplier_name?: string;
  vehicle_plate?: string;
  account_name?: string;
  payment_voucher_id?: number | null;
}

export interface PurchaseTotals {
  /** الإجمالي قبل الضريبة */
  net: number;
  /** قيمة ضريبة القيمة المضافة */
  vat: number;
  /** الإجمالي شامل الضريبة */
  total: number;
}

// ---------------------------------------------------------------------------
// حسابات الفاتورة
// ---------------------------------------------------------------------------

/**
 * إجماليات فاتورة المشتريات.
 * إن كانت الأسعار شاملة الضريبة يُستخرج الصافي بالقسمة على (1 + النسبة).
 */
export function purchaseTotals(items: PurchaseItem[], vatIncluded = false): PurchaseTotals {
  let net = 0;
  let vat = 0;
  for (const it of items) {
    const gross = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
    const rate = (Number(it.vat_rate) || 0) / 100;
    if (vatIncluded) {
      const base = rate > -1 ? gross / (1 + rate) : gross;
      net += base;
      vat += gross - base;
    } else {
      net += gross;
      vat += gross * rate;
    }
  }
  net = roundMoney(net);
  vat = roundMoney(vat);
  return { net, vat, total: roundMoney(net + vat) };
}

// ---------------------------------------------------------------------------
// الموردون
// ---------------------------------------------------------------------------
export async function listSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase.from("suppliers").select("*").order("code");
  if (error) throw new RuleError(translateDbError(error.message));
  return (data ?? []) as Supplier[];
}

export async function getSupplier(id: number): Promise<Supplier | null> {
  const { data } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle();
  return (data as Supplier) ?? null;
}

async function ensureUniqueSupplierContact(phone: string, email: string, supplierId?: number | null): Promise<void> {
  if (phone) {
    const { data, error } = await supabase.from("suppliers").select("id").eq("phone", phone).neq("id", supplierId ?? -1);
    if (error) throw new RuleError(translateDbError(error.message));
    if (data?.length) throw new RuleError("رقم الهاتف مسجل لمورّد آخر.");
  }
  if (email) {
    const { data, error } = await supabase.from("suppliers").select("id").eq("email", email).neq("id", supplierId ?? -1);
    if (error) throw new RuleError(translateDbError(error.message));
    if (data?.length) throw new RuleError("البريد الإلكتروني مسجل لمورّد آخر.");
  }
}

export async function saveSupplier(
  input: Record<string, unknown>,
  supplierId?: number | null
): Promise<number> {
  const existingId = supplierId == null ? null : positiveId(supplierId, "معرّف المورّد");
  const name = txt(input.name, "اسم المورّد", 160);
  if (!isPlausibleIdentityText(name)) throw new RuleError("أدخل اسماً حقيقياً للمورّد، وليس قيمة تجريبية أو وهمية.");

  const profile = normalizeTaxProfile({
    tax_number: String(input.tax_number ?? ""),
    commercial_reg: String(input.commercial_reg ?? ""),
    entity_type: String(input.entity_type ?? "company"),
    tax_status: String(input.tax_status ?? "taxable"),
    country: String(input.country ?? "SA"),
    region: String(input.region ?? ""),
    city: String(input.city ?? ""),
    district: String(input.district ?? ""),
    street: String(input.street ?? ""),
    building_no: String(input.building_no ?? ""),
    postal_code: String(input.postal_code ?? ""),
    additional_no: String(input.additional_no ?? ""),
  });
  const problems = validateTaxProfile(profile);
  if (problems.length) throw new RuleError(problems[0]);

  const phone = safePhone(input.phone ?? "", false);
  const email = safeEmail(input.email ?? "", false);
  const contactPerson = txt(input.contact_person ?? "", "مسؤول التواصل", 120);
  if (contactPerson && !isPlausibleIdentityText(contactPerson)) throw new RuleError("اسم مسؤول التواصل غير صحيح أو وهمي.");
  const address = txt(input.address ?? "", "عنوان المورّد", 300);
  if (address && !isPlausibleIdentityText(address)) throw new RuleError("عنوان المورّد غير صحيح أو وهمي.");
  const row = {
    ...profile,
    name,
    name_en: txt(input.name_en ?? "", "اسم المورّد بالإنجليزية", 160),
    phone,
    email,
    contact_person: contactPerson,
    address,
    notes: txt(input.notes ?? "", "ملاحظات المورّد", 2000),
    opening_balance: roundMoney(input.opening_balance ?? 0),
    payment_terms: boundedNumber(input.payment_terms ?? 0, "مهلة السداد", 0, 3650, true),
  };
  await ensureUniqueSupplierContact(phone, email, existingId);

  if (existingId) {
    const { error } = await supabase.from("suppliers").update(row).eq("id", existingId);
    if (error) throw new RuleError(translateDbError(error.message));
    return existingId;
  }

  const { data, error } = await supabase.from("suppliers").insert(row).select("id").single();
  if (error) throw new RuleError(translateDbError(error.message));
  const id = Number(data.id);
  await supabase.from("suppliers").update({ code: `SUPP-${String(id).padStart(4, "0")}` }).eq("id", id);
  return id;
}

export async function deleteSupplier(id: number): Promise<void> {
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) throw new RuleError(translateDbError(error.message));
}

// ---------------------------------------------------------------------------
// فواتير المشتريات
// ---------------------------------------------------------------------------
export async function listPurchaseInvoices(): Promise<(PurchaseInvoice & PurchaseTotals)[]> {
  const [invoiceRes, vehicleRes, cashboxRes, bankRes, paymentRes] = await Promise.all([
    supabase
      .from("purchase_invoices")
      .select("*, suppliers(name), purchase_items(*)")
      .order("date", { ascending: false })
      .order("number", { ascending: false }),
    supabase.from("vehicles").select("id, plate_number"),
    supabase.from("cashboxes").select("id, name"),
    supabase.from("banks").select("id, name"),
    supabase.from("payment_vouchers").select("id, purchase_invoice_id").eq("voucher_type", "purchase"),
  ]);
  if (invoiceRes.error) throw new RuleError(translateDbError(invoiceRes.error.message));

  const vehicleMap = new Map((vehicleRes.data ?? []).map((v) => [Number(v.id), String(v.plate_number)]));
  const cashboxMap = new Map((cashboxRes.data ?? []).map((a) => [Number(a.id), String(a.name)]));
  const bankMap = new Map((bankRes.data ?? []).map((a) => [Number(a.id), String(a.name)]));
  const paymentMap = new Map((paymentRes.data ?? []).map((p) => [Number(p.purchase_invoice_id), Number(p.id)]));

  return (invoiceRes.data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const sup = r.suppliers as { name?: string } | { name?: string }[] | null;
    const items = ((r.purchase_items ?? []) as PurchaseItem[]) ?? [];
    const t = purchaseTotals(items, Boolean(r.vat_included));
    const purchaseType: PurchaseType = r.purchase_type === "cash" ? "cash" : "credit";
    const vehicleId = r.vehicle_id == null ? null : Number(r.vehicle_id);
    const accountId = r.account_id == null ? null : Number(r.account_id);
    const accountKind = r.account_kind === "cashbox" || r.account_kind === "bank" ? r.account_kind : null;
    return {
      id: Number(r.id),
      number: Number(r.number),
      date: String(r.date),
      purchase_type: purchaseType,
      supplier_id: r.supplier_id == null ? null : Number(r.supplier_id),
      supplier_ref: String(r.supplier_ref ?? ""),
      expense_category: String(r.expense_category ?? "other"),
      vehicle_id: vehicleId,
      account_kind: accountKind,
      account_id: accountId,
      vat_rate: Number(r.vat_rate ?? 15),
      vat_included: Boolean(r.vat_included),
      notes: String(r.notes ?? ""),
      items,
      supplier_name: purchaseType === "cash" ? "شراء نقدي مباشر" : ((Array.isArray(sup) ? sup[0]?.name : sup?.name) ?? ""),
      vehicle_plate: vehicleId ? vehicleMap.get(vehicleId) ?? "" : "",
      account_name: accountId && accountKind ? (accountKind === "cashbox" ? cashboxMap.get(accountId) : bankMap.get(accountId)) ?? "" : "",
      payment_voucher_id: paymentMap.get(Number(r.id)) ?? null,
      ...t,
    };
  });
}

export async function getPurchaseInvoice(id: number): Promise<PurchaseInvoice | null> {
  const invoiceId = positiveId(id, "معرّف فاتورة المشتريات");
  const [{ data }, { data: payment }] = await Promise.all([
    supabase.from("purchase_invoices").select("*, purchase_items(*)").eq("id", invoiceId).maybeSingle(),
    supabase.from("payment_vouchers").select("id").eq("purchase_invoice_id", invoiceId).eq("voucher_type", "purchase").maybeSingle(),
  ]);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: Number(r.id),
    number: Number(r.number),
    date: String(r.date),
    purchase_type: r.purchase_type === "cash" ? "cash" : "credit",
    supplier_id: r.supplier_id == null ? null : Number(r.supplier_id),
    supplier_ref: String(r.supplier_ref ?? ""),
    expense_category: String(r.expense_category ?? "other"),
    vehicle_id: r.vehicle_id == null ? null : Number(r.vehicle_id),
    account_kind: r.account_kind === "cashbox" || r.account_kind === "bank" ? r.account_kind : null,
    account_id: r.account_id == null ? null : Number(r.account_id),
    vat_rate: Number(r.vat_rate ?? 15),
    vat_included: Boolean(r.vat_included),
    notes: String(r.notes ?? ""),
    items: (r.purchase_items ?? []) as PurchaseItem[],
    payment_voucher_id: payment ? Number(payment.id) : null,
  };
}

export async function savePurchaseInvoice(input: {
  id?: number | null;
  date: string;
  purchase_type: PurchaseType;
  supplier_id?: number | null;
  supplier_ref?: string;
  expense_category: string;
  vehicle_id?: number | null;
  account_kind?: "cashbox" | "bank" | null;
  account_id?: number | null;
  vat_rate?: number;
  vat_included?: boolean;
  notes?: string;
  items: PurchaseItem[];
}): Promise<number> {
  const invoiceId = input.id == null ? null : positiveId(input.id, "معرّف فاتورة المشتريات");
  const date = safeIsoDate(input.date, "تاريخ فاتورة المشتريات");
  const purchaseType: PurchaseType = input.purchase_type === "cash" ? "cash" : input.purchase_type === "credit" ? "credit" : (() => { throw new RuleError("اختر نوع فاتورة المشتريات."); })();
  if (!(input.expense_category in PURCHASE_EXPENSE_CATEGORIES)) throw new RuleError("اختر بند المصروف في الأرباح والخسائر.");
  const supplierId = purchaseType === "credit" ? positiveId(input.supplier_id, "المورّد") : null;
  const vehicleId = input.vehicle_id == null ? null : positiveId(input.vehicle_id, "السيارة");
  let accountKind: "cashbox" | "bank" | null = null;
  let accountId: number | null = null;
  if (purchaseType === "cash") {
    if (input.account_kind !== "cashbox" && input.account_kind !== "bank") throw new RuleError("اختر الخزينة أو البنك للدفع المباشر.");
    accountKind = input.account_kind;
    accountId = positiveId(input.account_id, "جهة الدفع");
  }
  if (!Array.isArray(input.items) || !input.items.length) throw new RuleError("أضف بنداً واحداً على الأقل للفاتورة.");
  if (input.items.length > 1000) throw new RuleError("عدد بنود فاتورة المشتريات أكبر من الحد المسموح.");
  if (input.vat_included != null && typeof input.vat_included !== "boolean") throw new RuleError("حالة شمول الضريبة غير صالحة.");
  const defaultVat = boundedNumber(input.vat_rate ?? 15, "نسبة الضريبة", 0, 100);
  const items = input.items.map((it) => {
    const itemName = txt(it.item_name, "اسم الصنف", 160);
    if (!itemName) throw new RuleError("اسم الصنف مطلوب في كل بند.");
    const qty = boundedNumber(it.qty, "الكمية", 0.001, 1_000_000);
    const unitPrice = roundMoney(it.unit_price);
    if (unitPrice < 0) throw new RuleError("سعر الوحدة لا يمكن أن يكون سالباً.");
    return {
      item_name: itemName,
      unit: txt(it.unit ?? "", "الوحدة", 30),
      qty,
      unit_price: unitPrice,
      vat_rate: boundedNumber(it.vat_rate ?? defaultVat, "نسبة ضريبة البند", 0, 100),
      notes: txt(it.notes ?? "", "ملاحظات البند", 500),
    };
  });
  const totals = purchaseTotals(items, input.vat_included ?? false);
  if (totals.total <= 0) throw new RuleError("إجمالي فاتورة المشتريات يجب أن يكون أكبر من صفر.");
  await ensureDateInOpenYear(date);

  const { data, error } = await supabase.rpc("save_purchase_invoice_v14", {
    p_invoice_id: invoiceId,
    p_date: date,
    p_purchase_type: purchaseType,
    p_supplier_id: supplierId,
    p_supplier_ref: txt(input.supplier_ref ?? "", "مرجع المورّد", 80),
    p_expense_category: input.expense_category,
    p_vehicle_id: vehicleId,
    p_account_kind: accountKind,
    p_account_id: accountId,
    p_vat_rate: defaultVat,
    p_vat_included: input.vat_included ?? false,
    p_notes: txt(input.notes ?? "", "ملاحظات فاتورة المشتريات", 1000),
    p_items: items,
  });
  if (error) throw new RuleError(translateDbError(error.message));
  return Number(data);
}

export async function deletePurchaseInvoice(id: number): Promise<void> {
  const invoiceId = positiveId(id, "معرّف فاتورة المشتريات");
  const { error } = await supabase.rpc("delete_purchase_invoice_v14", { p_invoice_id: invoiceId });
  if (error) throw new RuleError(translateDbError(error.message));
}

// ---------------------------------------------------------------------------
// الرصيد وكشف الحساب
// ---------------------------------------------------------------------------

/** رصيد المورّد: موجب = مستحق له علينا، سالب = دفعنا زيادة. */
export async function supplierBalance(supplierId: number, before?: string | null): Promise<number> {
  const sup = await getSupplier(supplierId);
  if (!sup) return 0;

  let invQ = supabase
    .from("purchase_invoices")
    .select("vat_included, purchase_items(qty, unit_price, vat_rate)")
    .eq("supplier_id", supplierId);
  if (before) invQ = invQ.lt("date", before);
  const { data: invs } = await invQ;

  let purchases = 0;
  for (const row of (invs ?? []) as Record<string, unknown>[]) {
    const items = (row.purchase_items ?? []) as PurchaseItem[];
    purchases += purchaseTotals(items, Boolean(row.vat_included)).total;
  }

  let payQ = supabase.from("payment_vouchers").select("amount").eq("supplier_id", supplierId);
  if (before) payQ = payQ.lt("date", before);
  const { data: pays } = await payQ;
  const paid = (pays ?? []).reduce((a, r) => a + (Number((r as { amount: number }).amount) || 0), 0);

  return roundMoney((Number(sup.opening_balance) || 0) + purchases - paid);
}

/** أرصدة كل الموردين بثلاثة استعلامات مجمّعة بدل استعلامين لكل مورّد. */
export async function suppliersWithBalance(): Promise<(Supplier & { balance: number })[]> {
  const [rows, invRes, payRes] = await Promise.all([
    listSuppliers(),
    supabase.from("purchase_invoices").select("supplier_id, vat_included, purchase_items(qty, unit_price, vat_rate)"),
    supabase.from("payment_vouchers").select("supplier_id, amount"),
  ]);

  const purchasesBySupplier = new Map<number, number>();
  for (const row of (invRes.data ?? []) as Record<string, unknown>[]) {
    const sid = Number(row.supplier_id);
    const t = purchaseTotals((row.purchase_items ?? []) as PurchaseItem[], Boolean(row.vat_included));
    purchasesBySupplier.set(sid, (purchasesBySupplier.get(sid) ?? 0) + t.total);
  }

  const paidBySupplier = new Map<number, number>();
  for (const row of (payRes.data ?? []) as Record<string, unknown>[]) {
    const sid = Number(row.supplier_id);
    if (!sid) continue;
    paidBySupplier.set(sid, (paidBySupplier.get(sid) ?? 0) + (Number(row.amount) || 0));
  }

  return rows.map((r) => ({
    ...r,
    balance: roundMoney((Number(r.opening_balance) || 0) + (purchasesBySupplier.get(r.id) ?? 0) - (paidBySupplier.get(r.id) ?? 0)),
  }));
}

export interface SupplierStatementRow {
  date: string;
  doc: string;
  desc: string;
  /** له (زيادة الالتزام: فاتورة مشتريات) */
  credit: number;
  /** عليه (سداد) */
  debit: number;
  balance: number;
  kind: "opening" | "purchase" | "payment";
}

/** كشف حساب مورّد بين تاريخين مع رصيد افتتاحي مرحّل. */
export async function supplierStatement(
  supplierId: number,
  from?: string | null,
  to?: string | null
): Promise<{ rows: SupplierStatementRow[]; totals: { credit: number; debit: number; balance: number } }> {
  const sup = await getSupplier(supplierId);
  if (!sup) return { rows: [], totals: { credit: 0, debit: 0, balance: 0 } };

  const opening = from ? await supplierBalance(supplierId, from) : Number(sup.opening_balance) || 0;

  let invQ = supabase
    .from("purchase_invoices")
    .select("id, number, date, supplier_ref, vat_included, purchase_items(qty, unit_price, vat_rate)")
    .eq("supplier_id", supplierId);
  if (from) invQ = invQ.gte("date", from);
  if (to) invQ = invQ.lte("date", to);
  const { data: invs } = await invQ;

  let payQ = supabase
    .from("payment_vouchers")
    .select("id, number, date, amount, description")
    .eq("supplier_id", supplierId);
  if (from) payQ = payQ.gte("date", from);
  if (to) payQ = payQ.lte("date", to);
  const { data: pays } = await payQ;

  const events: SupplierStatementRow[] = [];

  for (const row of (invs ?? []) as Record<string, unknown>[]) {
    const items = (row.purchase_items ?? []) as PurchaseItem[];
    const t = purchaseTotals(items, Boolean(row.vat_included));
    events.push({
      date: String(row.date),
      doc: `مشتريات #${row.number}`,
      desc: row.supplier_ref ? `مرجع المورّد: ${row.supplier_ref}` : "فاتورة مشتريات",
      credit: t.total,
      debit: 0,
      balance: 0,
      kind: "purchase",
    });
  }

  for (const row of (pays ?? []) as Record<string, unknown>[]) {
    events.push({
      date: String(row.date),
      doc: `سند دفع #${row.number}`,
      desc: String(row.description ?? "سداد للمورّد"),
      credit: 0,
      debit: Number(row.amount) || 0,
      balance: 0,
      kind: "payment",
    });
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let running = roundMoney(opening);
  const rows: SupplierStatementRow[] = [
    {
      date: from ?? "",
      doc: "رصيد افتتاحي",
      desc: from ? "المرحّل حتى بداية الفترة" : "الرصيد الافتتاحي للمورّد",
      credit: 0,
      debit: 0,
      balance: running,
      kind: "opening",
    },
  ];

  let credit = 0;
  let debit = 0;
  for (const e of events) {
    running = roundMoney(running + e.credit - e.debit);
    credit += e.credit;
    debit += e.debit;
    rows.push({ ...e, balance: running });
  }

  return {
    rows,
    totals: { credit: roundMoney(credit), debit: roundMoney(debit), balance: running },
  };
}

// ---------------------------------------------------------------------------
// أعمار الديون
// ---------------------------------------------------------------------------
export interface AgingBucketRow {
  id: number;
  name: string;
  current: number;   // 0–30
  d31_60: number;
  d61_90: number;
  over90: number;
  total: number;
}

const DAY = 86400000;

/** توزيع المستحقات على شرائح عمرية بناءً على تاريخ كل فاتورة (FIFO للسداد). */
export function buildAging(
  invoices: { date: string; total: number }[],
  paid: number,
  asOf: Date = new Date()
): Omit<AgingBucketRow, "id" | "name"> {
  const sorted = [...invoices].sort((a, b) => (a.date < b.date ? -1 : 1));
  let remaining = paid;
  const buckets = { current: 0, d31_60: 0, d61_90: 0, over90: 0 };

  for (const inv of sorted) {
    let due = inv.total;
    if (remaining > 0) {
      const used = Math.min(remaining, due);
      due -= used;
      remaining -= used;
    }
    if (due <= 0) continue;
    const age = Math.floor((asOf.getTime() - new Date(inv.date).getTime()) / DAY);
    if (age <= 30) buckets.current += due;
    else if (age <= 60) buckets.d31_60 += due;
    else if (age <= 90) buckets.d61_90 += due;
    else buckets.over90 += due;
  }

  const total = buckets.current + buckets.d31_60 + buckets.d61_90 + buckets.over90;
  return {
    current: roundMoney(buckets.current),
    d31_60: roundMoney(buckets.d31_60),
    d61_90: roundMoney(buckets.d61_90),
    over90: roundMoney(buckets.over90),
    total: roundMoney(total),
  };
}

/** تقرير أعمار ديون الموردين (ما علينا لهم). */
/** أعمار ديون كل الموردين بثلاثة استعلامات مجمّعة. */
export async function suppliersAging(asOf: Date = new Date()): Promise<AgingBucketRow[]> {
  const [sups, invRes, payRes] = await Promise.all([
    listSuppliers(),
    supabase.from("purchase_invoices").select("supplier_id, date, vat_included, purchase_items(qty, unit_price, vat_rate)"),
    supabase.from("payment_vouchers").select("supplier_id, amount"),
  ]);

  const invBySupplier = new Map<number, { date: string; total: number }[]>();
  for (const row of (invRes.data ?? []) as Record<string, unknown>[]) {
    const sid = Number(row.supplier_id);
    const list = invBySupplier.get(sid) ?? [];
    list.push({
      date: String(row.date),
      total: purchaseTotals((row.purchase_items ?? []) as PurchaseItem[], Boolean(row.vat_included)).total,
    });
    invBySupplier.set(sid, list);
  }

  const paidBySupplier = new Map<number, number>();
  for (const row of (payRes.data ?? []) as Record<string, unknown>[]) {
    const sid = Number(row.supplier_id);
    if (!sid) continue;
    paidBySupplier.set(sid, (paidBySupplier.get(sid) ?? 0) + (Number(row.amount) || 0));
  }

  const out: AgingBucketRow[] = [];
  for (const s of sups) {
    const invoices = [...(invBySupplier.get(s.id) ?? [])];
    const opening = Number(s.opening_balance) || 0;
    if (opening > 0) invoices.unshift({ date: s.created_at?.slice(0, 10) ?? "2000-01-01", total: opening });
    const b = buildAging(invoices, paidBySupplier.get(s.id) ?? 0, asOf);
    if (b.total !== 0) out.push({ id: s.id, name: s.name, ...b });
  }

  return out.sort((a, b) => b.total - a.total);
}
