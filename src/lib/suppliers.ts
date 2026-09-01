// دورة الموردين الكاملة: مورّد ← فاتورة مشتريات بالضريبة ← سند دفع ← رصيد وكشف حساب وأعمار ديون.
// كل الاستعلامات معزولة تلقائياً بـ company_id عبر RLS.

import { supabase } from "./supabase";
import { RuleError, roundMoney } from "./rules";
import { normalizeTaxProfile, validateTaxProfile } from "./tax";

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

export interface PurchaseInvoice {
  id: number;
  number: number;
  date: string;
  supplier_id: number;
  supplier_ref: string;
  vat_rate: number;
  vat_included: boolean;
  notes: string;
  items?: PurchaseItem[];
  supplier_name?: string;
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
  if (error) throw new RuleError(error.message);
  return (data ?? []) as Supplier[];
}

export async function getSupplier(id: number): Promise<Supplier | null> {
  const { data } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle();
  return (data as Supplier) ?? null;
}

export async function saveSupplier(
  input: Record<string, unknown>,
  supplierId?: number | null
): Promise<number> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new RuleError("اسم المورّد مطلوب.");

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

  const row = {
    ...profile,
    name,
    name_en: String(input.name_en ?? "").trim(),
    phone: String(input.phone ?? "").trim(),
    email: String(input.email ?? "").trim(),
    contact_person: String(input.contact_person ?? "").trim(),
    address: String(input.address ?? "").trim(),
    notes: String(input.notes ?? "").trim(),
    opening_balance: roundMoney(Number(input.opening_balance ?? 0) || 0),
    payment_terms: Math.max(0, Math.trunc(Number(input.payment_terms ?? 0) || 0)),
  };

  if (supplierId) {
    const { error } = await supabase.from("suppliers").update(row).eq("id", supplierId);
    if (error) throw new RuleError(error.message);
    return supplierId;
  }

  const { data, error } = await supabase.from("suppliers").insert(row).select("id").single();
  if (error) throw new RuleError(error.message);
  const id = Number(data.id);
  await supabase.from("suppliers").update({ code: `SUPP-${String(id).padStart(4, "0")}` }).eq("id", id);
  return id;
}

export async function deleteSupplier(id: number): Promise<void> {
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) throw new RuleError(error.message);
}

// ---------------------------------------------------------------------------
// فواتير المشتريات
// ---------------------------------------------------------------------------
export async function listPurchaseInvoices(): Promise<(PurchaseInvoice & PurchaseTotals)[]> {
  const { data, error } = await supabase
    .from("purchase_invoices")
    .select("*, suppliers(name), purchase_items(*)")
    .order("date", { ascending: false })
    .order("number", { ascending: false });
  if (error) throw new RuleError(error.message);

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const sup = r.suppliers as { name?: string } | { name?: string }[] | null;
    const items = ((r.purchase_items ?? []) as PurchaseItem[]) ?? [];
    const t = purchaseTotals(items, Boolean(r.vat_included));
    return {
      id: Number(r.id),
      number: Number(r.number),
      date: String(r.date),
      supplier_id: Number(r.supplier_id),
      supplier_ref: String(r.supplier_ref ?? ""),
      vat_rate: Number(r.vat_rate ?? 15),
      vat_included: Boolean(r.vat_included),
      notes: String(r.notes ?? ""),
      items,
      supplier_name: (Array.isArray(sup) ? sup[0]?.name : sup?.name) ?? "",
      ...t,
    };
  });
}

export async function getPurchaseInvoice(id: number): Promise<PurchaseInvoice | null> {
  const { data } = await supabase
    .from("purchase_invoices")
    .select("*, purchase_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: Number(r.id),
    number: Number(r.number),
    date: String(r.date),
    supplier_id: Number(r.supplier_id),
    supplier_ref: String(r.supplier_ref ?? ""),
    vat_rate: Number(r.vat_rate ?? 15),
    vat_included: Boolean(r.vat_included),
    notes: String(r.notes ?? ""),
    items: (r.purchase_items ?? []) as PurchaseItem[],
  };
}

