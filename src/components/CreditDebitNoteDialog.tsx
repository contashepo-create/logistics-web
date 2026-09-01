"use client";

import { useState } from "react";
import { Modal, Field, Textarea, AmountInput, DateInput, Button } from "@/components/ui";
import { notify } from "@/components/toast";
import { saveCreditDebitNote } from "@/lib/repo";
import { money, todayIso } from "@/lib/format";

export default function CreditDebitNoteDialog({
  invoiceId,
  customerId,
  invoiceNumber,
  noteType,
  defaultAmount,
  defaultVatRate,
  onClose,
}: {
  invoiceId: number;
  customerId: number;
  invoiceNumber: number;
  noteType: "credit" | "debit";
  defaultAmount?: number;
  defaultVatRate?: number;
  onClose: (saved?: boolean) => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState(String(defaultAmount ?? ""));
  const [vatRate, setVatRate] = useState(String(defaultVatRate ?? 15));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const amt = parseFloat(String(amount).replace(/,/g, "")) || 0;
  const vr = parseFloat(vatRate) || 0;
  const total = Math.round((amt * (1 + vr / 100)) * 100) / 100;
  const typeLabel = noteType === "debit" ? "إشعار مدين (زيادة مستحق العميل)" : "إشعار دائن (حسم/تخفيض مستحق العميل)";

  const save = async () => {
    if (!(amt > 0)) return notify("أدخل مبلغاً صحيحاً أكبر من صفر.", "error");
    if (!reason.trim()) return notify("اكتب سبب الإشعار (إلزامي للمراجعة المحاسبية).", "error");
    setSaving(true);
    try {
      await saveCreditDebitNote({
        note_type: noteType,
        invoice_id: invoiceId,
        customer_id: customerId,
        date,
        amount: amt,
        vat_rate: vr,
        reason,
      });
      notify(`تم حفظ ${noteType === "debit" ? "الإشعار المدين" : "الإشعار الدائن"} بنجاح.`, "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={typeLabel} onClose={() => onClose()} width={560}>
      <div className="group-box" style={{ marginTop: 0 }}>
        <div className="group-title">على الفاتورة الأساسية</div>
        <table className="data-table">
          <tbody>
            <tr><td>رقم الفاتورة</td><td>INV-{String(invoiceNumber).padStart(5, "0")}</td></tr>
            <tr><td>نوع الإشعار</td><td>{typeLabel}</td></tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="التاريخ" required><DateInput value={date} onChange={setDate} /></Field>
        <Field label="المبلغ قبل الضريبة" required><AmountInput value={amount} onChange={setAmount} /></Field>
      </div>
      <Field label="نسبة الضريبة %">
        <AmountInput value={vatRate} onChange={setVatRate} />
      </Field>
      <div className="field-hint" style={{ marginBottom: 8 }}>
        الإجمالي شامل الضريبة: <b>{money(total)}</b>
      </div>
      <Field label="سبب الإشعار" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: ارتجاع من العميل، خصم، زيادة كمية…" />
      </Field>

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Button variant="primary" onClick={save} disabled={saving}>💾 حفظ الإشعار</Button>
        <Button onClick={() => onClose()}>إلغاء</Button>
      </div>
    </Modal>
  );
}
