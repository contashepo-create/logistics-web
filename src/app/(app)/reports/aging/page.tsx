"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, Button } from "@/components/ui";
import { suppliersAging } from "@/lib/suppliers";
import { money } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

export default function AgingReportPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["aging-suppliers"], queryFn: () => suppliersAging() });

  const headers = ["المورّد", "حتى 30 يوم", "31 – 60", "61 – 90", "أكثر من 90", "الإجمالي المستحق"];
  const rows = useMemo(
    () => (data ?? []).map((r) => [r.name, money(r.current), money(r.d31_60), money(r.d61_90), money(r.over90), money(r.total)]),
    [data]
  );

  const totals = useMemo(() => {
    const src = data ?? [];
    return {
      current: src.reduce((a, r) => a + r.current, 0),
      d31_60: src.reduce((a, r) => a + r.d31_60, 0),
      d61_90: src.reduce((a, r) => a + r.d61_90, 0),
      over90: src.reduce((a, r) => a + r.over90, 0),
      total: src.reduce((a, r) => a + r.total, 0),
    };
  }, [data]);

  const summaryLines: [string, string][] = [
    ["حتى 30 يوم", money(totals.current)],
    ["31 – 60 يوم", money(totals.d31_60)],
    ["61 – 90 يوم", money(totals.d61_90)],
    ["أكثر من 90 يوم", money(totals.over90)],
    ["الإجمالي المستحق", money(totals.total)],
  ];

  return (
    <PageFrame
      title="أعمار ديون الموردين"
      subtitle="توزيع المستحق لكل مورّد حسب عمر الفاتورة (السداد يُخصم بأسلوب الأقدم أولاً)"
      toolbar={<Button onClick={() => qc.invalidateQueries({ queryKey: ["aging-suppliers"] })}>🔄 تحديث</Button>}
      exportBar={
        <ExportBar
          onExcel={() => exportPage({ title: "أعمار ديون الموردين", headers, rows, summaryLines, mode: "excel" })}
          onPdf={() => exportPage({ title: "أعمار ديون الموردين", headers, rows, summaryLines, mode: "pdf" })}
          onPrint={() => exportPage({ title: "أعمار ديون الموردين", headers, rows, summaryLines, mode: "print" })}
        />
      }
    >
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>لا توجد مستحقات قائمة للموردين 🎉</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={j === 4 && (data ?? [])[i].over90 > 0 ? "cell-danger" : undefined}>{c}</td>
                    ))}
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td>الإجمالي</td>
                  <td>{money(totals.current)}</td>
                  <td>{money(totals.d31_60)}</td>
                  <td>{money(totals.d61_90)}</td>
                  <td>{money(totals.over90)}</td>
                  <td>{money(totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "حتى 30 يوم", value: totals.current },
              { label: "31 – 60", value: totals.d31_60 },
              { label: "61 – 90", value: totals.d61_90 },
              { label: "أكثر من 90", value: totals.over90 },
              { label: "الإجمالي المستحق", value: totals.total },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
