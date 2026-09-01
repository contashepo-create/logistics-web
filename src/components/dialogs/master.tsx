"use client";

import { useEffect, useState } from "react";
import { Modal, Field, Input, Select, Textarea, AmountInput, DateInput, Button } from "@/components/ui";
import { notify } from "@/components/toast";
import { customerBalance, accountBalance } from "@/lib/calc";
import {
  saveCustomer, deleteCustomer, getCustomer,
  saveEmployee, deleteEmployee, getEmployee,
  saveVehicle, deleteVehicle, getVehicle,
  saveYear, deleteYear, getYear, setYearStatus, createSnapshot, getSnapshot, movementsCountInRange,
  saveAccount, deleteAccount, getAccount,
} from "@/lib/repo";
import { money } from "@/lib/format";

type Props = { id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void };

/* ============================ العميل ============================ */
export function CustomerDialog({ id, readOnly, onClose }: Props) {
  const [f, setF] = useState({ name: "", phone: "", address: "", opening_balance: "0", notes: "" });
  const [balance, setBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (id) {
        const c = await getCustomer(id);
        if (c) setF({ name: c.name, phone: c.phone, address: c.address, opening_balance: String(c.opening_balance), notes: c.notes });
        setBalance(await customerBalance(id));
      }
    })();
  }, [id]);

  const save = async () => {
    if (!f.name.trim()) return notify("اسم العميل مطلوب.", "error");
    setSaving(true);
    try {
      const nid = await saveCustomer({
        name: f.name.trim(), phone: f.phone.trim(), address: f.address.trim(),
        opening_balance: parseFloat(f.opening_balance || "0") || 0, notes: f.notes,
      }, id);
      notify(`تم حفظ العميل ${nid ? "" : ""}بنجاح.`, "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? "تعديل عميل" : "عميل جديد"} onClose={() => onClose()} width={920}>
      {id && balance != null && (
        <div className="group-box" style={{ marginTop: 0 }}>
          <div className="group-title">الرصيد الحالي</div>
          <div className={`total-value ${balance < 0 ? "neg" : ""}`}>{money(balance)}</div>
        </div>
      )}
      <Field label="الاسم" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} readOnly={readOnly} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="الهاتف"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} readOnly={readOnly} /></Field>
        <Field label="الرصيد الافتتاحي"><AmountInput value={f.opening_balance} onChange={(v) => setF({ ...f, opening_balance: v })} readOnly={readOnly} /></Field>
      </div>
      <Field label="العنوان"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} readOnly={readOnly} /></Field>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} readOnly={readOnly} /></Field>
      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ</Button></div>}
    </Modal>
  );
}

/* ============================ الموظف ============================ */
export function EmployeeDialog({ id, readOnly, onClose }: Props) {
  const [f, setF] = useState({ name: "", nationality: "", phone: "", emp_type: "driver", base_salary: "", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) getEmployee(id).then((e) => e && setF({
      name: e.name, nationality: e.nationality, phone: e.phone, emp_type: e.emp_type,
      base_salary: e.base_salary ? String(e.base_salary) : "", notes: e.notes,
    }));
  }, [id]);

  const save = async () => {
    if (!f.name.trim()) return notify("اسم الموظف مطلوب.", "error");
    setSaving(true);
    try {
      await saveEmployee({ ...f, name: f.name.trim(), base_salary: parseFloat(f.base_salary || "0") || 0 }, id);
      notify("تم حفظ الموظف بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? "تعديل موظف" : "موظف جديد"} onClose={() => onClose()}>
      <Field label="الاسم" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} readOnly={readOnly} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="الجنسية"><Input value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })} readOnly={readOnly} /></Field>
        <Field label="الهاتف"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} readOnly={readOnly} /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="النوع">
          <Select value={f.emp_type} onChange={(e) => setF({ ...f, emp_type: e.target.value })} disabled={readOnly}>
            <option value="driver">سائق</option>
            <option value="admin">إداري</option>
          </Select>
        </Field>
        <Field label="الراتب الشهري الأساسي" hint="يظهر تلقائياً عند إصدار مسير الراتب ويمكن تعديله">
          <AmountInput value={f.base_salary} onChange={(v) => setF({ ...f, base_salary: v })} />
        </Field>
      </div>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} readOnly={readOnly} /></Field>
      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ</Button></div>}
    </Modal>
  );
}

