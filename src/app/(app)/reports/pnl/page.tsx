"use client";

import { useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow } from "@/components/ui";
import { pnlReport } from "@/lib/calc";
import { money, todayIso, PURCHASE_EXPENSE_CATEGORIES } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function PnlReportPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());

  const { data, isLoading } = useQuery({
    queryKey: ["report-pnl", dFrom, dTo],
    queryFn: () => pnlReport(dFrom, dTo),
    placeholderData: keepPreviousData,
  });

  const d = data ?? {};
  const purchaseRows: [string, number][] = Object.entries(PURCHASE_EXPENSE_CATEGORIES)
    .map(([key, label]) => [`مشتريات — ${label}`, d[`purchase_${key}`] ?? 0] as [string, number])
    .filter(([, value]) => Math.abs(value) > 0.009);
  const rows: [string, number][] = [
    ["إيرادات النقلات", d.transport_revenue ?? 0],
    ["الإيرادات الأخرى (خردة / متنوع)", d.other_revenue ?? 0],
    ["إشعارات مدين (زيادة إيراد)", d.debit_notes_adjust ?? 0],
    ["إشعارات دائن (حسم / تخفيض إيراد)", d.credit_notes_adjust ?? 0],
    ["إجمالي الإيرادات", d.total_revenue ?? 0],
    ["مصروفات النقلات المباشرة (تريب/بنزين/كارتة)", d.direct_expenses ?? 0],
    ["سندات صرف على النقلات (يدوية)", d.trip_payments ?? 0],
    ["الرواتب الصافية المنصرفة", d.salaries ?? 0],
    ["إجمالي السلفيات المسجلة", d.advances ?? 0],
    ["مصاريف الصيانة (سندات السيارات)", d.maintenance ?? 0],
    ["المصاريف العامة المباشرة", d.general_expenses ?? 0],
    ...purchaseRows,
    ["إجمالي فواتير المشتريات قبل ضريبة المدخلات", d.purchase_expenses ?? 0],
    ["سحب نقدي لصاحب المنشأة (مصاريف خاصة بالمالك)", d.owner_withdrawals ?? 0],
    ["إجمالي المصروفات", d.total_expenses ?? 0],
    ["ضريبة القيمة المضافة المحصلة (مرجعي — ليست ربحاً)", d.vat_collected ?? 0],
    ["صافي الربح / (الخسارة) للفترة", d.net ?? 0],
  ];

  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;
  const summary: [string, string | number][] = [
    ["إجمالي الإيرادات", money(d.total_revenue ?? 0)],
    ["إجمالي المصروفات", money(d.total_expenses ?? 0)],
    ["صافي الربح / الخسارة", money(d.net ?? 0)],
  ];

  return (
    <PageFrame title="تقرير الأرباح والخسائر الشامل (P&L)" subtitle="فواتير المشتريات تظهر حسب بند المصروف المختار، سواء كانت نقدية أو آجلة"
      toolbar={<FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["report-pnl"] })} />}
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "تقرير الأرباح والخسائر الشامل (P&L)", subtitle, headers: ["البيان", "القيمة"], rows: rows.map(([k, v]) => [k, money(v)]), summaryLines: summary, mode: "excel" })}
        onPdf={() => exportPage({ title: "تقرير الأرباح والخسائر الشامل (P&L)", subtitle, headers: ["البيان", "القيمة"], rows: rows.map(([k, v]) => [k, money(v)]), summaryLines: summary, mode: "pdf" })}
        onPrint={() => exportPage({ title: "تقرير الأرباح والخسائر الشامل (P&L)", subtitle, headers: ["البيان", "القيمة"], rows: rows.map(([k, v]) => [k, money(v)]), summaryLines: summary, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>البيان</th><th>القيمة</th></tr></thead>
              <tbody>
                {rows.map(([k, v], i) => (
                  <tr key={i} style={i === rows.length - 1 ? { fontWeight: 700 } : undefined}><td>{k}</td><td>{money(v)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "إجمالي الإيرادات", value: d.total_revenue ?? 0 },
              { label: "إجمالي المصروفات", value: d.total_expenses ?? 0 },
              { label: "صافي الربح / الخسارة", value: d.net ?? 0 },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
