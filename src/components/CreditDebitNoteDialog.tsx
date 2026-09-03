"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, Field, Textarea, AmountInput, DateInput, Button } from "@/components/ui";
import { notify } from "@/components/toast";
import { listCreditableInvoiceTrips, saveCreditDebitNote } from "@/lib/repo";
import type { CreditableInvoiceTrip } from "@/lib/types";
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
  const isTripReturn = noteType === "credit";
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState(String(defaultAmount ?? ""));
  const [vatRate, setVatRate] = useState(String(defaultVatRate ?? 15));
  const [reason, setReason] = useState("");
  const [trips, setTrips] = useState<CreditableInvoiceTrip[]>([]);
  const [selectedTripIds, setSelectedTripIds] = useState<number[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(isTripReturn);
  const [tripsError, setTripsError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isTripReturn) return;
    let active = true;
    setLoadingTrips(true);
    setTripsError("");
    listCreditableInvoiceTrips(invoiceId)
      .then((rows) => { if (active) setTrips(rows); })
      .catch((error) => {
        if (active) setTripsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (active) setLoadingTrips(false); });
    return () => { active = false; };
  }, [invoiceId, isTripReturn]);

  const selectedTrips = useMemo(
    () => trips.filter((trip) => selectedTripIds.includes(trip.id) && !trip.already_credited),
    [trips, selectedTripIds]
  );
  const availableTrips = trips.filter((trip) => !trip.already_credited);
  const selectedAmount = Math.round(selectedTrips.reduce((sum, trip) => sum + trip.amount, 0) * 100) / 100;
  // الخادم يحسب الضريبة على مجموع النقلات المختارة كما تفعل الفاتورة الأصلية؛
  // لا نجمع تقريب ضريبة كل سطر حتى لا يظهر فرق هللة عند اختيار أكثر من نقلة.
  const creditVatRate = Number(defaultVatRate ?? 0);
  const selectedVat = Math.round((selectedAmount * creditVatRate / 100) * 100) / 100;
  const selectedTotal = Math.round((selectedAmount + selectedVat) * 100) / 100;
  const manualAmount = parseFloat(String(amount).replace(/,/g, "")) || 0;
  const manualVatRate = parseFloat(vatRate) || 0;
  const manualTotal = Math.round((manualAmount * (1 + manualVatRate / 100)) * 100) / 100;
  const typeLabel = noteType === "debit"
    ? "إشعار مدين (زيادة مستحق العميل)"
    : "إشعار دائن بمرتجع نقلة (تخفيض مستحق العميل)";

  const toggleTrip = (tripId: number, checked: boolean) => {
    setSelectedTripIds((current) => checked
      ? (current.includes(tripId) ? current : [...current, tripId])
      : current.filter((id) => id !== tripId));
  };

  const toggleAll = (checked: boolean) => {
    setSelectedTripIds(checked ? availableTrips.map((trip) => trip.id) : []);
  };

  const save = async () => {
    if (isTripReturn && selectedTrips.length === 0) {
      return notify("اختر نقلة واحدة على الأقل لإصدار الإشعار الدائن.", "error");
    }
    if (!isTripReturn && !(manualAmount > 0)) return notify("أدخل مبلغاً صحيحاً أكبر من صفر.", "error");
    if (!reason.trim()) return notify("اكتب سبب الإشعار (إلزامي للمراجعة المحاسبية).", "error");
    setSaving(true);
    try {
      await saveCreditDebitNote({
        note_type: noteType,
        invoice_id: invoiceId,
        customer_id: customerId,
        date,
        ...(isTripReturn
          ? { trip_ids: selectedTrips.map((trip) => trip.id) }
          : { amount: manualAmount, vat_rate: manualVatRate }),
        reason,
      });
      notify(`تم حفظ ${noteType === "debit" ? "الإشعار المدين" : "الإشعار الدائن للنقلات المختارة"} بنجاح.`, "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={typeLabel} onClose={() => onClose()} width={isTripReturn ? 920 : 560}>
      <div className="group-box" style={{ marginTop: 0 }}>
        <div className="group-title">على الفاتورة الأساسية</div>
        <table className="data-table">
          <tbody>
            <tr><td>رقم الفاتورة</td><td>INV-{String(invoiceNumber).padStart(5, "0")}</td></tr>
            <tr><td>نوع الإشعار</td><td>{typeLabel}</td></tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12 }}>
        <Field label="تاريخ الإشعار" required><DateInput value={date} onChange={setDate} /></Field>
      </div>

      {isTripReturn ? (
        <div className="group-box credit-trip-picker">
          <div className="group-title">اختر النقلة المرتجعة</div>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            يحتسب النظام قيمة الإشعار من مبلغ النقلة وضريبة الفاتورة تلقائياً. لا تتغير الفاتورة الأصلية؛ يظهر التخفيض في رصيدها وإشعاراتها.
          </div>
          {loadingTrips ? (
            <div className="invoice-empty-state">جارٍ تحميل نقلات الفاتورة…</div>
          ) : tripsError ? (
            <div className="invoice-empty-state" style={{ color: "var(--danger)" }}>{tripsError}</div>
          ) : trips.length === 0 ? (
            <div className="invoice-empty-state">لا توجد نقلات في هذه الفاتورة.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table credit-trip-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="اختيار كل النقلات المتاحة"
                        checked={availableTrips.length > 0 && selectedTrips.length === availableTrips.length}
                        disabled={availableTrips.length === 0}
                        onChange={(event) => toggleAll(event.target.checked)}
                      />
                    </th>
                    <th>مسار النقلة</th>
                    <th>العدد</th>
                    <th>سعر الوحدة</th>
                    <th>قبل الضريبة</th>
                    <th>الضريبة</th>
                    <th>شامل الضريبة</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr key={trip.id} className={trip.already_credited ? "credit-trip-returned" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`اختيار نقلة ${trip.from_loc} إلى ${trip.to_loc}`}
                          checked={selectedTripIds.includes(trip.id)}
                          disabled={trip.already_credited}
                          onChange={(event) => toggleTrip(trip.id, event.target.checked)}
                        />
                      </td>
                      <td><b>{trip.from_loc || "—"} ← {trip.to_loc || "—"}</b></td>
                      <td>{trip.qty}</td>
                      <td>{money(trip.unit_price)}</td>
                      <td>{money(trip.amount)}</td>
                      <td>{money(trip.vat_amount)}</td>
                      <td><b>{money(trip.total)}</b></td>
                      <td>{trip.already_credited ? "تم إصدار مرتجع" : "متاحة"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="total-row">
                    <td colSpan={4}>إجمالي النقلات المختارة ({selectedTrips.length})</td>
                    <td>{money(selectedAmount)}</td>
                    <td>{money(selectedVat)}</td>
                    <td><b>{money(selectedTotal)}</b></td>
                    <td>يُخصم من الفاتورة</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="المبلغ قبل الضريبة" required><AmountInput value={amount} onChange={setAmount} /></Field>
            <Field label="نسبة الضريبة %"><AmountInput value={vatRate} onChange={setVatRate} /></Field>
          </div>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            الإجمالي شامل الضريبة: <b>{money(manualTotal)}</b>
          </div>
        </>
      )}

      <Field label="سبب الإشعار" required>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={isTripReturn ? "مثال: مرتجع نقلة من العميل" : "مثال: زيادة كمية أو تصحيح قيمة"}
        />
      </Field>

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Button variant="primary" onClick={save} disabled={saving || loadingTrips || Boolean(tripsError)}>
          💾 حفظ الإشعار
        </Button>
        <Button onClick={() => onClose()}>إلغاء</Button>
      </div>
    </Modal>
  );
}
