"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageFrame, Spinner, Button, Balance } from "@/components/ui";
import { getInvoiceFull } from "@/lib/calc";
import { listCreditDebitNotesForInvoice } from "@/lib/repo";
import { printCustomerInvoice, exportCustomerInvoicePdf } from "@/components/dialogs/operations";
import CreditDebitNoteDialog from "@/components/CreditDebitNoteDialog";
import { money, EXPENSE_TYPES } from "@/lib/format";

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

  const number = `INV-${String(inv.number).padStart(5, "0")}`;
  const subtotal = Math.round((inv.trips_total + (inv.billable_total ?? 0)) * 100) / 100;
  const invoiceLines = [
    ...inv.trips.map((trip) => ({
      key: `trip-${trip.id}`,
      description: `خدمة نقل: ${trip.from_loc || "—"} ← ${trip.to_loc || "—"}`,
      detail: [trip.vehicle_name, trip.notes].filter(Boolean).join(" • "),
      quantity: Number(trip.qty ?? 1),
      unitAmount: Number(trip.unit_price || (trip.qty ? trip.price / trip.qty : trip.price)),
      total: Number(trip.price),
    })),
    ...inv.trips.flatMap((trip) => (trip.expenses ?? [])
      .filter((expense) => expense.source === "customer")
      .map((expense, index) => ({
        key: `billable-${trip.id}-${expense.id ?? index}`,
        description: expense.notes || EXPENSE_TYPES[expense.expense_type] || "بند إضافي",
        detail: `${trip.from_loc || "—"} ← ${trip.to_loc || "—"}`,
        quantity: Number(expense.qty ?? 1),
        unitAmount: Number(expense.unit_amount || expense.amount),
        total: Number(expense.amount),
      }))),
  ];

  const notesRows = (notes ?? []).map((note) => ({
    ...note,
    label: `${note.note_type === "debit" ? "DN" : "CN"}-${String(note.number).padStart(5, "0")}`,
  }));
  const debitNotes = notesRows.filter((n) => n.note_type === "debit").reduce((sum, n) => sum + Number(n.total ?? 0), 0);
  const creditNotes = notesRows.filter((n) => n.note_type === "credit").reduce((sum, n) => sum + Number(n.total ?? 0), 0);

  return (
    <PageFrame
      title={`فاتورة ${number}`}
      subtitle="معاينة واضحة للفاتورة الصادرة — التصحيح يتم بإشعار مدين أو دائن"
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
      <section className="invoice-preview-card" aria-label="معاينة الفاتورة">
        <header className="invoice-preview-head">
          <div>
            <span className="invoice-preview-kicker">{inv.vat_rate > 0 ? "فاتورة ضريبية" : "فاتورة نقل"}</span>
            <h2>{number}</h2>
            <p>تاريخ الإصدار: <b>{inv.date}</b></p>
          </div>
          <div className="invoice-preview-customer">
            <span>العميل</span>
            <strong>{inv.customer_name}</strong>
            <small>كود العميل: {inv.customer_code}</small>
          </div>
        </header>

        {(inv.container_number || inv.customer?.tax_number || inv.customer?.address) && (
          <div className="invoice-preview-meta">
            {inv.container_number && <div><span>رقم الحاوية</span><b dir="ltr">{inv.container_number}</b></div>}
            {inv.customer?.tax_number && <div><span>الرقم الضريبي للعميل</span><b dir="ltr">{inv.customer.tax_number}</b></div>}
            {inv.customer?.address && <div><span>عنوان العميل</span><b>{inv.customer.address}</b></div>}
          </div>
        )}

        <div className="invoice-preview-table-wrap">
          <table className="invoice-preview-table">
            <thead>
              <tr><th>#</th><th>بيان الخدمة</th><th>العدد</th><th>سعر الوحدة</th><th>الإجمالي قبل الضريبة</th></tr>
            </thead>
            <tbody>
              {invoiceLines.map((line, index) => (
                <tr key={line.key}>
                  <td>{index + 1}</td>
                  <td><strong>{line.description}</strong>{line.detail && <small>{line.detail}</small>}</td>
                  <td>{line.quantity}</td>
                  <td>{money(line.unitAmount)}</td>
                  <td><strong>{money(line.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="invoice-preview-bottom">
          <div className="invoice-preview-note">
            <span>ملاحظات الفاتورة</span>
            <p>{inv.notes || "لا توجد ملاحظات إضافية."}</p>
          </div>
          <div className="invoice-totals" aria-label="إجماليات الفاتورة">
            <div><span>الإجمالي الخاضع للضريبة</span><b>{money(subtotal)}</b></div>
            <div className="vat-row"><span>ضريبة القيمة المضافة ({inv.vat_rate}%)</span><b>{money(inv.vat_amount)}</b></div>
            <div className="grand-total"><span>الإجمالي شامل الضريبة</span><b>{money(inv.customer_total)}</b></div>
          </div>
        </div>
      </section>

      <section className="invoice-internal-panel">
        <div className="invoice-section-heading">
          <div><span>للمراجعة الداخلية فقط</span><h3>الملخص التشغيلي</h3></div>
          <small>لا تظهر هذه الأرقام في فاتورة العميل المطبوعة</small>
        </div>
        <div className="invoice-internal-grid">
          <div><span>تكاليف مباشرة</span><b>{money(inv.expenses_total)}</b></div>
          <div><span>سندات صرف لاحقة</span><b>{money(inv.later_payments)}</b></div>
          <div><span>عدد سطور النقل</span><b>{inv.trips_count}</b></div>
          <div><span>صافي النتيجة التشغيلية</span><Balance value={inv.actual_profit} /></div>
        </div>
      </section>

      <section className="invoice-adjustments-panel">
        <div className="invoice-section-heading">
          <div><span>التصحيحات النظامية</span><h3>الإشعارات المدينة والدائنة</h3></div>
          {notesRows.length > 0 && <small>الصافي بعد الإشعارات: {money(inv.customer_total + debitNotes - creditNotes)}</small>}
        </div>
        {notesRows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>الإشعار</th><th>التاريخ</th><th>السبب</th><th>الأثر</th></tr></thead>
              <tbody>{notesRows.map((note) => (
                <tr key={note.id}>
                  <td><b>{note.label}</b></td>
                  <td>{note.date}</td>
                  <td>{note.reason || "—"}</td>
                  <td className={note.note_type === "debit" ? "invoice-note-debit" : "invoice-note-credit"}>
                    {note.note_type === "debit" ? "+" : "−"}{money(note.total ?? 0)}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="invoice-empty-state">لا توجد إشعارات مرتبطة بهذه الفاتورة.</div>}
      </section>

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
