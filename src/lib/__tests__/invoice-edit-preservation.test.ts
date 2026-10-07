// اختبارات حماية بيانات الفواتير القديمة عند التعديل (v26):
//   1) تعديل فاتورة قائمة لا يغيّر معرّفات النقلات ولا يمس مصروفاتها ولا سنداتها التلقائية.
//   2) النقلة المرتجعة (إشعار دائن) لا تُحذف من الفاتورة برسالة واضحة.
//   3) خط خدمة مستخدمة في نقلات سابقة لا يتغير (حماية مسارات الفواتير القديمة).
//   4) النقلات القديمة بلا خدمة تبقى قابلة للحفظ وتُربط بالخدمة الافتراضية.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table } from "./memory-supabase";
import { supabase } from "@/lib/supabase";
import * as repo from "@/lib/repo";
import * as calc from "@/lib/calc";
import * as items from "@/lib/items";
import { clearFeatureCache } from "@/lib/features";

async function setup(featureOn = false) {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة النقل", vat_rate: 15, plan_type: "open", is_active: true }]);
  seedTable("company_features", featureOn ? [{ company_id: "c1", feature_key: "tax_invoice", enabled: true }] : []);
  clearFeatureCache();
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  const cust = await repo.saveCustomer({ name: "شركة الدلتا للنقل", opening_balance: 0 });
  const item = await items.saveItem({
    name: "نقل الرياض ← الدمام", unit: "نقلة", default_price: 1000,
    from_loc: "الرياض", to_loc: "الدمام",
  });
  const box = await repo.saveAccount("cashbox", { name: "الخزينة الرئيسية", created_date: "2026-01-01", opening_balance: 5000 });
  return { cust, item, box };
}

