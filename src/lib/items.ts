// دورة الأصناف والخدمات (v26).
//
//   • «الخدمة» (item_type = service) صنف داخل كتالوج المخزون لكنه **لا يحمل
//     مخزوناً فعلياً**: لا كميات ولا حركات مخزنية، وإنما يُربط بنقلات الفواتير.
//   • كل تقرير يُحسب من الاستخدام الفعلي في الفواتير (عدد النقلات والإيراد)،
//     فيبقى مطابقاً دائماً ولا يحتاج أي ترحيل أرصدة.
//   • تقريران: تقرير مجمّع لكل الأصناف/الخدمات، وتقرير تفصيلي لكل خدمة.

import { supabase } from "./supabase";
import { translateDbError } from "./db";
import { RuleError, boundedNumber, positiveId, roundMoney, txt } from "./rules";
import type { Item } from "./types";

export const ITEM_TYPES: Record<Item["item_type"], string> = {
  service: "خدمة (بلا مخزون فعلي)",
  product: "صنف مخزني",
};

/** الاسم الافتراضي للخدمة العامة التي تُنشأ تلقائياً لربط نقلات بلا خدمة مختارة. */
export const DEFAULT_SERVICE_NAME = "خدمة نقل";

function num(x: unknown): number {
  const v = Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// الكتالوج
// ---------------------------------------------------------------------------
export async function listItems(options?: {
  type?: Item["item_type"] | null;
  includeInactive?: boolean;
}): Promise<Item[]> {
  let q = supabase.from("items").select("*").order("item_type").order("name");
  if (options?.type) q = q.eq("item_type", options.type);
  if (!options?.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new RuleError(translateDbError(error.message));
  return (data ?? []) as Item[];
}

export async function getItem(itemId: number): Promise<Item | null> {
  const id = positiveId(itemId, "الصنف/الخدمة");
  const { data, error } = await supabase.from("items").select("*").eq("id", id).maybeSingle();
  if (error) throw new RuleError(translateDbError(error.message));
  return (data as Item) ?? null;
}

/** تحقق موحّد من بيانات الصنف/الخدمة قبل الإرسال للخادم. */
export function validateItem(data: Record<string, unknown>): {
  name: string;
  item_type: Item["item_type"];
  unit: string;
  default_price: number;
  description: string;
  notes: string;
  from_loc: string;
  to_loc: string;
} {
  const name = txt(data.name ?? "", "اسم الصنف/الخدمة", 160).trim();
  if (!name) throw new RuleError("يجب إدخال اسم الصنف/الخدمة.");
  const itemType = String(data.item_type ?? "service");
  if (itemType !== "service" && itemType !== "product") throw new RuleError("نوع الصنف غير صالح.");
  const unit = txt(data.unit ?? "", "الوحدة", 40);
  const price = roundMoney(data.default_price ?? 0);
  if (price < 0) throw new RuleError("السعر الافتراضي لا يمكن أن يكون سالباً.");
  // الخط: إما كامل (من ووصول معاً لخدمة خط) أو فارغ تماماً (خدمة عامة بلا خط)
  const fromLoc = txt(data.from_loc ?? "", "مكان الانطلاق", 200).trim();
  const toLoc = txt(data.to_loc ?? "", "مكان الوصول", 200).trim();
  if ((fromLoc === "") !== (toLoc === "")) {
    throw new RuleError("أكمل مكان الانطلاق والوصول للخط، أو اتركهما فارغين لخدمة عامة بلا خط.");
  }
  return {
    name,
    item_type: itemType,
    unit,
    default_price: price,
    description: txt(data.description ?? "", "وصف الخدمة", 1000),
    notes: txt(data.notes ?? "", "ملاحظات الصنف", 1000),
    from_loc: fromLoc,
    to_loc: toLoc,
  };
}

/** هل هذا الصنف خط سير كامل (من ← إلى) مخزَّن داخل الخدمة؟ */
export function isRouteItem(item?: Pick<Item, "from_loc" | "to_loc"> | null): boolean {
  return Boolean(String(item?.from_loc ?? "").trim() && String(item?.to_loc ?? "").trim());
}

/** وصف خط الخدمة «الرياض ← الدمام»، أو نص بديل للخدمة العامة. */
export function itemRouteLabel(item?: Pick<Item, "from_loc" | "to_loc"> | null, fallback = "خدمة عامة"): string {
  return isRouteItem(item) ? `${item!.from_loc} ← ${item!.to_loc}` : fallback;
}

/** إنشاء/تعديل صنف أو خدمة عبر الدالة الذرية save_item_v26. */
export async function saveItem(data: Record<string, any>, itemId?: number | null): Promise<number> {
  const clean = validateItem(data);
  const id = itemId ? positiveId(itemId, "الصنف/الخدمة") : null;
  // خط الخدمة يُفرض على النقلة عند الحفظ، فتغييره لخدمة مستخدمة يُعيد كتابة
  // مسارات فواتير قديمة عند تعديلها. نمنعه في الواجهة أيضاً (والخادم يمنعه).
  if (id != null) {
    const current = await getItem(id);
    if (!current) throw new RuleError("الصنف/الخدمة غير موجود.");
    const routeChanged =
      String(current.from_loc ?? "").trim() !== clean.from_loc ||
      String(current.to_loc ?? "").trim() !== clean.to_loc;
    if (routeChanged) {
      const used = await itemUsageCount(id);
      if (used > 0) {
        throw new RuleError(
          "لا يمكن تغيير خط خدمة مستخدمة في نقلات سابقة (سيُغيّر مسارات فواتير قديمة). " +
            "أنشئ خدمة جديدة بالخط المطلوب وعطّل القديمة."
        );
      }
    }
  }
  const { data: savedId, error } = await supabase.rpc("save_item_v26", {
    p_item_id: id,
    p_name: clean.name,
    p_item_type: clean.item_type,
    p_unit: clean.unit,
    p_default_price: clean.default_price,
    p_description: clean.description,
    p_notes: clean.notes,
    p_from_loc: clean.from_loc,
    p_to_loc: clean.to_loc,
  });
  if (error) throw new RuleError(translateDbError(error.message));
  return Number(savedId);
}

/** تعطيل/تنشيط صنف بدل حذفه — يحفظ تاريخ التقارير. */
export async function setItemActive(itemId: number, active: boolean): Promise<void> {
  const id = positiveId(itemId, "الصنف/الخدمة");
  const { error } = await supabase.from("items").update({ is_active: Boolean(active) }).eq("id", id);
  if (error) throw new RuleError(translateDbError(error.message));
}

/** عدد النقلات المرتبطة بصنف/خدمة. */
export async function itemUsageCount(itemId: number): Promise<number> {
  const id = positiveId(itemId, "الصنف/الخدمة");
  const { count: c, error } = await supabase
    .from("invoice_trips")
    .select("id", { count: "exact", head: true })
    .eq("item_id", id);
  if (error) throw new RuleError(translateDbError(error.message));
  return c ?? 0;
}

/**
 * حذف صنف/خدمة — ممنوع إن كانت مستخدمة في نقلات (التقارير تستند إليها)،
 * والبديل المقترح هو التعطيل.
 */
export async function deleteItem(itemId: number): Promise<void> {
  const id = positiveId(itemId, "الصنف/الخدمة");
  const used = await itemUsageCount(id);
  if (used > 0) {
    throw new RuleError(
      `لا يمكن حذف الصنف/الخدمة لارتباطه بـ ${used} نقلة. عطّله بدلاً من حذفه للحفاظ على التقارير.`
    );
  }
  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) throw new RuleError(translateDbError(error.message));
}

// ---------------------------------------------------------------------------
// الخدمة الافتراضية (لتوافق الفواتير التي لا تحدد خدمة صراحةً)
// ---------------------------------------------------------------------------
/**
 * معرّف خدمة الاستخدام العام للشركة (للنقلات التي لم تحدد خدمة صراحةً، مثل
 * استدعاءات العملاء القدامى). التفضيل خدمة **عامة بلا خط** حتى لا يفرض خط خدمة
 * مسارَه على نقلة قديمة كتب المستخدم مسارها بنفسه؛ فإن لم توجد خدمة بلا خط
 * أُنشئت «خدمة نقل»، وإن تعذّر الإنشاء (الاسم محجوز لخدمة تحولت إلى خط) يُعاد
 * أي خدمة متاحة. لا يوجد تخزين مؤقت عن قصد: التخزين كان يعيد معرّفاً لشركة أو
 * جلسة سابقة بعد تبدّل الجلسة أو إعادة ضبط بيانات الشركة، فيفشل الحفظ بخطأ
 * «غير موجود». (استعلام واحد صغير لا يُقاس أمام حفظ الفاتورة نفسه.)
 */
export async function defaultServiceItemId(): Promise<number> {
  const rows = await listFallbackCandidates();
  const generic = rows.find((row) => row.item_type === "service" && !isRouteItem(row));
  if (generic) return generic.id;
  try {
    return await saveItem({
      name: DEFAULT_SERVICE_NAME,
      item_type: "service",
      unit: "نقلة",
      description: "خدمة نقل عامة أُنشئت تلقائياً لربط نقلات الفواتير",
    });
  } catch (error) {
    // طلبان متزامنان قد يحاولان الإنشاء معاً فيصطدم أحدهما بقيد تكرار الاسم
    // داخل الشركة؛ وفي هذه الحالة نعيد قائمة محدَّثة ثم نقع على أي خدمة متاحة.
    const fresh = await listFallbackCandidates();
    const fallback = fresh.find((row) => row.item_type === "service") ?? fresh[0];
    if (fallback) return fallback.id;
    throw error;
  }
}

/** أصناف/خدمات الشركة مرتّبة بالأقدم، لاختيار خدمة الاستخدام العام. */
async function listFallbackCandidates(): Promise<
  Pick<Item, "id" | "item_type" | "from_loc" | "to_loc">[]
> {
  const { data, error } = await supabase
    .from("items")
    .select("id, item_type, from_loc, to_loc")
    .order("id");
  if (error) throw new RuleError(translateDbError(error.message));
  return (data ?? []) as Pick<Item, "id" | "item_type" | "from_loc" | "to_loc">[];
}

// ---------------------------------------------------------------------------
// تقارير الاستخدام (تقرير كل خدمة + تقرير جميع الأصناف/الخدمات)
// ---------------------------------------------------------------------------
export interface ItemUsageRow {
  item_id: number | null;
  code: string;
  name: string;
  item_type: Item["item_type"] | "unknown";
  unit: string;
  /** خط الخدمة (من ← إلى) إن كانت خدمة خط */
  from_loc: string;
  to_loc: string;
  is_active: boolean;
  /** عدد سطور النقلات */
  trips_count: number;
  /** إجمالي عدد النقلات (مجموع qty) */
  qty_total: number;
  /** عدد الفواتير المختلفة التي استُخدمت فيها الخدمة */
  invoices_count: number;
  /** الإيراد قبل الضريبة */
  revenue: number;
  vat_amount: number;
  /** الإجمالي شامل الضريبة */
  total: number;
  last_date: string | null;
}

export interface ItemUsageLine {
  trip_id: number;
  invoice_id: number;
  invoice_number: number;
  date: string;
  customer_name: string;
  customer_code: string;
  item_id: number | null;
  item_name: string;
  item_type: Item["item_type"] | "unknown";
  from_loc: string;
  to_loc: string;
  qty: number;
  unit_price: number;
  amount: number;
  vat_amount: number;
  total: number;
  container_numbers: string[];
}

export interface ItemsUsageReport {
  from: string;
  to: string;
  summary: ItemUsageRow[];
  lines: ItemUsageLine[];
  totals: {
    items_count: number;
    used_items_count: number;
    trips_count: number;
    qty_total: number;
    revenue: number;
    vat_amount: number;
    total: number;
  };
}

const UNKNOWN_ITEM_LABEL = "غير محدد (قبل ربط الخدمات)";

/**
 * تقرير استخدام واحد لكل الأصناف/الخدمات + كل سطور الاستخدام التفصيلية.
 * يُجلب بأربعة استعلامات مجمّعة (فواتير + نقلات + أصناف + عملاء) بلا N+1،
 * ويمكن قصره على عميل واحد (تقرير العميل الشامل) فلا تُجلب بيانات غيره.
 */
export async function itemsUsageReport(
  dFrom: string,
  dTo: string,
  options?: { customerId?: number | null }
): Promise<ItemsUsageReport> {
  const customerFilter = options?.customerId != null ? positiveId(options.customerId, "العميل") : null;
  const [itemsRes, customersRes, invRes] = await Promise.all([
    supabase.from("items").select("*").order("item_type").order("name"),
    supabase.from("customers").select("id, name, code"),
    (() => {
      let q = supabase
        .from("invoices")
        .select("id, number, date, customer_id, vat_rate")
        .order("date")
        .order("number");
      if (dFrom) q = q.gte("date", dFrom);
      if (dTo) q = q.lte("date", dTo);
      if (customerFilter != null) q = q.eq("customer_id", customerFilter);
      return q;
    })(),
  ]);
  if (itemsRes.error) throw new RuleError(translateDbError(itemsRes.error.message));
  if (invRes.error) throw new RuleError(translateDbError(invRes.error.message));

  const items = (itemsRes.data ?? []) as Item[];
  const customers = new Map(
    ((customersRes.data ?? []) as { id: number; name: string; code: string }[]).map((c) => [c.id, c])
  );
  const invoices = (invRes.data ?? []) as {
    id: number; number: number; date: string; customer_id: number; vat_rate: number;
  }[];
  const invById = new Map(invoices.map((inv) => [inv.id, inv]));
  const itemById = new Map(items.map((item) => [Number(item.id), item]));

  const invIds = invoices.map((inv) => inv.id);
  const trips = invIds.length
    ? ((await supabase
        .from("invoice_trips")
        .select("id, invoice_id, item_id, from_loc, to_loc, qty, unit_price, price, container_numbers")
        .in("invoice_id", invIds)
        .order("id")).data ?? []) as Record<string, any>[]
    : [];

  const lines: ItemUsageLine[] = [];
  const buckets = new Map<number, ItemUsageRow>();

  const bucket = (itemId: number | null): ItemUsageRow => {
    const key = itemId ?? 0;
    let row = buckets.get(key);
    if (!row) {
      const item = itemId != null ? itemById.get(itemId) : undefined;
      row = {
        item_id: itemId,
        code: item?.code ?? "",
        name: item?.name ?? UNKNOWN_ITEM_LABEL,
        item_type: item?.item_type ?? "unknown",
        unit: item?.unit ?? "",
        from_loc: String(item?.from_loc ?? ""),
        to_loc: String(item?.to_loc ?? ""),
        is_active: item ? item.is_active !== false : true,
        trips_count: 0,
        qty_total: 0,
        invoices_count: 0,
        revenue: 0,
        vat_amount: 0,
        total: 0,
        last_date: null,
      };
      buckets.set(key, row);
    }
    return row;
  };

  for (const item of items) bucket(Number(item.id));

  const invoiceSetPerItem = new Map<number, Set<number>>();
  for (const trip of trips) {
    const inv = invById.get(Number(trip.invoice_id));
    if (!inv) continue;
    const itemId = trip.item_id == null ? null : Number(trip.item_id);
    const qty = num(trip.qty) || 1;
    const amount = roundMoney(trip.price ?? qty * num(trip.unit_price));
    const vatRate = num(inv.vat_rate);
    const vat = round2((amount * vatRate) / 100);
    const customer = customers.get(Number(inv.customer_id));
    const item = itemId != null ? itemById.get(itemId) : undefined;

    lines.push({
      trip_id: Number(trip.id),
      invoice_id: Number(inv.id),
      invoice_number: num(inv.number),
      date: String(inv.date),
      customer_name: customer?.name ?? "—",
      customer_code: customer?.code ?? "—",
      item_id: itemId,
      item_name: item?.name ?? (itemId != null ? `صنف #${itemId}` : UNKNOWN_ITEM_LABEL),
      item_type: item?.item_type ?? "unknown",
      from_loc: String(trip.from_loc ?? ""),
      to_loc: String(trip.to_loc ?? ""),
      qty,
      unit_price: roundMoney(trip.unit_price ?? (qty ? amount / qty : amount)),
      amount,
      vat_amount: vat,
      total: round2(amount + vat),
      container_numbers: Array.isArray(trip.container_numbers)
        ? trip.container_numbers.filter((x: unknown) => typeof x === "string")
        : [],
    });

    const b = bucket(itemId);
    b.trips_count += 1;
    b.qty_total = round2(b.qty_total + qty);
    b.revenue = roundMoney(b.revenue + amount);
    b.vat_amount = roundMoney(b.vat_amount + vat);
    b.total = roundMoney(b.total + amount + vat);
    if (!b.last_date || inv.date > b.last_date) b.last_date = String(inv.date);
    const key = itemId ?? 0;
    const set = invoiceSetPerItem.get(key) ?? new Set<number>();
    set.add(Number(inv.id));
    invoiceSetPerItem.set(key, set);
  }

  for (const [key, row] of buckets) {
    row.invoices_count = invoiceSetPerItem.get(key)?.size ?? 0;
  }

  const summary = [...buckets.values()].sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return a.name.localeCompare(b.name, "ar");
  });

  return {
    from: dFrom,
    to: dTo,
    summary,
    lines,
    totals: {
      items_count: items.length,
      used_items_count: summary.filter((r) => r.item_id != null && r.trips_count > 0).length,
      trips_count: summary.reduce((a, r) => a + r.trips_count, 0),
      qty_total: round2(summary.reduce((a, r) => a + r.qty_total, 0)),
      revenue: roundMoney(summary.reduce((a, r) => a + r.revenue, 0)),
      vat_amount: roundMoney(summary.reduce((a, r) => a + r.vat_amount, 0)),
      total: roundMoney(summary.reduce((a, r) => a + r.total, 0)),
    },
  };
}

