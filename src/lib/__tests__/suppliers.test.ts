import { describe, it, expect } from "vitest";
import { purchaseTotals, buildAging, type PurchaseItem } from "@/lib/suppliers";

const item = (o: Partial<PurchaseItem>): PurchaseItem => ({
  item_name: "صنف", unit: "", qty: 1, unit_price: 0, vat_rate: 15, ...o,
});

describe("إجماليات فاتورة المشتريات", () => {
  it("الأسعار غير شاملة الضريبة", () => {
    const t = purchaseTotals([item({ qty: 2, unit_price: 100 })], false);
    expect(t.net).toBe(200);
    expect(t.vat).toBe(30);
    expect(t.total).toBe(230);
  });

  it("الأسعار شاملة الضريبة تُستخرج بالقسمة على 1.15", () => {
    const t = purchaseTotals([item({ qty: 1, unit_price: 115 })], true);
    expect(t.net).toBe(100);
    expect(t.vat).toBe(15);
    expect(t.total).toBe(115);
  });

  it("يدعم بنوداً بنسب ضريبة مختلفة (بند معفى)", () => {
    const t = purchaseTotals([
      item({ qty: 1, unit_price: 100, vat_rate: 15 }),
      item({ qty: 1, unit_price: 100, vat_rate: 0 }),
    ]);
    expect(t.net).toBe(200);
    expect(t.vat).toBe(15);
    expect(t.total).toBe(215);
  });

  it("قائمة فارغة = أصفار", () => {
    expect(purchaseTotals([])).toEqual({ net: 0, vat: 0, total: 0 });
  });

  it("يتعامل مع الكميات العشرية بلا أخطاء تقريب", () => {
    const t = purchaseTotals([item({ qty: 3, unit_price: 33.33 })]);
    expect(t.net).toBe(99.99);
    expect(t.total).toBe(114.99);
  });
});

describe("أعمار الديون", () => {
  const asOf = new Date("2026-06-30");
  const daysAgo = (n: number) => {
    const d = new Date(asOf);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  it("يوزّع الفواتير على الشرائح الأربع", () => {
    const b = buildAging([
      { date: daysAgo(10), total: 100 },
      { date: daysAgo(45), total: 200 },
      { date: daysAgo(75), total: 300 },
      { date: daysAgo(200), total: 400 },
    ], 0, asOf);
    expect(b.current).toBe(100);
    expect(b.d31_60).toBe(200);
    expect(b.d61_90).toBe(300);
    expect(b.over90).toBe(400);
    expect(b.total).toBe(1000);
  });

  it("السداد يُخصم من الأقدم أولاً", () => {
    const b = buildAging([
      { date: daysAgo(200), total: 400 },
      { date: daysAgo(10), total: 100 },
    ], 400, asOf);
    expect(b.over90).toBe(0);
    expect(b.current).toBe(100);
    expect(b.total).toBe(100);
  });

  it("السداد الجزئي يترك الباقي في شريحة الفاتورة", () => {
    const b = buildAging([{ date: daysAgo(100), total: 500 }], 200, asOf);
    expect(b.over90).toBe(300);
    expect(b.total).toBe(300);
  });

  it("السداد الزائد لا يُنتج أرصدة سالبة", () => {
    const b = buildAging([{ date: daysAgo(5), total: 100 }], 500, asOf);
    expect(b.total).toBe(0);
    expect(b.current).toBe(0);
  });

  it("بلا فواتير = أصفار", () => {
    expect(buildAging([], 0, asOf).total).toBe(0);
  });

  it("الفاتورة عند حدّ 30 يوماً تبقى في الشريحة الأولى وعند 31 تنتقل", () => {
    expect(buildAging([{ date: daysAgo(30), total: 50 }], 0, asOf).current).toBe(50);
    expect(buildAging([{ date: daysAgo(31), total: 50 }], 0, asOf).d31_60).toBe(50);
  });
});
