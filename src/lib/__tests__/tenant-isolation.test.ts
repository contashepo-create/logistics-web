// عزل الشركات (multi-tenant isolation) على كل المسارات: لا تسريب بيانات بين شركتين
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, setUser, seedTable } from "./memory-supabase";
import * as repo from "@/lib/repo";
import * as calc from "@/lib/calc";

const USER_A = { id: "uA", email: "a@gmail.com" };
const USER_B = { id: "uB", email: "b@gmail.com" };

interface Ctx { cust: number; emp: number; cb: number; inv: number; veh: number }

async function buildCompany(prefix: string): Promise<Ctx> {
  await repo.saveYear({ year: 2026, date_from: "2026-01-01", date_to: "2026-12-31" });
  const cust = await repo.saveCustomer({ name: `${prefix}-عميل`, phone: `0101234567${prefix === "A" ? "8" : "9"}`, address: "", opening_balance: 0 });
  const emp = await repo.saveEmployee({ name: `${prefix}-موظف`, emp_type: "driver", base_salary: 5000 });
  const veh = await repo.saveVehicle({ plate_number: `${prefix}-123`, vehicle_type: "شاحنة", notes: "" });
  const cb = await repo.saveAccount("cashbox", { name: `${prefix}-خزينة`, created_date: "2026-01-01", opening_balance: 50000 });
  const inv = await repo.saveInvoice({
    date: "2026-02-01", customer_id: cust, attachments: [],
    trips: [{ from_loc: "أ", to_loc: "ب", qty: 1, unit_price: 1000, expenses: [] }],
  });
  await repo.saveReceipt({ date: "2026-02-05", account_kind: "cashbox", account_id: cb, voucher_type: "customer", customer_id: cust, amount: 400, description: "دفعة" });
  await repo.savePayment({ date: "2026-02-06", account_kind: "cashbox", account_id: cb, voucher_type: "advance", employee_id: emp, amount: 300, description: "سلفة" });
  return { cust, emp, cb, inv, veh };
}

let A: Ctx, B: Ctx;

beforeEach(async () => {
  resetDb();
  seedTable("profiles", [
    { id: "uA", company_id: "cA", email: USER_A.email, name: "A" },
    { id: "uB", company_id: "cB", email: USER_B.email, name: "B" },
  ]);
  seedTable("companies", [
    { id: "cA", name: "شركة أ", currency: "ج.م", vat_rate: 0, plan_type: "trial", is_active: true, client_code: "AAAA2345" },
    { id: "cB", name: "شركة ب", currency: "ج.م", vat_rate: 0, plan_type: "trial", is_active: true, client_code: "BBBB6789" },
  ]);
  setUser(USER_A); A = await buildCompany("A");
  setUser(USER_B); B = await buildCompany("B");
});

describe("عزل القوائم الرئيسية", () => {
  it("كل شركة ترى بياناتها فقط", async () => {
    setUser(USER_A);
    const custA = await repo.listCustomers();
    const empA = await repo.listEmployees();
    const vehA = await repo.listVehicles();
    const invA = await repo.listInvoicesRaw();
    expect(custA.every((c) => c.name.startsWith("A-"))).toBe(true);
    expect(empA.every((e) => e.name.startsWith("A-"))).toBe(true);
    expect(vehA.every((v) => v.plate_number.startsWith("A-"))).toBe(true);
    expect(invA).toHaveLength(1);

    setUser(USER_B);
    const custB = await repo.listCustomers();
    expect(custB.every((c) => c.name.startsWith("B-"))).toBe(true);
    expect(custB.some((c) => c.id === A.cust)).toBe(false);
  });

  it("السندات والرواتب والحسابات معزولة", async () => {
    setUser(USER_A);
    expect((await repo.listReceipts()).length).toBe(1);
    expect((await repo.listPayments()).length).toBe(1);
    expect((await repo.listAccounts("cashbox")).every((a) => a.name.startsWith("A-"))).toBe(true);
    setUser(USER_B);
    expect((await repo.listAccounts("cashbox")).every((a) => a.name.startsWith("B-"))).toBe(true);
  });
});

