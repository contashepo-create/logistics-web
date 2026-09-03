"use client";

import { useEffect, useRef, useState } from "react";
import { Modal, Field, Input, Select, Textarea, AmountInput, DateInput, Button, AccountSelect } from "@/components/ui";
import { notify } from "@/components/toast";
import { listSuppliers, supplierBalance } from "@/lib/suppliers";
import { listCustomers, listEmployees, listVehicles, saveReceipt, savePayment, getReceipt, getPayment, companyInfo, listCreditDebitNotesForInvoice } from "@/lib/repo";
import { getInvoiceFull, allAccounts, invoiceOptions, tripOptionsByInvoice, tripInvoiceId } from "@/lib/calc";
import type { Customer } from "@/lib/types";
import { money, todayIso, amountToArabicWords, EXPENSE_TYPES, PAYMENT_TYPES, RECEIPT_TYPES, VEHICLE_EXPENSES } from "@/lib/format";
import { getProfile } from "@/lib/auth";
import { hasFeature, shouldWarnTaxInvoice, TAX_INVOICE_WARNING } from "@/lib/features";
import { renderInvoiceTemplate, type InvoiceTemplateLine } from "@/lib/invoice-template-html";
import { openPrintPreview } from "@/lib/exporter";
import type { PrintSettings } from "@/lib/print";


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
export function PaymentDialog({ id, readOnly, onClose, embedded = false }: { id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void; embedded?: boolean }) {
  const [accounts, setAccounts] = useState<{ kind: string; id: number; label: string }[]>([]);
  const [invoiceOpts, setInvoiceOpts] = useState<Awaited<ReturnType<typeof invoiceOptions>>>([]);
  const [tripOpts, setTripOpts] = useState<Awaited<ReturnType<typeof tripOptionsByInvoice>>>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [vehicles, setVehicles] = useState<{ id: number; plate_number: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; code: string; name: string }[]>([]);
  const [supplierDue, setSupplierDue] = useState<number | null>(null);
  const [f, setF] = useState({ account_kind: "cashbox", account_id: "", voucher_type: "trip", invoice_id: "", trip_id: "", employee_id: "", vehicle_id: "", vehicle_expense: "maintenance", supplier_id: "", quantity: "1", unit_amount: "", description: "", date: todayIso() });
  const [invoiceInfo, setInvoiceInfo] = useState<{ number: number; customer_name: string; remaining: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const lastInvoiceRef = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const [accs, invoices, employeeRows, vehicleRows, supplierRows, voucher] = await Promise.all([
        allAccounts(),
        invoiceOptions(),
        listEmployees(),
        listVehicles(),
        listSuppliers(),
        id ? getPayment(id) : Promise.resolve(null),
      ]);
      setAccounts(accs);
      setInvoiceOpts(invoices);
      setEmployees(employeeRows);
      setVehicles(vehicleRows);
      setSuppliers(supplierRows.map((x) => ({ id: x.id, code: x.code, name: x.name })));

      if (voucher) {
        const invoiceId = await tripInvoiceId(voucher.trip_id);
        setF({ account_kind: voucher.account_kind, account_id: String(voucher.account_id), voucher_type: voucher.voucher_type, invoice_id: invoiceId ? String(invoiceId) : "", trip_id: voucher.trip_id ? String(voucher.trip_id) : "", employee_id: voucher.employee_id ? String(voucher.employee_id) : "", vehicle_id: voucher.vehicle_id ? String(voucher.vehicle_id) : "", vehicle_expense: voucher.vehicle_expense || "maintenance", supplier_id: voucher.supplier_id ? String(voucher.supplier_id) : "", quantity: String(voucher.quantity || 1), unit_amount: String(voucher.unit_amount || voucher.amount), description: voucher.description, date: voucher.date });
        if (invoiceId) lastInvoiceRef.current = invoiceId;
      } else if (!id && accs.length) {
        setF((old) => ({ ...old, account_kind: accs[0].kind, account_id: String(accs[0].id) }));
      }
    })();
  }, [id]);

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
      return;
    }
    const id = Number(f.invoice_id);
    if (!id) {
      setInvoiceInfo(null);
      setTripOpts([]);
      return;
    }
    const inv = invoiceOpts.find((i) => i.id === id);
    setInvoiceInfo(inv ? { number: inv.number, customer_name: inv.customer_name, remaining: inv.remaining } : null);
    if (lastInvoiceRef.current !== id) {
      lastInvoiceRef.current = id;
      setF((p) => ({ ...p, trip_id: "" }));
      setTripOpts([]);
    }
    tripOptionsByInvoice(id).then(setTripOpts);
  }, [f.voucher_type, f.invoice_id, invoiceOpts]);

  const quantity = Number(f.quantity);
  const unitAmount = Number(f.unit_amount);
  const totalAmount = Number.isFinite(quantity) && Number.isFinite(unitAmount)
    ? Math.round(quantity * unitAmount * 100) / 100
    : 0;

  const save = async () => {
    if (!f.account_id) return notify("اختر الحساب.", "error");
    if (!(quantity > 0)) return notify("أدخل عدداً أكبر من صفر.", "error");
    if (!(unitAmount > 0)) return notify("أدخل قيمة وحدة صحيحة.", "error");
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
        quantity, unit_amount: unitAmount, amount: totalAmount, description: f.description,
      }, id);
      notify("تم حفظ سند الدفع بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <>
      <Field label="نوع السند">
        <Select value={f.voucher_type} onChange={(e) => setF({ ...f, voucher_type: e.target.value })} disabled={readOnly}>
          {Object.entries(PAYMENT_TYPES).filter(([k]) => k !== "purchase").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
                  INV-{String(t.number).padStart(5, "0")} — {t.customer_name}
                </option>
              ))}
            </Select>
          </Field>
          {invoiceInfo && (
            <div className="payment-selection-summary">
              <strong>INV-{String(invoiceInfo.number).padStart(5, "0")}</strong>
              <span>{invoiceInfo.customer_name}</span>
              <span>المتبقي: <b>{money(invoiceInfo.remaining)}</b></span>
            </div>
          )}
          <Field label="النقلة (الرحلة)" required>
            <Select value={f.trip_id} onChange={(e) => setF({ ...f, trip_id: e.target.value })} disabled={readOnly}>
              <option value="">— اختر النقلة —</option>
              {tripOpts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
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
          disabled={readOnly}
        />
      </Field>
      <div className="payment-amount-grid">
        <Field label="العدد" required>
          <AmountInput value={f.quantity} onChange={(v) => setF({ ...f, quantity: v })} readOnly={readOnly} />
        </Field>
        <Field label="قيمة الوحدة" required>
          <AmountInput value={f.unit_amount} onChange={(v) => setF({ ...f, unit_amount: v })} readOnly={readOnly} />
        </Field>
        <Field label="الإجمالي">
          <Input value={totalAmount > 0 ? money(totalAmount) : "0.00"} readOnly aria-label="إجمالي سند الدفع" />
        </Field>
      </div>
      <Field label="التاريخ" required><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} disabled={readOnly} /></Field>
      <Field label="البيان"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} readOnly={readOnly} /></Field>
      {f.voucher_type === "owner" && (
        <span className="field-hint">سحب نقدي خاص بصاحب المنشأة — يخرج من الخزينة/البنك ويُخصم من الأرباح، ويظهر في تقرير الأرباح والخسائر وكشف الحساب.</span>
      )}
      {!readOnly && <div className="payment-page-actions"><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ السند</Button></div>}
    </>
  );

  if (embedded) {
    return (
      <div className="payment-page-shell">
        <div className="payment-scroll-hint">استخدم شريط التمرير الجانبي أو مفاتيح الأسهم وPage Down لرؤية بقية السند.</div>
        <div className="payment-page-scroll" tabIndex={0} aria-label="نموذج سند الدفع القابل للتمرير">
          {content}
        </div>
      </div>
    );
  }
  return <Modal title={id ? (readOnly ? "عرض سند دفع" : "تعديل سند دفع") : "سند دفع جديد"} onClose={() => onClose()}>{content}</Modal>;
}

