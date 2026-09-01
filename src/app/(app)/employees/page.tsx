"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, matchesSearch } from "@/components/ui";
import { EmployeeDialog } from "@/components/dialogs/master";
import { AdvanceArchiveDialog } from "@/components/dialogs/payroll";
import { listEmployees, deleteEmployee } from "@/lib/repo";
import { notify } from "@/components/toast";
import { EMP_TYPES, money } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

export default function EmployeesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);
  const [archive, setArchive] = useState<{ id: number; name: string } | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees() });

  const headers = ["الكود", "الاسم", "رقم الهاتف", "النوع", "الراتب الأساسي", "ملاحظات"];
  const rows = useMemo(
    () => (data ?? []).map((e) => [
      e.code, e.name, e.phone || "—", EMP_TYPES[e.emp_type] ?? e.emp_type,
      e.base_salary ? money(e.base_salary) : "—", (e.notes || "—").slice(0, 40),
    ]),
    [data]
  );
  const filtered = useMemo(() => {
    if (!search.trim()) return { ids: (data ?? []).map((e) => e.id), rows };
    const pairs = (data ?? []).map((e, i) => ({ id: e.id, row: rows[i] })).filter((p) => matchesSearch(search, p.row));
    return { ids: pairs.map((p) => p.id), rows: pairs.map((p) => p.row) };
  }, [data, rows, search]);

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا الموظف؟")) return;
    try {
      await deleteEmployee(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <PageFrame
      title="جدول الموظفين والسائقين"
      subtitle="سجل الموظفين (سائقين وإداريين)"
      onAdd={() => setDialog({ mode: "add" })}
      search={search} onSearch={setSearch}
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "جدول الموظفين والسائقين", headers, rows: filtered.rows, mode: "excel" })}
        onPdf={() => exportPage({ title: "جدول الموظفين والسائقين", headers, rows: filtered.rows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "جدول الموظفين والسائقين", headers, rows: filtered.rows, mode: "print" })} />}
    >
      {isLoading ? <Spinner /> : (
        <DataTable headers={headers} rows={filtered.rows} ids={filtered.ids}
          extra={[{ key: "advances", label: "💰", title: "أرشيف السلفيات" }]}
          onAction={(id, key) => {
            if (key === "view") setDialog({ mode: "view", id: Number(id) });
            else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
            else if (key === "delete") onDelete(Number(id));
            else if (key === "advances") {
              const emp = (data ?? []).find((x) => x.id === Number(id));
              setArchive({ id: Number(id), name: emp?.name ?? "" });
            }
          }} />
      )}
      {archive && <AdvanceArchiveDialog employeeId={archive.id} employeeName={archive.name} onClose={() => setArchive(null)} />}
      {dialog && <EmployeeDialog id={dialog.id} readOnly={dialog.mode === "view"} onClose={(saved) => { setDialog(null); if (saved) qc.invalidateQueries({ queryKey: ["employees"] }); }} />}
    </PageFrame>
  );
}
