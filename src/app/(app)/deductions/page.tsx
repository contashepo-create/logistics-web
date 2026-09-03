"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { DeductionArchiveDialog } from "@/components/dialogs/payroll";
import { AmountInput, Button, DateInput, DictSelect, ExportBar, Field, FilterRow, Input, Modal, PageFrame, Select, Spinner, Textarea, TotalsBar } from "@/components/ui";
import { notify } from "@/components/toast";
import { listDeductionTracking } from "@/lib/calc";
import { exportPage } from "@/lib/exportHelper";
import { money, todayIso } from "@/lib/format";
import { deleteDeduction, getDeduction, listEmployees, saveDeduction } from "@/lib/repo";

const STATUS_LABELS = { open: "لم يُخصم", partial: "مخصوم جزئياً", closed: "مسدّد بالكامل" } as const;
function yearStart(): string { return `${new Date().getFullYear()}-01-01`; }

/* ==================== حوار تسجيل/تعديل بند خصم ==================== */
function DeductionDialog({ id, readOnly, onClose }: { id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void }) {
  const { data: employees } = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees() });
  const [f, setF] = useState({ date: todayIso(), employee_id: "", amount: "", reason: "", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) getDeduction(id).then((d) => d && setF({
      date: d.date, employee_id: String(d.employee_id),
      amount: String(d.amount), reason: d.reason, notes: d.notes,
    }));
  }, [id]);

  const n = (v: string) => parseFloat(String(v).replace(/,/g, "")) || 0;

  const save = async () => {
    if (!f.employee_id) return notify("اختر الموظف.", "error");
    if (n(f.amount) <= 0) return notify("أدخل مبلغ الخصم أكبر من صفر.", "error");
    if (!f.reason.trim()) return notify("سبب الخصم إلزامي للمراجعة.", "error");
    setSaving(true);
    try {
      await saveDeduction({
        date: f.date, employee_id: Number(f.employee_id),
        amount: n(f.amount), reason: f.reason.trim(), notes: f.notes,
      }, id);
      notify(id ? "تم تعديل بند الخصم بنجاح." : "تم تسجيل الخصم بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? (readOnly ? "عرض بند خصم" : "تعديل بند خصم") : "تسجيل خصم على موظف"} onClose={() => onClose()} width={620}>
      <div className="form-grid-3">
        <Field label="الموظف" required>
          <Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} disabled={readOnly || !!id}>
            <option value="">— اختر الموظف —</option>
            {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.code} - {e.name}</option>)}
          </Select>
        </Field>
        <Field label="تاريخ تسجيل الخصم" required><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label="مبلغ الخصم" required hint="يُقتطع من الراتب كاملاً أو مجزّأً عبر الأشهر">
          <AmountInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
      </div>
      <Field label="سبب الخصم" required hint="مثال: غياب بدون إذن، تلف عهدة، مخالفة مرورية، سلفة نثرية سابقة…">
        <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} readOnly={readOnly} />
      </Field>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} readOnly={readOnly} /></Field>
      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 {id ? "حفظ التعديل" : "تسجيل الخصم"}</Button></div>}
    </Modal>
  );
}

