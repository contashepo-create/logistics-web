"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, Field, Input, Select, Textarea, AmountInput, DateInput, Button, AccountSelect } from "@/components/ui";
import { notify } from "@/components/toast";
import { listSuppliers, supplierBalance } from "@/lib/suppliers";
import { listCustomers, listEmployees, listVehicles, saveInvoice, saveReceipt, savePayment, getReceipt, getPayment, companyInfo, currentVatRate } from "@/lib/repo";
import { getInvoiceFull, allAccounts, tripsOptions, tripProfit } from "@/lib/calc";
import type { Customer } from "@/lib/types";
import { money, todayIso, amountToArabicWords, EXPENSE_TYPES, EXPENSE_SOURCES, EXPENSE_SOURCE_HINTS, PAYMENT_TYPES, RECEIPT_TYPES, VEHICLE_EXPENSES } from "@/lib/format";

type ExpRow = {
  id?: number;
  expense_type: string;
  qty: string;
  unit_amount: string;
  source: string;
  account_kind: string;
  account_id: string;
  supplier_name: string;
  notes: string;
};
type TripRow = {
  id?: number; vehicle_id: string; driver_id: string; from_loc: string; to_loc: string;
  qty: string; unit_price: string; notes: string; expenses: ExpRow[];
};

const n = (v: string) => parseFloat(String(v).replace(/,/g, "")) || 0;
/** إجمالي سطر النقلة = العدد × سعر الوحدة */
export const tripLineTotal = (t: { qty: string; unit_price: string }) => Math.round(Math.max(1, n(t.qty) || 1) * n(t.unit_price) * 100) / 100;
/** إجمالي سطر المصروف = العدد × قيمة الوحدة */
export const expLineTotal = (e: { qty: string; unit_amount: string }) => Math.round((n(e.qty) || 1) * n(e.unit_amount) * 100) / 100;

