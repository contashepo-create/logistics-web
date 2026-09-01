"use client";

import { useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect } from "@/components/ui";
import { vehicleReport } from "@/lib/calc";
import { listVehicles } from "@/lib/repo";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function VehiclesReportPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [vehicleId, setVehicleId] = useState<number | null>(null);

  const { data: vehicles } = useQuery({ queryKey: ["vehicles"], queryFn: listVehicles });
  const { data, isLoading } = useQuery({
    queryKey: ["report-vehicles", dFrom, dTo, vehicleId],
    queryFn: () => vehicleReport(dFrom, dTo, vehicleId),
    placeholderData: keepPreviousData,
  });

  const headers = ["الكود", "رقم اللوحة", "النوع", "عدد النقلات", "الإيرادات", "مصروفات مباشرة", "صيانة (سندات دفع)", "صافي ربحية السيارة"];
  const rows = (data ?? []).map((v: any) => [v.code, v.plate, v.vtype || "—", String(v.trips), money(v.revenue), money(v.direct), money(v.maintenance), money(v.net)]);
  const totals = {
    trips: (data ?? []).reduce((a, v: any) => a + v.trips, 0),
    rev: (data ?? []).reduce((a, v: any) => a + v.revenue, 0),
    direct: (data ?? []).reduce((a, v: any) => a + v.direct, 0),
    maint: (data ?? []).reduce((a, v: any) => a + v.maintenance, 0),
    net: (data ?? []).reduce((a, v: any) => a + v.net, 0),
  };

  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;
  const summary: [string, string | number][] = [
    ["عدد السيارات", (data ?? []).length],
    ["إجمالي الإيرادات", money(totals.rev)],
    ["إجمالي المصروفات المباشرة", money(totals.direct)],
    ["إجمالي الصيانة", money(totals.maint)],
    ["صافي الربحية", money(totals.net)],
  ];

  return (
    <PageFrame title="تقرير أداء السيارات" subtitle="إيرادات السيارة من الفواتير − مصروفات رحلاتها − صيانتها من سندات الدفع"
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["report-vehicles"] })}>
          <div><label className="field-label">السيارة</label>
            <DictSelect value={vehicleId} onChange={setVehicleId} options={(vehicles ?? []).map((v) => ({ id: v.id, label: `${v.code} - ${v.plate_number}` }))} placeholder="الكل" />
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "تقرير أداء السيارات", subtitle, headers, rows, summaryLines: summary, mode: "excel" })}
        onPdf={() => exportPage({ title: "تقرير أداء السيارات", subtitle, headers, rows, summaryLines: summary, mode: "pdf" })}
        onPrint={() => exportPage({ title: "تقرير أداء السيارات", subtitle, headers, rows, summaryLines: summary, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                {rows.length > 0 && <tr style={{ fontWeight: 700 }}><td>الإجمالي</td><td></td><td></td><td>{totals.trips}</td><td>{money(totals.rev)}</td><td>{money(totals.direct)}</td><td>{money(totals.maint)}</td><td>{money(totals.net)}</td></tr>}
                {!rows.length && <tr><td colSpan={headers.length} style={{ color: "var(--muted)" }}>لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "الإيرادات", value: totals.rev },
              { label: "المصروفات المباشرة", value: totals.direct },
              { label: "الصيانة", value: totals.maint },
              { label: "صافي الربحية", value: totals.net },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
