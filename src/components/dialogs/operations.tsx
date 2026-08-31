"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, Field, Input, Select, Textarea, AmountInput, DateInput, Button, AccountSelect } from "@/components/ui";
import { notify } from "@/components/toast";
import { listCustomers, listEmployees, listVehicles, saveInvoice, saveReceipt, savePayment, getReceipt, getPayment, companyInfo, currentVatRate } from "@/lib/repo";
import { getInvoiceFull, allAccounts, tripsOptions, tripProfit } from "@/lib/calc";
import { money, todayIso, EXPENSE_TYPES, PAYMENT_TYPES, RECEIPT_TYPES, VEHICLE_EXPENSES } from "@/lib/format";

type TripRow = { id?: number; vehicle_id: string; driver_id: string; from_loc: string; to_loc: string; price: string; notes: string; expenses: { id?: number; expense_type: string; amount: string; notes: string }[] };

/* ============================ فاتورة نقل ============================ */
export function InvoiceDialog({ id, readOnly, onClose }: { id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void }) {
  const [customers, setCustomers] = useState<{ id: number; name: string; balance?: number }[]>([]);
  const [vehicles, setVehicles] = useState<{ id: number; plate_number: string }[]>([]);
  const [drivers, setDrivers] = useState<{ id: number; name: string }[]>([]);
  const [f, setF] = useState({ customer_id: "", date: todayIso(), vat_rate: "15", notes: "" });
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [cs, vs, ds, vatRate] = await Promise.all([listCustomers(), listVehicles(), listEmployees("driver"), currentVatRate()]);
      setCustomers(cs); setVehicles(vs); setDrivers(ds);
      setF((old) => ({ ...old, vat_rate: String(vatRate) }));
      if (id) {
        const inv = await getInvoiceFull(id);
        if (inv) {
          setF({ customer_id: String(inv.customer_id), date: inv.date, vat_rate: String(inv.vat_rate ?? 15), notes: inv.notes });
          setAttachments(inv.attachments ?? []);
          setTrips(inv.trips.map((t) => ({
            id: t.id, vehicle_id: t.vehicle_id ? String(t.vehicle_id) : "", driver_id: t.driver_id ? String(t.driver_id) : "",
            from_loc: t.from_loc, to_loc: t.to_loc, price: String(t.price), notes: t.notes,
            expenses: (t.expenses ?? []).map((e) => ({ id: e.id, expense_type: e.expense_type, amount: String(e.amount), notes: e.notes })),
          })));
        }
      }
    })();
  }, [id]);

  const totals = useMemo(() => {
    const subtotal = trips.reduce((a, t) => a + (parseFloat(t.price || "0") || 0), 0);
    const vatRate = parseFloat(f.vat_rate || "0") || 0;
    const vat = Math.round(subtotal * vatRate) / 100;
    return { subtotal, vat, total: subtotal + vat };
  }, [trips, f.vat_rate]);

  const addTrip = () => setTrips((p) => [...p, { vehicle_id: "", driver_id: "", from_loc: "", to_loc: "", price: "", notes: "", expenses: [] }]);
  const updTrip = (i: number, patch: Partial<TripRow>) => setTrips((p) => p.map((t, x) => (x === i ? { ...t, ...patch } : t)));
  const delTrip = (i: number) => setTrips((p) => p.filter((_, x) => x !== i));
  const addExp = (i: number) => setTrips((p) => p.map((t, x) => (x === i ? { ...t, expenses: [...t.expenses, { expense_type: "trip", amount: "", notes: "" }] } : t)));
  const updExp = (i: number, j: number, patch: Partial<TripRow["expenses"][number]>) =>
    setTrips((p) => p.map((t, x) => (x === i ? { ...t, expenses: t.expenses.map((e, y) => (y === j ? { ...e, ...patch } : e)) } : t)));
  const delExp = (i: number, j: number) => setTrips((p) => p.map((t, x) => (x === i ? { ...t, expenses: t.expenses.filter((_, y) => y !== j) } : t)));

  const save = async () => {
    if (!f.customer_id) return notify("اختر العميل.", "error");
    if (!trips.length) return notify("أضف نقلة واحدة على الأقل.", "error");
    for (const t of trips) {
      if (!t.from_loc.trim() || !t.to_loc.trim()) return notify("أكمل أماكن الانطلاق والوصول لكل نقلة.", "error");
      if (!(parseFloat(t.price) > 0)) return notify("سعر النقلة يجب أن يكون أكبر من صفر.", "error");
    }
    setSaving(true);
    try {
      await saveInvoice({
        customer_id: Number(f.customer_id), date: f.date, notes: f.notes,
        vat_rate: parseFloat(f.vat_rate || "15") || 15,
        attachments,
        trips: trips.map((t) => ({
          id: t.id, vehicle_id: t.vehicle_id ? Number(t.vehicle_id) : null, driver_id: t.driver_id ? Number(t.driver_id) : null,
          from_loc: t.from_loc, to_loc: t.to_loc, price: parseFloat(t.price) || 0, notes: t.notes,
          expenses: t.expenses.map((e) => ({ id: e.id, expense_type: e.expense_type, amount: parseFloat(e.amount) || 0, notes: e.notes })),
        })),
      }, id);
      notify("تم حفظ الفاتورة بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? "تعديل فاتورة نقل" : "فاتورة نقل جديدة"} onClose={() => onClose()} width={920}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="العميل" required>
          <Select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}>
            <option value="">— اختر العميل —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="التاريخ" required><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
      </div>

      <div className="group-box">
        <div className="group-title">النقلات</div>
        {trips.map((t, i) => (
          <div key={i} className="trip-row">
            <div className="trip-row-head">
              <span>نقلة {i + 1}</span>
              <button className="btn-row-danger" onClick={() => delTrip(i)}>حذف النقلة</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="من"><Input value={t.from_loc} onChange={(e) => updTrip(i, { from_loc: e.target.value })} /></Field>
              <Field label="إلى"><Input value={t.to_loc} onChange={(e) => updTrip(i, { to_loc: e.target.value })} /></Field>
              <Field label="السيارة">
                <Select value={t.vehicle_id} onChange={(e) => updTrip(i, { vehicle_id: e.target.value })}>
                  <option value="">—</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                </Select>
              </Field>
              <Field label="السائق">
                <Select value={t.driver_id} onChange={(e) => updTrip(i, { driver_id: e.target.value })}>
                  <option value="">—</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="السعر"><AmountInput value={t.price} onChange={(v) => updTrip(i, { price: v })} /></Field>
            <Field label="ملاحظات"><Input value={t.notes} onChange={(e) => updTrip(i, { notes: e.target.value })} /></Field>
            <div className="expenses-head">
              <span className="section-label">المصروفات المباشرة</span>
              <button className="btn" onClick={() => addExp(i)}>+ مصروف</button>
            </div>
            {t.expenses.map((e, j) => (
              <div key={j} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                <Field label="النوع">
                  <Select value={e.expense_type} onChange={(ev) => updExp(i, j, { expense_type: ev.target.value })}>
                    {Object.entries(EXPENSE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="المبلغ"><AmountInput value={e.amount} onChange={(v) => updExp(i, j, { amount: v })} /></Field>
                <Field label="بيان"><Input value={e.notes} onChange={(ev) => updExp(i, j, { notes: ev.target.value })} /></Field>
                <button className="btn-row-danger" onClick={() => delExp(i, j)}>✕</button>
              </div>
            ))}
          </div>
        ))}
        {!readOnly && <button className="btn" onClick={addTrip}>+ إضافة نقلة</button>}
      </div>

      <div className="group-box">
        <div className="group-title">الضريبة والإجمالي</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label="نسبة ضريبة القيمة المضافة %"><AmountInput value={f.vat_rate} onChange={(v) => setF({ ...f, vat_rate: v })} /></Field>
          <Field label="الإجمالي قبل الضريبة"><Input value={money(totals.subtotal)} readOnly /></Field>
          <Field label="الضريبة"><Input value={money(totals.vat)} readOnly /></Field>
        </div>
        <div style={{ marginTop: 8 }}>
          <Field label="الإجمالي شامل الضريبة"><Input value={money(totals.total)} readOnly /></Field>
        </div>
      </div>

      <Field label="ملاحظات الفاتورة"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <Field label="المرفقات">
        <Input type="file" multiple onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          setAttachments((p) => [...p, ...files.map((x) => x.name)]);
        }} />
        {attachments.length > 0 && <div style={{ marginTop: 6, color: "var(--muted)" }}>{attachments.join("، ")}</div>}
      </Field>

      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ الفاتورة</Button></div>}
    </Modal>
  );
}

