"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Field, Input, Select, Textarea, AmountInput, DateInput, Button, AccountSelect } from "@/components/ui";
import { notify } from "@/components/toast";
import { listSuppliers, supplierBalance } from "@/lib/suppliers";
import { listCustomers, listEmployees, listVehicles, saveReceipt, savePayment, getReceipt, getPayment, companyInfo } from "@/lib/repo";
import { getInvoiceFull, allAccounts, invoiceOptions, tripOptionsByInvoice, tripInvoiceId, tripProfit } from "@/lib/calc";
import type { Customer } from "@/lib/types";
import { money, todayIso, amountToArabicWords, EXPENSE_TYPES, PAYMENT_TYPES, RECEIPT_TYPES, VEHICLE_EXPENSES } from "@/lib/format";


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
  const [invoiceOpts, setInvoiceOpts] = useState<Awaited<ReturnType<typeof invoiceOptions>>>([]);
  const [tripOpts, setTripOpts] = useState<Awaited<ReturnType<typeof tripOptionsByInvoice>>>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [vehicles, setVehicles] = useState<{ id: number; plate_number: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; code: string; name: string }[]>([]);
  const [supplierDue, setSupplierDue] = useState<number | null>(null);
  const [f, setF] = useState({ account_kind: "cashbox", account_id: "", voucher_type: "trip", invoice_id: "", trip_id: "", employee_id: "", vehicle_id: "", vehicle_expense: "maintenance", supplier_id: "", amount: "", description: "", date: todayIso() });
  const [invoiceInfo, setInvoiceInfo] = useState<{ number: number; date: string; customer_name: string; total: number; paid: number; remaining: number } | null>(null);
  const [tripInfo, setTripInfo] = useState<{ price: number; direct: number; later: number; net: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const lastInvoiceRef = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const accs = await allAccounts();
      setAccounts(accs);
      setInvoiceOpts(await invoiceOptions());
      setEmployees(await listEmployees());
      setVehicles(await listVehicles());
      setSuppliers((await listSuppliers()).map((x) => ({ id: x.id, code: x.code, name: x.name })));
      if (id) {
        const v = await getPayment(id);
        if (v) {
          const invoiceId = await tripInvoiceId(v.trip_id);
          setF({ account_kind: v.account_kind, account_id: String(v.account_id), voucher_type: v.voucher_type, invoice_id: invoiceId ? String(invoiceId) : "", trip_id: v.trip_id ? String(v.trip_id) : "", employee_id: v.employee_id ? String(v.employee_id) : "", vehicle_id: v.vehicle_id ? String(v.vehicle_id) : "", vehicle_expense: v.vehicle_expense || "maintenance", supplier_id: (v as { supplier_id?: number | null }).supplier_id ? String((v as { supplier_id?: number | null }).supplier_id) : "", amount: String(v.amount), description: v.description, date: v.date });
          if (invoiceId) {
            lastInvoiceRef.current = invoiceId;
            setTripOpts(await tripOptionsByInvoice(invoiceId));
          }
        }
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

  // اختيار الفاتورة ← عرض بياناتها + سحب نقلاتها فقط
  useEffect(() => {
    if (f.voucher_type !== "trip") {
      setInvoiceInfo(null);
      setTripOpts([]);
      setTripInfo(null);
      return;
    }
    const id = Number(f.invoice_id);
    if (!id) {
      setInvoiceInfo(null);
      setTripOpts([]);
      setTripInfo(null);
      return;
    }
    const inv = invoiceOpts.find((i) => i.id === id);
    setInvoiceInfo(inv ? { number: inv.number, date: inv.date, customer_name: inv.customer_name, total: inv.total, paid: inv.paid, remaining: inv.remaining } : null);
    if (lastInvoiceRef.current !== id) {
      lastInvoiceRef.current = id;
      setF((p) => ({ ...p, trip_id: "" }));
      setTripOpts([]);
    }
    tripOptionsByInvoice(id).then(setTripOpts);
  }, [f.voucher_type, f.invoice_id, invoiceOpts]);

  const save = async () => {
    if (!f.account_id) return notify("اختر الحساب.", "error");
    const amt = parseFloat(f.amount);
    if (!(amt > 0)) return notify("أدخل مبلغاً صحيحاً.", "error");
    setSaving(true);
    try {
      await savePayment({
        date: f.date, account_kind: f.account_kind, account_id: Number(f.account_id),
        voucher_type: f.voucher_type,
        invoice_id: f.voucher_type === "trip" && f.invoice_id ? Number(f.invoice_id) : null,
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
          <Field label="الفاتورة" required>
            <Select value={f.invoice_id} onChange={(e) => setF({ ...f, invoice_id: e.target.value })} disabled={readOnly}>
              <option value="">— اختر الفاتورة —</option>
              {invoiceOpts.map((t) => (
                <option key={t.id} value={t.id}>
                  INV-{String(t.number).padStart(5, "0")} | {t.date} | {t.customer_name} | {money(t.total)}
                </option>
              ))}
            </Select>
          </Field>
          {invoiceInfo && (
            <div className="group-box" style={{ marginTop: 0 }}>
              <div className="group-title">بيانات الفاتورة</div>
              <table className="data-table">
                <tbody>
                  <tr><td>رقم الفاتورة</td><td>INV-{String(invoiceInfo.number).padStart(5, "0")}</td></tr>
                  <tr><td>التاريخ</td><td>{invoiceInfo.date}</td></tr>
                  <tr><td>العميل</td><td>{invoiceInfo.customer_name}</td></tr>
                  <tr><td>إجمالي الفاتورة</td><td>{money(invoiceInfo.total)}</td></tr>
                  <tr><td>المسدَّد من الفاتورة</td><td>{money(invoiceInfo.paid)}</td></tr>
                  <tr className="total-row"><td>المتبقي على الفاتورة</td><td>{money(invoiceInfo.remaining)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
          <Field label="النقلة (الرحلة)" required>
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
                  <tr><td>سعر النقلة</td><td>{money(tripInfo.price)}</td></tr>
                  <tr><td>مصاريف مباشرة مسجلة سابقاً</td><td>{money(tripInfo.direct)}</td></tr>
                  <tr><td>سندات دفع سابقة على النقلة</td><td>{money(tripInfo.later)}</td></tr>
                  <tr className="total-row"><td>صافي الربح/الخسارة حتى الآن</td><td>{money(tripInfo.net)}</td></tr>
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
      {f.voucher_type === "owner" && (
        <span className="field-hint">سحب نقدي خاص بصاحب المنشأة — يخرج من الخزينة/البنك ويُخصم من الأرباح، ويظهر في تقرير الأرباح والخسائر وكشف الحساب.</span>
      )}
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
  const [info, ps, meta] = await Promise.all([
    companyInfo(),
    import("@/lib/print").then((m) => m.getPrintSettings()),
    import("@/lib/exportHelper").then((m) => m.printMeta()),
  ]);
  const { buildZatcaQr, zatcaQrDataUrl, zatcaInvoiceType, zatcaMissingFields, ZATCA_TYPE_LABEL } = await import("@/lib/zatca");
  const { formatNationalAddress } = await import("@/lib/tax");

  const cur = info.currency || "ر.س";
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

  // لغة التسميات: عربي أو إنجليزي فقط (لا يُعرض الاثنان معاً أبداً)
  const enLabels = ps.label_language === "en";
  const bi = (ar: string, en: string) =>
    esc(enLabels ? en : ar);
  const accent = ps.accent_color || "#1d4ed8";
  const soft = ps.template === "minimal" ? "#111827" : accent;
  const headBg = ps.template === "classic" || ps.template === "compact" ? accent
    : ps.template === "minimal" ? "#111827"
    : ps.template === "elegant" ? "#ffffff"
    : accent;
  const headColor = ps.template === "minimal" || ps.template === "elegant" ? (ps.template === "minimal" ? "#111827" : accent) : "#ffffff";
  const borderStyle = ps.template === "minimal" ? "1px solid #cbd5e1" : "1px solid #e2e8f0";
  const titleStyle = ps.template === "modern" ? `background:${accent};color:#fff;border-radius:10px;padding:10px 14px;`
    : ps.template === "classic" ? `border:1.5pt solid ${accent};color:${accent};padding:8px 14px;`
    : ps.template === "elegant" ? `border-bottom:1pt solid ${accent};color:${accent};padding-bottom:8px;`
    : ps.template === "compact" ? `background:${accent};color:#fff;padding:7px 14px;`
    : `color:#111827;border-bottom:1pt solid #111827;padding-bottom:6px;`;
  const showField = (enabled: boolean, value?: unknown) => enabled && String(value ?? "").trim() !== "";
  const labelOr = (v: unknown, alt = "") => String(v ?? "").trim() ? String(v) : alt;

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
        ${bi(ar, en)}
      </td>
      <td style="padding:7px 12px;text-align:left;font-weight:${strong ? 800 : 700};color:${strong ? accent : "#0f172a"};font-size:${strong ? "15px" : "13px"};white-space:nowrap;">${v}</td>
    </tr>`;

  const infoBox = (titleAr: string, titleEn: string, body: string) => `
    <div style="flex:1;border:${borderStyle};border-radius:10px;overflow:hidden;">
      <div style="background:${headBg};padding:6px 12px;font-size:11.5px;font-weight:700;color:${headColor};">
        ${bi(titleAr, titleEn)}
      </div>
      <div style="padding:10px 12px;font-size:12.5px;line-height:1.85;">${body}</div>
    </div>`;

  const kv = (ar: string, en: string, v: string) =>
    v ? `<div><span style="color:#64748b;">${bi(ar, en)}:</span> <b>${esc(v)}</b></div>` : "";

  const html = `
  <div style="font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;color:#0f172a;direction:rtl;">

    <!-- ترويسة -->
    <table width="100%" style="border-collapse:collapse;margin-bottom:12px;">
      <tr>
        <td style="vertical-align:top;">
          ${showField(ps.invoice_show_company_name, info.company_name) ? `<div style="font-size:20px;font-weight:800;color:${accent};line-height:1.35;">${esc(info.company_name || "شركة النقل")}</div>` : ""}
          ${showField(ps.invoice_show_company_name, info.company_name_en) ? `<div style="font-size:12.5px;font-weight:700;color:#475569;direction:ltr;">${esc(info.company_name_en)}</div>` : ""}
          <div style="font-size:11.5px;color:#64748b;line-height:1.85;margin-top:4px;">
            ${showField(ps.invoice_show_company_address, sellerAddress) ? esc(sellerAddress) + "<br/>" : ""}
            ${showField(ps.invoice_show_company_phone, info.company_phone) ? bi("هاتف", "Tel") + ": " + esc(info.company_phone) + "&nbsp;&nbsp;" : ""}
            ${showField(ps.invoice_show_company_email, info.company_email) ? esc(info.company_email) + "&nbsp;&nbsp;" : ""}
            ${showField(ps.invoice_show_company_website, info.company_website) ? esc(info.company_website) : ""}
          </div>
          <div style="font-size:11.5px;color:#0f172a;line-height:1.85;margin-top:4px;">
            ${showField(ps.invoice_show_company_tax_number, sellerVat) ? kv("الرقم الضريبي", "VAT No.", sellerVat) : ""}
            ${showField(ps.invoice_show_company_cr, info.company_commercial_reg) ? kv("السجل التجاري", "CR No.", labelOr(info.company_commercial_reg)) : ""}
            ${showField(ps.invoice_show_company_unified, info.company_unified_number) ? kv("الرقم الموحّد", "Unified No.", labelOr(info.company_unified_number)) : ""}
          </div>
        </td>
        <td style="vertical-align:top;text-align:left;width:250px;">
          <div style="${titleStyle};text-align:center;${ps.template === "minimal" ? "border:1pt solid #111827;" : ""}${ps.template === "elegant" ? "border-bottom:1pt solid " + accent + ";" : ""}">
            <div style="font-size:16px;font-weight:800;letter-spacing:.4px;">${bi(typeLabel.ar, typeLabel.en)}</div>
          </div>
          <table width="100%" style="margin-top:8px;border-collapse:collapse;font-size:12px;">
            <tr><td style="padding:3px 0;color:#64748b;">${bi("رقم الفاتورة", "Invoice No.")}</td><td style="padding:3px 0;text-align:left;font-weight:800;">INV-${num}</td></tr>
            <tr><td style="padding:3px 0;color:#64748b;">${bi("تاريخ الإصدار", "Issue date")}</td><td style="padding:3px 0;text-align:left;font-weight:700;">${esc(inv.date)}</td></tr>
            ${showField(ps.invoice_show_currency, cur) ? `<tr><td style="padding:3px 0;color:#64748b;">${bi("العملة", "Currency")}</td><td style="padding:3px 0;text-align:left;font-weight:700;">${esc(cur)}${enLabels ? " (SAR)" : ""}</td></tr>` : ""}
            <tr><td style="padding:3px 0;color:#64748b;">${bi("طُبع بواسطة", "Printed by")}</td><td style="padding:3px 0;text-align:left;font-weight:700;">${esc(meta.printedBy || "—")}</td></tr>
            <tr><td style="padding:3px 0;color:#64748b;">${bi("وقت الطباعة", "Printed at")}</td><td style="padding:3px 0;text-align:left;font-weight:700;">${esc(meta.printedAt)}</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="height:3px;background:linear-gradient(90deg,${soft},${accent} 60%,transparent);border-radius:3px;margin-bottom:12px;"></div>

    <!-- بيانات البائع والمشتري -->
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      ${infoBox("فاتورة إلى (المشتري)", "Bill to (Buyer)", `
        ${showField(ps.invoice_show_customer_name, buyer?.name) ? `<div style="font-weight:800;font-size:13.5px;">${esc(buyer?.name ?? "—")}</div>` : ""}
        ${showField(ps.invoice_show_customer_code, inv.customer_code) ? `<div style="color:#475569;">${bi("كود العميل", "Customer code")}: ${esc(inv.customer_code)}</div>` : ""}
        ${showField(ps.invoice_show_customer_name, buyer?.name_en) && buyer?.name_en ? `<div style="direction:ltr;color:#475569;font-size:11.5px;">${esc(buyer.name_en)}</div>` : ""}
        ${showField(ps.invoice_show_customer_tax_number, buyerVat) ? kv("الرقم الضريبي", "VAT No.", buyerVat) : ""}
        ${showField(ps.invoice_show_customer_cr, buyer?.commercial_reg) ? kv("السجل التجاري", "CR No.", labelOr(buyer?.commercial_reg)) : ""}
        ${showField(ps.invoice_show_customer_address, buyerAddress) ? `<div style="color:#475569;">${esc(buyerAddress)}</div>` : ""}
        ${showField(ps.invoice_show_customer_phone, buyer?.phone) ? `<div style="color:#475569;">${bi("هاتف", "Tel")}: ${esc(buyer!.phone)}</div>` : ""}
        ${!showField(ps.invoice_show_customer_name, buyer?.name) && !showField(ps.invoice_show_customer_code, inv.customer_code) ? `<div style="color:#64748b;">${bi("—", "—")}</div>` : ""}
      `)}
      ${infoBox("ملخص الفاتورة", "Invoice summary", `
        ${inv.container_number ? `<div>${bi("رقم الحاوية", "Container No.")}: <b dir="ltr">${esc(inv.container_number)}</b></div>` : ""}
        <div>${bi("عدد البنود", "Line items")}: <b>${idx}</b></div>
        <div>${bi("نسبة الضريبة", "VAT rate")}: <b>${vatRate}%</b></div>
        <div>${bi("الإجمالي المستحق", "Total due")}: <b style="color:${accent};">${money(total)} ${esc(cur)}</b></div>
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
          ${ps.invoice_show_barcode && qrImg && missing.length === 0 ? `<img src="${qrImg}" alt="QR" style="width:120px;height:120px;border:1px solid #e2e8f0;border-radius:8px;padding:4px;background:#fff;"/>` : ""}
        </td>
        <td style="vertical-align:top;padding-inline:12px;">
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:12px;background:#f8fafc;">
            <div style="color:#64748b;font-weight:700;margin-bottom:4px;">${bi("المبلغ كتابةً", "Amount in words")}</div>
            <div style="font-weight:700;line-height:1.85;">${esc(amountToArabicWords(total, cur))}</div>
          </div>
          ${inv.notes ? `<div style="margin-top:8px;border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:12px;">
            <div style="color:#64748b;font-weight:700;margin-bottom:4px;">${bi("ملاحظات", "Notes")}</div>
            <div style="line-height:1.85;">${esc(inv.notes)}</div></div>` : ""}
        </td>
        <td style="width:290px;vertical-align:top;">
          <table width="100%" style="border-collapse:collapse;border:${borderStyle};border-radius:10px;overflow:hidden;">
            ${totalLine("الإجمالي الخاضع للضريبة", "Total taxable amount", `${money(subtotal)} ${esc(cur)}`)}
            ${totalLine(`ضريبة القيمة المضافة (${vatRate}%)`, "VAT", `${money(vat)} ${esc(cur)}`)}
            <tr><td colspan="2" style="padding:0;"><div style="height:2px;background:${accent};"></div></td></tr>
            ${totalLine("الإجمالي شامل الضريبة", "Total amount due", `${money(total)} ${esc(cur)}`, true)}
          </table>
        </td>
      </tr>
    </table>

    <!-- التوقيعات -->
    <table width="100%" style="margin-top:22px;border-collapse:collapse;font-size:12px;color:#475569;">
      <tr>
        <td style="text-align:center;padding-top:6px;">
          <div style="border-top:1px dashed #94a3b8;padding-top:6px;width:190px;margin:0 auto;">${bi("توقيع المستلم", "Receiver")}</div>
        </td>
        <td style="text-align:center;padding-top:6px;">
          <div style="border-top:1px dashed #94a3b8;padding-top:6px;width:190px;margin:0 auto;">${bi("عن الشركة", "For the company")}</div>
        </td>
      </tr>
    </table>

    ${ps.footer_text ? `<div style="margin-top:14px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:11px;color:#64748b;text-align:center;line-height:1.7;">${esc(ps.footer_text)}</div>` : ""}
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
