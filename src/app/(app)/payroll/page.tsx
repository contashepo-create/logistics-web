"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect } from "@/components/ui";
import { PayrollDialog } from "@/components/dialogs/payroll";
import { listPayrolls, listEmployees, deletePayroll } from "@/lib/repo";
import { notify } from "@/components/toast";
import { money, todayIso, EMP_TYPES, periodLabel } from "@/lib/format";
import { voucherNumberLabel } from "@/lib/calc";
import { exportPage } from "@/lib/exportHelper";
import { printPayrollSlip } from "@/lib/payrollPrint";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function PayrollPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);

  const { data: employees } = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees() });
  const { data, isLoading } = useQuery({
    queryKey: ["payrolls", dFrom, dTo, employeeId],
    queryFn: () => listPayrolls(dFrom, dTo, employeeId),
    placeholderData: keepPreviousData,
  });

  const headers = ["رقم الراتب", "تاريخ الصرف", "الموظف", "النوع", "عن شهر", "طريقة الصرف", "الأساسي", "الإضافات", "خصم السلف", "خصومات أخرى", "الصافي المنصرف"];
  const rows = useMemo(
    () => (data ?? []).map((p) => [
      voucherNumberLabel("PAY", p.number), p.date, p.employee_name || "—", EMP_TYPES[p.emp_type ?? ""] ?? "—",
      periodLabel(p.period_year, p.period_month), p.account_name || "—", money(p.base_salary), money(p.additions),
      money(p.advance_deduction), money(p.other_deductions), money(p.net_salary),
    ]),
    [data]
  );

  const total = (data ?? []).reduce((a, p) => a + p.net_salary, 0);
  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا الراتب؟\nستعود السلف المخصومة فيه إلى حالة غير مسددة.")) return;
    try {
      await deletePayroll(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["payrolls"] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <PageFrame title="إدارة الرواتب" subtitle="الصافي = الأساسي + الإضافات − خصم السلف − الخصومات الأخرى" addText="➕ إصدار راتب"
      onAdd={() => setDialog({ mode: "add" })}
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["payrolls"] })}>
          <div><label className="field-label">الموظف</label>
            <DictSelect value={employeeId} onChange={setEmployeeId} options={(employees ?? []).map((e) => ({ id: e.id, label: `${e.code} - ${e.name}` }))} placeholder="الكل" />
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "إدارة الرواتب", subtitle, headers, rows, mode: "excel" })}
        onPdf={() => exportPage({ title: "إدارة الرواتب", subtitle, headers, rows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "إدارة الرواتب", subtitle, headers, rows, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <>
          <DataTable headers={headers} rows={rows} ids={(data ?? []).map((p) => p.id)}
            extra={[{ key: "print-slip", label: "🖨️", title: "طباعة مسير هذا الموظف لهذا الشهر" }]}
            onAction={(id, key) => {
              if (key === "print-slip") void printPayrollSlip(Number(id));
              else if (key === "view") setDialog({ mode: "view", id: Number(id) });
              else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
              else if (key === "delete") onDelete(Number(id));
            }} />
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[{ label: "إجمالي الرواتب المنصرفة (الصافي)", value: total }]} />
          </div>
        </>
      )}
      {dialog && <PayrollDialog id={dialog.id} readOnly={dialog.mode === "view"} onClose={(saved) => { setDialog(null); if (saved) qc.invalidateQueries({ queryKey: ["payrolls"] }); }} />}
    </PageFrame>
  );
}