/* ============================ فاتورة العميل (طباعة / PDF) ============================ */
/**
 * فاتورة بيع للعميل: تعرض ما يُطالَب به فقط (بنود النقل + البنود التي يتحمّلها العميل
 * + الضريبة). لا تُعرض أي تكاليف أو أرباح أو مصادر تمويل أو موردين أو سائقين.
 */
export async function customerInvoiceHtml(invoiceId: number): Promise<{ html: string; number: number; warnTaxInvoice: boolean; settings: PrintSettings } | null> {
  const inv = await getInvoiceFull(invoiceId);
  if (!inv) return null;
  const [info, ps, meta, taxInvoiceEnabled, profile, notes] = await Promise.all([
    companyInfo(),
    import("@/lib/print").then((m) => m.getPrintSettings()),
    import("@/lib/exportHelper").then((m) => m.printMeta()),
    hasFeature("tax_invoice"),
    getProfile().catch(() => null),
    listCreditDebitNotesForInvoice(invoiceId).catch(() => []),
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
  // لا يُنشأ QR أصلاً ما لم يمنح المطوّر ميزة الفاتورة الضريبية لهذه الشركة.
  if (taxInvoiceEnabled) {
    try {
      qrImg = await zatcaQrDataUrl(qrPayload);
    } catch {
      qrImg = "";
    }
  }
  const missing = zatcaMissingFields({
    sellerName: info.company_name, sellerVat, sellerAddress,
    buyerName: buyer?.name, buyerVat, type: invType, date: inv.date,
  });

  const toLine = (
    description: string,
    detail: string,
    quantity: number,
    unitAmount: number,
    taxableAmount: number,
    containerNumbers: string[] = [],
  ): InvoiceTemplateLine => {
    const vatAmount = Math.round(taxableAmount * vatRate) / 100;
    return {
      description,
      detail,
      containerNumbers,
      quantity,
      unitAmount,
      taxableAmount,
      vatRate,
      vatAmount,
      total: Math.round((taxableAmount + vatAmount) * 100) / 100,
    };
  };

  // بنود العميل فقط: لا تمر أي تكلفة داخلية أو اسم مورد أو مصدر تمويل إلى القالب.
  const lines: InvoiceTemplateLine[] = [
    ...inv.trips.map((t) => toLine(
      `خدمة نقل: ${t.from_loc || "—"} ← ${t.to_loc || "—"}`,
      t.notes || "",
      Number(t.qty ?? 1),
      Number(t.unit_price || t.price) || 0,
      Number(t.price) || 0,
      t.container_numbers ?? [],
    )),
    ...inv.trips.flatMap((t) => (t.expenses ?? [])
      .filter((e) => e.source === "customer")
      .map((e) => toLine(
        e.notes || EXPENSE_TYPES[e.expense_type] || "بند إضافي",
        `${t.from_loc || "—"} ← ${t.to_loc || "—"}`,
        Number(e.qty ?? 1),
        Number(e.unit_amount || e.amount) || 0,
        Number(e.amount) || 0,
      ))),
  ];

  const creditNotesList = notes.filter((n) => n.note_type === "credit");
  const hasCreditNote = creditNotesList.length > 0;
  const creditNoteAmount = creditNotesList.reduce((sum, n) => sum + Number(n.total ?? 0), 0);

  const html = renderInvoiceTemplate({
    invoiceNumber: `INV-${num}`,
    issueDate: inv.date,
    invoiceTitleAr: typeLabel.ar,
    invoiceTitleEn: typeLabel.en,
    currency: cur,
    containerNumber: inv.container_number || "",
    seller: {
      name: info.company_name || "شركة النقل",
      nameEn: info.company_name_en || "",
      taxNumber: sellerVat,
      commercialRegistration: info.company_commercial_reg || "",
      unifiedNumber: info.company_unified_number || "",
      address: sellerAddress,
      phone: info.company_phone || "",
      email: info.company_email || "",
      website: info.company_website || "",
    },
    buyer: {
      name: buyer?.name || "—",
      nameEn: buyer?.name_en || "",
      code: inv.customer_code,
      taxNumber: buyerVat,
      commercialRegistration: buyer?.commercial_reg || "",
      address: buyerAddress,
      phone: buyer?.phone || "",
    },
    lines,
    hasCreditNote,
    creditNoteAmount,
    subtotal,
    vatRate,
    vatAmount: vat,
    total,
    amountInWords: amountToArabicWords(total, cur),
    notes: inv.notes || "",
    printedBy: meta.printedBy || "—",
    printedAt: meta.printedAt,
    qrDataUrl: taxInvoiceEnabled && qrImg && missing.length === 0 ? qrImg : "",
    qrCaption: "رمز الفاتورة الضريبية",
    footerText: ps.header_note || "",
  }, ps);

  return {
    html,
    number: inv.number,
    warnTaxInvoice: shouldWarnTaxInvoice({ featureEnabled: taxInvoiceEnabled, vatRate, profile }),
    settings: ps,
  };
}

/** تحذير واجهة فقط؛ لا يدخل مطلقاً في HTML المطبوع أو ملف PDF. */
function showTaxInvoiceWarning(show: boolean): void {
  if (!show || typeof window === "undefined") return;
  window.alert(TAX_INVOICE_WARNING);
}

export async function printCustomerInvoice(invoiceId: number): Promise<void> {
  // يجب أن يتم window.open داخل حدث النقر نفسه؛ وإلا قد يحجبه المتصفح بعد await.
  const preview = openPrintPreview("معاينة الفاتورة");
  if (!preview) {
    notify("تعذّر فتح معاينة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مجدداً.", "error");
    return;
  }
  try {
    const res = await customerInvoiceHtml(invoiceId);
    if (!res) {
      preview?.close();
      return notify("الفاتورة غير موجودة.", "error");
    }
    showTaxInvoiceWarning(res.warnTaxInvoice);
    const [{ printCss }, { printHtml }] = await Promise.all([
      import("@/lib/print"),
      import("@/lib/exporter"),
    ]);
    printHtml(res.html, `فاتورة ${res.number}`, { css: printCss(res.settings), watermark: res.settings.watermark }, preview);
  } catch (error) {
    preview?.close();
    notify(error instanceof Error ? error.message : "تعذّر تجهيز معاينة الطباعة.", "error");
  }
}

export async function exportCustomerInvoicePdf(invoiceId: number): Promise<void> {
  const res = await customerInvoiceHtml(invoiceId);
  if (!res) return notify("الفاتورة غير موجودة.", "error");
  showTaxInvoiceWarning(res.warnTaxInvoice);
  const { exportPdfHtml } = await import("@/lib/exporter");
  await exportPdfHtml(res.html, `فاتورة-${res.number}.pdf`);
}
