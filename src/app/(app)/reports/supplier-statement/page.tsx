"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect } from "@/components/ui";
import { listSuppliers, supplierStatement } from "@/lib/suppliers";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

export default function SupplierStatementPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [supplierId, setSupplierId] = useState<number | null>(null);

  const { data: suppliers } = useQuery({ queryKey: ["suppliers-list"], queryFn: listSuppliers });
  const { data: st, isLoading } = useQuery({
    queryKey: ["report-supp-stmt", supplierId, dFrom, dTo],
    queryFn: () => (supplierId ? supplierStatement(supplierId, dFrom, dTo) : null),
    enabled: !!supplierId,
  });

  const headers = ["التاريخ", "المستند", "البيان", "مشتريات (له)", "مدفوعات (عليه)", "الرصيد"];
  const rows = (st?.rows ?? []).map((r) => [r.date || "—", r.doc, r.desc, money(r.credit), money(r.debit), money(r.balance)]);

  const supplierLabel = suppliers?.find((s) => s.id === supplierId)?.name ?? "";
  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;
  const summaryLines: [string, string][] = [
    ["المورّد", supplierLabel],
    ["إجمالي المشتريات", money(st?.totals.credit ?? 0)],
    ["إجمالي المدفوعات", money(st?.totals.debit ?? 0)],
    ["الرصيد المستحق", money(st?.totals.balance ?? 0)],
  ];

  return (
    <PageFrame
      title="كشف حساب مورّد"
      subtitle="الرصيد الافتتاحي + فواتير المشتريات − سندات الدفع = المستحق للمورّد"
      toolbar={
        <FilterRow
          dFrom={dFrom}
          dTo={dTo}
          onFrom={setDFrom}
          onTo={setDTo}
          onRefresh={() => qc.invalidateQueries({ queryKey: ["report-supp-stmt"] })}
        >
          <div>
            <label className="field-label">المورّد</label>
            <DictSelect
              value={supplierId}
              onChange={setSupplierId}
              options={(suppliers ?? []).map((s) => ({ id: s.id, label: `${s.code} - ${s.name}` }))}
            />
          </div>
        </FilterRow>
      }
      exportBar={
        <ExportBar
          onExcel={() => exportPage({ title: "كشف حساب مورّد", subtitle, headers, rows, summaryLines, mode: "excel" })}
          onPdf={() => exportPage({ title: "كشف حساب مورّد", subtitle, headers, rows, summaryLines, mode: "pdf" })}
          onPrint={() => exportPage({ title: "كشف حساب مورّد", subtitle, headers, rows, summaryLines, mode: "print" })}
        />
      }
    >
      {isLoading ? (
        <Spinner />
      ) : !supplierId ? (
        <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>اختر المورّد لعرض الكشف</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                <tr style={{ fontWeight: 700 }}>
                  <td></td><td>الإجمالي / الرصيد النهائي</td><td></td>
                  <td>{money(st?.totals.credit ?? 0)}</td>
                  <td>{money(st?.totals.debit ?? 0)}</td>
                  <td>{money(st?.totals.balance ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "إجمالي المشتريات", value: st?.totals.credit ?? 0 },
              { label: "إجمالي المدفوعات", value: st?.totals.debit ?? 0 },
              { label: "المستحق للمورّد", value: st?.totals.balance ?? 0 },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
