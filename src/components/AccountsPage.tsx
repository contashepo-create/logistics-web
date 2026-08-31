"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, matchesSearch } from "@/components/ui";
import { AccountDialog } from "@/components/dialogs/master";
import { AccountStatementDialog } from "@/components/statements";
import { accountsWithBalance } from "@/lib/calc";
import { deleteAccount } from "@/lib/repo";
import { notify } from "@/components/toast";
import { money } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

export function AccountsPage({ kind }: { kind: "cashbox" | "bank" }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);
  const [statementId, setStatementId] = useState<number | null>(null);
  const { data, isLoading } = useQuery({ queryKey: [kind], queryFn: () => accountsWithBalance(kind) });

  const isBank = kind === "bank";
  const headers = isBank
    ? ["رقم السجل", "اسم البنك", "تاريخ الإنشاء", "رقم الحساب", "الآيبان (IBAN)", "الرصيد الافتتاحي", "الرصيد الحالي"]
    : ["الرقم", "اسم الخزينة", "تاريخ الإنشاء", "الرصيد الافتتاحي", "الرصيد الحالي"];

  const rows = useMemo(
    () =>
      (data ?? []).map((a) => {
        const base = [a.code, a.name, a.created_date];
        if (isBank) base.push((a as any).account_number || "—", (a as any).iban || "—");
        base.push(money(a.opening_balance), money(a.balance));
        return base;
      }),
    [data, isBank]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return { ids: (data ?? []).map((a) => a.id), rows };
    const pairs = (data ?? []).map((a, i) => ({ id: a.id, row: rows[i] })).filter((p) => matchesSearch(search, p.row));
    return { ids: pairs.map((p) => p.id), rows: pairs.map((p) => p.row) };
  }, [data, rows, search]);

  const title = isBank ? "البنوك" : "الخزائن (صناديق النقد)";
  const subtitle = isBank ? "الحسابات البنكية — الرصيد يُحدَّث تلقائياً" : "مصدر الأموال النقدية — الرصيد يُحدَّث تلقائياً";

  const onDelete = async (id: number) => {
    const lbl = isBank ? "بنك" : "خزينة";
    if (!window.confirm(`هل أنت متأكد من حذف هذا ال${lbl}؟`)) return;
    try {
      await deleteAccount(kind, id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: [kind] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <PageFrame title={title} subtitle={subtitle}
      onAdd={() => setDialog({ mode: "add" })} search={search} onSearch={setSearch}
      exportBar={<ExportBar
        onExcel={() => exportPage({ title, headers, rows: filtered.rows, mode: "excel" })}
        onPdf={() => exportPage({ title, headers, rows: filtered.rows, mode: "pdf" })}
        onPrint={() => exportPage({ title, headers, rows: filtered.rows, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <DataTable headers={headers} rows={filtered.rows} ids={filtered.ids}
          extra={[{ key: "statement", label: "📄", title: `كشف حساب ${isBank ? "البنك" : "الخزينة"}` }]}
          onAction={(id, key) => {
            if (key === "view") setDialog({ mode: "view", id: Number(id) });
            else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
            else if (key === "delete") onDelete(Number(id));
            else if (key === "statement") setStatementId(Number(id));
          }} />
      )}
      {dialog && <AccountDialog kind={kind} id={dialog.id} readOnly={dialog.mode === "view"} onClose={(saved) => { setDialog(null); if (saved) qc.invalidateQueries({ queryKey: [kind] }); }} />}
      {statementId != null && <AccountStatementDialog kind={kind} accountId={statementId} onClose={() => setStatementId(null)} />}
    </PageFrame>
  );
}