/* ============================ السيارة ============================ */
export function VehicleDialog({ id, readOnly, onClose }: Props) {
  const [f, setF] = useState({ plate_number: "", vehicle_type: "", default_driver_id: "", notes: "" });
  const [drivers, setDrivers] = useState<{ id: number; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    import("@/lib/repo").then((r) => r.listEmployees("driver")).then((ds) => setDrivers(ds.map((d) => ({ id: d.id, name: d.name }))));
    if (id) getVehicle(id).then((v) => v && setF({ plate_number: v.plate_number, vehicle_type: v.vehicle_type, default_driver_id: v.default_driver_id ? String(v.default_driver_id) : "", notes: v.notes }));
  }, [id]);

  const save = async () => {
    if (!f.plate_number.trim()) return notify("رقم اللوحة مطلوب.", "error");
    setSaving(true);
    try {
      await saveVehicle({
        plate_number: f.plate_number.trim(), vehicle_type: f.vehicle_type.trim(),
        default_driver_id: f.default_driver_id ? Number(f.default_driver_id) : null, notes: f.notes,
      }, id);
      notify("تم حفظ السيارة بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? "تعديل سيارة" : "سيارة جديدة"} onClose={() => onClose()}>
      <Field label="رقم اللوحة" required><Input value={f.plate_number} onChange={(e) => setF({ ...f, plate_number: e.target.value })} readOnly={readOnly} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="نوع السيارة"><Input value={f.vehicle_type} onChange={(e) => setF({ ...f, vehicle_type: e.target.value })} readOnly={readOnly} /></Field>
        <Field label="السائق الافتراضي">
          <Select value={f.default_driver_id} onChange={(e) => setF({ ...f, default_driver_id: e.target.value })} disabled={readOnly}>
            <option value="">— بدون —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} readOnly={readOnly} /></Field>
      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ</Button></div>}
    </Modal>
  );
}

/* ============================ السنة المالية ============================ */
export function YearDialog({ id, readOnly, onClose }: Props) {
  const [f, setF] = useState({ year: String(new Date().getFullYear()), date_from: "", date_to: "", status: "open", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) getYear(id).then((y) => y && setF({ year: String(y.year), date_from: y.date_from, date_to: y.date_to, status: y.status, notes: y.notes }));
  }, [id]);

  const save = async () => {
    const year = parseInt(f.year, 10);
    if (!year) return notify("أدخل سنة صحيحة.", "error");
    if (!f.date_from || !f.date_to) return notify("حدد تاريخي البدء والانتهاء.", "error");
    setSaving(true);
    try {
      await saveYear({ year, date_from: f.date_from, date_to: f.date_to, status: f.status, notes: f.notes }, id);
      notify("تم حفظ السنة المالية بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? "تعديل سنة مالية" : "سنة مالية جديدة"} onClose={() => onClose()}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="السنة" required><Input value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} readOnly={readOnly} /></Field>
        <Field label="الحالة">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} disabled={readOnly}>
            <option value="open">مفتوحة</option>
            <option value="closed">مغلقة</option>
          </Select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="من تاريخ" required><DateInput value={f.date_from} onChange={(v) => setF({ ...f, date_from: v })} readOnly={readOnly} /></Field>
        <Field label="إلى تاريخ" required><DateInput value={f.date_to} onChange={(v) => setF({ ...f, date_to: v })} readOnly={readOnly} /></Field>
      </div>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} readOnly={readOnly} /></Field>
      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ</Button></div>}
    </Modal>
  );
}

/* ============================ حساب (خزينة/بنك) ============================ */
export function AccountDialog({ kind, id, readOnly, onClose }: { kind: "cashbox" | "bank"; id?: number | null; readOnly?: boolean; onClose: (changed?: boolean) => void }) {
  const [f, setF] = useState({ name: "", created_date: "", opening_balance: "0", account_number: "", iban: "", notes: "" });
  const [balance, setBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const label = kind === "cashbox" ? "خزينة" : "بنك";

  useEffect(() => {
    (async () => {
      if (id) {
        const a = await getAccount(kind, id);
        if (a) setF({ name: a.name, created_date: a.created_date, opening_balance: String(a.opening_balance), account_number: (a as any).account_number ?? "", iban: (a as any).iban ?? "", notes: a.notes });
        setBalance(await accountBalance(kind, id));
      }
    })();
  }, [id, kind]);

  const save = async () => {
    if (!f.name.trim()) return notify(`اسم ${label} مطلوب.`, "error");
    if (!f.created_date) return notify("حدد تاريخ الإنشاء.", "error");
    setSaving(true);
    try {
      await saveAccount(kind, {
        name: f.name.trim(), created_date: f.created_date,
        opening_balance: parseFloat(f.opening_balance || "0") || 0,
        account_number: f.account_number, iban: f.iban, notes: f.notes,
      }, id);
      notify(`تم حفظ ${label} بنجاح.`, "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? `تعديل ${label}` : `${label} جديد`} onClose={() => onClose()}>
      {id && balance != null && (
        <div className="group-box" style={{ marginTop: 0 }}>
          <div className="group-title">الرصيد الحالي</div>
          <div className={`total-value ${balance < 0 ? "neg" : ""}`}>{money(balance)}</div>
        </div>
      )}
      <Field label="الاسم" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} readOnly={readOnly} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="تاريخ الإنشاء" required><DateInput value={f.created_date} onChange={(v) => setF({ ...f, created_date: v })} readOnly={readOnly} /></Field>
        <Field label="الرصيد الافتتاحي"><AmountInput value={f.opening_balance} onChange={(v) => setF({ ...f, opening_balance: v })} readOnly={readOnly} /></Field>
      </div>
      {kind === "bank" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="رقم الحساب"><Input value={f.account_number} onChange={(e) => setF({ ...f, account_number: e.target.value })} readOnly={readOnly} dir="ltr" /></Field>
          <Field label="IBAN"><Input value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value })} readOnly={readOnly} dir="ltr" /></Field>
        </div>
      )}
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} readOnly={readOnly} /></Field>
      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ</Button></div>}
    </Modal>
  );
}

