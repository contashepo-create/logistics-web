"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, Balance, Modal, Field, Input, Select, Textarea, Button, AmountInput, matchesSearch } from "@/components/ui";
import { notify } from "@/components/toast";
import { money, balanceText } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";
import {
  suppliersWithBalance, getSupplier, saveSupplier, deleteSupplier, supplierBalance,
} from "@/lib/suppliers";
import {
  ENTITY_TYPES, TAX_STATUSES, SA_REGIONS, COUNTRIES, formatNationalAddress, validateTaxProfile,
} from "@/lib/tax";

const EMPTY = {
  name: "", name_en: "", phone: "", email: "", contact_person: "",
  address: "", opening_balance: "0", notes: "", payment_terms: "0",
  tax_number: "", commercial_reg: "", entity_type: "company", tax_status: "taxable",
  country: "SA", region: "", city: "", district: "", street: "",
  building_no: "", postal_code: "", additional_no: "",
};

function SupplierDialog({ id, readOnly, onClose }: { id?: number; readOnly?: boolean; onClose: (saved?: boolean) => void }) {
  const [f, setF] = useState({ ...EMPTY });
  const [balance, setBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"basic" | "tax" | "address">("basic");

  useEffect(() => {
    (async () => {
      if (!id) return;
      const s = (await getSupplier(id)) as Record<string, unknown> | null;
      if (s) {
        setF((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(prev) as (keyof typeof prev)[]) {
            const v = s[k as string];
            if (v !== undefined && v !== null) next[k] = String(v);
          }
          return next;
        });
      }
      setBalance(await supplierBalance(id));
    })();
  }, [id]);

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) return notify("اسم المورّد مطلوب.", "error");
    const problems = validateTaxProfile(f);
    if (problems.length) return notify(problems[0], "error");
    setSaving(true);
    try {
      await saveSupplier({
        ...f,
        opening_balance: parseFloat(f.opening_balance || "0") || 0,
        payment_terms: parseInt(f.payment_terms || "0", 10) || 0,
      }, id);
      notify("تم حفظ المورّد بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const national = formatNationalAddress(f);

  return (
    <Modal title={id ? "تعديل مورّد" : "مورّد جديد"} onClose={() => onClose()} width={960}>
      {id && balance != null && (
        <div className="group-box" style={{ marginTop: 0 }}>
          <div className="group-title">الرصيد الحالي (المستحق للمورّد)</div>
          <div className={`total-value ${balance < 0 ? "neg" : ""}`}>{money(balance)}</div>
        </div>
      )}

      <div className="tabs-head" style={{ marginBottom: 10 }}>
        <button className={tab === "basic" ? "active" : ""} onClick={() => setTab("basic")}>🏭 البيانات الأساسية</button>
        <button className={tab === "tax" ? "active" : ""} onClick={() => setTab("tax")}>🧾 البيانات الضريبية</button>
        <button className={tab === "address" ? "active" : ""} onClick={() => setTab("address")}>📍 العنوان الوطني</button>
      </div>

      {tab === "basic" && (
        <>
          <div className="form-grid-2">
            <Field label="اسم المورّد" required><Input value={f.name} onChange={(e) => set("name", e.target.value)} readOnly={readOnly} /></Field>
            <Field label="الاسم بالإنجليزية"><Input dir="ltr" value={f.name_en} onChange={(e) => set("name_en", e.target.value)} readOnly={readOnly} /></Field>
          </div>
          <div className="form-grid-3">
            <Field label="الهاتف"><Input dir="ltr" value={f.phone} onChange={(e) => set("phone", e.target.value)} readOnly={readOnly} /></Field>
            <Field label="البريد الإلكتروني"><Input dir="ltr" value={f.email} onChange={(e) => set("email", e.target.value)} readOnly={readOnly} /></Field>
            <Field label="مسؤول التواصل"><Input value={f.contact_person} onChange={(e) => set("contact_person", e.target.value)} readOnly={readOnly} /></Field>
          </div>
          <div className="form-grid-2">
            <Field label="الرصيد الافتتاحي (له علينا)"><AmountInput value={f.opening_balance} onChange={(v) => set("opening_balance", v)} readOnly={readOnly} /></Field>
            <Field label="مهلة السداد (يوم)"><Input type="number" min={0} dir="ltr" value={f.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} readOnly={readOnly} /></Field>
          </div>
          <Field label="العنوان المختصر"><Input value={f.address} onChange={(e) => set("address", e.target.value)} readOnly={readOnly} /></Field>
          <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} readOnly={readOnly} /></Field>
        </>
      )}

      {tab === "tax" && (
        <>
          <div className="form-grid-2">
            <Field label="الرقم الضريبي (15 رقماً)">
              <Input dir="ltr" inputMode="numeric" maxLength={15} placeholder="3XXXXXXXXXXXXX3"
                value={f.tax_number} onChange={(e) => set("tax_number", e.target.value)} readOnly={readOnly} />
              <span className="field-hint">يظهر في فاتورة المشتريات ويُستخدم في خصم ضريبة المدخلات.</span>
            </Field>
            <Field label="رقم السجل التجاري (10 أرقام)">
              <Input dir="ltr" inputMode="numeric" maxLength={10} value={f.commercial_reg}
                onChange={(e) => set("commercial_reg", e.target.value)} readOnly={readOnly} />
            </Field>
          </div>
          <div className="form-grid-2">
            <Field label="نوع الجهة">
              <Select value={f.entity_type} onChange={(e) => set("entity_type", e.target.value)} disabled={readOnly}>
                {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="الحالة الضريبية">
              <Select value={f.tax_status} onChange={(e) => set("tax_status", e.target.value)} disabled={readOnly}>
                {TAX_STATUSES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
          </div>
        </>
      )}

      {tab === "address" && (
        <>
          <div className="form-grid-3">
            <Field label="الدولة">
              <Select value={f.country} onChange={(e) => set("country", e.target.value)} disabled={readOnly}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="المنطقة">
              <Input list="sup-regions" value={f.region} onChange={(e) => set("region", e.target.value)} readOnly={readOnly} />
              <datalist id="sup-regions">{SA_REGIONS.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
            <Field label="المدينة"><Input value={f.city} onChange={(e) => set("city", e.target.value)} readOnly={readOnly} /></Field>
          </div>
          <div className="form-grid-2">
            <Field label="الحي"><Input value={f.district} onChange={(e) => set("district", e.target.value)} readOnly={readOnly} /></Field>
            <Field label="الشارع"><Input value={f.street} onChange={(e) => set("street", e.target.value)} readOnly={readOnly} /></Field>
          </div>
          <div className="form-grid-3">
            <Field label="رقم المبنى"><Input dir="ltr" maxLength={4} value={f.building_no} onChange={(e) => set("building_no", e.target.value)} readOnly={readOnly} /></Field>
            <Field label="الرمز البريدي"><Input dir="ltr" maxLength={5} value={f.postal_code} onChange={(e) => set("postal_code", e.target.value)} readOnly={readOnly} /></Field>
            <Field label="الرقم الإضافي"><Input dir="ltr" maxLength={4} value={f.additional_no} onChange={(e) => set("additional_no", e.target.value)} readOnly={readOnly} /></Field>
          </div>
          {national && <div className="field-hint" style={{ marginTop: 6 }}>العنوان المُجمّع: <b>{national}</b></div>}
        </>
      )}

      {!readOnly && <div style={{ marginTop: 14 }}><Button variant="primary" onClick={save} disabled={saving}>💾 حفظ</Button></div>}
    </Modal>
  );
}

export default function SuppliersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["suppliers"], queryFn: suppliersWithBalance });

  const textRows = useMemo(
    () => (data ?? []).map((s) => [
      s.code, s.name, s.phone || "—", s.tax_number || "—", s.city || "—",
      money(s.opening_balance), balanceText(s.balance),
    ]),
    [data]
  );
  const viewRows = useMemo(
    () => (data ?? []).map((s, i) => [...textRows[i].slice(0, 6), <Balance key={s.id} value={s.balance} pill />]),
    [data, textRows]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return { ids: (data ?? []).map((s) => s.id), rows: viewRows, text: textRows };
    const pairs = (data ?? [])
      .map((s, i) => ({ id: s.id, row: viewRows[i], text: textRows[i] }))
      .filter((p) => matchesSearch(search, p.text));
    return { ids: pairs.map((p) => p.id), rows: pairs.map((p) => p.row), text: pairs.map((p) => p.text) };
  }, [data, viewRows, textRows, search]);

  const headers = ["الكود", "اسم المورّد", "الهاتف", "الرقم الضريبي", "المدينة", "الرصيد الافتتاحي", "المستحق حالياً"];

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا المورّد؟")) return;
    try {
      await deleteSupplier(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  return (
    <PageFrame
      title="جدول الموردين"
      subtitle="أرصدة الموردين تُحدَّث تلقائياً من فواتير المشتريات وسندات الدفع"
      addText="➕ إضافة"
      onAdd={() => setDialog({ mode: "add" })}
      search={search}
      onSearch={setSearch}
      exportBar={
        <ExportBar
          onExcel={() => exportPage({ title: "جدول الموردين", headers, rows: filtered.text, mode: "excel" })}
          onPdf={() => exportPage({ title: "جدول الموردين", headers, rows: filtered.text, mode: "pdf" })}
          onPrint={() => exportPage({ title: "جدول الموردين", headers, rows: filtered.text, mode: "print" })}
        />
      }
    >
      {isLoading ? <Spinner /> : (
        <DataTable
          headers={headers}
          rows={filtered.rows}
          ids={filtered.ids}
          onAction={(id, key) => {
            if (key === "view") setDialog({ mode: "view", id: Number(id) });
            else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
            else if (key === "delete") onDelete(Number(id));
          }}
        />
      )}
      {dialog && (
        <SupplierDialog
          id={dialog.id}
          readOnly={dialog.mode === "view"}
          onClose={(saved) => {
            setDialog(null);
            if (saved) qc.invalidateQueries({ queryKey: ["suppliers"] });
          }}
        />
      )}
    </PageFrame>
  );
}
