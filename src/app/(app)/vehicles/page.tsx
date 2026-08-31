"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, matchesSearch } from "@/components/ui";
import { VehicleDialog } from "@/components/dialogs/master";
import { listVehicles, deleteVehicle } from "@/lib/repo";
import { notify } from "@/components/toast";
import { exportPage } from "@/lib/exportHelper";

export default function VehiclesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["vehicles"], queryFn: listVehicles });

  const headers = ["الكود", "رقم اللوحة", "النوع", "السائق الافتراضي"];
  const rows = useMemo(() => (data ?? []).map((v) => [v.code, v.plate_number, v.vehicle_type || "—", v.driver_name || "—"]), [data]);
  const filtered = useMemo(() => {
    if (!search.trim()) return { ids: (data ?? []).map((v) => v.id), rows };
    const pairs = (data ?? []).map((v, i) => ({ id: v.id, row: rows[i] })).filter((p) => matchesSearch(search, p.row));
    return { ids: pairs.map((p) => p.id), rows: pairs.map((p) => p.row) };
  }, [data, rows, search]);

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف هذه السيارة؟")) return;
    try {
      await deleteVehicle(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["vehicles"] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <PageFrame title="جدول السيارات" subtitle="سيارات الشركة مع السائق الافتراضي لكل سيارة"
      onAdd={() => setDialog({ mode: "add" })} search={search} onSearch={setSearch}
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "جدول السيارات", headers, rows: filtered.rows, mode: "excel" })}
        onPdf={() => exportPage({ title: "جدول السيارات", headers, rows: filtered.rows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "جدول السيارات", headers, rows: filtered.rows, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <DataTable headers={headers} rows={filtered.rows} ids={filtered.ids}
          onAction={(id, key) => {
            if (key === "view") setDialog({ mode: "view", id: Number(id) });
            else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
            else if (key === "delete") onDelete(Number(id));
          }} />
      )}
      {dialog && <VehicleDialog id={dialog.id} readOnly={dialog.mode === "view"} onClose={(saved) => { setDialog(null); if (saved) qc.invalidateQueries({ queryKey: ["vehicles"] }); }} />}
    </PageFrame>
  );
}