describe("عزل الوصول المباشر بالمعرّف (IDOR)", () => {
  it("لا يمكن قراءة فاتورة شركة أخرى بمعرّفها", async () => {
    setUser(USER_B);
    const seen = (await repo.listInvoicesRaw()).map((i) => i.id);
    expect(seen).not.toContain(A.inv);
    // محاولة تعديل فاتورة شركة أخرى بمعرّفها تفشل
    await expect(repo.saveInvoice({
      date: "2026-03-02", customer_id: B.cust, attachments: [],
      trips: [{ from_loc: "س", to_loc: "ص", qty: 1, unit_price: 50, expenses: [] }],
    }, A.inv)).rejects.toThrow();
  });

  it("لا يمكن قراءة عميل أو موظف شركة أخرى بمعرّفه", async () => {
    setUser(USER_B);
    expect(await repo.getCustomer(A.cust)).toBeFalsy();
    expect(await repo.getEmployee(A.emp)).toBeFalsy();
  });

  it("لا يمكن إصدار فاتورة على عميل شركة أخرى", async () => {
    setUser(USER_B);
    await expect(repo.saveInvoice({
      date: "2026-03-01", customer_id: A.cust, attachments: [],
      trips: [{ from_loc: "س", to_loc: "ص", qty: 1, unit_price: 100, expenses: [] }],
    })).rejects.toThrow();
  });

  it("لا يمكن الصرف من خزينة شركة أخرى", async () => {
    setUser(USER_B);
    await expect(repo.savePayment({
      date: "2026-03-01", account_kind: "cashbox", account_id: A.cb,
      voucher_type: "expense", amount: 100, description: "محاولة",
    })).rejects.toThrow();
  });

  it("لا يمكن صرف راتب لموظف شركة أخرى", async () => {
    setUser(USER_B);
    await expect(repo.savePayroll({
      date: "2026-03-01", employee_id: A.emp, period_year: 2026, period_month: 3,
      account_kind: "cashbox", account_id: B.cb, base_salary: 1000, additions: 0, other_deductions: 0, settlements: [],
    })).rejects.toThrow();
  });

  it("لا يمكن حذف سجل شركة أخرى", async () => {
    setUser(USER_B);
    await repo.deleteCustomer(A.cust).catch(() => undefined);
    setUser(USER_A);
    expect(await repo.getCustomer(A.cust)).toBeTruthy();
  });
});

describe("عزل التقارير والأرصدة", () => {
  it("رصيد العميل وكشف الحساب لا يتأثران ببيانات شركة أخرى", async () => {
    setUser(USER_A);
    const balA = await calc.customerBalance(A.cust);
    setUser(USER_B);
    const balB = await calc.customerBalance(B.cust);
    expect(Number(balA)).toBeCloseTo(600, 2);
    expect(Number(balB)).toBeCloseTo(600, 2);
    // من داخل شركة ب: عميل شركة أ بلا أي حركة
    const cross = await calc.customerBalance(A.cust);
    expect(Number(cross)).toBeCloseTo(0, 2);
  });

  it("رصيد الخزينة معزول", async () => {
    setUser(USER_A);
    const a = Number(await calc.accountBalance("cashbox", A.cb));
    setUser(USER_B);
    const crossRead = Number(await calc.accountBalance("cashbox", A.cb));
    expect(a).toBeCloseTo(50000 + 400 - 300, 2);
    expect(crossRead).toBeCloseTo(0, 2);
  });

  it("أرشيف السلف لا يعرض سلف موظفي شركة أخرى", async () => {
    setUser(USER_B);
    expect(await calc.advanceArchive(A.emp)).toHaveLength(0);
    expect(await calc.advanceArchive(B.emp)).toHaveLength(1);
  });

  it("ترقيم المستندات مستقل لكل شركة", async () => {
    setUser(USER_A);
    const invA = (await repo.listInvoicesRaw())[0];
    setUser(USER_B);
    const invB = (await repo.listInvoicesRaw())[0];
    expect(invA.number).toBe(1);
    expect(invB.number).toBe(1);
  });
});