/* ==================== شاشة متابعة الخصومات ==================== */
export default function DeductionsPage() {
  const qc = useQueryClient();
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [status, setStatus] = useState<"open" | "partial" | "closed" | "">("");
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);
  const [archive, setArchive] = useState<{ id: number; name: string } | null>(null);

  const { data: employees } = useQuery({ queryKey: ["employees"], queryFn: () => listEmployees() });
  const { data, isLoading } = useQuery({
    queryKey: ["deductions-tracking", dFrom, dTo, employeeId, status],
    queryFn: () => listDeductionTracking({ dFrom, dTo, employeeId, status: status || null }),
    placeholderData: keepPreviousData,
  });

  const headers = ["رقم الخصم", "تاريخ التسجيل", "الموظف", "السبب", "قيمة الخصم", "المخصوم", "المتبقي", "الحالة", "آخر خصم", "تفاصيل الاقتطاع"];
  const exportRows = useMemo(() => (data ?? []).map((row) => [
    `DED-${String(row.number).padStart(5, "0")}`, row.date, row.employee_name, row.reason || "—",
    money(row.amount), money(row.settled), money(row.remaining), STATUS_LABELS[row.status],
    row.last_settled_date || "—", row.settlement_details || "—",
  ]), [data]);
  const rows = useMemo(() => (data ?? []).map((row, index) => exportRows[index].map((cell, cellIndex) =>
    cellIndex === 7
      ? <span key={cellIndex} className={`advance-status advance-${row.status}`}>{cell}</span>
      : cell
  )), [data, exportRows]);

  const totals = useMemo(() => ({
    total: (data ?? []).reduce((sum, row) => sum + row.amount, 0),
    settled: (data ?? []).reduce((sum, row) => sum + row.settled, 0),
    remaining: (data ?? []).reduce((sum, row) => sum + row.remaining, 0),
  }), [data]);
  const subtitle = `سجل الخصومات من ${dFrom} إلى ${dTo} — الاقتطاع يتم عند إصدار الرواتب (كلياً أو جزئياً)`;

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف بند الخصم هذا؟\nلا يمكن حذف بند سبق اقتطاعه في مسير رواتب.")) return;
    try {
      await deleteDeduction(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["deductions-tracking"] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <PageFrame
      title="إدارة ومتابعة الخصومات"
      subtitle="سجّل الخصم على الموظف هنا، ثم يُقتطع من راتبه كاملاً أو جزئياً عند إصدار المسير — مع تتبع المخصوم والمتبقي حسب الشهر"
      addText="➕ تسجيل خصم جديد"
      onAdd={() => setDialog({ mode: "add" })}
      toolbar={
        <FilterRow dFrom={dFrom} dTo={dTo} onFrom={setDFrom} onTo={setDTo} onRefresh={() => qc.invalidateQueries({ queryKey: ["deductions-tracking"] })}>
          <div>
            <label className="field-label">الموظف</label>
            <DictSelect value={employeeId} onChange={setEmployeeId} options={(employees ?? []).map((e) => ({ id: e.id, label: `${e.code} - ${e.name}` }))} placeholder="كل الموظفين" />
          </div>
          <div>
            <label className="field-label">الحالة</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="">كل الحالات</option>
              <option value="open">لم يُخصم</option>
              <option value="partial">مخصوم جزئياً</option>
              <option value="closed">مسدّد بالكامل</option>
            </Select>
          </div>
        </FilterRow>
      }
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "متابعة الخصومات", subtitle, headers, rows: exportRows, mode: "excel" })}
        onPdf={() => exportPage({ title: "متابعة الخصومات", subtitle, headers, rows: exportRows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "متابعة الخصومات", subtitle, headers, rows: exportRows, mode: "print" })}
      />}
    >
      <div className="reference-only-note">ℹ️ يظهر الخصم تلقائياً في <b>مسير الراتب</b> للموظف لتختار خصمه كاملاً أو جزءاً منه، ويُتتبَّع كل اقتطاع برقم المسير وشهره.</div>
      {isLoading ? <Spinner /> : (
        <>
          <DataTable
            headers={headers}
            rows={rows}
            ids={(data ?? []).map((row) => row.id)}
            actions={["view", "edit", "delete"]}
            extra={[{ key: "archive", label: "📚", title: "عرض أرشيف الموظف واقتطاعات الرواتب" }]}
            onAction={(id, key) => {
              if (key === "view") setDialog({ mode: "view", id: Number(id) });
              else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
              else if (key === "delete") void onDelete(Number(id));
              else if (key === "archive") {
                const row = (data ?? []).find((item) => item.id === Number(id));
                if (row) setArchive({ id: row.employee_id, name: row.employee_name });
              }
            }}
          />
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "إجمالي الخصومات", value: totals.total },
              { label: "إجمالي المخصوم", value: totals.settled },
              { label: "إجمالي المتبقي", value: totals.remaining },
            ]} />
          </div>
        </>
      )}
      {dialog && <DeductionDialog id={dialog.id} readOnly={dialog.mode === "view"} onClose={(saved) => {
        setDialog(null);
        if (saved) {
          qc.invalidateQueries({ queryKey: ["deductions-tracking"] });
          qc.invalidateQueries({ queryKey: ["employees"] });
        }
      }} />}
      {archive && <DeductionArchiveDialog employeeId={archive.id} employeeName={archive.name} onClose={() => setArchive(null)} />}
    </PageFrame>
  );
}
