"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { AdvanceArchiveDialog } from "@/components/dialogs/payroll";
import { DictSelect, ExportBar, FilterRow, PageFrame, Select, Spinner, TotalsBar } from "@/components/ui";
import { listAdvanceTracking } from "@/lib/calc";
import { exportPage } from "@/lib/exportHelper";
import { money, todayIso } from "@/lib/format";
import { listEmployees } from "@/lib/repo";

const STATUS_LABELS = { open: "لم تُخصم", partial: "مخصومة جزئياً", closed: "مسدّدة بالكامل" } as const;
function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function AdvancesPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [status, setStatus] = useState<"open" | "partial" | "closed" | "">("");
  const [archive, setArchive] = useState<{ id: number; name: string } | null>(null);

  const { data: employees } = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees() });
  const { data, isLoading } = useQuery({
    queryKey: ["advances-tracking", dFrom, dTo, employeeId, status],
    queryFn: () => listAdvanceTracking({ dFrom, dTo, employeeId, status: status || null }),
    placeholderData: keepPreviousData,
  });

  const headers = ["رقم السلفة", "تاريخ الصرف", "الموظف", "صُرفت من", "قيمة السلفة", "المخصوم", "المتبقي", "الحالة", "آخر خصم", "البيان"];
  const exportRows = useMemo(() => (data ?? []).map((row) => [
    `PV-${String(row.number).padStart(5, "0")}`, row.date, row.employee_name, row.account_label,
    money(row.amount), money(row.settled), money(row.remaining), STATUS_LABELS[row.status],
    row.last_settled_date || "—", row.description || "—",
  ]), [data]);
  const rows = useMemo(() => (data ?? []).map((row, index) => exportRows[index].map((cell, cellIndex) =>
    cellIndex === 7
      ? <span key={cellIndex} className={`advance-status advance-${row.status}`}>{cell}</span>
      : cell
  )), [data, exportRows]);

  const totals = useMemo(() => ({
    total: (data ?? []).reduce((sum, row) => sum + row.amount, 0),
    settled: (data ?? []).reduce((sum, row) => sum + row.settled, 0),
    remaining: (data ?? []).reduce((sum, row) => sum + row.remaining, 0),
  }), [data]);
  const subtitle = `مرجع السلفيات من ${dFrom} إلى ${dTo} — التسجيل يتم حصراً من سند الدفع`;

  return (
    <PageFrame
      title="إدارة ومتابعة السلفيات"
      subtitle="قسم للمتابعة والمرجعية فقط؛ لا يمكن تسجيل سلفة جديدة أو تعديلها من هنا"
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["advances-tracking"] })}>
          <div>
            <label className="field-label">الموظف</label>
            <DictSelect value={employeeId} onChange={setEmployeeId} options={(employees ?? []).map((e) => ({ id: e.id, label: `${e.code} - ${e.name}` }))} placeholder="كل الموظفين" />
          </div>
          <div>
            <label className="field-label">الحالة</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="">كل الحالات</option>
              <option value="open">لم تُخصم</option>
              <option value="partial">مخصومة جزئياً</option>
              <option value="closed">مسدّدة بالكامل</option>
            </Select>
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "متابعة السلفيات", subtitle, headers, rows: exportRows, mode: "excel" })}
        onPdf={() => exportPage({ title: "متابعة السلفيات", subtitle, headers, rows: exportRows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "متابعة السلفيات", subtitle, headers, rows: exportRows, mode: "print" })}
      />}
    >
      <div className="reference-only-note">ℹ️ لإصدار سلفة جديدة: افتح <b>سندات الدفع</b> واختر النوع «سلفة موظف/سائق».</div>
      {isLoading ? <Spinner /> : (
        <>
          <DataTable
            headers={headers}
            rows={rows}
            ids={(data ?? []).map((row) => row.id)}
            actions={[]}
            extra={[{ key: "archive", label: "📚", title: "عرض أرشيف الموظف وتسويات الرواتب" }]}
            onAction={(id) => {
              const row = (data ?? []).find((item) => item.id === Number(id));
              if (row) setArchive({ id: row.employee_id, name: row.employee_name });
            }}
          />
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "إجمالي السلف", value: totals.total },
              { label: "إجمالي المخصوم", value: totals.settled },
              { label: "إجمالي المتبقي", value: totals.remaining },
            ]} />
          </div>
        </>
      )}
      {archive && <AdvanceArchiveDialog employeeId={archive.id} employeeName={archive.name} onClose={() => setArchive(null)} />}
    </PageFrame>
  );
}
