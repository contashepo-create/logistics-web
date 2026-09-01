// اختبارات إشعارات الدين/الدائن: تأكيد أثرها على أرصدة العملاء والتقارير
// وكشوف الحساب، وبأن حذف الإشعار يعيد الأرقام تلقائياً.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable, table } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as calc from "@/lib/calc";

function setup(): void {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{ id: "c1", name: "شركة", vat_rate: 15, plan_type: "open", is_active: true }]);
}

async function seedInvoice() {
  const cust = await repo.saveCustomer({ name: "شركة العميل", opening_balance: 100 });
  const inv = await repo.saveInvoice({
    date: "2026-05-05",
    customer_id: cust,
    attachments: [],
    trips: [{ from_loc: "أ", to_loc: "ب", price: 1000, expenses: [] }],
  });
  return { cust, inv };
}

describe("إشعارات الدين/الدائن", () => {
  beforeEach(() => {
    setup();
  });

  it("الإشعار المدين يزيد رصيد العميل ويُحتسب إيراداً في تقرير الأرباح والخسائر", async () => {
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const { cust, inv } = await seedInvoice();

    // فاتورة 1000 + ضريبة 15% = 1150، إضافة للرصيد الافتتاحي 100 = 1250
    let rows = await calc.customersWithBalance();
    expect(rows[0].balance).toBeCloseTo(1250, 2);

    const amt = 100;
    const noteId = await repo.saveCreditDebitNote({
      note_type: "debit", invoice_id: inv, customer_id: cust, date: "2026-05-06", amount: amt, vat_rate: 15, reason: "زيادة كمية",
    });
    expect(noteId).toBeGreaterThan(0);

    // أثر الإشعار = 100 × 1.15 = 115
    rows = await calc.customersWithBalance();
    expect(rows[0].balance).toBeCloseTo(1250 + 115, 2);

    const pnl = await calc.pnlReport("2026-01-01", "2026-12-31");
    expect(pnl.debit_notes_adjust).toBeCloseTo(115, 2);
    expect(pnl.credit_notes_adjust).toBeCloseTo(0, 2);
    expect(pnl.total_revenue).toBeCloseTo(1000 + 115, 2); // الإيراد قبل الضريبة للنقلة + الأثر الصافي للإشعار
  });

  it("الإشعار الدائن يخفض رصيد العميل ويخصم الإيراد", async () => {
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const { cust, inv } = await seedInvoice();

    await repo.saveCreditDebitNote({
      note_type: "credit", invoice_id: inv, customer_id: cust, date: "2026-05-06", amount: 200, vat_rate: 15, reason: "حسم",
    });

    const rows = await calc.customersWithBalance();
    expect(rows[0].balance).toBeCloseTo(1250 - 230, 2);

    const pnl = await calc.pnlReport("2026-01-01", "2026-12-31");
    expect(pnl.credit_notes_adjust).toBeCloseTo(-230, 2);
    expect(pnl.total_revenue).toBeCloseTo(1000 - 230, 2);
  });

  it("يظهر الإشعار في كشف الحساب البسيط والمفصّل مع الإجماليات الصحيحة", async () => {
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const { cust, inv } = await seedInvoice();

    await repo.saveCreditDebitNote({
      note_type: "credit", invoice_id: inv, customer_id: cust, date: "2026-05-07", amount: 50, vat_rate: 15, reason: "خصم اتفاق",
    });

    const st = await calc.customerStatement(cust, "2026-01-01", "2026-12-31");
    expect(st.rows.some((r) => r.kind === "note_credit")).toBe(true);
    expect(st.notes_credit).toBeCloseTo(57.5, 2);
    expect(st.notes_debit).toBeCloseTo(0, 2);
    expect(st.closing).toBeCloseTo(1250 - 57.5, 2);

    const full = await calc.customerStatementFull(cust, "2026-01-01", "2026-12-31");
    expect(full.notes_credit).toBeCloseTo(57.5, 2);
    expect(full.closing).toBeCloseTo(1250 - 57.5, 2);
    expect(full.openItems.length).toBeGreaterThan(0);
  });

  it("حذف الإشعار يعيد حساب الأرصدة والتقارير فوراً", async () => {
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const { cust, inv } = await seedInvoice();

    const noteId = await repo.saveCreditDebitNote({
      note_type: "debit", invoice_id: inv, customer_id: cust, date: "2026-05-06", amount: 100, vat_rate: 15, reason: "تصحيح",
    });
    expect((await calc.customersWithBalance())[0].balance).toBeCloseTo(1250 + 115, 2);

    await repo.deleteCreditDebitNote(noteId);

    const rows = await calc.customersWithBalance();
    expect(rows[0].balance).toBeCloseTo(1250, 2);

    const pnl = await calc.pnlReport("2026-01-01", "2026-12-31");
    expect(pnl.debit_notes_adjust).toBeCloseTo(0, 2);
    expect(pnl.total_revenue).toBeCloseTo(1000, 2);
  });

  it("invoiceOptions يعرض المتبقي على الفاتورة مع أثر الإشعارات والتحصيلات", async () => {
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const { cust, inv } = await seedInvoice();
    const cb = await repo.saveAccount("cashbox", { name: "خزينة", created_date: "2026-01-01", opening_balance: 100000 });

    await repo.saveCreditDebitNote({
      note_type: "credit", invoice_id: inv, customer_id: cust, date: "2026-05-06", amount: 100, vat_rate: 15, reason: "حسم",
    });
    await repo.saveReceipt({
      date: "2026-05-08", account_kind: "cashbox", account_id: cb, voucher_type: "customer", customer_id: cust, amount: 300, description: "دفعة",
    });

    const opts = await calc.invoiceOptions();
    expect(opts).toHaveLength(1);
    // الفاتورة 1150 بعد حسم 115 = 1035، دفعة 300 ⇒ المتبقي 735
    expect(opts[0].total).toBeCloseTo(1035, 2);
    expect(opts[0].paid).toBeCloseTo(300, 2);
    expect(opts[0].remaining).toBeCloseTo(735, 2);
  });

  it("listCreditDebitNotes يعيد تفاصيل الفاتورة والعميل والإجمالي شامل الضريبة", async () => {
    await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
    const { cust, inv } = await seedInvoice();
    await repo.saveCreditDebitNote({
      note_type: "debit", invoice_id: inv, customer_id: cust, date: "2026-05-06", amount: 100, vat_rate: 15, reason: "تصحيح",
    });

    const notes = await repo.listCreditDebitNotes("2026-01-01", "2026-12-31", "debit");
    expect(notes).toHaveLength(1);
    expect(notes[0].invoice_number).toBe(table("invoices")[0].number);
    expect(notes[0].customer_name).toBe("شركة العميل");
    expect(notes[0].total).toBeCloseTo(115, 2);

    const invNotes = await repo.listCreditDebitNotesForInvoice(inv);
    expect(invNotes).toHaveLength(1);
    expect(invNotes[0].note_type).toBe("debit");
  });
});