/**
 * تقرير خدمة واحدة: نفس بيانات التقرير المجمّع مقصورة على الصنف المطلوب
 * (بقصد إعادة استخدام نفس المسار المحسوب، فيبقى رقم الخدمة مطابقاً للتقارير
 * المجمّعة وتقرير العميل الشامل دائماً).
 */
export async function itemUsageReport(
  itemId: number,
  dFrom: string,
  dTo: string
): Promise<{
  item: Item | null;
  summary: ItemUsageRow | null;
  lines: ItemUsageLine[];
  totals: { trips_count: number; qty_total: number; revenue: number; vat_amount: number; total: number; invoices_count: number };
}> {
  const id = positiveId(itemId, "الصنف/الخدمة");
  const [item, report] = await Promise.all([getItem(id), itemsUsageReport(dFrom, dTo)]);
  const lines = report.lines.filter((line) => line.item_id === id);
  const summary = report.summary.find((row) => row.item_id === id) ?? null;
  return {
    item,
    summary,
    lines,
    totals: {
      trips_count: summary?.trips_count ?? lines.length,
      qty_total: summary?.qty_total ?? round2(lines.reduce((a, l) => a + l.qty, 0)),
      revenue: summary?.revenue ?? roundMoney(lines.reduce((a, l) => a + l.amount, 0)),
      vat_amount: summary?.vat_amount ?? roundMoney(lines.reduce((a, l) => a + l.vat_amount, 0)),
      total: summary?.total ?? roundMoney(lines.reduce((a, l) => a + l.total, 0)),
      invoices_count: summary?.invoices_count ?? new Set(lines.map((l) => l.invoice_id)).size,
    },
  };
}

/** خيارات قوائم اختيار الخدمات في شاشات الفواتير والتقارير. */
export async function itemOptions(includeInactive = false): Promise<{ id: number; label: string }[]> {
  const items = await listItems({ includeInactive });
  return items.map((item) => {
    const parts = [item.name];
    // يُضاف الخط للوصف إن لم يكن مذكوراً أصلاً في اسم الخدمة
    const route = itemRouteLabel(item, "");
    if (route && !item.name.includes(String(item.from_loc ?? ""))) parts.push(`(${route})`);
    if (item.unit) parts.push(`— ${item.unit}`);
    return { id: Number(item.id), label: parts.join(" ") };
  });
}

/** سعر الوحدة الافتراضي لصنف (يُستخدم لتعبئة سعر النقلة تلقائياً). */
export function defaultUnitPrice(item?: Item | null): number {
  return boundedNumber(item?.default_price ?? 0, "السعر الافتراضي", 0, 999_999_999_999);
}