/* ============================ لقطة إغلاق السنة ============================ */
export function SnapshotDialog({ yearId, year, onClose }: { yearId: number; year?: number; onClose: (changed?: boolean) => void }) {
  const [tab, setTab] = useState<"customers" | "accounts" | "pnl">("customers");
  const [snap, setSnap] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    getSnapshot(yearId).then(setSnap);
  }, [yearId]);

  // getSnapshot يعيد كائن اللقطة مباشرة (بلا تغليف في .data)
  const customers: any[] = snap?.customers ?? [];
  const cashboxes: any[] = snap?.cashboxes ?? [];
  const banks: any[] = snap?.banks ?? [];
  const pnl: Record<string, number> = snap?.pnl ?? {};

  return (
    <Modal title="لقطة إغلاق السنة المالية" onClose={onClose} width={920}>
      <div className="tabs-head">
        <button className={tab === "customers" ? "active" : ""} onClick={() => setTab("customers")}>أرصدة العملاء</button>
        <button className={tab === "accounts" ? "active" : ""} onClick={() => setTab("accounts")}>الخزائن والبنوك</button>
        <button className={tab === "pnl" ? "active" : ""} onClick={() => setTab("pnl")}>الأرباح والخسائر</button>
      </div>
      {tab === "customers" && (
        <table className="data-table">
          <thead><tr><th>الكود</th><th>العميل</th><th>الرصيد</th></tr></thead>
          <tbody>
            {customers.map((c, i) => <tr key={i}><td>{c.code}</td><td>{c.name}</td><td>{money(c.balance)}</td></tr>)}
          </tbody>
        </table>
      )}
      {tab === "accounts" && (
        <table className="data-table">
          <thead><tr><th>الكود</th><th>الحساب</th><th>النوع</th><th>الرصيد</th></tr></thead>
          <tbody>
            {cashboxes.map((c, i) => <tr key={"c" + i}><td>{c.code}</td><td>{c.name}</td><td>خزينة</td><td>{money(c.balance)}</td></tr>)}
            {banks.map((b, i) => <tr key={"b" + i}><td>{b.code}</td><td>{b.name}</td><td>بنك</td><td>{money(b.balance)}</td></tr>)}
          </tbody>
        </table>
      )}
      {tab === "pnl" && (
        <table className="data-table">
          <thead><tr><th>البند</th><th>القيمة</th></tr></thead>
          <tbody>
            <tr><td>إيرادات النقل</td><td>{money(pnl.transport_revenue)}</td></tr>
            <tr><td>إيرادات أخرى</td><td>{money(pnl.other_revenue)}</td></tr>
            <tr><td>إجمالي الإيرادات</td><td>{money(pnl.total_revenue)}</td></tr>
            <tr><td>مصروفات مباشرة</td><td>{money(pnl.direct_expenses)}</td></tr>
            <tr><td>رواتب</td><td>{money(pnl.salaries)}</td></tr>
            <tr><td>سلف</td><td>{money(pnl.advances)}</td></tr>
            <tr><td>صيانة سيارات</td><td>{money(pnl.maintenance)}</td></tr>
            <tr><td>مصروفات عامة</td><td>{money(pnl.general_expenses)}</td></tr>
            <tr className="total-row"><td>صافي الربح</td><td>{money(pnl.net)}</td></tr>
          </tbody>
        </table>
      )}
    </Modal>
  );
}
