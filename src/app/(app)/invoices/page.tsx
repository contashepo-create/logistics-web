"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect } from "@/components/ui";
import { InvoiceDialog, exportCustomerInvoicePdf, printCustomerInvoice } from "@/components/dialogs/operations";
import { invoiceList } from "@/lib/calc";
import { listCustomers, deleteInvoice } from "@/lib/repo";
import { notify } from "@/components/toast";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function InvoicesPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);

  const { data: customers } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const { data, isLoading } = useQuery({
    queryKey: ["invoices", dFrom, dTo, customerId],
    queryFn: () => invoiceList(dFrom, dTo, customerId),
  });

  const headers = ["رقم الفاتورة", "التاريخ", "العميل", "عدد النقلات", "إجمالي النقلات", "المصروفات المباشرة", "الربح المتوقع", "مصاريف لاحقة (سندات)", "الربح الفعلي"];
  const rows = useMemo(
    () => (data ?? []).map((inv) => [
      `INV-${String(inv.number).padStart(5, "0")}`, inv.date, inv.customer_name, String(inv.trips_count),
      money(inv.trips_total), money(inv.expenses_total), money(inv.expected_profit),
      money(inv.later_payments), money(inv.actual_profit),
    ]),
    [data]
  );

  const totals = {
    trips: (data ?? []).reduce((a, i) => a + i.trips_total, 0),
    expenses: (data ?? []).reduce((a, i) => a + i.expenses_total, 0),
    profit: (data ?? []).reduce((a, i) => a + i.actual_profit, 0),
  };

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف هذه الفاتورة وكل نقلاتها؟")) return;
    try {
      await deleteInvoice(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;

  return (
    <PageFrame title="فواتير النقل" subtitle="رأس الفاتورة + النقلات والمصروفات — الربح الفعلي يشمل مصاريف السندات اللاحقة"
      onAdd={() => setDialog({ mode: "add" })}
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["invoices"] })}>
          <div><label className="field-label">العميل</label>
            <DictSelect value={customerId} onChange={setCustomerId} options={(customers ?? []).map((c) => ({ id: c.id, label: `${c.code} - ${c.name}` }))} placeholder="الكل" />
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "فواتير النقل", subtitle, headers, rows, mode: "excel" })}
        onPdf={() => exportPage({ title: "فواتير النقل", subtitle, headers, rows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "فواتير النقل", subtitle, headers, rows, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <>
          <DataTable headers={headers} rows={rows} ids={(data ?? []).map((i) => i.id)}
            extra={[
              { key: "print", label: "🖨️", title: "طباعة فاتورة العميل" },
              { key: "pdf", label: "📄", title: "حفظ فاتورة العميل PDF" },
            ]}
            onAction={(id, key) => {
              if (key === "view") setDialog({ mode: "view", id: Number(id) });
              else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
              else if (key === "delete") onDelete(Number(id));
              else if (key === "print") printCustomerInvoice(Number(id));
              else if (key === "pdf") exportCustomerInvoicePdf(Number(id));
            }} />
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "إجمالي النقلات", value: totals.trips },
              { label: "إجمالي المصروفات المباشرة", value: totals.expenses },
              { label: "إجمالي الأرباح الفعلية", value: totals.profit },
            ]} />
          </div>
        </>
      )}
      {dialog && <InvoiceDialog id={dialog.id} readOnly={dialog.mode === "view"} onClose={(saved) => { setDialog(null); if (saved) { qc.invalidateQueries({ queryKey: ["invoices"] }); qc.invalidateQueries({ queryKey: ["customers"] }); } }} />}
    </PageFrame>
  );
}
