"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect } from "@/components/ui";
import { employeeStatement, voucherNumberLabel, invoiceNumberLabel } from "@/lib/calc";
import { listEmployees } from "@/lib/repo";
import { money, todayIso, periodLabel } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function EmployeeStatementReportPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [tab, setTab] = useState(0);

  const { data: employees } = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees() });
  const { data: st, isLoading } = useQuery({
    queryKey: ["report-emp-stmt", employeeId, dFrom, dTo],
    queryFn: () => employeeId ? employeeStatement(employeeId, dFrom, dTo) : null,
    enabled: !!employeeId,
  });

  const salHeaders = ["رقم", "التاريخ", "عن شهر", "الأساسي", "إضافات", "خصم سلف", "خصومات أخرى", "الصافي"];
  const advHeaders = ["رقم السلفة", "التاريخ", "القيمة", "المسدد", "المتبقي", "تفاصيل السداد"];
  const allowHeaders = ["الفاتورة", "التاريخ", "الرحلة", "سعر النقلة", "بدل التريب"];

  const salRows = (st?.salaries ?? []).map((p) => [voucherNumberLabel("PAY", p.number), p.date, periodLabel(p.period_year, p.period_month), money(p.base_salary), money(p.additions), money(p.advance_deduction), money(p.other_deductions), money(p.net_salary)]);
  const advRows = (st?.advances ?? []).map((a) => [voucherNumberLabel("PV", a.number), a.date, money(a.amount), money(a.settled), money(a.remaining), (a.settlements ?? []).map((s: any) => `مسير PAY-${String(s.pnum ?? "").padStart(5, "0")}${s.period ? ` (${s.period})` : ""} بتاريخ ${s.pdate}: ${money(s.amount)}`).join(" | ") || "لم يُخصم منها شيء بعد"]);
  const allowRows = (st?.allowances ?? []).map((a: any) => [invoiceNumberLabel(a.inv_number), a.inv_date, a.route, money(a.price), money(a.trip_allowance)]);

  const t = st?.totals ?? { salaries_net: 0, advances_total: 0, advances_remaining: 0, allowances_total: 0 };
  const employeeLabel = employees?.find((e) => e.id === employeeId)?.name ?? "";
  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;

  const tabNames = [" — الرواتب", " — السلف", " — بدلات التريب"];
  const current = tab === 0 ? { h: salHeaders, r: salRows, name: "الرواتب" } : tab === 1 ? { h: advHeaders, r: advRows, name: "السلف" } : { h: allowHeaders, r: allowRows, name: "بدلات التريب" };

  const summary: [string, string | number][] = [
    ["الموظف", employeeLabel],
    ["إجمالي الرواتب الصافية", money(t.salaries_net)],
    ["إجمالي السلف", money(t.advances_total)],
    ["المتبقي من السلف", money(t.advances_remaining)],
    ["إجمالي بدلات التريب", money(t.allowances_total)],
  ];

  return (
    <PageFrame title="كشف حساب موظف / سائق" subtitle="الرواتب المنصرفة تفصيلياً + سجل السلف وتسوياتها + بدلات التريب من الفواتير"
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["report-emp-stmt"] })}>
          <div><label className="field-label">الموظف</label>
            <DictSelect value={employeeId} onChange={setEmployeeId} options={(employees ?? []).map((e) => ({ id: e.id, label: `${e.code} - ${e.name}` }))} />
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: `كشف حساب موظف/سائق${tabNames[tab]}`, subtitle, headers: current.h, rows: current.r, summaryLines: summary, mode: "excel" })}
        onPdf={() => exportPage({ title: `كشف حساب موظف/سائق${tabNames[tab]}`, subtitle, headers: current.h, rows: current.r, summaryLines: summary, mode: "pdf" })}
        onPrint={() => exportPage({ title: `كشف حساب موظف/سائق${tabNames[tab]}`, subtitle, headers: current.h, rows: current.r, summaryLines: summary, mode: "print" })} />}>
      {isLoading ? <Spinner /> : !employeeId ? (
        <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>اختر الموظف لعرض الكشف</div>
      ) : (
        <>
          <div className="tabs-head">
            <button className={tab === 0 ? "active" : ""} onClick={() => setTab(0)}>الرواتب المنصرفة</button>
            <button className={tab === 1 ? "active" : ""} onClick={() => setTab(1)}>سجل السلف</button>
            <button className={tab === 2 ? "active" : ""} onClick={() => setTab(2)}>بدلات التريب من الفواتير</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{current.h.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {current.r.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                {!current.r.length && <tr><td colSpan={current.h.length} style={{ color: "var(--muted)" }}>لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "إجمالي الرواتب الصافية", value: t.salaries_net },
              { label: "إجمالي السلف", value: t.advances_total },
              { label: "المتبقي من السلف", value: t.advances_remaining },
              { label: "إجمالي بدلات التريب", value: t.allowances_total },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