/* ============================ سند قبض ============================ */
export function ReceiptDialog({ id, readOnly, onClose }: { id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void }) {
  const [accounts, setAccounts] = useState<{ kind: string; id: number; label: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [f, setF] = useState({ account_kind: "cashbox", account_id: "", voucher_type: "customer", customer_id: "", amount: "", description: "", date: todayIso() });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const accs = await allAccounts();
      setAccounts(accs);
      setCustomers(await listCustomers());
      if (id) {
        const v = await getReceipt(id);
        if (v) setF({ account_kind: v.account_kind, account_id: String(v.account_id), voucher_type: v.voucher_type, customer_id: v.customer_id ? String(v.customer_id) : "", amount: String(v.amount), description: v.description, date: v.date });
      } else if (accs.length) {
        const first = accs[0];
        setF((old) => ({ ...old, account_kind: first.kind, account_id: String(first.id) }));
      }
    })();
  }, [id]);

  const save = async () => {
    if (!f.account_id) return notify("اختر الحساب.", "error");
    const amt = parseFloat(f.amount);
    if (!(amt > 0)) return notify("أدخل مبلغاً صحيحاً.", "error");
    setSaving(true);
    try {
      await saveReceipt({
        date: f.date, account_kind: f.account_kind, account_id: Number(f.account_id),
        voucher_type: f.voucher_type,
        customer_id: f.voucher_type === "customer" && f.customer_id ? Number(f.customer_id) : null,
        amount: amt, description: f.description,
      }, id);
      notify("تم حفظ سند القبض بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? (readOnly ? "عرض سند قبض" : "تعديل سند قبض") : "سند قبض جديد"} onClose={() => onClose()}>
      <Field label="نوع السند">
        <Select value={f.voucher_type} onChange={(e) => setF({ ...f, voucher_type: e.target.value })} disabled={readOnly}>
          {Object.entries(RECEIPT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      {f.voucher_type === "customer" && (
        <Field label="العميل">
          <Select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })} disabled={readOnly}>
            <option value="">— اختر العميل —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="الحساب (خزينة/بنك)">
        <AccountSelect
          value={f.account_id ? { kind: f.account_kind, id: Number(f.account_id) } : null}
          onChange={(v) => setF({ ...f, account_kind: v?.kind ?? "cashbox", account_id: v ? String(v.id) : "" })}
          options={accounts}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="المبلغ" required><AmountInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} readOnly={readOnly} /></Field>
        <Field label="التاريخ" required><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} disabled={readOnly} /></Field>
      </div>
      <Field label="البيان"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} readOnly={readOnly} /></Field>
      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ السند</Button></div>}
    </Modal>
  );
}

