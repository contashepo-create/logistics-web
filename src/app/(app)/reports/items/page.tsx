"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow } from "@/components/ui";
import { itemsUsageReport } from "@/lib/items";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

/** تقرير جميع الأصناف/الخدمات: كمية وإيراد كل خدمة من الاستخدام الفعلي في الفواتير. */
export default function ItemsReportPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());

  const { data, isLoading } = useQuery({
    queryKey: ["report-items", dFrom, dTo],
    queryFn: () => itemsUsageReport(dFrom, dTo),
    placeholderData: keepPreviousData,
  });

  const headers = ["الكود", "الخدمة", "النوع", "الخط (من ← إلى)", "الوحدة", "عدد النقلات", "إجمالي الكمية", "عدد الفواتير", "الإيراد قبل الضريبة", "الضريبة", "الإجمالي", "آخر استخدام"];
  const records = (data?.summary ?? []).map((r) => ({
    r,
    cells: [
      r.code || "—",
      r.name,
      r.item_type === "service" ? "خدمة" : r.item_type === "product" ? "صنف مخزني" : "غير محدد",
      r.from_loc && r.to_loc ? `${r.from_loc} ← ${r.to_loc}` : "—",
      r.unit || "—",
      String(r.trips_count),
      String(r.qty_total),
      String(r.invoices_count),
      money(r.revenue),
      money(r.vat_amount),
      money(r.total),
      r.last_date ?? "—",
    ],
  }));
  const rows = records.map((x) => x.cells);

  const t = data?.totals;
  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;
  const summary: [string, string | number][] = [
    ["عدد الخدمات في الكتالوج", t?.items_count ?? 0],
    ["خدمات مستخدمة فعلياً", t?.used_items_count ?? 0],
    ["عدد النقلات", t?.trips_count ?? 0],
    ["إجمالي الإيراد قبل الضريبة", money(t?.revenue ?? 0)],
    ["إجمالي الضريبة", money(t?.vat_amount ?? 0)],
    ["الإجمالي شامل الضريبة", money(t?.total ?? 0)],
  ];

  return (
    <PageFrame
      title="تقرير الخدمات والأصناف"
      subtitle="إيراد وكميات كل خدمة محسوبة من الاستخدام الفعلي في الفواتير — بلا كميات مخزنية"
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["report-items"] })} />
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "تقرير الخدمات والأصناف", subtitle, headers, rows, summaryLines: summary, mode: "excel" })}
        onPdf={() => exportPage({ title: "تقرير الخدمات والأصناف", subtitle, headers, rows, summaryLines: summary, mode: "pdf" })}
        onPrint={() => exportPage({ title: "تقرير الخدمات والأصناف", subtitle, headers, rows, summaryLines: summary, mode: "print" })}
      />}
    >
      {isLoading ? <Spinner /> : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{[...headers, "تقرير الخدمة"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {records.map(({ r, cells }, i) => (
                  <tr key={`${r.item_id ?? "n"}-${i}`}>
                    {cells.map((c, j) => <td key={j}>{c}</td>)}
                    <td>
                      {r.item_id != null
                        ? <button className="btn btn-sm" onClick={() => router.push(`/reports/items/${r.item_id}`)}>📄 تفصيلي</button>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
                {!records.length && (
                  <tr><td colSpan={headers.length + 1} style={{ color: "var(--muted)" }}>لا توجد خدمات بعد — أضفها من شاشة «الخدمات والأصناف»</td></tr>
                )}
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={5}>الإجمالي</td>
                  <td>{t?.trips_count ?? 0}</td>
                  <td>{t?.qty_total ?? 0}</td>
                  <td></td>
                  <td>{money(t?.revenue ?? 0)}</td>
                  <td>{money(t?.vat_amount ?? 0)}</td>
                  <td>{money(t?.total ?? 0)}</td>
                  <td></td><td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "الإيراد قبل الضريبة", value: t?.revenue ?? 0 },
              { label: "الضريبة", value: t?.vat_amount ?? 0 },
              { label: "الإجمالي شامل الضريبة", value: t?.total ?? 0 },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
