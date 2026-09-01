"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageFrame, Spinner, Button, Balance } from "@/components/ui";
import { getInvoiceFull } from "@/lib/calc";
import { listCreditDebitNotesForInvoice } from "@/lib/repo";
import { printCustomerInvoice, exportCustomerInvoicePdf } from "@/components/dialogs/operations";
import CreditDebitNoteDialog from "@/components/CreditDebitNoteDialog";
import { money, balanceText } from "@/lib/format";

export default function InvoiceViewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const id = Number(params.id);
  const [noteDialog, setNoteDialog] = useState<"credit" | "debit" | null>(null);

  const { data: inv, isLoading } = useQuery({
    queryKey: ["invoice-full", id],
    queryFn: () => getInvoiceFull(id),
    enabled: Number.isFinite(id) && id > 0,
  });
  const { data: notes } = useQuery({
    queryKey: ["invoices-notes", id],
    queryFn: () => listCreditDebitNotesForInvoice(id),
    enabled: Number.isFinite(id) && id > 0,
  });

  if (isLoading) return <PageFrame title="عرض الفاتورة"><Spinner /></PageFrame>;
  if (!inv) {
    return (
      <PageFrame title="عرض الفاتورة">
        <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>
          الفاتورة غير موجودة.
          <div style={{ marginTop: 12 }}><Button onClick={() => router.push("/invoices")}>→ عودة للفواتير</Button></div>
        </div>
      </PageFrame>
    );
  }

  const headers = ["#", "الرحلة", "السيارة", "السائق", "العدد", "سعر الوحدة", "الإجمالي", "ملاحظات"];
  const rows = inv.trips.map((t, i) => [
    String(i + 1), `${t.from_loc || "—"} ← ${t.to_loc || "—"}`,
    t.vehicle_name ?? "—", t.driver_name ?? "—", String(t.qty ?? 1),
    money(t.unit_price || (t.qty ? t.price / t.qty : t.price)), money(t.price), t.notes || "—",
  ]);

  const notesRows = (notes ?? []).map((n) => [
    `${n.note_type === "debit" ? "إشعار مدين" : "إشعار دائن"} ${n.note_type === "debit" ? "DN" : "CN"}-${String(n.number).padStart(5, "0")}`,
    n.date,
    n.reason || "—",
    n.note_type === "debit" ? money(n.total ?? 0) : "—",
    n.note_type === "credit" ? money(n.total ?? 0) : "—",
  ]);

  return (
    <PageFrame
      title={`فاتورة نقل INV-${String(inv.number).padStart(5, "0")}`}
      subtitle={`العميل: ${inv.customer_name} | التاريخ: ${inv.date} | الحالة: غير قابلة للتعديل`}
      toolbar={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={() => router.push("/invoices")}>→ عودة للفواتير</Button>
          <Button variant="primary" onClick={() => printCustomerInvoice(id)}>🖨️ طباعة</Button>
          <Button onClick={() => exportCustomerInvoicePdf(id)}>📄 PDF</Button>
          <Button onClick={() => setNoteDialog("debit")}>➕ إشعار مدين</Button>
          <Button onClick={() => setNoteDialog("credit")}>➖ إشعار دائن</Button>
        </div>
      }
    >
      <div className="inv-view-grid">
        <div className="group-box">
          <div className="group-title">بيانات الفاتورة</div>
          <table className="data-table">
            <tbody>
              <tr><td>العميل</td><td>{inv.customer_name} ({inv.customer_code})</td></tr>
              <tr><td>التاريخ</td><td>{inv.date}</td></tr>
              {inv.container_number ? <tr><td>رقم الحاوية</td><td dir="ltr">{inv.container_number}</td></tr> : null}
              <tr><td>عدد النقلات</td><td>{inv.trips_count}</td></tr>
              <tr><td>نسبة الضريبة</td><td>{inv.vat_rate}%</td></tr>
              <tr className="total-row"><td>الإجمالي المستحق</td><td>{money(inv.customer_total)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="group-box">
          <div className="group-title">ملخص مالي</div>
          <table className="data-table">
            <tbody>
              <tr><td>إجمالي النقلات</td><td>{money(inv.trips_total)}</td></tr>
              <tr><td>المصروفات المباشرة</td><td>{money(inv.expenses_total)}</td></tr>
              <tr><td>سندات صرف لاحقة</td><td>{money(inv.later_payments)}</td></tr>
              <tr><td>الربح الفعلي</td><td><Balance value={inv.actual_profit} /></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="inv-sec-title"><span>بنود النقل</span></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>

      {inv.notes && (
        <>
          <div className="inv-sec-title" style={{ marginTop: 14 }}><span>ملاحظات الفاتورة</span></div>
          <div className="exp-hint">{inv.notes}</div>
        </>
      )}

      <div className="inv-sec-title" style={{ marginTop: 14 }}>
        <span>إشعارات مدين/دائن الصادرة على هذه الفاتورة</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>رقم الإشعار</th><th>التاريخ</th><th>السبب</th><th>مدين</th><th>دائن</th></tr></thead>
          <tbody>
            {notesRows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
            {!notesRows.length && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>لا توجد إشعارات بعد.</td></tr>}
          </tbody>
        </table>
      </div>

      {noteDialog && (
        <CreditDebitNoteDialog
          invoiceId={inv.id}
          customerId={inv.customer_id}
          invoiceNumber={inv.number}
          noteType={noteDialog}
          defaultAmount={inv.customer_total && inv.vat_rate > 0 ? Math.round((inv.customer_total / (1 + inv.vat_rate / 100)) * 100) / 100 : inv.customer_total}
          defaultVatRate={inv.vat_rate}
          onClose={(saved) => {
            setNoteDialog(null);
            if (saved) {
              qc.invalidateQueries({ queryKey: ["invoices-notes", id] });
              qc.invalidateQueries({ queryKey: ["customers"] });
              qc.invalidateQueries({ queryKey: ["invoices"] });
            }
          }}
        />
      )}
    </PageFrame>
  );
}
