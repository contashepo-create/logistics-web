"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, Field, Input, Select, Textarea, AmountInput, DateInput, Button, AccountSelect } from "@/components/ui";
import { notify } from "@/components/toast";
import { listEmployees, savePayroll, getPayroll, employeeAdvances } from "@/lib/repo";
import { allAccounts } from "@/lib/calc";
import { money, todayIso, MONTHS_AR } from "@/lib/format";

type AdvanceRow = { payment_voucher_id: number; number: number; date: string; amount: number; remaining: number; deduct: string };

export function PayrollDialog({ id, readOnly, onClose }: { id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void }) {
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [accounts, setAccounts] = useState<{ kind: string; id: number; label: string }[]>([]);
  const now = new Date();
  const [f, setF] = useState({
    date: todayIso(), employee_id: "", period_year: String(now.getFullYear()), period_month: String(now.getMonth() + 1),
    account_kind: "cashbox", account_id: "", base_salary: "", additions: "", additions_note: "",
    other_deductions: "", notes: "",
  });
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setEmployees(await listEmployees());
      const accs = await allAccounts();
      setAccounts(accs);
      if (accs.length) setF((old) => ({ ...old, account_kind: accs[0].kind, account_id: String(accs[0].id) }));
      if (id) {
        const p = await getPayroll(id);
        if (p) {
          setF({
            date: p.date, employee_id: String(p.employee_id), period_year: String(p.period_year), period_month: String(p.period_month),
            account_kind: p.account_kind, account_id: String(p.account_id), base_salary: String(p.base_salary),
            additions: String(p.additions), additions_note: p.additions_note, other_deductions: String(p.other_deductions), notes: p.notes,
          });
          if (p.settlements?.length) {
            setAdvances(p.settlements.map((s) => ({
              payment_voucher_id: s.payment_voucher_id, number: s.voucher_number, date: s.voucher_date,
              amount: s.amount, remaining: 0, deduct: String(s.amount),
            })));
          }
        }
      }
    })();
  }, [id]);

  useEffect(() => {
    if (f.employee_id && !id) {
      employeeAdvances(Number(f.employee_id)).then((rows) =>
        setAdvances(rows.map((r: any) => ({
          payment_voucher_id: r.id, number: r.number, date: r.date, amount: r.amount, remaining: r.remaining, deduct: "",
        })))
      );
    }
  }, [f.employee_id, id]);

  const deductTotal = useMemo(() => advances.reduce((a, r) => a + (parseFloat(r.deduct || "0") || 0), 0), [advances]);
  const net = useMemo(() => {
    const base = parseFloat(f.base_salary || "0") || 0;
    const add = parseFloat(f.additions || "0") || 0;
    const other = parseFloat(f.other_deductions || "0") || 0;
    return base + add - deductTotal - other;
  }, [f.base_salary, f.additions, f.other_deductions, deductTotal]);

  const setDeduct = (i: number, v: string) => setAdvances((p) => p.map((r, x) => (x === i ? { ...r, deduct: v } : r)));

  const save = async () => {
    if (!f.employee_id) return notify("اختر الموظف.", "error");
    if (!f.account_id) return notify("اختر الحساب.", "error");
    if (net < 0) return notify("لا يمكن أن يكون صافي الراتب بالسالب.", "error");
    setSaving(true);
    try {
      await savePayroll({
        date: f.date, employee_id: Number(f.employee_id),
        period_year: Number(f.period_year), period_month: Number(f.period_month),
        account_kind: f.account_kind, account_id: Number(f.account_id),
        base_salary: parseFloat(f.base_salary || "0") || 0,
        additions: parseFloat(f.additions || "0") || 0,
        additions_note: f.additions_note,
        other_deductions: parseFloat(f.other_deductions || "0") || 0,
        notes: f.notes,
        settlements: advances.filter((r) => parseFloat(r.deduct || "0") > 0).map((r) => ({
          payment_voucher_id: r.payment_voucher_id, amount: parseFloat(r.deduct) || 0,
        })),
      }, id);
      notify("تم حفظ الرواتب بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? "تعديل راتب" : "راتب جديد"} onClose={() => onClose()} width={920}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="الموظف" required>
          <Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
            <option value="">— اختر الموظف —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field label="التاريخ" required><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        <Field label="سنة الفترة">
          <Input value={f.period_year} onChange={(e) => setF({ ...f, period_year: e.target.value })} />
        </Field>
        <Field label="شهر الفترة">
          <Select value={f.period_month} onChange={(e) => setF({ ...f, period_month: e.target.value })}>
            {MONTHS_AR.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="الحساب (خزينة/بنك)">
        <AccountSelect
          value={f.account_id ? { kind: f.account_kind, id: Number(f.account_id) } : null}
          onChange={(v) => setF({ ...f, account_kind: v?.kind ?? "cashbox", account_id: v ? String(v.id) : "" })}
          options={accounts}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="الراتب الأساسي"><AmountInput value={f.base_salary} onChange={(v) => setF({ ...f, base_salary: v })} /></Field>
        <Field label="الإضافات"><AmountInput value={f.additions} onChange={(v) => setF({ ...f, additions: v })} /></Field>
        <Field label="خصومات أخرى"><AmountInput value={f.other_deductions} onChange={(v) => setF({ ...f, other_deductions: v })} /></Field>
      </div>
      <Field label="بيان الإضافات"><Input value={f.additions_note} onChange={(e) => setF({ ...f, additions_note: e.target.value })} /></Field>

      {advances.length > 0 && (
        <div className="group-box">
          <div className="group-title">خصم السلف المتاحة ({advances.length})</div>
          <table className="data-table">
            <thead><tr><th>السند</th><th>التاريخ</th><th>المبلغ</th><th>المتبقي</th><th>يُخصم الآن</th></tr></thead>
            <tbody>
              {advances.map((r, i) => (
                <tr key={r.payment_voucher_id}>
                  <td>PV-{String(r.number).padStart(5, "0")}</td>
                  <td>{r.date}</td>
                  <td>{money(r.amount)}</td>
                  <td>{money(r.remaining)}</td>
                  <td><AmountInput value={r.deduct} onChange={(v) => setDeduct(i, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <div className="group-box">
        <div className="group-title">الصافي</div>
        <div className={`total-value ${net < 0 ? "neg" : ""}`}>{money(net)}</div>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>إجمالي خصم السلف: {money(deductTotal)}</div>
      </div>
      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ الراتب</Button></div>}
    </Modal>
  );
}