export async function savePurchaseInvoice(input: {
  id?: number | null;
  date: string;
  supplier_id: number;
  supplier_ref?: string;
  vat_rate?: number;
  vat_included?: boolean;
  notes?: string;
  items: PurchaseItem[];
}): Promise<number> {
  if (!input.supplier_id) throw new RuleError("اختر المورّد.");
  if (!input.items?.length) throw new RuleError("أضف بنداً واحداً على الأقل للفاتورة.");
  for (const it of input.items) {
    if (!String(it.item_name ?? "").trim()) throw new RuleError("اسم الصنف مطلوب في كل بند.");
    if ((Number(it.qty) || 0) <= 0) throw new RuleError("الكمية يجب أن تكون أكبر من صفر.");
    if ((Number(it.unit_price) || 0) < 0) throw new RuleError("سعر الوحدة لا يمكن أن يكون سالباً.");
  }

  const { data, error } = await supabase.rpc("save_purchase_invoice", {
    p_invoice_id: input.id ?? null,
    p_date: input.date,
    p_supplier_id: input.supplier_id,
    p_supplier_ref: input.supplier_ref ?? "",
    p_vat_rate: input.vat_rate ?? 15,
    p_vat_included: input.vat_included ?? false,
    p_notes: input.notes ?? "",
    p_items: input.items.map((it) => ({
      item_name: it.item_name,
      unit: it.unit ?? "",
      qty: Number(it.qty) || 0,
      unit_price: Number(it.unit_price) || 0,
      vat_rate: Number(it.vat_rate ?? input.vat_rate ?? 15),
      notes: it.notes ?? "",
    })),
  });
  if (error) throw new RuleError(error.message);
  return Number(data);
}

export async function deletePurchaseInvoice(id: number): Promise<void> {
  const { count } = await supabase
    .from("payment_vouchers")
    .select("id", { count: "exact", head: true })
    .eq("purchase_invoice_id", id);
  if ((count ?? 0) > 0) {
    throw new RuleError("لا يمكن حذف الفاتورة لوجود سندات دفع مرتبطة بها.");
  }
  const { error } = await supabase.from("purchase_invoices").delete().eq("id", id);
  if (error) throw new RuleError(error.message);
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

export async function suppliersWithBalance(): Promise<(Supplier & { balance: number })[]> {
  const rows = await listSuppliers();
  const out: (Supplier & { balance: number })[] = [];
  for (const r of rows) out.push({ ...r, balance: await supplierBalance(r.id) });
  return out;
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
export async function suppliersAging(asOf: Date = new Date()): Promise<AgingBucketRow[]> {
  const sups = await listSuppliers();
  const out: AgingBucketRow[] = [];

  for (const s of sups) {
    const { data: invs } = await supabase
      .from("purchase_invoices")
      .select("date, vat_included, purchase_items(qty, unit_price, vat_rate)")
      .eq("supplier_id", s.id);

    const invoices = ((invs ?? []) as Record<string, unknown>[]).map((row) => ({
      date: String(row.date),
      total: purchaseTotals((row.purchase_items ?? []) as PurchaseItem[], Boolean(row.vat_included)).total,
    }));

    const { data: pays } = await supabase
      .from("payment_vouchers")
      .select("amount")
      .eq("supplier_id", s.id);
    const paid = (pays ?? []).reduce((a, r) => a + (Number((r as { amount: number }).amount) || 0), 0);

    const opening = Number(s.opening_balance) || 0;
    if (opening > 0) invoices.unshift({ date: s.created_at?.slice(0, 10) ?? "2000-01-01", total: opening });

    const b = buildAging(invoices, paid, asOf);
    if (b.total !== 0) out.push({ id: s.id, name: s.name, ...b });
  }

  return out.sort((a, b) => b.total - a.total);
}
