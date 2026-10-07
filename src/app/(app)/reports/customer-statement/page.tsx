"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect, Field, Input, AmountInput, Select, Button } from "@/components/ui";
import { customerStatement, statementFiltersLabel, STATEMENT_DOC_TYPES, type StatementFilters, type StatementDocType } from "@/lib/calc";
import { listCustomers } from "@/lib/repo";
import { itemOptions } from "@/lib/items";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

export default function CustomerStatementReportPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [customerId, setCustomerId] = useState<number | null>(null);

  // الفلاتر الذكية: المسار (من/إلى)، القيمة، اسم/رقم الفاتورة، نوع المستند، والخدمة
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

  const { data: customers } = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const { data: items } = useQuery({ queryKey: ["items-options"], queryFn: () => itemOptions(true) });

  const { data: st, isLoading } = useQuery({
    queryKey: ["report-cust-stmt", customerId, dFrom, dTo, filters],
    queryFn: () => customerId ? customerStatement(customerId, dFrom, dTo, filters) : null,
    placeholderData: keepPreviousData,
    enabled: !!customerId,
  });

  const headers = ["التاريخ", "المستند", "البيان", "التفاصيل", "مدين (عليه)", "دائن (له)", "الرصيد"];
  const rows = (st?.rows ?? []).map((r) => [
    r.date, r.doc, r.desc, r.detail ?? "—", money(r.debit), money(r.credit), money(r.balance ?? 0),
  ]);
  const invTotal = st?.invoiced ?? 0;
  const recTotal = st?.collected ?? 0;
  const notesDebit = st?.notes_debit ?? 0;
  const notesCredit = st?.notes_credit ?? 0;

  const customerLabel = customers?.find((c) => c.id === customerId)?.name ?? "";
  const filterLabel = statementFiltersLabel(filters);
  const counts = st ? `الحركات المطابقة ${st.matched_count} من ${st.all_rows_count}` : "";
  const subtitle = `الفترة: من ${dFrom} إلى ${dTo}${filterLabel ? ` — ${filterLabel}` : ""}${counts ? ` — ${counts}` : ""}`;

  const itemLabel = items?.find((i) => i.id === itemId)?.label ?? "";

  const summaryLines: [string, string | number][] = [
    ["العميل", customerLabel],
    ["الفلاتر المطبَّقة", filterLabel || "بدون فلاتر"],
    ["الرصيد الافتتاحي", money(st?.opening ?? 0)],
    ["إجمالي الفواتير المعروضة (مدين)", money(invTotal)],
    ["إجمالي التحصيل المعروض (دائن)", money(recTotal)],
    ["إشعارات مدين معروضة", money(notesDebit)],
    ["إشعارات دائن معروضة", money(notesCredit)],
    ["مجموع المدين المعروض", money(st?.matched_debit ?? 0)],
    ["مجموع الدائن المعروض", money(st?.matched_credit ?? 0)],
    ["الرصيد الحالي (كل الحركات)", money(st?.closing ?? 0)],
  ];

  const doExport = (mode: "excel" | "pdf" | "print") =>
    exportPage({ title: "كشف حساب عميل", subtitle, headers, rows, summaryLines, mode });

  const resetFilters = () => {
    setQ(""); setFromLoc(""); setToLoc(""); setAmountMin(""); setAmountMax(""); setDocType(""); setItemId(null);
  };

  return (
    <PageFrame title="كشف حساب عميل" subtitle="الرصيد الافتتاحي + الفواتير − سندات القبض = الرصيد الحالي"
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["report-cust-stmt"] })}>
          <div><label className="field-label">العميل</label>
            <DictSelect value={customerId} onChange={setCustomerId} options={(customers ?? []).map((c) => ({ id: c.id, label: `${c.code} - ${c.name}` }))} />
          </div>
          {customerId != null && (
            <Button onClick={() => router.push(`/reports/customers/${customerId}`)} title="كل ما يخص العميل في تقرير واحد">
              📊 التقرير الشامل
            </Button>
          )}
        </FilterRow>
      }
      exportBar={<ExportBar onExcel={() => doExport("excel")} onPdf={() => doExport("pdf")} onPrint={() => doExport("print")} />}>
      <div className="group-box" style={{ marginTop: 0 }}>
        <div className="group-title">فلتر ذكي للكشف</div>
        <div className="form-grid-3">
          <Field label="النقلة من (مكان الانطلاق)" hint="يطابق مسار نقلات الفواتير والمرتجعات">
            <Input value={fromLoc} onChange={(e) => setFromLoc(e.target.value)} placeholder="مثال: الرياض" />
          </Field>
          <Field label="النقلة إلى (مكان الوصول)">
            <Input value={toLoc} onChange={(e) => setToLoc(e.target.value)} placeholder="مثال: الدمام" />
          </Field>
          <Field label="نوع المستند">
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
          <Field label="اسم/رقم الفاتورة أو بيان المستند" hint="يقبل الأرقام العربية، ويطابق رقم الفاتورة والسندات المخصَّصة لها">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثال: INV-00012 أو اسم عميل/سبب إشعار" />
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <Input readOnly value={itemLabel || "—"} title="الخدمة المختارة" />
            <button type="button" className="btn btn-sm" onClick={resetFilters}>↺ تصفير الفلاتر</button>
          </div>
        </div>
        <div className="field-hint">
          ملاحظة: فلتر «من/إلى» يعرض الحركات التي لها نقلات (فواتير ومرتجعات) فقط؛ السندات والإشعارات اليدوية بلا مسار
          فلا تظهر عند تحديد مسار. الرصيد الجاري لكل سطر محسوب دائماً من كل الحركات حتى مع الفلترة.
        </div>
      </div>

      {isLoading ? <Spinner /> : !customerId ? (
        <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>اختر العميل لعرض الكشف</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
                {!rows.length && (
                  <tr><td colSpan={headers.length} style={{ color: "var(--muted)" }}>لا توجد حركات مطابقة للفلاتر</td></tr>
                )}
                <tr style={{ fontWeight: 700 }}>
                  <td></td><td>الإجمالي / الرصيد النهائي</td><td></td><td></td>
                  <td>{money(st?.matched_debit ?? 0)}</td><td>{money(st?.matched_credit ?? 0)}</td>
                  <td>{money(st?.closing ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: " الرصيد الافتتاحي", value: st?.opening ?? 0 },
              { label: " إجمالي الفواتير", value: invTotal },
              { label: " إجمالي التحصيل", value: recTotal },
              { label: " إشعارات مدين", value: notesDebit },
              { label: " إشعارات دائن", value: notesCredit },
              { label: " الرصيد الحالي", value: st?.closing ?? 0 },
            ]} />
          </div>
        </>
      )}
    </PageFrame>
  );
}
