"use client";

import { useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect } from "@/components/ui";
import { customerStatement } from "@/lib/calc";
import { listCustomers } from "@/lib/repo";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function CustomerStatementReportPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [customerId, setCustomerId] = useState<number | null>(null);

  const { data: customers } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const { data: st, isLoading } = useQuery({
    queryKey: ["report-cust-stmt", customerId, dFrom, dTo],
    queryFn: () => customerId ? customerStatement(customerId, dFrom, dTo) : null,
    placeholderData: keepPreviousData,
    enabled: !!customerId,
  });

  const headers = ["التاريخ", "المستند", "البيان", "مدين (عليه)", "دائن (له)", "الرصيد"];
  const rows = (st?.rows ?? []).map((r) => [r.date, r.doc, r.desc, money(r.debit), money(r.credit), money(r.balance)]);
  const invTotal = (st?.rows ?? []).reduce((a, r) => a + r.debit, 0);
  const recTotal = (st?.rows ?? []).reduce((a, r) => a + r.credit, 0);

  const customerLabel = customers?.find((c) => c.id === customerId)?.name ?? "";
  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;

  return (
    <PageFrame title="كشف حساب عميل" subtitle="الرصيد الافتتاحي + الفواتير − سندات القبض = الرصيد الحالي"
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["report-cust-stmt"] })}>
          <div><label className="field-label">العميل</label>
            <DictSelect value={customerId} onChange={setCustomerId} options={(customers ?? []).map((c) => ({ id: c.id, label: `${c.code} - ${c.name}` }))} />
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "كشف حساب عميل", subtitle, headers, rows, summaryLines: [
          ["العميل", customerLabel], ["الرصيد الافتتاحي", money(st?.opening ?? 0)],
          ["إجمالي الفواتير", money(invTotal)], ["إجمالي التحصيل", money(recTotal)],
          ["الرصيد الحالي", money(st?.closing ?? 0)],
        ], mode: "excel" })}
        onPdf={() => exportPage({ title: "كشف حساب عميل", subtitle, headers, rows, summaryLines: [
          ["العميل", customerLabel], ["الرصيد الافتتاحي", money(st?.opening ?? 0)],
          ["إجمالي الفواتير", money(invTotal)], ["إجمالي التحصيل", money(recTotal)],
          ["الرصيد الحالي", money(st?.closing ?? 0)],
        ], mode: "pdf" })}
        onPrint={() => exportPage({ title: "كشف حساب عميل", subtitle, headers, rows, summaryLines: [
          ["العميل", customerLabel], ["الرصيد الافتتاحي", money(st?.opening ?? 0)],
          ["إجمالي الفواتير", money(invTotal)], ["إجمالي التحصيل", money(recTotal)],
          ["الرصيد الحالي", money(st?.closing ?? 0)],
        ], mode: "print" })} />}>
      {isLoading ? <Spinner /> : !customerId ? (
        <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>اختر العميل لعرض الكشف</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                <tr style={{ fontWeight: 700 }}><td></td><td>الإجمالي / الرصيد النهائي</td><td></td><td>{money(invTotal)}</td><td>{money(recTotal)}</td><td>{money(st?.closing ?? 0)}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "الرصيد الافتتاحي", value: st?.opening ?? 0 },
              { label: "إجمالي الفواتير", value: invTotal },
              { label: "إجمالي التحصيل", value: recTotal },
              { label: "الرصيد الحالي", value: st?.closing ?? 0 },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
