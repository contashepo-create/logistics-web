"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, FilterRow, DictSelect, Field, Input, AmountInput, Select, Button, DateInput } from "@/components/ui";
import { customerStatement, statementFiltersLabel, STATEMENT_DOC_TYPES, type StatementFilters, type StatementDocType } from "@/lib/calc";
import { listCustomers } from "@/lib/repo";
import { itemOptions } from "@/lib/items";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";
import { isValidDateRange } from "@/lib/dateRange";
import { notify } from "@/components/toast";

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
    enabled: !!customerId && isValidDateRange(dFrom, dTo),
  });

  const headers = ["التاريخ", "المستند", "البيان", "التفاصيل", "مدين (عليه)", "دائن (له)", "الرصيد"];
  const stmtRows = st?.rows ?? [];
  // صفوف التصدير: تبدأ بالرصيد الافتتاحي وتنتهي بالإجماليات، والخانات الصفرية تُترك فارغة
  // لأن كشوف الشركات لا تعرض «0.00» في عمودي المدين/الدائن.
  const exportRows: (string | number)[][] = [
    [dFrom, "رصيد افتتاحي", "الرصيد قبل الفترة (افتتاحي)", "", "", "", money(st?.opening ?? 0)],
    ...stmtRows.map((r) => [
      r.date, r.doc, r.desc, r.detail ?? "",
      r.debit ? money(r.debit) : "", r.credit ? money(r.credit) : "", money(r.balance ?? 0),
    ]),
    ["", "الإجماليات", `${stmtRows.length} حركة معروضة`, "", money(st?.matched_debit ?? 0), money(st?.matched_credit ?? 0), money(st?.closing ?? 0)],
  ];
  const invTotal = st?.invoiced ?? 0;
  const recTotal = st?.collected ?? 0;
  const notesDebit = st?.notes_debit ?? 0;
  const notesCredit = st?.notes_credit ?? 0;

  const customerName = customers?.find((c) => c.id === customerId)?.name ?? "";
  const customerLabel = customerName;
  const filterLabel = statementFiltersLabel(filters);
  const counts = st ? `الحركات المطابقة ${st.matched_count} من ${st.all_rows_count}` : "";
  const subtitle = `${customerName ? `${customerName} | ` : ""}الفترة: من ${dFrom} إلى ${dTo}${filterLabel ? ` — ${filterLabel}` : ""}${counts ? ` — ${counts}` : ""}`;

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

  const doExport = async (mode: "excel" | "pdf" | "print") => {
    try {
      await exportPage({ title: "كشف حساب عميل", subtitle, headers, rows: exportRows, summaryLines, mode });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

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
          <Field label="من تاريخ" hint="الفترة المطبَّقة على الكشف والتصدير">
            <DateInput value={dFrom} onChange={setDFrom} />
          </Field>
          <Field label="إلى تاريخ">
            <DateInput value={dTo} onChange={setDTo} />
          </Field>
          <Field label="نوع المستند" hint="يُطبَّق مع الفترة على الحركات المعروضة">
            <Select value={docType} onChange={(e) => setDocType(e.target.value as StatementDocType | "")}>
              <option value="">الكل</option>
              {STATEMENT_DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="form-grid-3">
          <Field label="النقلة من (مكان الانطلاق)" hint="يطابق مسار نقلات الفواتير والمرتجعات">
            <Input value={fromLoc} onChange={(e) => setFromLoc(e.target.value)} placeholder="مثال: الرياض" />
          </Field>
          <Field label="النقلة إلى (مكان الوصول)">
            <Input value={toLoc} onChange={(e) => setToLoc(e.target.value)} placeholder="مثال: الدمام" />
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
          «من تاريخ/إلى تاريخ» يحددان الفترة المشمولة في الكشف والتصدير (والرصيد الافتتاحي محسوب حتى ما قبل «من تاريخ»).
          فلتر «النقلة من/إلى» يعرض الحركات التي لها نقلات (فواتير ومرتجعات) فقط؛ السندات والإشعارات اليدوية بلا مسار
          فلا تظهر عند تحديد مسار. الرصيد الجاري لكل سطر محسوب دائماً من كل الحركات حتى مع الفلترة.
        </div>
      </div>

      {isLoading ? <Spinner /> : !customerId ? (
        <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>اختر العميل لعرض الكشف</div>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <TotalsBar items={[
              { label: "الرصيد الافتتاحي", value: st?.opening ?? 0 },
              { label: "إجمالي الفواتير", value: invTotal },
              { label: "إجمالي التحصيل", value: recTotal },
              { label: "إشعارات مدين", value: notesDebit },
              { label: "إشعارات دائن", value: notesCredit },
              { label: "الرصيد الحالي", value: st?.closing ?? 0 },
            ]} />
          </div>
          <div className="table-wrap">
            <table className="data-table stmt-table">
              <thead>
                <tr>
                  <th className="num">التاريخ</th>
                  <th>المستند</th>
                  <th style={{ textAlign: "right" }}>البيان</th>
                  <th style={{ textAlign: "right" }}>التفاصيل</th>
                  <th className="num">مدين (عليه)</th>
                  <th className="num">دائن (له)</th>
                  <th className="num">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                <tr className="stmt-opening">
                  <td className="num">{dFrom}</td>
                  <td>—</td>
                  <td className="data-cell-wrap" colSpan={2}>رصيد ما قبل الفترة (افتتاحي)</td>
                  <td className="num">—</td>
                  <td className="num">—</td>
                  <td className="num">{money(st?.opening ?? 0)}</td>
                </tr>
                {stmtRows.map((r, i) => (
                  <tr key={i}>
                    <td className="num">{r.date}</td>
                    <td className={r.kind === "invoice" ? "stmt-doc-inv" : "stmt-doc-rec"}>{r.doc}</td>
                    <td className="data-cell-wrap">{r.desc}</td>
                    <td className="data-cell-wrap stmt-detail">{r.detail ?? "—"}</td>
                    <td className="num">{r.debit ? money(r.debit) : "—"}</td>
                    <td className="num">{r.credit ? money(r.credit) : "—"}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(r.balance ?? 0)}</td>
                  </tr>
                ))}
                {!stmtRows.length && (
                  <tr><td colSpan={headers.length} style={{ color: "var(--muted)" }}>لا توجد حركات مطابقة للفلاتر</td></tr>
                )}
                <tr className="total-row">
                  <td className="num"></td>
                  <td>الإجماليات</td>
                  <td className="data-cell-wrap">{stmtRows.length} حركة معروضة</td>
                  <td></td>
                  <td className="num">{money(st?.matched_debit ?? 0)}</td>
                  <td className="num">{money(st?.matched_credit ?? 0)}</td>
                  <td className="num">{money(st?.closing ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageFrame>
  );
}
