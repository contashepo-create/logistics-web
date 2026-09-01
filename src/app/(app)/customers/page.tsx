"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, Balance } from "@/components/ui";
import { CustomerDialog } from "@/components/dialogs/master";
import { CustomerStatementDialog } from "@/components/statements";
import { customersWithBalance } from "@/lib/calc";
import { deleteCustomer } from "@/lib/repo";
import { notify } from "@/components/toast";
import { money, balanceText } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";
import { matchesSearch } from "@/components/ui";

export default function CustomersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);
  const [statementId, setStatementId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["customers"], queryFn: customersWithBalance });

  // صفوف نصية (للبحث والتصدير) وصفوف معروضة (بالرصيد الملوّن)
  const textRows = useMemo(
    () => (data ?? []).map((c) => [c.code, c.name, c.phone || "—", c.address || "—", money(c.opening_balance), balanceText(c.balance)]),
    [data]
  );
  const viewRows = useMemo(
    () => (data ?? []).map((c, i) => [...textRows[i].slice(0, 5), <Balance key={c.id} value={c.balance} pill />]),
    [data, textRows]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return { ids: (data ?? []).map((c) => c.id), rows: viewRows, text: textRows };
    const pairs = (data ?? [])
      .map((c, i) => ({ id: c.id, row: viewRows[i], text: textRows[i] }))
      .filter((p) => matchesSearch(search, p.text));
    return { ids: pairs.map((p) => p.id), rows: pairs.map((p) => p.row), text: pairs.map((p) => p.text) };
  }, [data, viewRows, textRows, search]);

  const headers = ["الكود", "اسم العميل", "رقم الهاتف", "العنوان", "الرصيد الافتتاحي", "الرصيد الحالي (له/عليه)"];

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا العميل؟")) return;
    try {
      await deleteCustomer(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <PageFrame
      title="جدول العملاء"
      subtitle="أرصدة العملاء تُحدَّث تلقائياً من الفواتير وسندات القبض"
      addText="➕ إضافة"
      onAdd={() => setDialog({ mode: "add" })}
      search={search}
      onSearch={setSearch}
      exportBar={
        <ExportBar
          onExcel={() => exportPage({ title: "جدول العملاء", headers, rows: filtered.text, mode: "excel" })}
          onPdf={() => exportPage({ title: "جدول العملاء", headers, rows: filtered.text, mode: "pdf" })}
          onPrint={() => exportPage({ title: "جدول العملاء", headers, rows: filtered.text, mode: "print" })}
        />
      }
    >
      {isLoading ? <Spinner /> : (
        <DataTable
          headers={headers}
          rows={filtered.rows}
          ids={filtered.ids}
          extra={[{ key: "statement", label: "📄", title: "كشف حساب العميل" }]}
          onAction={(id, key) => {
            if (key === "view") setDialog({ mode: "view", id: Number(id) });
            else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
            else if (key === "delete") onDelete(Number(id));
            else if (key === "statement") setStatementId(Number(id));
          }}
        />
      )}
      {dialog && (
        <CustomerDialog
          id={dialog.id}
          readOnly={dialog.mode === "view"}
          onClose={(saved) => {
            setDialog(null);
            if (saved) qc.invalidateQueries({ queryKey: ["customers"] });
          }}
        />
      )}
      {statementId != null && <CustomerStatementDialog customerId={statementId} onClose={() => setStatementId(null)} />}
    </PageFrame>
  );
}