/* ============================ سند دفع ============================ */
export function PaymentDialog({ id, readOnly, onClose }: { id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void }) {
  const [accounts, setAccounts] = useState<{ kind: string; id: number; label: string }[]>([]);
  const [tripOpts, setTripOpts] = useState<{ id: number; label: string }[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [vehicles, setVehicles] = useState<{ id: number; plate_number: string }[]>([]);
  const [f, setF] = useState({ account_kind: "cashbox", account_id: "", voucher_type: "trip", trip_id: "", employee_id: "", vehicle_id: "", vehicle_expense: "maintenance", amount: "", description: "", date: todayIso() });
  const [tripInfo, setTripInfo] = useState<{ price: number; direct: number; later: number; net: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const accs = await allAccounts();
      setAccounts(accs);
      setTripOpts(await tripsOptions());
      setEmployees(await listEmployees());
      setVehicles(await listVehicles());
      if (id) {
        const v = await getPayment(id);
        if (v) setF({ account_kind: v.account_kind, account_id: String(v.account_id), voucher_type: v.voucher_type, trip_id: v.trip_id ? String(v.trip_id) : "", employee_id: v.employee_id ? String(v.employee_id) : "", vehicle_id: v.vehicle_id ? String(v.vehicle_id) : "", vehicle_expense: v.vehicle_expense || "maintenance", amount: String(v.amount), description: v.description, date: v.date });
      } else if (accs.length) setF((old) => ({ ...old, account_kind: accs[0].kind, account_id: String(accs[0].id) }));
    })();
  }, [id]);

  useEffect(() => {
    if (f.voucher_type === "trip" && f.trip_id) {
      tripProfit(Number(f.trip_id)).then(setTripInfo);
    } else setTripInfo(null);
  }, [f.voucher_type, f.trip_id]);

  const save = async () => {
    if (!f.account_id) return notify("اختر الحساب.", "error");
    const amt = parseFloat(f.amount);
    if (!(amt > 0)) return notify("أدخل مبلغاً صحيحاً.", "error");
    setSaving(true);
    try {
      await savePayment({
        date: f.date, account_kind: f.account_kind, account_id: Number(f.account_id),
        voucher_type: f.voucher_type,
        trip_id: f.voucher_type === "trip" && f.trip_id ? Number(f.trip_id) : null,
        employee_id: f.voucher_type === "advance" && f.employee_id ? Number(f.employee_id) : null,
        vehicle_id: f.voucher_type === "vehicle" && f.vehicle_id ? Number(f.vehicle_id) : null,
        vehicle_expense: f.voucher_type === "vehicle" ? f.vehicle_expense : "",
        amount: amt, description: f.description,
      }, id);
      notify("تم حفظ سند الدفع بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? (readOnly ? "عرض سند دفع" : "تعديل سند دفع") : "سند دفع جديد"} onClose={() => onClose()}>
      <Field label="نوع السند">
        <Select value={f.voucher_type} onChange={(e) => setF({ ...f, voucher_type: e.target.value })} disabled={readOnly}>
          {Object.entries(PAYMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>

      {f.voucher_type === "trip" && (
        <>
          <Field label="النقلة" required>
            <Select value={f.trip_id} onChange={(e) => setF({ ...f, trip_id: e.target.value })} disabled={readOnly}>
              <option value="">— اختر النقلة —</option>
              {tripOpts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
          {tripInfo && (
            <div className="group-box" style={{ marginTop: 0 }}>
              <div className="group-title">ملخص النقلة</div>
              <table className="data-table">
                <tbody>
                  <tr><td>السعر</td><td>{money(tripInfo.price)}</td></tr>
                  <tr><td>المصروفات المباشرة</td><td>{money(tripInfo.direct)}</td></tr>
                  <tr><td>سندات دفع سابقة</td><td>{money(tripInfo.later)}</td></tr>
                  <tr className="total-row"><td>المتبقي</td><td>{money(tripInfo.net)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {f.voucher_type === "advance" && (
        <Field label="الموظف/السائق" required>
          <Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} disabled={readOnly}>
            <option value="">— اختر الموظف —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
      )}
      {f.voucher_type === "vehicle" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="السيارة" required>
            <Select value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })} disabled={readOnly}>
              <option value="">— اختر السيارة —</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
            </Select>
          </Field>
          <Field label="نوع المصروف">
            <Select value={f.vehicle_expense} onChange={(e) => setF({ ...f, vehicle_expense: e.target.value })} disabled={readOnly}>
              {Object.entries(VEHICLE_EXPENSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </div>
      )}

      <Field label="الحساب (خزينة/بنك)">
        <AccountSelect
          value={f.account_id ? { kind: f.account_kind, id: Number(f.account_id) } : null}
          onChange={(v) => setF({ ...f, account_kind: v?.kind ?? "cashbox", account_id: v ? String(v.id) : "" })}
          options={accounts}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="المبلغ" required><AmountInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} readOnly={readOnly} /></Field>
        <Field label="التاريخ" required><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} disabled={readOnly} /></Field>
      </div>
      <Field label="البيان"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} readOnly={readOnly} /></Field>
      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ السند</Button></div>}
    </Modal>
  );
}

/* ============================ فاتورة العميل (طباعة / PDF) ============================ */
async function customerInvoiceHtml(invoiceId: number): Promise<{ html: string; number: number } | null> {
  const inv = await getInvoiceFull(invoiceId);
  if (!inv) return null;
  const info = await companyInfo();
  const subtotal = inv.trips_total;
  const vat = inv.vat_amount ?? Math.round(subtotal * (inv.vat_rate ?? 0)) / 100;
  const total = subtotal + vat;

  const rows = inv.trips
    .map((t, i) => `<tr>
      <td>${i + 1}</td>
      <td>${esc(t.from_loc)}</td><td>${esc(t.to_loc)}</td>
      <td>${money(t.price)}</td>
    </tr>`)
    .join("");

  const html = `<div style="font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;color:#111;">
    <div style="display:flex;justify-content:space-between;border-bottom:2px solid #1f4e79;padding-bottom:12px;">
      <div style="font-weight:700;font-size:18px;color:#1f4e79;">${esc(info.company_name || "شركة النقل")}</div>
      <div>فاتورة مرجعية<br/><b>رقم: ${inv.number}</b><br/>التاريخ: ${inv.date}</div>
    </div>
    <h2 style="color:#1f4e79;margin:6px 0;">فاتورة نقل — ${esc(inv.customer?.name ?? "")}</h2>
    <div>العميل: ${esc(inv.customer?.name ?? "")}${inv.customer?.phone ? " — هاتف: " + esc(inv.customer.phone) : ""}</div>
    <table width="100%" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;margin-top:12px;font-size:13px;">
      <thead><tr style="background:#eef3f9;"><th>#</th><th>من</th><th>إلى</th><th>السعر (${esc(info.currency || "ر.س")})</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table width="300px" align="left" style="margin-top:14px;border-collapse:collapse;font-size:13px;">
      <tr><td>الإجمالي قبل الضريبة</td><td align="center">${money(subtotal)}</td></tr>
      <tr><td>ضريبة القيمة المضافة (${inv.vat_rate ?? 0}%)</td><td align="center">${money(vat)}</td></tr>
      <tr style="border-top:2px solid #1f4e79;font-weight:700;font-size:15px;"><td>الإجمالي شامل الضريبة</td><td align="center">${money(total)}</td></tr>
    </table>
    <div style="margin-top:18px;font-size:12px;color:#555;border-top:1px dashed #999;padding-top:8px;">${esc(info.company_vat_note || "فاتورة مرجعية — ضريبة القيمة المضافة")}</div>
  </div>`;

  return { html, number: inv.number };
}

export async function printCustomerInvoice(invoiceId: number): Promise<void> {
  const res = await customerInvoiceHtml(invoiceId);
  if (!res) return notify("الفاتورة غير موجودة.", "error");
  const { getPrintSettings, printCss } = await import("@/lib/print");
  const { printHtml } = await import("@/lib/exporter");
  const ps = await getPrintSettings();
  printHtml(res.html, `فاتورة ${res.number}`, { css: printCss(ps), watermark: ps.watermark });
}

export async function exportCustomerInvoicePdf(invoiceId: number): Promise<void> {
  const res = await customerInvoiceHtml(invoiceId);
  if (!res) return notify("الفاتورة غير موجودة.", "error");
  const { exportPdfHtml } = await import("@/lib/exporter");
  await exportPdfHtml(res.html, `فاتورة-${res.number}.pdf`);
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
