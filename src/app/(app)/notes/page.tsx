"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, Select, Button } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { listCreditDebitNotes, deleteCreditDebitNote } from "@/lib/repo";
import { notify } from "@/components/toast";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function NotesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [type, setType] = useState<"" | "credit" | "debit">("");

  const { data, isLoading } = useQuery({
    queryKey: ["notes", dFrom, dTo, type],
    queryFn: () => listCreditDebitNotes(dFrom, dTo, type || null),
    placeholderData: keepPreviousData,
  });

  const headers = ["رقم الإشعار", "النوع", "الفاتورة", "العميل", "التاريخ", "المبلغ قبل الضريبة", "الضريبة %", "الإجمالي", "السبب"];
  const rows = (data ?? []).map((n) => [
    `${n.note_type === "debit" ? "DN" : "CN"}-${String(n.number).padStart(5, "0")}`,
    n.note_type === "debit" ? "🔺 مدين" : "🔻 دائن",
    n.invoice_number ? `INV-${String(n.invoice_number).padStart(5, "0")}` : "—",
    n.customer_name ?? "—",
    n.date,
    money(n.amount),
    `${n.vat_rate}%`,
    money(n.total ?? 0),
    n.reason || "—",
  ]);

  const totals = {
    debit: (data ?? []).filter((n) => n.note_type === "debit").reduce((a, n) => a + (n.total ?? 0), 0),
    credit: (data ?? []).filter((n) => n.note_type === "credit").reduce((a, n) => a + (n.total ?? 0), 0),
  };

  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;
  const summary: [string, string][] = [
    ["إجمالي الإشعارات المدينة", money(totals.debit)],
    ["إجمالي الإشعارات الدائنة", money(totals.credit)],
    ["أثر صافي على الإيرادات", money(totals.debit - totals.credit)],
  ];

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا الإشعار؟ سيُعاد حساب الأرصدة والتقارير تلقائياً.")) return;
    try {
      await deleteCreditDebitNote(id);
      notify("تم حذف الإشعار.", "success");
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["report-pnl"] });
      qc.invalidateQueries({ queryKey: ["report-trips"] });
      qc.invalidateQueries({ queryKey: ["report-cust-stmt"] });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  return (
    <PageFrame
      title="إشعارات الدائن والمدين"
      subtitle="تصحيحات الفواتير الصادرة — المدين يزيد المستحق على العميل، والدائن يخصمه"
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["notes"] })}>
          <div>
            <label className="field-label">النوع</label>
            <Select value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="">الكل</option>
              <option value="debit">مدين</option>
              <option value="credit">دائن</option>
            </Select>
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "إشعارات الدائن والمدين", subtitle, headers, rows, summaryLines: summary, mode: "excel" })}
        onPdf={() => exportPage({ title: "إشعارات الدائن والمدين", subtitle, headers, rows, summaryLines: summary, mode: "pdf" })}
        onPrint={() => exportPage({ title: "إشعارات الدائن والمدين", subtitle, headers, rows, summaryLines: summary, mode: "print" })}
      />}
    >
      {isLoading ? <Spinner /> : (
        <>
          <DataTable
            headers={headers}
            rows={rows}
            ids={(data ?? []).map((n) => n.id)}
            actions={[]}
            extra={[
              { key: "view", label: "👁️", title: "عرض الفاتورة" },
              { key: "delete", label: "🗑️", title: "حذف الإشعار", danger: true },
            ]}
            onAction={(id, key) => {
              const note = (data ?? []).find((n) => n.id === Number(id));
              if (key === "view" && note?.invoice_id) router.push(`/invoices/${note.invoice_id}`);
              else if (key === "delete") onDelete(Number(id));
            }}
          />
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "إجمالي المدينة", value: totals.debit },
              { label: "إجمالي الدائنة", value: totals.credit },
              { label: "الأثر الصافي", value: totals.debit - totals.credit },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
