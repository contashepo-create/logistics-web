"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, Select } from "@/components/ui";
import { ReceiptDialog } from "@/components/dialogs/operations";
import { listReceipts, deleteReceipt } from "@/lib/repo";
import { notify } from "@/components/toast";
import { money, todayIso, RECEIPT_TYPES } from "@/lib/format";
import { voucherNumberLabel } from "@/lib/calc";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function ReceiptsPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [type, setType] = useState<string>("");
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["receipts", dFrom, dTo, type],
    queryFn: () => listReceipts(dFrom, dTo, type || null),
  });

  const headers = ["رقم السند", "التاريخ", "النوع", "العميل / المصدر", "أودع في", "المبلغ", "البيان"];
  const rows = useMemo(
    () => (data ?? []).map((v) => [
      voucherNumberLabel("RV", v.number), v.date, RECEIPT_TYPES[v.voucher_type] ?? "—",
      v.customer_name || "—", v.account_name || "—", money(v.amount), v.description || "—",
    ]),
    [data]
  );

  const totals = {
    all: (data ?? []).reduce((a, v) => a + v.amount, 0),
    customers: (data ?? []).filter((v) => v.voucher_type === "customer").reduce((a, v) => a + v.amount, 0),
    other: (data ?? []).filter((v) => v.voucher_type === "other").reduce((a, v) => a + v.amount, 0),
  };

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف سند القبض هذا؟")) return;
    try {
      await deleteReceipt(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;

  return (
    <PageFrame title="سندات القبض" subtitle="تحصيل من العملاء (يقلل المديونية) أو إيرادات أخرى (تضاف للأرباح)"
      onAdd={() => setDialog({ mode: "add" })}
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["receipts"] })}>
          <div><label className="field-label">النوع</label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(RECEIPT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "سندات القبض", subtitle, headers, rows, mode: "excel" })}
        onPdf={() => exportPage({ title: "سندات القبض", subtitle, headers, rows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "سندات القبض", subtitle, headers, rows, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <>
          <DataTable headers={headers} rows={rows} ids={(data ?? []).map((v) => v.id)}
            onAction={(id, key) => {
              if (key === "view") setDialog({ mode: "view", id: Number(id) });
              else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
              else if (key === "delete") onDelete(Number(id));
            }} />
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "إجمالي المقبوضات", value: totals.all },
              { label: "تحصيل من عملاء", value: totals.customers },
              { label: "إيرادات أخرى", value: totals.other },
            ]} />
          </div>
        </>
      )}
      {dialog && <ReceiptDialog id={dialog.id} readOnly={dialog.mode === "view"} onClose={(saved) => { setDialog(null); if (saved) { qc.invalidateQueries({ queryKey: ["receipts"] }); qc.invalidateQueries({ queryKey: ["customers"] }); } }} />}
    </PageFrame>
  );
}
