import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async () => {
  const mem = await import("./memory-supabase");
  return { supabase: mem.supabaseMock };
});

import { resetDb, seedTable, setUser } from "./memory-supabase";
import { saveCustomer, saveYear } from "@/lib/repo";

beforeEach(() => {
  resetDb();
  setUser({ id: "u1", email: "owner@gmail.com" });
  seedTable("profiles", [{ id: "u1", company_id: "c1", email: "owner@gmail.com", name: "مالك الشركة" }]);
  seedTable("companies", [{
    id: "c1", name: "شركة الدلتا للنقل", phone: "01012345678", email: "owner@gmail.com",
    address: "المنصورة، شارع الجمهورية", currency: "ج.م", vat_rate: 15, vat_note: "",
    plan_type: "open", trial_end: null, subscription_start: null, subscription_end: null, is_active: true,
  }]);
});

describe("التحقق النهائي قبل الكتابة", () => {
  it("يمنع تكرار هاتف أو بريد العملاء داخل الشركة بعد التطبيع", async () => {
    await saveCustomer({
      name: "مؤسسة النور للتجارة", phone: "010 2345 6789", email: "SALES@NOOR.EXAMPLE.COM",
      address: "المنصورة، شارع الجيش", opening_balance: 0,
    });
    await expect(saveCustomer({
      name: "مؤسسة أخرى للنقل", phone: "01023456789", email: "other@example.com", opening_balance: 0,
    })).rejects.toThrow("رقم الهاتف مسجل لعميل آخر");
    await expect(saveCustomer({
      name: "شركة ثالثة للشحن", phone: "01123456789", email: "sales@noor.example.com", opening_balance: 0,
    })).rejects.toThrow("البريد الإلكتروني مسجل لعميل آخر");
  });

  it("يرفض الحقن والقيم الوهمية والأرقام غير المنتهية", async () => {
    await expect(saveCustomer({ name: "<script>alert(1)</script>", opening_balance: 0 })).rejects.toThrow("غير مسموح");
    await expect(saveCustomer({ name: "عميل", opening_balance: 0 })).rejects.toThrow("حقيقياً");
    await expect(saveCustomer({ name: "شركة النور", opening_balance: Number.POSITIVE_INFINITY })).rejects.toThrow("مبلغ غير صالحة");
  });

  it("يرفض تاريخاً غير موجود فعلياً ولا يحوله تلقائياً", async () => {
    await expect(saveYear({
      year: 2026, date_from: "2026-02-31", date_to: "2026-12-31", notes: "",
    })).rejects.toThrow("تاريخ");
  });
});