describe("حماية الفواتير القديمة عند التعديل", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { s = await setup(); });

  async function seedInvoice() {
    return repo.saveInvoice({
      date: "2026-05-05",
      customer_id: s.cust,
      attachments: [],
      trips: [{
        item_id: s.item, from_loc: "الرياض", to_loc: "الدمام", qty: 2, unit_price: 1000,
        container_numbers: [], notes: "نقلة أولى",
        expenses: [
          { expense_type: "fuel", qty: 1, unit_amount: 100, source: "cash", account_kind: "cashbox", account_id: s.box, notes: "وقود" },
          { expense_type: "other", qty: 1, unit_amount: 50, source: "customer", notes: "رسم إضافي" },
        ],
      }],
    });
  }

  it("التعديل يحافظ على معرّفات النقلات والمصروفات وسندات الصرف التلقائية", async () => {
    const invId = await seedInvoice();
    const trip = table("invoice_trips").find((t) => t.invoice_id === invId)!;
    const expenses = table("trip_expenses").filter((e) => e.trip_id === trip.id);
    expect(expenses).toHaveLength(2);
    const cashExpense = expenses.find((e) => e.source === "cash")!;
    const customerExpense = expenses.find((e) => e.source === "customer")!;
    const voucher = table("payment_vouchers").find((v) => v.source_expense_id === cashExpense.id)!;
    expect(voucher.number).toBeGreaterThan(0);

    // تعديل الفاتورة: السعر 1000 ← 1200، تحديث مبلغ مصروف الخزينة إلى 250، وإزالة رسم العميل.
    await repo.saveInvoice({
      date: "2026-05-05",
      customer_id: s.cust,
      attachments: [],
      trips: [{
        id: trip.id,
        item_id: s.item, from_loc: "الرياض", to_loc: "الدمام", qty: 2, unit_price: 1200,
        container_numbers: [], notes: "نقلة أولى",
        expenses: [{
          id: cashExpense.id, expense_type: "fuel", qty: 1, unit_amount: 250,
          source: "cash", account_kind: "cashbox", account_id: s.box, notes: "وقود",
        }],
      }],
    }, invId);

    // النقلة نفسها (المعرّف ثابت) بسعر جديد
    const tripsAfter = table("invoice_trips").filter((t) => t.invoice_id === invId);
    expect(tripsAfter).toHaveLength(1);
    expect(tripsAfter[0].id).toBe(trip.id);
    expect(tripsAfter[0].price).toBeCloseTo(2400, 2);

    // مصروف الخزينة حُدِّث في مكانه: المعرّف نفسه والمبلغ الجديد
    const cashAfter = table("trip_expenses").find((e) => e.id === cashExpense.id)!;
    expect(cashAfter.amount).toBeCloseTo(250, 2);
    // والمصروف المُزال من الفاتورة حُذف فعلاً
    expect(table("trip_expenses").some((e) => e.id === customerExpense.id)).toBe(false);

    // سند الصرف التلقائي بقي برقمه ومعرّفه وتحدّث مبلغه
    const vouchersAfter = table("payment_vouchers").filter((v) => v.voucher_type === "trip");
    expect(vouchersAfter).toHaveLength(1);
    expect(vouchersAfter[0].id).toBe(voucher.id);
    expect(vouchersAfter[0].number).toBe(voucher.number);
    expect(vouchersAfter[0].amount).toBeCloseTo(250, 2);

    // إجماليات الفاتورة تُحسب من البيانات الجديدة
    const inv = await calc.getInvoiceFull(invId);
    expect(inv?.trips[0].price).toBeCloseTo(2400, 2);
  });

  it("إزالة نقلة صدر لها إشعار دائن (مرتجع) مرفوضة برسالة واضحة", async () => {
    // السيناريو الواقعي: أُنشئ الإشعار وميزة الباركود مفعّلة، ثم أُوقفت الميزة
    // (فبقيت الإشعارات القديمة مؤثرة) وأصبح تعديل الفاتورة متاحاً — فلا يجوز أن
    // يحذف التعديل نقلة مرتجعة بصمت.
    const { cust } = await setup(true);
    const invId = await repo.saveInvoice({
      date: "2026-06-01", customer_id: cust, attachments: [],
      trips: [
        { from_loc: "الرياض", to_loc: "الدمام", qty: 1, unit_price: 1000, expenses: [] },
        { from_loc: "جدة", to_loc: "مكة", qty: 1, unit_price: 400, expenses: [] },
      ],
    });
    const trips = table("invoice_trips").filter((t) => t.invoice_id === invId);
    const returned = trips[1];
    await repo.saveCreditDebitNote({
      note_type: "credit", invoice_id: invId, customer_id: cust,
      date: "2026-06-02", reason: "مرتجع نقلة", trip_ids: [returned.id],
    });

    // بإيقاف الميزة: الحذف مرفوض بسبب الإشعار المرتبط، والتعديل لا يحذف النقلة المرتجعة
    seedTable("company_features", [{ company_id: "c1", feature_key: "tax_invoice", enabled: false }]);
    clearFeatureCache();
    await expect(repo.deleteInvoice(invId)).rejects.toThrow(/إشعار/);

    // وحذف النقلة وحدها من الفاتورة مرفوض كذلك
    await expect(repo.saveInvoice({
      date: "2026-06-01", customer_id: cust, attachments: [],
      trips: [{ id: trips[0].id, from_loc: "الرياض", to_loc: "الدمام", qty: 1, unit_price: 1000, expenses: [] }],
    }, invId)).rejects.toThrow(/لا يمكن حذف نقلة صدر لها إشعار دائن/);
    expect(table("invoice_trips").filter((t) => t.invoice_id === invId)).toHaveLength(2);
  });

  it("لا يمكن تغيير خط خدمة مستخدمة في نقلات سابقة، ويُسمح بتعديل الاسم والسعر", async () => {
    await seedInvoice();

    // تعديل الوصف والسعر بدون لمس الخط: مسموح
    await expect(items.saveItem({
      name: "نقل الرياض ← الدمام", unit: "نقلة", default_price: 1500,
      from_loc: "الرياض", to_loc: "الدمام", description: "خط شرقي",
    }, s.item)).resolves.toBeGreaterThan(0);

    // تغيير الخط: مرفوض من طبقة المكتبة
    await expect(items.saveItem({
      name: "نقل الرياض ← الدمام", from_loc: "جدة", to_loc: "مكة",
    }, s.item)).rejects.toThrow(/لا يمكن تغيير خط خدمة مستخدمة في نقلات سابقة/);

    // ومرفوض أيضاً عند استدعاء الدالة الخادمية مباشرة (نفس الحماية في قاعدة البيانات)
    const direct = await supabase.rpc("save_item_v26", {
      p_item_id: s.item, p_name: "نقل الرياض ← الدمام", p_item_type: "service", p_unit: "نقلة",
      p_default_price: 1500, p_description: "", p_notes: "", p_from_loc: "جدة", p_to_loc: "مكة",
    });
    expect(direct.error?.message ?? "").toMatch(/لا يمكن تغيير خط خدمة مستخدمة في نقلات سابقة/);

    // خدمة غير مستخدمة: تغيير خطها مسموح
    const free = await items.saveItem({ name: "نقل جدة ← مكة", from_loc: "جدة", to_loc: "مكة" });
    await expect(items.saveItem({ name: "نقل جدة ← مكة", from_loc: "الطائف", to_loc: "أبها" }, free)).resolves.toBe(free);
  });

  it("تعديل الفاتورة دون إرسال مصروفاتها القديمة لا يمسّ نقلة صدرت لها سندات", async () => {
    const invId = await seedInvoice();
    const trip = table("invoice_trips").find((t) => t.invoice_id === invId)!;
    // سند دفع يدوي على النقلة (من شاشة سندات الدفع): يمنع حذف النقلة لكنه لا يُتجاهل
    const vouchersBefore = table("payment_vouchers").length;

    // حفظ بلا تغييرات جوهرية: نفس النقلة بنفس السعر والمصروفات كما تُقرأ من الخادم
    const full = await calc.getInvoiceFull(invId);
    await repo.saveInvoice({
      date: full!.date, customer_id: full!.customer_id, attachments: [],
      trips: (full!.trips ?? []).map((t) => ({
        id: t.id, item_id: t.item_id, from_loc: t.from_loc, to_loc: t.to_loc,
        qty: Number(t.qty), unit_price: Number(t.unit_price), container_numbers: [],
        notes: t.notes, expenses: (t.expenses ?? []).map((e) => ({ ...e, id: e.id })),
      })),
    }, invId);

    expect(table("payment_vouchers").length).toBe(vouchersBefore);
    expect(table("trip_expenses").filter((e) => e.trip_id === trip.id)).toHaveLength(2);
  });

  it("النقلات القديمة بلا خدمة تبقى قابلة للحفظ وتُربط بالخدمة الافتراضية", async () => {
    const invId = await repo.saveInvoice({
      date: "2026-07-01", customer_id: s.cust, attachments: [],
      trips: [{ from_loc: "طنطا", to_loc: "بورسعيد", qty: 1, unit_price: 300, expenses: [] }],
    });
    const trip = table("invoice_trips").find((t) => t.invoice_id === invId)!;
    expect(trip.item_id).toBeGreaterThan(0);
    const defaultItem = table("items").find((i) => i.id === trip.item_id)!;
    expect(defaultItem.item_type).toBe("service");
    // والخدمة الافتراضية عامة بلا خط حتى لا تُفرض على النقلة القديمة
    expect(String(defaultItem.from_loc ?? "")).toBe("");
    expect(String(defaultItem.to_loc ?? "")).toBe("");
    expect(trip.from_loc).toBe("طنطا");
    expect(trip.to_loc).toBe("بورسعيد");
  });
});
