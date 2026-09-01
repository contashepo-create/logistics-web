"use client";

import { useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect } from "@/components/ui";
import { tripProfitsReport } from "@/lib/calc";
import { listCustomers } from "@/lib/repo";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function TripsReportPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [customerId, setCustomerId] = useState<number | null>(null);

  const { data: customers } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const { data, isLoading } = useQuery({
    queryKey: ["report-trips", dFrom, dTo, customerId],
    queryFn: () => tripProfitsReport(dFrom, dTo, customerId),
    placeholderData: keepPreviousData,
  });

  const headers = ["رقم الفاتورة", "التاريخ", "العميل", "الرحلة (من ← إلى)", "السيارة", "السائق", "الإيراد", "مصاريف مباشرة", "مصاريف لاحقة (سندات)", "صافي الربح الفعلي"];
  const rows = (data ?? []).map((t: any) => [t.invoice, t.date, t.customer, t.route, t.vehicle, t.driver, money(t.revenue), money(t.direct), money(t.later), money(t.net)]);
  const totals = {
    rev: (data ?? []).reduce((a, t: any) => a + t.revenue, 0),
    direct: (data ?? []).reduce((a, t: any) => a + t.direct, 0),
    later: (data ?? []).reduce((a, t: any) => a + t.later, 0),
    net: (data ?? []).reduce((a, t: any) => a + t.net, 0),
  };

  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;
  const summary: [string, string | number][] = [
    ["عدد الرحلات", (data ?? []).length],
    ["إجمالي الإيرادات", money(totals.rev)],
    ["إجمالي المصاريف المباشرة", money(totals.direct)],
    ["إجمالي المصاريف اللاحقة", money(totals.later)],
    ["صافي الأرباح الفعلية", money(totals.net)],
  ];

  return (
    <PageFrame title="تقرير أرباح الفواتير والرحلات" subtitle="الإيرادات − المصاريف المباشرة وقت الفاتورة − المصاريف اللاحقة من سندات الدفع = صافي الربح الفعلي لكل رحلة"
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["report-trips"] })}>
          <div><label className="field-label">العميل</label>
            <DictSelect value={customerId} onChange={setCustomerId} options={(customers ?? []).map((c) => ({ id: c.id, label: `${c.code} - ${c.name}` }))} placeholder="الكل" />
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "تقرير أرباح الفواتير والرحلات", subtitle, headers, rows, summaryLines: summary, mode: "excel" })}
        onPdf={() => exportPage({ title: "تقرير أرباح الفواتير والرحلات", subtitle, headers, rows, summaryLines: summary, mode: "pdf" })}
        onPrint={() => exportPage({ title: "تقرير أرباح الفواتير والرحلات", subtitle, headers, rows, summaryLines: summary, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                {!rows.length && <tr><td colSpan={headers.length} style={{ color: "var(--muted)" }}>لا توجد بيانات</td></tr>}
                <tr style={{ fontWeight: 700 }}><td>الإجمالي</td><td></td><td></td><td></td><td></td><td></td><td>{money(totals.rev)}</td><td>{money(totals.direct)}</td><td>{money(totals.later)}</td><td>{money(totals.net)}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "الإيرادات", value: totals.rev },
              { label: "المصاريف المباشرة", value: totals.direct },
              { label: "المصاريف اللاحقة", value: totals.later },
              { label: "صافي الأرباح الفعلية", value: totals.net },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
