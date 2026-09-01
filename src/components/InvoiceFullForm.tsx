"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select, Textarea, AmountInput, DateInput, Button } from "@/components/ui";
import { notify } from "@/components/toast";
import { listCustomers, listEmployees, listVehicles, saveInvoice, currentVatRate, getCustomer, companyInfo } from "@/lib/repo";
import { money, todayIso } from "@/lib/format";

type TripRow = {
  vehicle_id: string;
  driver_id: string;
  from_loc: string;
  to_loc: string;
  qty: string;
  unit_price: string;
  notes: string;
};

const n = (v: string) => parseFloat(String(v).replace(/,/g, "")) || 0;
const tripLineTotal = (t: { qty: string; unit_price: string }) =>
  Math.round(Math.max(1, n(t.qty) || 1) * n(t.unit_price) * 100) / 100;

export default function InvoiceFullForm() {
  const router = useRouter();
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [vehicles, setVehicles] = useState<{ id: number; plate_number: string }[]>([]);
  const [drivers, setDrivers] = useState<{ id: number; name: string }[]>([]);
  const [f, setF] = useState({ customer_id: "", date: todayIso(), vat_rate: "15", notes: "", container_number: "" });
  const [trips, setTrips] = useState<TripRow[]>([{ vehicle_id: "", driver_id: "", from_loc: "", to_loc: "", qty: "1", unit_price: "", notes: "" }]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [cs, vs, ds, vatRate] = await Promise.all([listCustomers(), listVehicles(), listEmployees("driver"), currentVatRate()]);
      setCustomers(cs); setVehicles(vs); setDrivers(ds);
      setF((old) => ({ ...old, vat_rate: String(vatRate) }));
    })();
  }, []);

  const totals = useMemo(() => {
    const tripsTotal = trips.reduce((a, t) => a + tripLineTotal(t), 0);
    const subtotal = Math.round(tripsTotal * 100) / 100;
    const vatRate = parseFloat(f.vat_rate || "0") || 0;
    const vat = Math.round(subtotal * vatRate) / 100;
    return { tripsTotal, subtotal, vat, total: subtotal + vat };
  }, [trips, f.vat_rate]);

  const upd = (i: number, patch: Partial<TripRow>) =>
    setTrips((p) => p.map((t, x) => (x === i ? { ...t, ...patch } : t)));

  const save = async () => {
    if (!f.customer_id) return notify("اختر العميل.", "error");
    if (!trips.length) return notify("أضف نقلة واحدة على الأقل.", "error");
    for (const t of trips) {
      if (!t.from_loc.trim() || !t.to_loc.trim()) return notify("أكمل أماكن الانطلاق والوصول لكل نقلة.", "error");
      if (!(n(t.qty) >= 1)) return notify("عدد النقلات يجب أن يكون 1 على الأقل.", "error");
      if (!(tripLineTotal(t) > 0)) return notify("سعر النقلة يجب أن يكون أكبر من صفر.", "error");
    }
    setSaving(true);
    try {
      await saveInvoice({
        customer_id: Number(f.customer_id), date: f.date, notes: f.notes,
        container_number: f.container_number.trim(),
        vat_rate: parseFloat(f.vat_rate || "15") || 15,
        attachments,
        trips: trips.map((t) => ({
          vehicle_id: t.vehicle_id ? Number(t.vehicle_id) : null,
          driver_id: t.driver_id ? Number(t.driver_id) : null,
          from_loc: t.from_loc, to_loc: t.to_loc,
          qty: Math.max(1, Math.trunc(n(t.qty) || 1)),
          unit_price: n(t.unit_price),
          price: tripLineTotal(t),
          notes: t.notes,
          expenses: [],
        })),
      });
      // عند تفعيل المطوّر للفاتورة الضريبية فقط: ننبه إلى البيانات الناقصة
      // اللازمة للباركود. عند توقف الميزة يظهر تحذير عدم مطابقة زاتكا وقت الطباعة.
      let warn = "";
      try {
        const { hasFeature } = await import("@/lib/features");
        const taxInvoiceEnabled = await hasFeature("tax_invoice");
        if (taxInvoiceEnabled) {
          const [info, cust] = await Promise.all([companyInfo(), getCustomer(Number(f.customer_id))]);
          const { zatcaInvoiceType, zatcaMissingFields } = await import("@/lib/zatca");
          const { formatNationalAddress } = await import("@/lib/tax");
          const c = (cust ?? {}) as Record<string, string | undefined>;
          const sellerAddress = formatNationalAddress({
            country: info.company_country, region: info.company_region, city: info.company_city,
            district: info.company_district, street: info.company_street, building_no: info.company_building_no,
            postal_code: info.company_postal_code, additional_no: info.company_additional_no,
            address_note: info.company_address_note,
          }) || info.company_address || "";
          const type = zatcaInvoiceType({ tax_number: c.tax_number, tax_status: c.tax_status });
          const missing = zatcaMissingFields({
            sellerName: info.company_name, sellerVat: info.company_tax_number, sellerAddress,
            buyerName: c.name, buyerVat: c.tax_number, type, date: f.date,
          });
          if (missing.length) warn = ` — ⚠️ بيانات الفاتورة ناقصة (${missing.join("، ")}) ولن يُنشأ/يُطبع الباركود حتى استكمالها.`;
        }
      } catch { /* تحذير فقط؛ لا يمنع حفظ الفاتورة */ }
      notify(warn ? `تم حفظ الفاتورة بنجاح.${warn}` : "تم حفظ الفاتورة بنجاح.", warn ? "warning" : "success");
      router.push("/invoices");
      router.refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inv-form">
      <div className="page-head">
        <div>
          <Button variant="row" onClick={() => router.push("/invoices")}>→ عودة للفواتير</Button>
        </div>
        <div className="page-head-title">فاتورة نقل جديدة — صفحة كاملة</div>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          المصروفات لا تُسجَّل هنا؛ تُسجَّل من «سندات الدفع» مع اختيار الفاتورة/الرحلة.
        </div>
      </div>

      <div className="inv-head-card">
        <Field label="العميل" required>
          <Select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}>
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
        <Field label="رقم الحاوية (اختياري)">
          <Input dir="ltr" value={f.container_number} onChange={(e) => setF({ ...f, container_number: e.target.value })} placeholder="مثال: MSCU1234567" />
        </Field>
      </div>

      <div>
        <div className="inv-sec-title">
          <span>بنود النقل</span>
          <button className="btn btn-primary" onClick={() => setTrips((p) => [...p, { vehicle_id: "", driver_id: "", from_loc: "", to_loc: "", qty: "1", unit_price: "", notes: "" }])}>＋ إضافة نقلة</button>
        </div>

        {trips.map((t, i) => (
          <div key={i} className="trip-card">
            <div className="trip-card-head">
              <span className="trip-badge">{i + 1}</span>
              <span className="trip-route">
                {t.from_loc || <span className="muted">من …</span>}
                <span className="muted"> ← </span>
                {t.to_loc || <span className="muted">إلى …</span>}
              </span>
              <span className="trip-head-spacer" />
              <span className="trip-head-amount">{money(tripLineTotal(t))}</span>
              <button className="btn-row-danger" onClick={() => setTrips((p) => p.filter((_, x) => x !== i))}>حذف النقلة</button>
            </div>
            <div className="trip-card-body">
              <div className="trip-grid-4">
                <Field label="من" required><Input value={t.from_loc} onChange={(e) => upd(i, { from_loc: e.target.value })} /></Field>
                <Field label="إلى" required><Input value={t.to_loc} onChange={(e) => upd(i, { to_loc: e.target.value })} /></Field>
                <Field label="السيارة">
                  <Select value={t.vehicle_id} onChange={(e) => upd(i, { vehicle_id: e.target.value })}>
                    <option value="">—</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                  </Select>
                </Field>
                <Field label="السائق">
                  <Select value={t.driver_id} onChange={(e) => upd(i, { driver_id: e.target.value })}>
                    <option value="">—</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="trip-price-box">
                <Field label="عدد النقلات" required>
                  <Input type="number" min={1} step={1} dir="ltr" style={{ textAlign: "center" }}
                    value={t.qty} onChange={(e) => upd(i, { qty: e.target.value })} />
                </Field>
                <Field label="سعر النقلة الواحدة" required>
                  <AmountInput value={t.unit_price} onChange={(v) => upd(i, { unit_price: v })} />
                </Field>
                <Field label="إجمالي بند النقل">
                  <Input value={money(tripLineTotal(t))} readOnly />
                </Field>
              </div>
              <Field label="ملاحظات النقلة"><Input value={t.notes} onChange={(e) => upd(i, { notes: e.target.value })} /></Field>
              <div className="exp-hint" style={{ marginTop: 4 }}>
                💡 مصاريف النقل تُسجَّل من سندات الدفع فقط، وستظهر هنا في التقارير بعد التسجيل.
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="inv-totals">
        <div className="tot-card client">
          <div className="tot-card-head"><span>ما يُطالَب به العميل</span></div>
          <div className="tot-card-body">
            <div className="tot-line"><span className="k">إجمالي بنود النقل</span><span className="v">{money(totals.tripsTotal)}</span></div>
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
      </div>

      <Field label="ملاحظات الفاتورة (تظهر للعميل)">
        <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <Field label="المرفقات">
        <Input type="file" multiple onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          setAttachments((p) => [...p, ...files.map((x) => x.name)]);
        }} />
        {attachments.length > 0 && <div style={{ marginTop: 6, color: "var(--muted)" }}>{attachments.join("، ")}</div>}
      </Field>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button variant="primary" onClick={save} disabled={saving}>💾 حفظ الفاتورة</Button>
        <Button onClick={() => router.push("/invoices")}>إلغاء</Button>
      </div>
    </div>
  );
}
