// اختبارات أداء: تضمن ألا يعود نمط N+1 في الشاشات الرئيسية.
// المعيار: عدد الاستعلامات ثابت مهما زاد عدد السجلات.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, seedTable, setUser, resetQueryCount, getQueryCount } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as calc from "@/lib/calc";

function setupCompany(): void {
  resetDb();
  setUser({ id: "u1", email: "owner@test.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@test.com", name: "مالك" }]);
  seedTable("companies", [{
    id: "c1", name: "شركة اختبار", currency: "ر.س", vat_rate: 15, plan_type: "open",
    trial_end: null, subscription_start: null, subscription_end: null, is_active: true,
  }]);
}

async function seedCustomers(n: number): Promise<void> {
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  for (let i = 0; i < n; i += 1) {
    const cid = await repo.saveCustomer({ name: `عميل ${i}`, opening_balance: 100 });
    await repo.saveInvoice({
      date: "2026-05-05", customer_id: cid, attachments: [],
      trips: [{ from_loc: "أ", to_loc: "ب", price: 1000, expenses: [] }],
    });
  }
}

describe("أداء تحميل الشاشات (منع N+1)", () => {
  beforeEach(setupCompany);

  it("أرصدة العملاء تُحسب بعدد استعلامات ثابت مهما زاد العملاء", async () => {
    await seedCustomers(3);
    resetQueryCount();
    const few = await calc.customersWithBalance();
    const qFew = getQueryCount();

    setupCompany();
    await seedCustomers(12);
    resetQueryCount();
    const many = await calc.customersWithBalance();
    const qMany = getQueryCount();

    expect(few).toHaveLength(3);
    expect(many).toHaveLength(12);
    expect(qFew).toBeLessThanOrEqual(5);
    expect(qMany).toBe(qFew); // ثابت — لا يزيد بزيادة السجلات
  });

  it("صحّة الأرصدة محفوظة بعد التجميع", async () => {
    await seedCustomers(2);
    const rows = await calc.customersWithBalance();
    // افتتاحي 100 + فاتورة 1000 + ضريبة 15% = 1250
    expect(rows[0].balance).toBeCloseTo(1250, 2);
  });

  it("قائمة الفواتير تُحمَّل بعدد استعلامات ثابت", async () => {
    await seedCustomers(2);
    resetQueryCount();
    const few = await calc.invoiceList();
    const qFew = getQueryCount();

    setupCompany();
    await seedCustomers(8);
    resetQueryCount();
    const many = await calc.invoiceList();
    const qMany = getQueryCount();

    expect(few).toHaveLength(2);
    expect(many).toHaveLength(8);
    expect(qMany).toBe(qFew);
    expect(qFew).toBeLessThanOrEqual(6);
    expect(many[0].customer_total).toBeCloseTo(1150, 2);
  });

  it("أرصدة الخزائن بعدد استعلامات ثابت", async () => {
    for (let i = 0; i < 6; i += 1) {
      await repo.saveAccount("cashbox", { name: `خزينة ${i}`, opening_balance: 1000 });
    }
    resetQueryCount();
    const rows = await calc.accountsWithBalance("cashbox");
    expect(rows).toHaveLength(6);
    expect(getQueryCount()).toBeLessThanOrEqual(5);
    expect(rows[0].balance).toBeCloseTo(1000, 2);
  });

  it("companyInfo تقرأ بيانات الشركة باستعلامات قليلة لا استعلاماً لكل حقل", async () => {
    resetQueryCount();
    const info = await repo.companyInfo();
    expect(info.company_name).toBe("شركة اختبار");
    expect(info.vat_rate).toBe("15");
    expect(getQueryCount()).toBeLessThanOrEqual(3);
  });
});
