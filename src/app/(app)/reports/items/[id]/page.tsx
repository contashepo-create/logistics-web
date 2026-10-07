"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, Button } from "@/components/ui";
import { itemUsageReport, isRouteItem } from "@/lib/items";
import { invoiceNumberLabel } from "@/lib/calc";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

/** تقرير خدمة واحدة (خط): كل نقلاتها وإيرادها والعملاء المستخدمون لها. */
export default function ItemReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const id = Number(params.id);
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());

  const { data, isLoading } = useQuery({
    queryKey: ["report-item", id, dFrom, dTo],
    queryFn: () => itemUsageReport(id, dFrom, dTo),
    placeholderData: keepPreviousData,
    enabled: Number.isFinite(id) && id > 0,
  });

  const item = data?.item ?? null;
  const route = item && isRouteItem(item) ? `${item.from_loc} ← ${item.to_loc}` : "خدمة عامة بلا خط";
  const headers = ["التاريخ", "الفاتورة", "العميل", "الكود", "النقلة (من ← إلى)", "الكمية", "سعر الوحدة", "الإيراد", "الضريبة", "الإجمالي", "الحاويات"];
  const rows = (data?.lines ?? []).map((l) => [
    l.date,
    invoiceNumberLabel(l.invoice_number),
    l.customer_name,
    l.customer_code,
    `${l.from_loc || "—"} ← ${l.to_loc || "—"}`,
    String(l.qty),
    money(l.unit_price),
    money(l.amount),
    money(l.vat_amount),
    money(l.total),
    l.container_numbers.length ? l.container_numbers.join("، ") : "—",
  ]);

  const t = data?.totals;
  const subtitle = `الخدمة: ${item?.name ?? "—"}${item?.code ? ` (${item.code})` : ""} — الخط: ${route} — الفترة: من ${dFrom} إلى ${dTo}`;
  const summary: [string, string | number][] = [
    ["الخدمة", item?.name ?? "—"],
    ["الكود", item?.code ?? "—"],
    ["الخط", route],
    ["عدد النقلات", t?.trips_count ?? 0],
    ["إجمالي الكمية", t?.qty_total ?? 0],
    ["عدد الفواتير", t?.invoices_count ?? 0],
    ["الإيراد قبل الضريبة", money(t?.revenue ?? 0)],
    ["الضريبة", money(t?.vat_amount ?? 0)],
    ["الإجمالي شامل الضريبة", money(t?.total ?? 0)],
  ];

  return (
    <PageFrame
      title="تقرير خدمة (خط)"
      subtitle={subtitle}
      toolbar={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Button onClick={() => router.push("/reports/items")}>→ كل الخدمات</Button>
          <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["report-item", id] })} />
        </div>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: `تقرير خدمة - ${item?.name ?? ""}`, subtitle, headers, rows, summaryLines: summary, mode: "excel" })}
        onPdf={() => exportPage({ title: `تقرير خدمة - ${item?.name ?? ""}`, subtitle, headers, rows, summaryLines: summary, mode: "pdf" })}
        onPrint={() => exportPage({ title: `تقرير خدمة - ${item?.name ?? ""}`, subtitle, headers, rows, summaryLines: summary, mode: "print" })}
      />}
    >
      {isLoading ? <Spinner /> : !item ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>الخدمة غير موجودة.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                {!rows.length && (
                  <tr><td colSpan={headers.length} style={{ color: "var(--muted)" }}>لا توجد نقلات لهذه الخدمة في الفترة المحددة</td></tr>
                )}
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={5}>الإجمالي</td>
                  <td>{t?.qty_total ?? 0}</td><td></td>
                  <td>{money(t?.revenue ?? 0)}</td>
                  <td>{money(t?.vat_amount ?? 0)}</td>
                  <td>{money(t?.total ?? 0)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "عدد النقلات", value: t?.trips_count ?? 0 },
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
