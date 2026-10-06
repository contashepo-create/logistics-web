"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect, Field, Input, AmountInput, Select, Button,
} from "@/components/ui";
import { notify } from "@/components/toast";
import { customerFullReport, balanceSideLabel } from "@/lib/customerReport";
import {
  exportCustomerReportExcel, exportCustomerReportPdf, printCustomerReport,
} from "@/lib/customerReportExport";
import { statementFiltersLabel, STATEMENT_DOC_TYPES, invoiceNumberLabel, type StatementFilters, type StatementDocType } from "@/lib/calc";
import { itemOptions } from "@/lib/items";
import { money, todayIso } from "@/lib/format";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

const STATUS_LABEL: Record<string, string> = { paid: "مسددة", partial: "مسددة جزئياً", open: "غير مسددة" };

/** التقرير الشامل عن العميل: كل ما يخصه — بيانات، فواتير، نقلات، خدمات، سندات، إشعارات، أرصدة وأعمار — مع تصدير. */
export default function CustomerFullReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const customerId = Number(params.id);
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [busy, setBusy] = useState<"" | "excel" | "pdf" | "print">("");

  const [q, setQ] = useState("");
  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [docType, setDocType] = useState<StatementDocType | "">("");
  const [itemId, setItemId] = useState<number | null>(null);

  const filters = useMemo<StatementFilters>(() => ({
    q: q.trim() || undefined,
    fromLoc: fromLoc.trim() || undefined,
    toLoc: toLoc.trim() || undefined,
    amountMin: amountMin.trim() === "" ? null : parseFloat(amountMin),
    amountMax: amountMax.trim() === "" ? null : parseFloat(amountMax),
    docType: docType || undefined,
    itemId: itemId ?? null,
  }), [q, fromLoc, toLoc, amountMin, amountMax, docType, itemId]);

  const { data: items } = useQuery({ queryKey: ["items-options"], queryFn: () => itemOptions(true) });

  const { data: rep, isLoading } = useQuery({
    queryKey: ["report-customer-full", customerId, dFrom, dTo, filters],
    queryFn: () => customerFullReport(customerId, dFrom, dTo, filters),
    placeholderData: keepPreviousData,
    enabled: Number.isFinite(customerId) && customerId > 0,
  });

  const s = rep?.summary;
  const filterLabel = statementFiltersLabel(filters);
  const subtitle = rep
    ? `الكود: ${rep.customer?.code ?? "—"} | الفترة: من ${rep.from} إلى ${rep.to}${filterLabel ? ` — ${filterLabel}` : ""} | الحركات المعروضة ${rep.statement.matched_count} من ${rep.statement.all_rows_count}`
    : "كل ما يخص العميل في تقرير واحد";

  const run = async (mode: "excel" | "pdf" | "print") => {
    if (!rep) return;
    setBusy(mode);
    try {
      if (mode === "excel") await exportCustomerReportExcel(rep);
      else if (mode === "pdf") await exportCustomerReportPdf(rep);
      else await printCustomerReport(rep);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy("");
    }
  };

  const resetFilters = () => {
    setQ(""); setFromLoc(""); setToLoc(""); setAmountMin(""); setAmountMax(""); setDocType(""); setItemId(null);
  };

  return (
    <PageFrame
      title={`التقرير الشامل عن العميل${rep?.customer ? ` - ${rep.customer.name}` : ""}`}
      subtitle={subtitle}
      toolbar={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Button onClick={() => router.push("/reports/customers")}>→ كل العملاء</Button>
          <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["report-customer-full", customerId] })} />
        </div>
      }
      exportBar={<ExportBar onExcel={() => run("excel")} onPdf={() => run("pdf")} onPrint={() => run("print")} />}
    >
      {isLoading && !rep ? <Spinner /> : !rep?.customer ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>العميل غير موجود.</div>
      ) : (
        <>
          {/* ——— فلتر ذكي لحركات الكشف داخل التقرير ——— */}
          <div className="group-box" style={{ marginTop: 0 }}>
            <div className="group-title">فلتر ذكي لحركات الكشف</div>
            <div className="form-grid-3">
              <Field label="النقلة من (مكان الانطلاق)">
                <Input value={fromLoc} onChange={(e) => setFromLoc(e.target.value)} placeholder="مثال: الرياض" />
              </Field>
              <Field label="النقلة إلى (مكان الوصول)">
                <Input value={toLoc} onChange={(e) => setToLoc(e.target.value)} placeholder="مثال: الدمام" />
              </Field>
              <Field label="نوع المستند (بيع / مرتجع / إشعار / سند)">
                <Select value={docType} onChange={(e) => setDocType(e.target.value as StatementDocType | "")}>
                  <option value="">الكل</option>
                  {STATEMENT_DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
            </div>
            <div className="form-grid-3">
              <Field label="الخدمة / الخط">
                <DictSelect value={itemId} onChange={setItemId} options={items ?? []} placeholder="كل الخدمات" />
              </Field>
              <Field label="القيمة من (شامل الضريبة)">
                <AmountInput value={amountMin} onChange={setAmountMin} />
              </Field>
              <Field label="القيمة إلى (شامل الضريبة)">
                <AmountInput value={amountMax} onChange={setAmountMax} />
              </Field>
            </div>
            <div className="form-grid-2">
              <Field label="بحث (اسم/رقم الفاتورة أو البيان)">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثال: 1042 أو نقل معدات" />
              </Field>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <Button onClick={resetFilters}>↩️ مسح الفلاتر</Button>
              </div>
            </div>
            <div className="field-hint">
              الفلتر يخص قسم «كشف الحساب» فقط؛ الفواتير والنقلات والخدمات والأعمار تُعرض كاملة حتى نهاية الفترة لشرح تركيبة الرصيد.
            </div>
          </div>

          {/* ——— بيانات العميل ——— */}
          <div className="group-box">
            <div className="group-title">بيانات العميل</div>
            <div className="form-grid-3">
              <div><span className="field-label">الاسم</span><div>{rep.customer.name}</div></div>
              <div><span className="field-label">الكود</span><div>{rep.customer.code || "—"}</div></div>
              <div><span className="field-label">الهاتف</span><div>{rep.customer.phone || "—"}</div></div>
              <div><span className="field-label">العنوان</span><div>{rep.customer.address || "—"}</div></div>
              <div><span className="field-label">الرقم الضريبي</span><div>{rep.customer.tax_number || "—"}</div></div>
              <div><span className="field-label">السجل التجاري</span><div>{rep.customer.commercial_reg || "—"}</div></div>
            </div>
            {rep.customer.notes ? <div className="field-hint">ملاحظات: {rep.customer.notes}</div> : null}
          </div>

          {/* ——— المؤشرات ——— */}
          <div className="group-box">
            <div className="group-title">الملخص المالي والمؤشرات</div>
            <TotalsBar items={[
              { label: "رصيد افتتاحي", value: s?.opening ?? 0 },
              { label: "إجمالي الفواتير", value: s?.invoiced ?? 0 },
              { label: "إجمالي المقبوضات", value: s?.collected ?? 0 },
              { label: "إشعارات مدينة", value: s?.notes_debit ?? 0 },
              { label: "إشعارات دائنة", value: s?.notes_credit ?? 0 },
              { label: "رصيد الإقفال", value: s?.closing ?? 0 },
            ]} />
            <div style={{ marginTop: 10 }} className="field-hint">
              {balanceSideLabel(s?.closing ?? 0)} — متبقٍ على الفواتير (بدون الرصيد الافتتاحي): {money(s?.outstanding ?? 0)} —
              متوسط الفاتورة: {money(s?.avg_invoice ?? 0)} — عدد الفواتير/السندات/الإشعارات: {s?.invoices_count ?? 0}/{s?.receipts_count ?? 0}/{s?.notes_count ?? 0} —
              النقلات: {s?.trips_count ?? 0} — إجمالي الكميات: {s?.qty_total ?? 0} — الخدمات المستخدمة: {s?.services_count ?? 0}
              <br />
              أول حركة في الفترة: {s?.first_movement ?? "—"} — آخر حركة: {s?.last_movement ?? "—"} — تاريخ آخر فاتورة: {s?.last_invoice_date ?? "—"}
              {s?.days_since_last_invoice != null ? ` (منذ ${s.days_since_last_invoice} يوم)` : ""}
            </div>
          </div>

          {/* ——— كشف الحساب ——— */}
          <div className="group-box">
            <div className="group-title">كشف الحساب ({rep.statement.matched_count} من {rep.statement.all_rows_count})</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr>{["التاريخ", "المستند", "الرقم", "البيان", "مدين", "دائن", "الرصيد"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>
                  {rep.statement.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.date}</td>
                      <td>{r.doc}</td>
                      <td>{r.number != null ? r.number : "—"}</td>
                      <td>{r.desc}{r.detail ? ` — ${r.detail}` : ""}</td>
                      <td>{r.debit ? money(r.debit) : ""}</td>
                      <td>{r.credit ? money(r.credit) : ""}</td>
                      <td>{r.balance != null ? money(r.balance) : "—"}</td>
                    </tr>
                  ))}
                  {!rep.statement.rows.length && <tr><td colSpan={7} style={{ color: "var(--muted)" }}>لا توجد حركات مطابقة للفلاتر.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ——— الفواتير ——— */}
          <div className="group-box">
            <div className="group-title">الفواتير ({rep.invoices.length})</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr>{["الرقم", "التاريخ", "النقلات", "الخطوط", "قبل الضريبة", "الضريبة", "الإجمالي", "المسدد", "المتبقي", "الحالة"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>
                  {rep.invoices.map((v) => (
                    <tr key={v.id} style={v.in_range ? undefined : { opacity: 0.65 }}>
                      <td>
                        <button className="btn btn-sm" onClick={() => router.push(`/invoices/${v.id}`)}>{invoiceNumberLabel(v.number)}</button>
                      </td>
                      <td>{v.date}</td>
                      <td>{v.trips_count}</td>
                      <td>{v.legs.length ? v.legs.join(" ، ") : "—"}</td>
                      <td>{money(v.subtotal)}</td>
                      <td>{money(v.vat_amount)}</td>
                      <td>{money(v.total)}</td>
                      <td>{money(v.paid)}</td>
                      <td>{money(v.remaining)}</td>
                      <td>{STATUS_LABEL[v.status] ?? v.status}{v.in_range ? "" : " (خارج الفترة)"}</td>
                    </tr>
                  ))}
                  {!rep.invoices.length && <tr><td colSpan={10} style={{ color: "var(--muted)" }}>لا توجد فواتير.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ——— الخدمات ——— */}
          <div className="group-box">
            <div className="group-title">الخدمات / الأصناف المستخدمة ({rep.services.length})</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr>{["الخدمة", "الوحدة", "الخط", "عدد النقلات", "الكميات", "الإيراد", "الضريبة", "الإجمالي"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>
                  {rep.services.map((sv, i) => (
                    <tr key={`${sv.item_id ?? "x"}-${i}`}>
                      <td>{sv.item_id != null
                        ? <button className="btn btn-sm" onClick={() => router.push(`/reports/items/${sv.item_id}`)}>{sv.name}</button>
                        : sv.name}</td>
                      <td>{sv.unit || "—"}</td>
                      <td>{sv.from_loc && sv.to_loc ? `${sv.from_loc} ← ${sv.to_loc}` : "خدمة عامة"}</td>
                      <td>{sv.trips_count}</td>
                      <td>{sv.qty_total}</td>
                      <td>{money(sv.revenue)}</td>
                      <td>{money(sv.vat_amount)}</td>
                      <td>{money(sv.total)}</td>
                    </tr>
                  ))}
                  {!rep.services.length && <tr><td colSpan={8} style={{ color: "var(--muted)" }}>لا توجد خدمات مستخدمة في الفترة.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ——— النقلات ——— */}
          <div className="group-box">
            <div className="group-title">نقلات الفواتير ({rep.trips.length})</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr>{["الفاتورة", "التاريخ", "الخدمة", "من", "إلى", "الكمية", "سعر الوحدة", "الإجمالي", "الحاويات", "السيارة", "السائق"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>
                  {rep.trips.map((t) => (
                    <tr key={t.trip_id}>
                      <td>{t.invoice_label}</td>
                      <td>{t.date}</td>
                      <td>{t.item_name}</td>
                      <td>{t.from_loc || "—"}</td>
                      <td>{t.to_loc || "—"}</td>
                      <td>{t.qty}</td>
                      <td>{money(t.unit_price)}</td>
                      <td>{money(t.amount)}</td>
                      <td>{t.containers.length ? t.containers.join("، ") : "—"}</td>
                      <td>{t.vehicle_name || "—"}</td>
                      <td>{t.driver_name || "—"}</td>
                    </tr>
                  ))}
                  {!rep.trips.length && <tr><td colSpan={11} style={{ color: "var(--muted)" }}>لا توجد نقلات.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ——— السندات والإشعارات ——— */}
          <div className="group-box">
            <div className="group-title">سندات القبض ({rep.receipts.length})</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr>{["الرقم", "التاريخ", "المبلغ", "البيان", "الحساب", "توزيع السداد"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>
                  {rep.receipts.map((r) => (
                    <tr key={r.id}>
                      <td>{r.label}</td><td>{r.date}</td><td>{money(r.amount)}</td>
                      <td>{r.description || "—"}</td><td>{r.account_name || "—"}</td><td>{r.allocations || "—"}</td>
                    </tr>
                  ))}
                  {!rep.receipts.length && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>لا توجد سندات قبض في الفترة.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="group-box">
            <div className="group-title">إشعارات مدين/دائن ({rep.notes.length})</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr>{["الرقم", "النوع", "التاريخ", "المبلغ", "الضريبة", "الإجمالي", "السبب", "الفاتورة"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>
                  {rep.notes.map((n) => (
                    <tr key={n.id}>
                      <td>{n.label}</td>
                      <td>{n.type === "debit" ? "إشعار مدين" : "إشعار دائن"}</td>
                      <td>{n.date}</td><td>{money(n.amount)}</td><td>{money(n.vat_amount)}</td><td>{money(n.total)}</td>
                      <td>{n.reason || "—"}</td>
                      <td>{n.invoice_number != null ? invoiceNumberLabel(n.invoice_number) : "—"}</td>
                    </tr>
                  ))}
                  {!rep.notes.length && <tr><td colSpan={8} style={{ color: "var(--muted)" }}>لا توجد إشعارات في الفترة.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ——— الأرصدة والأعمار ——— */}
          <div className="group-box">
            <div className="group-title">أعمار الديون والفواتير المفتوحة</div>
            <div className="form-grid-2">
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr>{["الفترة", "عدد الفواتير", "المبلغ"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rep.aging.map((a) => (
                      <tr key={a.bucket}><td>{a.bucket}</td><td>{a.count}</td><td>{money(a.amount)}</td></tr>
                    ))}
                    <tr style={{ fontWeight: 700 }}>
                      <td>الإجمالي</td>
                      <td>{rep.aging.reduce((sum, a) => sum + a.count, 0)}</td>
                      <td>{money(s?.outstanding ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr>{["الفاتورة", "التاريخ", "الإجمالي", "المسدد", "المتبقي", "العمر"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rep.open_items.map((o) => (
                      <tr key={o.number}>
                        <td>{invoiceNumberLabel(o.number)}</td><td>{o.date}</td>
                        <td>{money(o.total)}</td><td>{money(o.paid)}</td><td>{money(o.remaining)}</td>
                        <td>{o.age_days} يوم</td>
                      </tr>
                    ))}
                    {!rep.open_items.length && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>لا توجد فواتير مفتوحة.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="field-hint">
            التصدير يشمل كل الأقسام: {busy ? "جارٍ تحضير الملف…" : "Excel (ورقة لكل قسم) أو PDF/طباعة يشملان كل الجداول."}
          </div>
        </>
      )}
    </PageFrame>
  );
}
