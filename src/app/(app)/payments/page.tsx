"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, Select } from "@/components/ui";
import { listPayments, deletePayment } from "@/lib/repo";
import { notify } from "@/components/toast";
import { money, todayIso, PAYMENT_TYPES } from "@/lib/format";
import { voucherNumberLabel, invoiceNumberLabel } from "@/lib/calc";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function PaymentsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [type, setType] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["payments", dFrom, dTo, type],
    queryFn: () => listPayments(dFrom, dTo, type || null),
    placeholderData: keepPreviousData,
  });

  const headers = ["رقم السند", "التاريخ", "النوع", "التوجيه", "صرف من", "المبلغ", "البيان"];
  const rows = useMemo(
    () => (data ?? []).map((v) => {
      let target = "مصروف عام";
      if (v.voucher_type === "trip") target = `رحلة بفاتورة ${invoiceNumberLabel(v.inv_number ?? 0)} (${v.customer_name || "—"})`;
      else if (v.voucher_type === "advance") target = `سلفة: ${v.employee_name || "—"}`;
      else if (v.voucher_type === "vehicle") target = `سيارة: ${v.plate_number || "—"}`;
      else if (v.voucher_type === "supplier") target = `مورّد: ${v.supplier_name || "—"}`;
      else if (v.voucher_type === "owner") target = "صاحب المنشأة (سحب نقدي)";
      return [voucherNumberLabel("PV", v.number), v.date, PAYMENT_TYPES[v.voucher_type] ?? "—", target, v.account_name || "—", money(v.amount), v.description || "—"];
    }),
    [data]
  );

  const total = (data ?? []).reduce((a, v) => a + v.amount, 0);
  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}`;

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف سند الدفع هذا؟")) return;
    try {
      await deletePayment(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["report-trips"] });
      qc.invalidateQueries({ queryKey: ["report-pnl"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <PageFrame title="سندات الدفع" subtitle="مصروف رحلة / سلفة موظف / مصروف سيارة / سداد مورّد / مصروف عام — الإدخال في صفحة كاملة"
      addText="➕ سند دفع جديد"
      onAdd={() => router.push("/payments/new")}
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["payments"] })}>
          <div><label className="field-label">النوع</label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(PAYMENT_TYPES).filter(([k]) => k !== "purchase").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "سندات الدفع", subtitle, headers, rows, mode: "excel" })}
        onPdf={() => exportPage({ title: "سندات الدفع", subtitle, headers, rows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "سندات الدفع", subtitle, headers, rows, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <>
          <DataTable headers={headers} rows={rows} ids={(data ?? []).map((v) => v.id)}
            onAction={(id, key) => {
              if (key === "view") router.push(`/payments/${Number(id)}?mode=view`);
              else if (key === "edit") router.push(`/payments/${Number(id)}?mode=edit`);
              else if (key === "delete") onDelete(Number(id));
            }} />
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[{ label: "إجمالي المدفوعات", value: total }]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
