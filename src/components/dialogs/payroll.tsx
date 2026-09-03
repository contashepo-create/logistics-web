"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, Field, Input, Select, Textarea, AmountInput, DateInput, Button, AccountSelect } from "@/components/ui";
import { notify } from "@/components/toast";
import { listEmployees, savePayroll, getPayroll, employeeAdvances, employeeDeductions, getEmployee } from "@/lib/repo";
import { allAccounts, advanceArchive, advanceArchiveTotals, deductionArchive, deductionArchiveTotals } from "@/lib/calc";
import type { AdvanceArchiveRow, DeductionArchiveRow } from "@/lib/calc";
import { money, todayIso, MONTHS_AR, periodLabel } from "@/lib/format";

type AdvanceRow = {
  payment_voucher_id: number; number: number; date: string;
  amount: number; remaining: number; deduct: string;
};

type DeductionRow = {
  employee_deduction_id: number; number: number; date: string;
  amount: number; remaining: number; deduct: string; reason: string;
};

/** سبب الخصم للعرض المختصر في جدول المسير. */
const dedReason = (r: DeductionRow): string => r.reason || "—";

const n = (v: string) => parseFloat(String(v).replace(/,/g, "")) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function PayrollDialog({ id, readOnly, onClose }: { id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void }) {
  const [employees, setEmployees] = useState<{ id: number; name: string; code: string; base_salary?: number }[]>([]);
  const [accounts, setAccounts] = useState<{ kind: string; id: number; label: string }[]>([]);
  const now = new Date();
  const [f, setF] = useState({
    date: todayIso(), employee_id: "", period_year: String(now.getFullYear()), period_month: String(now.getMonth() + 1),
    account_kind: "cashbox", account_id: "", base_salary: "", additions: "", additions_note: "",
    other_deductions: "", deduction_note: "", notes: "",
  });
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [deductions, setDeductions] = useState<DeductionRow[]>([]);
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
          setF((old) => ({
            ...old,
            date: p.date, employee_id: String(p.employee_id), period_year: String(p.period_year), period_month: String(p.period_month),
            account_kind: p.account_kind, account_id: String(p.account_id), base_salary: String(p.base_salary),
            additions: String(p.additions), additions_note: p.additions_note,
            other_deductions: String(p.other_deductions), notes: p.notes,
          }));
          const [rows, dedRows] = await Promise.all([
            employeeAdvances(p.employee_id),
            employeeDeductions(p.employee_id),
          ]);
          const settlements = p.settlements ?? [];
          setAdvances(rows.map((r: any) => {
            const s = settlements.find((x) => x.payment_voucher_id === r.id);
            return {
              payment_voucher_id: r.id, number: r.number, date: r.date,
              amount: r.amount, remaining: r.remaining + (s ? s.amount : 0),
              deduct: s ? String(s.amount) : "",
            };
          }));
          const dedSettlements = p.deduction_settlements ?? [];
          setDeductions(dedRows.map((r: any) => {
            const s = dedSettlements.find((x) => x.employee_deduction_id === r.id);
            return {
              employee_deduction_id: r.id, number: r.number, date: r.date,
              amount: r.amount, remaining: r.remaining + (s ? s.amount : 0),
              deduct: s ? String(s.amount) : "", reason: String(r.reason ?? ""),
            };
          }));
        }
      }
    })();
  }, [id]);

  // عند اختيار الموظف: تحميل راتبه الأساسي تلقائياً + سلفه وخصوماته غير المسددة
  useEffect(() => {
    if (!f.employee_id || id) return;
    (async () => {
      const emp = await getEmployee(Number(f.employee_id));
      if (emp) {
        setF((old) => ({ ...old, base_salary: emp.base_salary ? String(emp.base_salary) : old.base_salary }));
      }
      const [rows, dedRows] = await Promise.all([
        employeeAdvances(Number(f.employee_id), false),
        employeeDeductions(Number(f.employee_id), false),
      ]);
      setAdvances(rows.map((r: any) => ({
        payment_voucher_id: r.id, number: r.number, date: r.date, amount: r.amount, remaining: r.remaining, deduct: "",
      })));
      setDeductions(dedRows.map((r: any) => ({
        employee_deduction_id: r.id, number: r.number, date: r.date, amount: r.amount, remaining: r.remaining, deduct: "", reason: String(r.reason ?? ""),
      })));
    })();
  }, [f.employee_id, id]);

  const deductTotal = useMemo(() => r2(advances.reduce((a, r) => a + n(r.deduct), 0)), [advances]);
  const dedRowTotal = useMemo(() => r2(deductions.reduce((a, r) => a + n(r.deduct), 0)), [deductions]);
  const gross = useMemo(() => r2(n(f.base_salary) + n(f.additions)), [f.base_salary, f.additions]);
  const net = useMemo(() => r2(gross - deductTotal - dedRowTotal - n(f.other_deductions)), [gross, deductTotal, dedRowTotal, f.other_deductions]);
  const advancesRemainingAfter = useMemo(
    () => r2(advances.reduce((a, r) => a + (r.remaining - n(r.deduct)), 0)),
    [advances]
  );
  const deductionsRemainingAfter = useMemo(
    () => r2(deductions.reduce((a, r) => a + (r.remaining - n(r.deduct)), 0)),
    [deductions]
  );

  const setDeduct = (i: number, v: string) => setAdvances((p) => p.map((r, x) => (x === i ? { ...r, deduct: v } : r)));
  const deductAll = (i: number) => setAdvances((p) => p.map((r, x) => (x === i ? { ...r, deduct: String(r.remaining) } : r)));
  const clearOne = (i: number) => setAdvances((p) => p.map((r, x) => (x === i ? { ...r, deduct: "" } : r)));
  const deductEverything = () => setAdvances((p) => p.map((r) => ({ ...r, deduct: String(r.remaining) })));
  const clearAll = () => setAdvances((p) => p.map((r) => ({ ...r, deduct: "" })));
  /** خصم مبلغ محدد موزّعاً على السلف بالأقدمية */
  const deductAmount = (target: number) => {
    let left = target;
    setAdvances((p) => p.map((r) => {
      if (left <= 0) return { ...r, deduct: "" };
      const take = Math.min(r.remaining, left);
      left = r2(left - take);
      return { ...r, deduct: take > 0 ? String(take) : "" };
    }));
  };

  // ——— أدوات جدول الخصومات (كلي/جزئي مثل السلف تماماً) ———
  const setDeductD = (i: number, v: string) => setDeductions((p) => p.map((r, x) => (x === i ? { ...r, deduct: v } : r)));
  const deductAllD = (i: number) => setDeductions((p) => p.map((r, x) => (x === i ? { ...r, deduct: String(r.remaining) } : r)));
  const clearOneD = (i: number) => setDeductions((p) => p.map((r, x) => (x === i ? { ...r, deduct: "" } : r)));
  const deductEverythingD = () => setDeductions((p) => p.map((r) => ({ ...r, deduct: String(r.remaining) })));
  const clearAllD = () => setDeductions((p) => p.map((r) => ({ ...r, deduct: "" })));

  const save = async () => {
    if (!f.employee_id) return notify("اختر الموظف.", "error");
    if (!f.account_id) return notify("اختر جهة الصرف (خزينة أو بنك).", "error");
    if (n(f.base_salary) <= 0) return notify("أدخل الراتب الأساسي.", "error");
    if (net < 0) return notify("لا يمكن أن يكون صافي الراتب بالسالب — راجع الخصومات.", "error");
    for (const r of advances) {
      if (n(r.deduct) > r.remaining + 0.01) return notify(`خصم السلفة PV-${r.number} أكبر من المتبقي منها.`, "error");
    }
    for (const r of deductions) {
      if (n(r.deduct) > r.remaining + 0.01) return notify(`خصم البند DED-${r.number} أكبر من المتبقي منه.`, "error");
    }
    setSaving(true);
    try {
      await savePayroll({
        date: f.date, employee_id: Number(f.employee_id),
        period_year: Number(f.period_year), period_month: Number(f.period_month),
        account_kind: f.account_kind, account_id: Number(f.account_id),
        base_salary: n(f.base_salary),
        additions: n(f.additions),
        additions_note: f.additions_note,
        other_deductions: n(f.other_deductions),
        notes: f.deduction_note ? `${f.notes}${f.notes ? " — " : ""}خصومات: ${f.deduction_note}` : f.notes,
        settlements: advances.filter((r) => n(r.deduct) > 0).map((r) => ({
          payment_voucher_id: r.payment_voucher_id, amount: n(r.deduct),
        })),
        deduction_settlements: deductions.filter((r) => n(r.deduct) > 0).map((r) => ({
          employee_deduction_id: r.employee_deduction_id, amount: n(r.deduct),
        })),
      }, id);
      notify("تم حفظ مسير الراتب بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const empName = employees.find((e) => String(e.id) === f.employee_id)?.name ?? "—";

  return (
    <Modal title={id ? "تعديل مسير راتب" : "مسير راتب جديد"} onClose={() => onClose()} width={960}>
      <div className="inv-form">
        <div className="inv-head-card">
          <Field label="الموظف" required>
            <Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} disabled={readOnly || !!id}>
              <option value="">— اختر الموظف —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <Field label="شهر الاستحقاق" required>
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 6 }}>
              <Select value={f.period_month} onChange={(e) => setF({ ...f, period_month: e.target.value })} disabled={readOnly}>
                {MONTHS_AR.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </Select>
              <Input value={f.period_year} onChange={(e) => setF({ ...f, period_year: e.target.value })} readOnly={readOnly} />
            </div>
          </Field>
          <Field label="تاريخ الصرف" required><DateInput value={f.date} onChange={(v) => setF({ ...f, date: v })} /></Field>
        </div>

        <div className="inv-sec-title"><span>مكوّنات الراتب</span></div>
        <div className="form-grid-3">
          <Field label="الراتب الأساسي" required hint="يُحمَّل تلقائياً من ملف الموظف وقابل للتعديل لهذا الشهر">
            <AmountInput value={f.base_salary} onChange={(v) => setF({ ...f, base_salary: v })} />
          </Field>
          <Field label="الإضافات / الحوافز"><AmountInput value={f.additions} onChange={(v) => setF({ ...f, additions: v })} /></Field>
          <Field label="بيان الإضافات"><Input value={f.additions_note} onChange={(e) => setF({ ...f, additions_note: e.target.value })} readOnly={readOnly} /></Field>
          <Field label="خصومات أخرى (جزاءات/غياب)"><AmountInput value={f.other_deductions} onChange={(v) => setF({ ...f, other_deductions: v })} /></Field>
          <Field label="سبب الخصم"><Input value={f.deduction_note} onChange={(e) => setF({ ...f, deduction_note: e.target.value })} readOnly={readOnly} /></Field>
          <Field label="جهة الصرف (خزينة / بنك)" required>
            <AccountSelect
              value={f.account_id ? { kind: f.account_kind, id: Number(f.account_id) } : null}
              onChange={(v) => setF({ ...f, account_kind: v?.kind ?? "cashbox", account_id: v ? String(v.id) : "" })}
              options={accounts}
            />
          </Field>
        </div>

        <div className="inv-sec-title">
          <span>خصم السلف ({advances.length})</span>
          {!readOnly && advances.length > 0 && (
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="btn" onClick={deductEverything}>خصم كل السلف</button>
              <button className="btn" onClick={() => deductAmount(r2(gross / 2))} title="خصم نصف الراتب الإجمالي موزّعاً بالأقدمية">خصم نصف الراتب</button>
              <button className="btn" onClick={clearAll}>إلغاء الخصم</button>
            </span>
          )}
        </div>

        {advances.length === 0 ? (
          <div className="exp-empty">لا توجد سلف غير مسدَّدة لهذا الموظف.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table adv-table">
              <thead>
                <tr><th>السند</th><th>تاريخ الصرف</th><th>قيمة السلفة</th><th>المتبقي</th><th>يُخصم هذا الشهر</th><th>يتبقى بعد الخصم</th><th></th></tr>
              </thead>
              <tbody>
                {advances.map((r, i) => {
                  const after = r2(r.remaining - n(r.deduct));
                  return (
                    <tr key={r.payment_voucher_id}>
                      <td style={{ fontWeight: 700 }}>PV-{String(r.number).padStart(5, "0")}</td>
                      <td>{r.date}</td>
                      <td>{money(r.amount)}</td>
                      <td>{money(r.remaining)}</td>
                      <td style={{ minWidth: 130 }}><AmountInput value={r.deduct} onChange={(v) => setDeduct(i, v)} readOnly={readOnly} /></td>
                      <td style={{ fontWeight: 700, color: after > 0 ? "var(--warning)" : "var(--success)" }}>{money(after)}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn-row" title="خصم الكل" onClick={() => deductAll(i)} disabled={readOnly}>الكل</button>
                          <button className="btn-row" title="إلغاء" onClick={() => clearOne(i)} disabled={readOnly}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="inv-sec-title">
          <span>خصم الخصومات ({deductions.length})</span>
          {!readOnly && deductions.length > 0 && (
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="btn" onClick={deductEverythingD}>خصم كل الخصومات</button>
              <button className="btn" onClick={clearAllD}>إلغاء الخصم</button>
            </span>
          )}
        </div>

        {deductions.length === 0 ? (
          <div className="exp-empty">لا توجد خصومات غير مسدَّدة لهذا الموظف.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table adv-table">
              <thead>
                <tr><th>البند</th><th>تاريخ التسجيل</th><th>قيمة الخصم</th><th>السبب</th><th>المتبقي</th><th>يُخصم هذا الشهر</th><th>يتبقى بعد الخصم</th><th></th></tr>
              </thead>
              <tbody>
                {deductions.map((r, i) => {
                  const after = r2(r.remaining - n(r.deduct));
                  return (
                    <tr key={r.employee_deduction_id}>
                      <td style={{ fontWeight: 700 }}>DED-{String(r.number).padStart(5, "0")}</td>
                      <td>{r.date}</td>
                      <td>{money(r.amount)}</td>
                      <td style={{ maxWidth: 180, fontSize: 12.5 }} title={dedReason(r)}>{dedReason(r)}</td>
                      <td>{money(r.remaining)}</td>
                      <td style={{ minWidth: 130 }}><AmountInput value={r.deduct} onChange={(v) => setDeductD(i, v)} readOnly={readOnly} /></td>
                      <td style={{ fontWeight: 700, color: after > 0 ? "var(--warning)" : "var(--success)" }}>{money(after)}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn-row" title="خصم الكل" onClick={() => deductAllD(i)} disabled={readOnly}>الكل</button>
                          <button className="btn-row" title="إلغاء" onClick={() => clearOneD(i)} disabled={readOnly}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="inv-totals">
          <div className="tot-card client">
            <div className="tot-card-head"><span>صافي المستحق للموظف</span><span>{empName} — {periodLabel(Number(f.period_year), Number(f.period_month))}</span></div>
            <div className="tot-card-body">
              <div className="tot-line"><span className="k">الراتب الأساسي</span><span className="v">{money(n(f.base_salary))}</span></div>
              <div className="tot-line"><span className="k">الإضافات</span><span className="v">{money(n(f.additions))}</span></div>
              <div className="tot-line"><span className="k">إجمالي الاستحقاق</span><span className="v">{money(gross)}</span></div>
              <div className="tot-line is-cost"><span className="k">خصم السلف</span><span className="v">{money(deductTotal)}</span></div>
              <div className="tot-line is-cost"><span className="k">خصم الخصومات</span><span className="v">{money(dedRowTotal)}</span></div>
              <div className="tot-line is-cost"><span className="k">خصومات أخرى</span><span className="v">{money(n(f.other_deductions))}</span></div>
              <div className="tot-line grand"><span className="k">الصافي المنصرف</span><span className="v">{money(net)}</span></div>
            </div>
          </div>
          <div className="tot-card internal">
            <div className="tot-card-head"><span>متابعة السلف والخصومات</span><span>📌</span></div>
            <div className="tot-card-body">
              <div className="tot-line"><span className="k">السلف غير المسددة قبل المسير</span><span className="v">{money(r2(advances.reduce((a, r) => a + r.remaining, 0)))}</span></div>
              <div className="tot-line is-cost"><span className="k">المخصوم من السلف في هذا المسير</span><span className="v">{money(deductTotal)}</span></div>
              <div className="tot-line is-profit"><span className="k">المتبقي من السلف بعد المسير</span><span className="v">{money(advancesRemainingAfter)}</span></div>
              <div className="tot-line"><span className="k">الخصومات غير المسددة قبل المسير</span><span className="v">{money(r2(deductions.reduce((a, r) => a + r.remaining, 0)))}</span></div>
              <div className="tot-line is-cost"><span className="k">المخصوم من الخصومات في هذا المسير</span><span className="v">{money(dedRowTotal)}</span></div>
              <div className="tot-line is-profit"><span className="k">المتبقي من الخصومات بعد المسير</span><span className="v">{money(deductionsRemainingAfter)}</span></div>
            </div>
            <div className="tot-note">يُسجَّل لكل خصم أثر دائم في أرشيف السلفة/الخصم (رقم المسير وشهره وتاريخه).</div>
          </div>
        </div>

        <Field label="ملاحظات المسير"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} readOnly={readOnly} /></Field>

        {!readOnly && <div><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ مسير الراتب</Button></div>}
      </div>
    </Modal>
  );
}

/* ==================== أرشيف الخصومات لموظف ==================== */
export function DeductionArchiveDialog({ employeeId, employeeName, onClose }: {
  employeeId: number; employeeName?: string; onClose: () => void;
}) {
  const [rows, setRows] = useState<DeductionArchiveRow[] | null>(null);

  useEffect(() => { deductionArchive(employeeId).then(setRows); }, [employeeId]);
  const totals = rows ? deductionArchiveTotals(rows) : { total: 0, settled: 0, remaining: 0, open_count: 0 };

  const statusChip = (s: DeductionArchiveRow["status"]) => {
    const map = { open: ["exp-chip src-driver", "لم يُخصم"], partial: ["exp-chip src-cash", "مخصوم جزئياً"], closed: ["exp-chip src-customer", "مسدّد بالكامل"] } as const;
    const [cls, label] = map[s];
    return <span className={cls}>{label}</span>;
  };

  return (
    <Modal title={`أرشيف الخصومات — ${employeeName ?? ""}`} onClose={onClose} width={980}>
      <div className="stmt-cards">
        <div className="stmt-card"><span className="k">إجمالي الخصومات</span><span className="v">{money(totals.total)}</span></div>
        <div className="stmt-card"><span className="k">المخصوم</span><span className="v">{money(totals.settled)}</span></div>
        <div className="stmt-card"><span className="k">المتبقي</span><span className="v">{money(totals.remaining)}</span></div>
        <div className="stmt-card"><span className="k">بنود مفتوحة</span><span className="v">{totals.open_count}</span></div>
      </div>

      {!rows ? <div className="exp-empty">جارٍ التحميل…</div>
        : rows.length === 0 ? <div className="exp-empty">لا توجد خصومات مسجّلة لهذا الموظف.</div>
        : rows.map((d) => (
          <div key={d.id} className="trip-card">
            <div className="trip-card-head">
              <span className="trip-badge">DED</span>
              <span className="trip-route">
                خصم رقم DED-{String(d.number).padStart(5, "0")}
                <span className="muted"> — سُجّل في {d.date}</span>
              </span>
              <span className="trip-head-spacer" />
              {statusChip(d.status)}
              <span className="trip-head-amount">{money(d.amount)}</span>
            </div>
            <div className="trip-card-body">
              {d.reason && <div style={{ fontSize: 13 }}>السبب: <b>{d.reason}</b></div>}
              {d.notes && <div style={{ color: "var(--muted)", fontSize: 12.5 }}>ملاحظات: {d.notes}</div>}
              <div className="trip-summary">
                <div className="trip-sum-item is-rev"><span className="k">قيمة الخصم</span><span className="v">{money(d.amount)}</span></div>
                <div className="trip-sum-item is-cost"><span className="k">المخصوم حتى الآن</span><span className="v">{money(d.settled)}</span></div>
                <div className="trip-sum-item is-net"><span className="k">المتبقي</span><span className="v">{money(d.remaining)}</span></div>
              </div>
              <div className="inv-sec-title"><span>سجل الاقتطاعات من الرواتب</span></div>
              {d.settlements.length === 0 ? (
                <div className="exp-empty">لم يُخصم منه شيء بعد.</div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>مسير الراتب</th><th>تاريخ المسير</th><th>عن شهر</th><th>المبلغ المخصوم</th></tr></thead>
                    <tbody>
                      {d.settlements.map((s, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 700 }}>PAY-{String(s.payroll_number).padStart(5, "0")}</td>
                          <td>{s.payroll_date}</td>
                          <td>{s.period_label}</td>
                          <td style={{ fontWeight: 700 }}>{money(s.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ))}
    </Modal>
  );
}

/* ==================== أرشيف السلفيات لموظف ==================== */
export function AdvanceArchiveDialog({ employeeId, employeeName, onClose }: {
  employeeId: number; employeeName?: string; onClose: () => void;
}) {
  const [rows, setRows] = useState<AdvanceArchiveRow[] | null>(null);

  useEffect(() => { advanceArchive(employeeId).then(setRows); }, [employeeId]);
  const totals = rows ? advanceArchiveTotals(rows) : { total: 0, settled: 0, remaining: 0, open_count: 0 };

  const statusChip = (s: AdvanceArchiveRow["status"]) => {
    const map = { open: ["exp-chip src-driver", "لم تُخصم"], partial: ["exp-chip src-cash", "مخصومة جزئياً"], closed: ["exp-chip src-customer", "مسدَّدة بالكامل"] } as const;
    const [cls, label] = map[s];
    return <span className={cls}>{label}</span>;
  };

  return (
    <Modal title={`أرشيف السلفيات — ${employeeName ?? ""}`} onClose={onClose} width={980}>
      <div className="stmt-cards">
        <div className="stmt-card"><span className="k">إجمالي السلف</span><span className="v">{money(totals.total)}</span></div>
        <div className="stmt-card"><span className="k">المخصوم</span><span className="v">{money(totals.settled)}</span></div>
        <div className="stmt-card"><span className="k">المتبقي</span><span className="v">{money(totals.remaining)}</span></div>
        <div className="stmt-card"><span className="k">سلف مفتوحة</span><span className="v">{totals.open_count}</span></div>
      </div>

      {!rows ? <div className="exp-empty">جارٍ التحميل…</div>
        : rows.length === 0 ? <div className="exp-empty">لا توجد سلف مسجّلة لهذا الموظف.</div>
        : rows.map((a) => (
          <div key={a.id} className="trip-card">
            <div className="trip-card-head">
              <span className="trip-badge">PV</span>
              <span className="trip-route">
                سلفة رقم PV-{String(a.number).padStart(5, "0")}
                <span className="muted"> — صُرفت في {a.date} من {a.account_label}</span>
              </span>
              <span className="trip-head-spacer" />
              {statusChip(a.status)}
              <span className="trip-head-amount">{money(a.amount)}</span>
            </div>
            <div className="trip-card-body">
              {a.description && <div style={{ color: "var(--muted)", fontSize: 12.5 }}>البيان: {a.description}</div>}
              <div className="trip-summary">
                <div className="trip-sum-item is-rev"><span className="k">قيمة السلفة</span><span className="v">{money(a.amount)}</span></div>
                <div className="trip-sum-item is-cost"><span className="k">المخصوم حتى الآن</span><span className="v">{money(a.settled)}</span></div>
                <div className="trip-sum-item is-net"><span className="k">المتبقي</span><span className="v">{money(a.remaining)}</span></div>
              </div>
              <div className="inv-sec-title"><span>سجل الخصومات</span></div>
              {a.settlements.length === 0 ? (
                <div className="exp-empty">لم يُخصم منها شيء بعد.</div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>مسير الراتب</th><th>تاريخ المسير</th><th>عن شهر</th><th>المبلغ المخصوم</th></tr></thead>
                    <tbody>
                      {a.settlements.map((s, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 700 }}>PAY-{String(s.payroll_number).padStart(5, "0")}</td>
                          <td>{s.payroll_date}</td>
                          <td>{s.period_label}</td>
                          <td style={{ fontWeight: 700 }}>{money(s.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ))}
    </Modal>
  );
}