/* ============================ فاتورة نقل ============================ */
export function InvoiceDialog({ id, readOnly, onClose }: { id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void }) {
  const [customers, setCustomers] = useState<{ id: number; name: string; balance?: number }[]>([]);
  const [vehicles, setVehicles] = useState<{ id: number; plate_number: string }[]>([]);
  const [drivers, setDrivers] = useState<{ id: number; name: string }[]>([]);
  const [accounts, setAccounts] = useState<{ kind: string; id: number; label: string }[]>([]);
  const [f, setF] = useState({ customer_id: "", date: todayIso(), vat_rate: "15", notes: "" });
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [cs, vs, ds, vatRate, accs] = await Promise.all([listCustomers(), listVehicles(), listEmployees("driver"), currentVatRate(), allAccounts()]);
      setCustomers(cs); setVehicles(vs); setDrivers(ds); setAccounts(accs);
      setF((old) => ({ ...old, vat_rate: String(vatRate) }));
      if (id) {
        const inv = await getInvoiceFull(id);
        if (inv) {
          setF({ customer_id: String(inv.customer_id), date: inv.date, vat_rate: String(inv.vat_rate ?? 15), notes: inv.notes });
          setAttachments(inv.attachments ?? []);
          setTrips(inv.trips.map((t) => ({
            id: t.id, vehicle_id: t.vehicle_id ? String(t.vehicle_id) : "", driver_id: t.driver_id ? String(t.driver_id) : "",
            from_loc: t.from_loc, to_loc: t.to_loc,
            qty: String(t.qty ?? 1),
            unit_price: String(t.unit_price || (t.qty ? t.price / t.qty : t.price)),
            notes: t.notes,
            expenses: (t.expenses ?? []).map((e) => ({
              id: e.id, expense_type: e.expense_type,
              qty: String(e.qty ?? 1),
              unit_amount: String(e.unit_amount || e.amount),
              source: e.source ?? "cash",
              account_kind: e.account_kind ?? "",
              account_id: e.account_id ? String(e.account_id) : "",
              supplier_name: e.supplier_name ?? "",
              notes: e.notes,
            })),
          })));
        }
      }
    })();
  }, [id]);

  const totals = useMemo(() => {
    const tripsTotal = trips.reduce((a, t) => a + tripLineTotal(t), 0);
    let cost = 0;
    let billable = 0;
    for (const t of trips) {
      for (const e of t.expenses) {
        if (e.source === "customer") billable += expLineTotal(e);
        else cost += expLineTotal(e);
      }
    }
    const subtotal = Math.round((tripsTotal + billable) * 100) / 100;
    const vatRate = parseFloat(f.vat_rate || "0") || 0;
    const vat = Math.round(subtotal * vatRate) / 100;
    return { tripsTotal, billable, cost, subtotal, vat, total: subtotal + vat, profit: Math.round((subtotal - cost) * 100) / 100 };
  }, [trips, f.vat_rate]);

  const addTrip = () => setTrips((p) => [...p, { vehicle_id: "", driver_id: "", from_loc: "", to_loc: "", qty: "1", unit_price: "", notes: "", expenses: [] }]);
  const updTrip = (i: number, patch: Partial<TripRow>) => setTrips((p) => p.map((t, x) => (x === i ? { ...t, ...patch } : t)));
  const delTrip = (i: number) => setTrips((p) => p.filter((_, x) => x !== i));
  const defaultAccount = () => (accounts.length ? { kind: accounts[0].kind, id: String(accounts[0].id) } : { kind: "cashbox", id: "" });
  const addExp = (i: number) => setTrips((p) => p.map((t, x) => {
    if (x !== i) return t;
    const acc = defaultAccount();
    return { ...t, expenses: [...t.expenses, { expense_type: "trip", qty: "1", unit_amount: "", source: "cash", account_kind: acc.kind, account_id: acc.id, supplier_name: "", notes: "" }] };
  }));
  const updExp = (i: number, j: number, patch: Partial<TripRow["expenses"][number]>) =>
    setTrips((p) => p.map((t, x) => (x === i ? { ...t, expenses: t.expenses.map((e, y) => (y === j ? { ...e, ...patch } : e)) } : t)));
  const delExp = (i: number, j: number) => setTrips((p) => p.map((t, x) => (x === i ? { ...t, expenses: t.expenses.filter((_, y) => y !== j) } : t)));

  const save = async () => {
    if (!f.customer_id) return notify("اختر العميل.", "error");
    if (!trips.length) return notify("أضف نقلة واحدة على الأقل.", "error");
    for (const t of trips) {
      if (!t.from_loc.trim() || !t.to_loc.trim()) return notify("أكمل أماكن الانطلاق والوصول لكل نقلة.", "error");
      if (!(n(t.qty) >= 1)) return notify("عدد النقلات يجب أن يكون 1 على الأقل.", "error");
      if (!(tripLineTotal(t) > 0)) return notify("سعر النقلة يجب أن يكون أكبر من صفر.", "error");
      for (const e of t.expenses) {
        if (!(expLineTotal(e) > 0)) return notify("أكمل عدد وقيمة كل مصروف.", "error");
        if (e.source === "cash" && !e.account_id) return notify("اختر الخزينة أو البنك لكل مصروف نقدي.", "error");
        if (e.source === "driver" && !t.driver_id) return notify("حدّد السائق في النقلة قبل تسجيل مصروف من عهدته.", "error");
        if (e.source === "supplier" && !e.supplier_name.trim()) return notify("اكتب اسم المورد/المحطة للمصروف الآجل.", "error");
      }
    }
    setSaving(true);
    try {
      await saveInvoice({
        customer_id: Number(f.customer_id), date: f.date, notes: f.notes,
        vat_rate: parseFloat(f.vat_rate || "15") || 15,
        attachments,
        trips: trips.map((t) => ({
          id: t.id, vehicle_id: t.vehicle_id ? Number(t.vehicle_id) : null, driver_id: t.driver_id ? Number(t.driver_id) : null,
          from_loc: t.from_loc, to_loc: t.to_loc,
          qty: Math.max(1, Math.trunc(n(t.qty) || 1)),
          unit_price: n(t.unit_price),
          price: tripLineTotal(t),
          notes: t.notes,
          expenses: t.expenses.map((e) => ({
            id: e.id, expense_type: e.expense_type,
            qty: n(e.qty) || 1, unit_amount: n(e.unit_amount), amount: expLineTotal(e),
            source: e.source,
            account_kind: e.source === "cash" ? e.account_kind : null,
            account_id: e.source === "cash" && e.account_id ? Number(e.account_id) : null,
            supplier_name: e.source === "supplier" ? e.supplier_name : "",
            notes: e.notes,
          })),
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

  const perTrip = (t: TripRow) => {
    let cost = 0, billable = 0;
    for (const e of t.expenses) (e.source === "customer" ? (billable += expLineTotal(e)) : (cost += expLineTotal(e)));
    const revenue = tripLineTotal(t) + billable;
    return { cost, billable, revenue, net: Math.round((revenue - cost) * 100) / 100 };
  };

  const srcClass = (src: string) => `src-${src}`;
  const currency = "";

  return (
    <Modal title={id ? `تعديل فاتورة نقل` : "فاتورة نقل جديدة"} onClose={() => onClose()} width={980}>
      <div className="inv-form">
        {/* ------------------------- بيانات الفاتورة ------------------------- */}
        <div className="inv-head-card">
          <Field label="العميل" required>
            <Select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })} disabled={readOnly}>
              <option value="">— اختر العميل —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="تاريخ الفاتورة" required>
            <DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          </Field>
          <Field label="عدد النقلات في الفاتورة">
            <Input value={`${trips.length} سطر — ${trips.reduce((a, t) => a + Math.max(1, n(t.qty) || 1), 0)} نقلة`} readOnly />
          </Field>
        </div>

        {/* ------------------------- النقلات ------------------------- */}
        <div>
          <div className="inv-sec-title">
            <span>بنود النقل</span>
            {!readOnly && <button className="btn btn-primary" onClick={addTrip}>＋ إضافة نقلة</button>}
          </div>

          {trips.length === 0 && (
            <div className="exp-empty">لا توجد نقلات بعد — اضغط «إضافة نقلة» لبدء تسجيل بنود الفاتورة.</div>
          )}

          {trips.map((t, i) => {
            const st = perTrip(t);
            return (
              <div key={i} className="trip-card">
                <div className="trip-card-head">
                  <span className="trip-badge">{i + 1}</span>
                  <span className="trip-route">
                    {t.from_loc || <span className="muted">من …</span>}
                    <span className="muted"> ← </span>
                    {t.to_loc || <span className="muted">إلى …</span>}
                    {Math.max(1, n(t.qty) || 1) > 1 && <span className="muted">{`  ×${Math.max(1, n(t.qty) || 1)} نقلة`}</span>}
                  </span>
                  <span className="trip-head-spacer" />
                  <span className="trip-head-amount">{money(st.revenue)}</span>
                  {!readOnly && <button className="btn-row-danger" onClick={() => delTrip(i)}>حذف النقلة</button>}
                </div>

                <div className="trip-card-body">
                  <div className="trip-grid-4">
                    <Field label="من" required><Input value={t.from_loc} onChange={(e) => updTrip(i, { from_loc: e.target.value })} readOnly={readOnly} /></Field>
                    <Field label="إلى" required><Input value={t.to_loc} onChange={(e) => updTrip(i, { to_loc: e.target.value })} readOnly={readOnly} /></Field>
                    <Field label="السيارة">
                      <Select value={t.vehicle_id} onChange={(e) => updTrip(i, { vehicle_id: e.target.value })} disabled={readOnly}>
                        <option value="">—</option>
                        {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                      </Select>
                    </Field>
                    <Field label="السائق">
                      <Select value={t.driver_id} onChange={(e) => updTrip(i, { driver_id: e.target.value })} disabled={readOnly}>
                        <option value="">—</option>
                        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </Select>
                    </Field>
                  </div>

                  <div className="trip-price-box">
                    <Field label="عدد النقلات" required>
                      <Input type="number" min={1} step={1} dir="ltr" style={{ textAlign: "center" }}
                        value={t.qty} onChange={(e) => updTrip(i, { qty: e.target.value })} readOnly={readOnly} />
                    </Field>
                    <Field label="سعر النقلة الواحدة" required>
                      <AmountInput value={t.unit_price} onChange={(v) => updTrip(i, { unit_price: v })} />
                    </Field>
                    <Field label="إجمالي بند النقل">
                      <Input value={money(tripLineTotal(t))} readOnly />
                    </Field>
                  </div>

                  <Field label="ملاحظات النقلة"><Input value={t.notes} onChange={(e) => updTrip(i, { notes: e.target.value })} readOnly={readOnly} /></Field>

                  {/* ------------------ مصروفات هذه النقلة ------------------ */}
                  <div className="exp-block">
                    <div className="inv-sec-title">
                      <span>{`مصروفات النقلة ${i + 1}`}</span>
                      {!readOnly && <button className="btn" onClick={() => addExp(i)}>＋ مصروف</button>}
                    </div>

                    {t.expenses.length === 0 && (
                      <div className="exp-empty">لا مصروفات على هذه النقلة.</div>
                    )}

                    {t.expenses.map((e, j) => (
                      <div key={j} className={`exp-card ${srcClass(e.source)}`}>
                        <div className="exp-card-head">
                          <span className={`exp-chip ${srcClass(e.source)}`}>{EXPENSE_SOURCES[e.source] ?? e.source}</span>
                          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
                            {EXPENSE_TYPES[e.expense_type] ?? e.expense_type}
                            {n(e.qty) > 1 ? ` × ${n(e.qty)}` : ""}
                          </span>
                          <span className={`exp-head-total ${e.source === "customer" ? "is-billable" : ""}`}>
                            {money(expLineTotal(e))}{e.source === "customer" ? " (على العميل)" : ""}
                          </span>
                        </div>

                        <div className="exp-grid">
                          <Field label="نوع المصروف">
                            <Select value={e.expense_type} onChange={(ev) => updExp(i, j, { expense_type: ev.target.value })} disabled={readOnly}>
                              {Object.entries(EXPENSE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </Select>
                          </Field>
                          <Field label="العدد">
                            <Input type="number" min={1} step={1} dir="ltr" style={{ textAlign: "center" }}
                              value={e.qty} onChange={(ev) => updExp(i, j, { qty: ev.target.value })} readOnly={readOnly} />
                          </Field>
                          <Field label="قيمة الوحدة">
                            <AmountInput value={e.unit_amount} onChange={(v) => updExp(i, j, { unit_amount: v })} />
                          </Field>
                          <Field label="إجمالي المصروف">
                            <Input value={money(expLineTotal(e))} readOnly />
                          </Field>
                          {!readOnly && (
                            <button className="btn btn-danger" title="حذف المصروف" onClick={() => delExp(i, j)}>✕</button>
                          )}
                        </div>

                        <div className="exp-grid-2">
                          <Field label="مصدر التمويل" required>
                            <Select value={e.source} onChange={(ev) => {
                              const src = ev.target.value;
                              const acc = defaultAccount();
                              updExp(i, j, {
                                source: src,
                                account_kind: src === "cash" ? (e.account_kind || acc.kind) : "",
                                account_id: src === "cash" ? (e.account_id || acc.id) : "",
                              });
                            }} disabled={readOnly}>
                              {Object.entries(EXPENSE_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </Select>
                          </Field>

                          {e.source === "cash" && (
                            <Field label="من الخزينة / البنك" required>
                              <Select value={e.account_kind && e.account_id ? `${e.account_kind}:${e.account_id}` : ""}
                                onChange={(ev) => {
                                  const [kind, aid] = ev.target.value.split(":");
                                  updExp(i, j, { account_kind: kind ?? "", account_id: aid ?? "" });
                                }} disabled={readOnly}>
                                <option value="">— اختر —</option>
                                {accounts.map((a) => (
                                  <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>{a.label}</option>
                                ))}
                              </Select>
                            </Field>
                          )}
                          {e.source === "supplier" && (
                            <Field label="المورد / المحطة" required>
                              <Input value={e.supplier_name} onChange={(ev) => updExp(i, j, { supplier_name: ev.target.value })} readOnly={readOnly} />
                            </Field>
                          )}
                          {e.source === "driver" && (
                            <Field label="السائق (عهدة)">
                              <Input value={drivers.find((d) => String(d.id) === t.driver_id)?.name ?? "— حدّد السائق أعلاه —"} readOnly />
                            </Field>
                          )}
                          {e.source === "customer" && (
                            <Field label="الأثر على الفاتورة">
                              <Input value="بند إضافي على العميل (إيراد وليس تكلفة)" readOnly />
                            </Field>
                          )}

                          <Field label="بيان المصروف"><Input value={e.notes} onChange={(ev) => updExp(i, j, { notes: ev.target.value })} readOnly={readOnly} /></Field>
                        </div>

                        <div className="exp-hint">{EXPENSE_SOURCE_HINTS[e.source]}</div>
                      </div>
                    ))}
                  </div>

                  {/* ------------------ ملخص النقلة ------------------ */}
                  <div className="trip-summary">
                    <div className="trip-sum-item is-rev"><span className="k">إيراد النقلة</span><span className="v">{money(st.revenue)}</span></div>
                    <div className="trip-sum-item is-cost"><span className="k">تكلفة المصروفات</span><span className="v">{money(st.cost)}</span></div>
                    <div className="trip-sum-item is-net"><span className="k">صافي النقلة</span><span className="v">{money(st.net)}</span></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ------------------------- الإجماليات ------------------------- */}
        <div className="inv-totals">
          <div className="tot-card client">
            <div className="tot-card-head"><span>ما يُطالَب به العميل</span><span>فاتورة رقم {id ? id : "جديدة"}</span></div>
            <div className="tot-card-body">
              <div className="tot-line"><span className="k">إجمالي بنود النقل</span><span className="v">{money(totals.tripsTotal)}{currency}</span></div>
              <div className="tot-line"><span className="k">بنود يتحمّلها العميل</span><span className="v">{money(totals.billable)}</span></div>
              <div className="tot-line"><span className="k">الإجمالي قبل الضريبة</span><span className="v">{money(totals.subtotal)}</span></div>
              <div className="tot-line">
                <span className="k">
                  <span className="tot-vat-row">
                    <label>ضريبة القيمة المضافة %</label>
                    <AmountInput value={f.vat_rate} onChange={(v) => setF({ ...f, vat_rate: v })} />
                  </span>
                </span>
                <span className="v">{money(totals.vat)}</span>
              </div>
              <div className="tot-line grand"><span className="k">الإجمالي المستحق</span><span className="v">{money(totals.total)}</span></div>
            </div>
          </div>

          <div className="tot-card internal">
            <div className="tot-card-head"><span>ملخص داخلي (لا يظهر للعميل)</span><span>🔒</span></div>
            <div className="tot-card-body">
              <div className="tot-line is-cost"><span className="k">تكلفة المصروفات على الشركة</span><span className="v">{money(totals.cost)}</span></div>
              <div className="tot-line is-profit"><span className="k">الربح المتوقع</span><span className="v">{money(totals.profit)}</span></div>
              <div className="tot-line">
                <span className="k">هامش الربح</span>
                <span className="v">{totals.subtotal > 0 ? `${Math.round((totals.profit / totals.subtotal) * 1000) / 10}%` : "—"}</span>
              </div>
            </div>
            <div className="tot-note">التكاليف والأرباح لأغراض الإدارة فقط، ولا تُطبع ضمن فاتورة العميل.</div>
          </div>
        </div>

        <Field label="ملاحظات الفاتورة (تظهر للعميل)">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} readOnly={readOnly} />
        </Field>
        <Field label="المرفقات">
          <Input type="file" multiple onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            setAttachments((p) => [...p, ...files.map((x) => x.name)]);
          }} />
          {attachments.length > 0 && <div style={{ marginTop: 6, color: "var(--muted)" }}>{attachments.join("، ")}</div>}
        </Field>

        {!readOnly && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button variant="primary" onClick={save} disabled={saving}>💾 حفظ الفاتورة</Button>
            {id ? <Button onClick={() => printCustomerInvoice(id)}>🖨️ طباعة فاتورة العميل</Button> : null}
          </div>
        )}
      </div>
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
  const [suppliers, setSuppliers] = useState<{ id: number; code: string; name: string }[]>([]);
  const [supplierDue, setSupplierDue] = useState<number | null>(null);
  const [f, setF] = useState({ account_kind: "cashbox", account_id: "", voucher_type: "trip", trip_id: "", employee_id: "", vehicle_id: "", vehicle_expense: "maintenance", supplier_id: "", amount: "", description: "", date: todayIso() });
  const [tripInfo, setTripInfo] = useState<{ price: number; direct: number; later: number; net: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const accs = await allAccounts();
      setAccounts(accs);
      setTripOpts(await tripsOptions());
      setEmployees(await listEmployees());
      setVehicles(await listVehicles());
      setSuppliers((await listSuppliers()).map((x) => ({ id: x.id, code: x.code, name: x.name })));
      if (id) {
        const v = await getPayment(id);
        if (v) setF({ account_kind: v.account_kind, account_id: String(v.account_id), voucher_type: v.voucher_type, trip_id: v.trip_id ? String(v.trip_id) : "", employee_id: v.employee_id ? String(v.employee_id) : "", vehicle_id: v.vehicle_id ? String(v.vehicle_id) : "", vehicle_expense: v.vehicle_expense || "maintenance", supplier_id: (v as { supplier_id?: number | null }).supplier_id ? String((v as { supplier_id?: number | null }).supplier_id) : "", amount: String(v.amount), description: v.description, date: v.date });
      } else if (accs.length) setF((old) => ({ ...old, account_kind: accs[0].kind, account_id: String(accs[0].id) }));
    })();
  }, [id]);

  useEffect(() => {
    if (f.voucher_type === "trip" && f.trip_id) {
      tripProfit(Number(f.trip_id)).then(setTripInfo);
    } else setTripInfo(null);
  }, [f.voucher_type, f.trip_id]);

  // المستحق الحالي للمورّد المختار (مساعدة بصرية قبل الصرف)
  useEffect(() => {
    if (f.voucher_type === "supplier" && f.supplier_id) {
      supplierBalance(Number(f.supplier_id)).then(setSupplierDue).catch(() => setSupplierDue(null));
    } else setSupplierDue(null);
  }, [f.voucher_type, f.supplier_id]);

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
        supplier_id: f.voucher_type === "supplier" && f.supplier_id ? Number(f.supplier_id) : null,
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

      {f.voucher_type === "supplier" && (
        <>
          <Field label="المورّد" required>
            <Select value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })} disabled={readOnly}>
              <option value="">— اختر المورّد —</option>
              {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.code} - {sp.name}</option>)}
            </Select>
          </Field>
          {supplierDue != null && (
            <div className="field-hint" style={{ marginBottom: 8 }}>
              المستحق حالياً لهذا المورّد: <b>{money(supplierDue)}</b>
            </div>
          )}
        </>
      )}

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
/**
 * فاتورة بيع للعميل: تعرض ما يُطالَب به فقط (بنود النقل + البنود التي يتحمّلها العميل
 * + الضريبة). لا تُعرض أي تكاليف أو أرباح أو مصادر تمويل أو موردين أو سائقين.
 */
export async function customerInvoiceHtml(invoiceId: number): Promise<{ html: string; number: number } | null> {
  const inv = await getInvoiceFull(invoiceId);
  if (!inv) return null;
  const info = await companyInfo();
  const { buildZatcaQr, zatcaQrDataUrl, zatcaInvoiceType, zatcaMissingFields, ZATCA_TYPE_LABEL } = await import("@/lib/zatca");
  const { formatNationalAddress } = await import("@/lib/tax");

  const cur = info.currency || "ر.س";
  const curEn = "SAR";
  const billable = inv.billable_total ?? 0;
  const subtotal = Math.round((inv.trips_total + billable) * 100) / 100;
  const vatRate = inv.vat_rate ?? 0;
  const vat = inv.vat_amount ?? Math.round(subtotal * vatRate) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  const num = String(inv.number).padStart(5, "0");

  // ——— بيانات زاتكا ———
  type BuyerInfo = Customer & Partial<Record<"name_en" | "tax_number" | "tax_status" | "commercial_reg" | "country" | "region" | "city" | "district" | "street" | "building_no" | "postal_code" | "additional_no", string>>;
  const buyer = (inv.customer ?? null) as BuyerInfo | null;
  const invType = zatcaInvoiceType(buyer);
  const typeLabel = ZATCA_TYPE_LABEL[invType];
  const sellerVat = String(info.company_tax_number || "");
  const buyerVat = String(buyer?.tax_number || "");
  const sellerAddress = formatNationalAddress({
    country: info.company_country, region: info.company_region, city: info.company_city,
    district: info.company_district, street: info.company_street, building_no: info.company_building_no,
    postal_code: info.company_postal_code, additional_no: info.company_additional_no,
  }) || info.company_address || "";
  const buyerAddress = buyer
    ? formatNationalAddress({
        country: buyer.country, region: buyer.region, city: buyer.city, district: buyer.district,
        street: buyer.street, building_no: buyer.building_no, postal_code: buyer.postal_code,
        additional_no: buyer.additional_no,
      }) || buyer.address || ""
    : "";
  const issuedAt = `${inv.date}T00:00:00Z`;
  const qrPayload = buildZatcaQr({
    sellerName: info.company_name || "",
    vatNumber: sellerVat,
    timestamp: issuedAt,
    totalWithVat: total,
    vatAmount: vat,
  });
  let qrImg = "";
  try {
    qrImg = await zatcaQrDataUrl(qrPayload);
  } catch {
    qrImg = "";
  }
  const missing = zatcaMissingFields({
    sellerName: info.company_name, sellerVat, sellerAddress,
    buyerName: buyer?.name, buyerVat, type: invType, date: inv.date,
  });

  /** سطر ثنائي اللغة: العربية أعلى والإنجليزية أسفل بخط أصغر. */
  const bi = (ar: string, en: string) =>
    `<div style="font-weight:700;">${esc(ar)}</div><div style="font-size:10.5px;color:#64748b;font-weight:600;direction:ltr;">${esc(en)}</div>`;

  const cell = (v: string, align = "center", extra = "") =>
    `<td style="padding:9px 10px;border-bottom:1px solid #e6ebf2;text-align:${align};${extra}">${v}</td>`;

  let idx = 0;
  const tripRows = inv.trips.map((t) => {
    idx += 1;
    const desc = `<b>خدمة نقل: ${esc(t.from_loc || "—")} ← ${esc(t.to_loc || "—")}</b>` +
      `<div style="font-size:10.5px;color:#64748b;direction:ltr;text-align:left;">Transport service</div>` +
      (t.notes ? `<div style="color:#64748b;font-size:11.5px;margin-top:2px;">${esc(t.notes)}</div>` : "");
    const line = Number(t.price) || 0;
    const lineVat = Math.round(line * vatRate) / 100;
    const bg = idx % 2 === 0 ? "background:#fafbfd;" : "";
    return `<tr style="${bg}">` +
      cell(String(idx)) + cell(desc, "right") +
      cell(String(t.qty ?? 1)) + cell(money(t.unit_price || t.price)) +
      cell(money(line)) + cell(`${vatRate}%`) + cell(money(lineVat)) +
      cell(money(Math.round((line + lineVat) * 100) / 100), "center", "font-weight:700;") + "</tr>";
  }).join("");

  // بنود إضافية يتحمّلها العميل (بلا أي إشارة لمصدر التمويل أو المورد)
  const billableRows = inv.trips
    .flatMap((t) => (t.expenses ?? []).filter((e) => e.source === "customer").map((e) => ({ t, e })))
    .map(({ t, e }) => {
      idx += 1;
      const label = esc(e.notes || EXPENSE_TYPES[e.expense_type] || "بند إضافي");
      const desc = `<b>${label}</b><div style="color:#64748b;font-size:11.5px;margin-top:2px;">${esc(t.from_loc || "")} ← ${esc(t.to_loc || "")}</div>`;
      const line = Number(e.amount) || 0;
      const lineVat = Math.round(line * vatRate) / 100;
      const bg = idx % 2 === 0 ? "background:#fafbfd;" : "";
      return `<tr style="${bg}">` +
        cell(String(idx)) + cell(desc, "right") +
        cell(String(e.qty ?? 1)) + cell(money(e.unit_amount || e.amount)) +
        cell(money(line)) + cell(`${vatRate}%`) + cell(money(lineVat)) +
        cell(money(Math.round((line + lineVat) * 100) / 100), "center", "font-weight:700;") + "</tr>";
    }).join("");

  const totalLine = (ar: string, en: string, v: string, strong = false) =>
    `<tr>
      <td style="padding:7px 12px;color:${strong ? "#0f172a" : "#475569"};font-weight:${strong ? 800 : 500};font-size:${strong ? "14px" : "12.5px"};">
        ${esc(ar)}<div style="font-size:10px;color:#64748b;direction:ltr;">${esc(en)}</div>
      </td>
      <td style="padding:7px 12px;text-align:left;font-weight:${strong ? 800 : 700};color:${strong ? "#1d4ed8" : "#0f172a"};font-size:${strong ? "15px" : "13px"};white-space:nowrap;">${v}</td>
    </tr>`;

  const infoBox = (titleAr: string, titleEn: string, body: string) => `
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
      <div style="background:#f1f5f9;padding:6px 12px;font-size:11.5px;font-weight:700;color:#475569;display:flex;justify-content:space-between;">
        <span>${esc(titleAr)}</span><span style="direction:ltr;color:#94a3b8;">${esc(titleEn)}</span>
      </div>
      <div style="padding:10px 12px;font-size:12.5px;line-height:1.85;">${body}</div>
    </div>`;

  const kv = (ar: string, en: string, v: string) =>
    v ? `<div><span style="color:#64748b;">${esc(ar)} <span style="direction:ltr;font-size:10.5px;">/ ${esc(en)}</span>:</span> <b>${esc(v)}</b></div>` : "";

  const html = `
  <div style="font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;color:#0f172a;direction:rtl;">

    <!-- ترويسة -->
    <table width="100%" style="border-collapse:collapse;margin-bottom:12px;">
      <tr>
        <td style="vertical-align:top;">
          <div style="font-size:20px;font-weight:800;color:#1d4ed8;line-height:1.35;">${esc(info.company_name || "شركة النقل")}</div>
          ${info.company_name_en ? `<div style="font-size:12.5px;font-weight:700;color:#475569;direction:ltr;">${esc(info.company_name_en)}</div>` : ""}
          <div style="font-size:11.5px;color:#64748b;line-height:1.85;margin-top:4px;">
            ${sellerAddress ? esc(sellerAddress) + "<br/>" : ""}
            ${info.company_phone ? "هاتف / Tel: " + esc(info.company_phone) + "&nbsp;&nbsp;" : ""}
            ${info.company_email ? esc(info.company_email) : ""}
          </div>
          <div style="font-size:11.5px;color:#0f172a;line-height:1.85;margin-top:4px;">
            ${kv("الرقم الضريبي", "VAT No.", sellerVat)}
            ${kv("السجل التجاري", "CR No.", info.company_commercial_reg)}
          </div>
        </td>
        <td style="vertical-align:top;text-align:left;width:250px;">
          <div style="background:#1d4ed8;color:#fff;border-radius:10px;padding:10px 14px;text-align:center;">
            <div style="font-size:16px;font-weight:800;letter-spacing:.4px;">${esc(typeLabel.ar)}</div>
            <div style="font-size:12px;opacity:.92;margin-top:2px;direction:ltr;">${esc(typeLabel.en)}</div>
          </div>
          <table width="100%" style="margin-top:8px;border-collapse:collapse;font-size:12px;">
            <tr><td style="padding:3px 0;color:#64748b;">رقم الفاتورة <span style="direction:ltr;font-size:10px;">/ Invoice No.</span></td><td style="padding:3px 0;text-align:left;font-weight:800;">INV-${num}</td></tr>
            <tr><td style="padding:3px 0;color:#64748b;">تاريخ الإصدار <span style="direction:ltr;font-size:10px;">/ Issue date</span></td><td style="padding:3px 0;text-align:left;font-weight:700;">${esc(inv.date)}</td></tr>
            <tr><td style="padding:3px 0;color:#64748b;">العملة <span style="direction:ltr;font-size:10px;">/ Currency</span></td><td style="padding:3px 0;text-align:left;font-weight:700;">${esc(cur)} (${curEn})</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="height:3px;background:linear-gradient(90deg,#1d4ed8,#60a5fa 60%,transparent);border-radius:3px;margin-bottom:12px;"></div>

    <!-- بيانات البائع والمشتري -->
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      ${infoBox("فاتورة إلى (المشتري)", "Bill to (Buyer)", `
        <div style="font-weight:800;font-size:13.5px;">${esc(buyer?.name ?? "—")}</div>
        ${buyer?.name_en ? `<div style="direction:ltr;color:#475569;font-size:11.5px;">${esc(buyer.name_en)}</div>` : ""}
        ${kv("الرقم الضريبي", "VAT No.", buyerVat)}
        ${kv("السجل التجاري", "CR No.", String(buyer?.commercial_reg ?? ""))}
        ${buyerAddress ? `<div style="color:#475569;">${esc(buyerAddress)}</div>` : ""}
        ${buyer?.phone ? `<div style="color:#475569;">هاتف / Tel: ${esc(buyer.phone)}</div>` : ""}
      `)}
      ${infoBox("ملخص الفاتورة", "Invoice summary", `
        <div>عدد البنود <span style="direction:ltr;font-size:10.5px;">/ Line items</span>: <b>${idx}</b></div>
        <div>نسبة الضريبة <span style="direction:ltr;font-size:10.5px;">/ VAT rate</span>: <b>${vatRate}%</b></div>
        <div>الإجمالي المستحق <span style="direction:ltr;font-size:10.5px;">/ Total due</span>: <b style="color:#1d4ed8;">${money(total)} ${esc(cur)}</b></div>
      `)}
    </div>

    <!-- بنود الفاتورة -->
    <table width="100%" style="border-collapse:collapse;font-size:12.5px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
      <thead>
        <tr style="background:#1d4ed8;color:#fff;font-size:11.5px;">
          <th style="padding:8px 6px;width:34px;">${bi("#", "No.")}</th>
          <th style="padding:8px 10px;text-align:right;">${bi("بيان الخدمة", "Description")}</th>
          <th style="padding:8px 6px;width:56px;">${bi("العدد", "Qty")}</th>
          <th style="padding:8px 6px;width:88px;">${bi("سعر الوحدة", "Unit price")}</th>
          <th style="padding:8px 6px;width:92px;">${bi("الإجمالي", "Taxable amount")}</th>
          <th style="padding:8px 6px;width:56px;">${bi("النسبة", "VAT %")}</th>
          <th style="padding:8px 6px;width:88px;">${bi("الضريبة", "VAT amount")}</th>
          <th style="padding:8px 6px;width:100px;">${bi("شامل الضريبة", "Total incl. VAT")}</th>
        </tr>
      </thead>
      <tbody>${tripRows}${billableRows}</tbody>
    </table>

    <!-- الإجماليات ورمز زاتكا -->
    <table width="100%" style="margin-top:12px;border-collapse:collapse;">
      <tr>
        <td style="vertical-align:top;width:150px;text-align:center;">
          ${qrImg ? `<img src="${qrImg}" alt="ZATCA QR" style="width:120px;height:120px;border:1px solid #e2e8f0;border-radius:8px;padding:4px;background:#fff;"/>
          <div style="font-size:10px;color:#64748b;margin-top:4px;line-height:1.6;">رمز الفاتورة الإلكترونية<br/><span style="direction:ltr;">ZATCA e-invoice QR</span></div>` : ""}
        </td>
        <td style="vertical-align:top;padding-inline:12px;">
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:12px;background:#f8fafc;">
            <div style="color:#64748b;font-weight:700;margin-bottom:4px;">المبلغ كتابةً <span style="direction:ltr;font-size:10px;">/ Amount in words</span></div>
            <div style="font-weight:700;line-height:1.85;">${esc(amountToArabicWords(total, cur))}</div>
          </div>
          ${inv.notes ? `<div style="margin-top:8px;border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:12px;">
            <div style="color:#64748b;font-weight:700;margin-bottom:4px;">ملاحظات <span style="direction:ltr;font-size:10px;">/ Notes</span></div>
            <div style="line-height:1.85;">${esc(inv.notes)}</div></div>` : ""}
          ${missing.length ? `<div style="margin-top:8px;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:10px;padding:8px 12px;font-size:11.5px;">
            بيانات ناقصة لاستيفاء متطلبات زاتكا: ${esc(missing.join("، "))}</div>` : ""}
        </td>
        <td style="width:290px;vertical-align:top;">
          <table width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
            ${totalLine("الإجمالي الخاضع للضريبة", "Total taxable amount", `${money(subtotal)} ${esc(cur)}`)}
            ${totalLine(`ضريبة القيمة المضافة (${vatRate}%)`, "VAT", `${money(vat)} ${esc(cur)}`)}
            <tr><td colspan="2" style="padding:0;"><div style="height:2px;background:#1d4ed8;"></div></td></tr>
            ${totalLine("الإجمالي شامل الضريبة", "Total amount due", `${money(total)} ${esc(cur)}`, true)}
          </table>
        </td>
      </tr>
    </table>

    <!-- التوقيعات -->
    <table width="100%" style="margin-top:22px;border-collapse:collapse;font-size:12px;color:#475569;">
      <tr>
        <td style="text-align:center;padding-top:6px;">
          <div style="border-top:1px dashed #94a3b8;padding-top:6px;width:190px;margin:0 auto;">توقيع المستلم <span style="direction:ltr;font-size:10px;">/ Receiver</span></div>
        </td>
        <td style="text-align:center;padding-top:6px;">
          <div style="border-top:1px dashed #94a3b8;padding-top:6px;width:190px;margin:0 auto;">عن الشركة <span style="direction:ltr;font-size:10px;">/ For the company</span></div>
        </td>
      </tr>
    </table>

    <div style="margin-top:14px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:11px;color:#64748b;text-align:center;line-height:1.7;">
      ${esc(info.company_vat_note || "شكراً لتعاملكم معنا")}<br/>
      <span style="direction:ltr;">This invoice complies with ZATCA e-invoicing requirements (KSA).</span>
    </div>
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
