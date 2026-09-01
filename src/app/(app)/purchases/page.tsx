"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import {
  PageFrame, Spinner, ExportBar, Modal, Field, Input, Select, Textarea, Button,
  AmountInput, AccountSelect, DictSelect, TotalsBar, matchesSearch,
} from "@/components/ui";
import { notify } from "@/components/toast";
import { money, todayIso, PURCHASE_EXPENSE_CATEGORIES } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";
import { listSuppliers } from "@/lib/suppliers";
import {
  listPurchaseInvoices, getPurchaseInvoice, savePurchaseInvoice, deletePurchaseInvoice,
  purchaseTotals, type PurchaseItem,
} from "@/lib/suppliers";
import { currentVatRate, listVehicles } from "@/lib/repo";
import { allAccounts } from "@/lib/calc";

const EMPTY_ITEM: PurchaseItem = { item_name: "", unit: "", qty: 1, unit_price: 0, vat_rate: 15 };

function PurchaseDialog({ id, readOnly, onClose }: { id?: number; readOnly?: boolean; onClose: (saved?: boolean) => void }) {
  const { data: suppliers } = useQuery({ queryKey: ["suppliers-list"], queryFn: listSuppliers });
  const { data: vehicles } = useQuery({ queryKey: ["vehicles"], queryFn: listVehicles });
  const { data: accounts } = useQuery({ queryKey: ["all-accounts"], queryFn: allAccounts });
  const [date, setDate] = useState(todayIso());
  const [purchaseType, setPurchaseType] = useState<"credit" | "cash">("credit");
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierRef, setSupplierRef] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("other");
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [accountKind, setAccountKind] = useState<"cashbox" | "bank">("cashbox");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [vatRate, setVatRate] = useState(15);
  const [vatIncluded, setVatIncluded] = useState(false);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PurchaseItem[]>([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const rate = await currentVatRate();
      if (!id) {
        setVatRate(rate);
        setItems([{ ...EMPTY_ITEM, vat_rate: rate }]);
        return;
      }
      const inv = await getPurchaseInvoice(id);
      if (inv) {
        setDate(inv.date);
        setPurchaseType(inv.purchase_type);
        setSupplierId(inv.supplier_id);
        setSupplierRef(inv.supplier_ref);
        setExpenseCategory(inv.expense_category);
        setVehicleId(inv.vehicle_id);
        setAccountKind(inv.account_kind ?? "cashbox");
        setAccountId(inv.account_id);
        setVatRate(inv.vat_rate);
        setVatIncluded(inv.vat_included);
        setNotes(inv.notes);
        setItems(inv.items?.length ? inv.items : [{ ...EMPTY_ITEM, vat_rate: inv.vat_rate }]);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!id && !accountId && accounts?.length) {
      setAccountKind(accounts[0].kind === "bank" ? "bank" : "cashbox");
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId, id]);

  const setItem = (i: number, patch: Partial<PurchaseItem>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const totals = useMemo(() => purchaseTotals(items, vatIncluded), [items, vatIncluded]);

  const save = async () => {
    setSaving(true);
    try {
      await savePurchaseInvoice({
        id, date, purchase_type: purchaseType,
        supplier_id: purchaseType === "credit" ? supplierId : null,
        supplier_ref: supplierRef,
        expense_category: expenseCategory,
        vehicle_id: vehicleId,
        account_kind: purchaseType === "cash" ? accountKind : null,
        account_id: purchaseType === "cash" ? accountId : null,
        vat_rate: vatRate, vat_included: vatIncluded, notes, items,
      });
      notify("تم حفظ فاتورة المشتريات بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? "تعديل فاتورة مشتريات" : "فاتورة مشتريات جديدة"} onClose={() => onClose()} width={1040}>
      <div className="purchase-routing-card">
        <div className="form-grid-4">
          <Field label="طريقة الشراء" required>
            <Select value={purchaseType} disabled={readOnly} onChange={(e) => setPurchaseType(e.target.value === "cash" ? "cash" : "credit")}>
              <option value="credit">آجل على مورّد</option>
              <option value="cash">نقدي مباشر بدون مورّد</option>
            </Select>
          </Field>
          <Field label="التاريخ" required><Input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} readOnly={readOnly} /></Field>
          <Field label="بند المصروف في الأرباح والخسائر" required>
            <Select value={expenseCategory} disabled={readOnly} onChange={(e) => setExpenseCategory(e.target.value)}>
              {Object.entries(PURCHASE_EXPENSE_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
          </Field>
          <Field label="تحميل على سيارة (اختياري)">
            <Select value={vehicleId ?? ""} disabled={readOnly} onChange={(e) => setVehicleId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— بدون سيارة —</option>
              {(vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.code} - {v.plate_number}</option>)}
            </Select>
          </Field>
        </div>

        <div className="form-grid-3" style={{ marginTop: 12 }}>
          {purchaseType === "credit" ? (
            <Field label="المورّد" required>
              <DictSelect
                value={supplierId}
                onChange={setSupplierId}
                options={(suppliers ?? []).map((s) => ({ id: s.id, label: `${s.code} - ${s.name}` }))}
                disabled={readOnly}
              />
            </Field>
          ) : (
            <Field label="الدفع المباشر من" required hint="يُنشئ حركة صرف تلقائية ويخصم الإجمالي فوراً من الرصيد.">
              <AccountSelect
                value={accountId ? { kind: accountKind, id: accountId } : null}
                onChange={(v) => { setAccountKind(v?.kind === "bank" ? "bank" : "cashbox"); setAccountId(v?.id ?? null); }}
                options={accounts ?? []}
                disabled={readOnly}
              />
            </Field>
          )}
          <Field label={purchaseType === "credit" ? "رقم فاتورة المورّد" : "رقم الإيصال / المرجع"}>
            <Input dir="ltr" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} readOnly={readOnly} />
          </Field>
          <Field label="نسبة الضريبة %">
            <Input type="number" dir="ltr" min={0} max={100} value={vatRate}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                setVatRate(v);
                setItems((prev) => prev.map((it) => ({ ...it, vat_rate: v })));
              }} readOnly={readOnly} />
          </Field>
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>
          تُحمَّل الفاتورة على بند «{PURCHASE_EXPENSE_CATEGORIES[expenseCategory]}» في الأرباح والخسائر
          {vehicleId ? " وعلى السيارة المختارة في تقرير أداء السيارات." : " دون تحميلها على سيارة."}
        </div>
      </div>

      <div className="group-box">
        <div className="group-title">🧾 بنود الفاتورة</div>
        <label className="check-row" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={vatIncluded} disabled={readOnly}
            onChange={(e) => setVatIncluded(e.target.checked)} />
          <span>الأسعار المُدخلة شاملة ضريبة القيمة المضافة</span>
        </label>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>الصنف / الخدمة</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الضريبة %</th><th>الإجمالي</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const line = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
                return (
                  <tr key={i}>
                    <td><Input value={it.item_name} onChange={(e) => setItem(i, { item_name: e.target.value })} readOnly={readOnly} /></td>
                    <td style={{ width: 90 }}><Input value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} readOnly={readOnly} /></td>
                    <td style={{ width: 100 }}><Input type="number" dir="ltr" min={0} step="any" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} readOnly={readOnly} /></td>
                    <td style={{ width: 130 }}><AmountInput value={String(it.unit_price)} onChange={(v) => setItem(i, { unit_price: Number(v) || 0 })} readOnly={readOnly} /></td>
                    <td style={{ width: 90 }}><Input type="number" dir="ltr" min={0} max={100} value={it.vat_rate} onChange={(e) => setItem(i, { vat_rate: Number(e.target.value) })} readOnly={readOnly} /></td>
                    <td style={{ width: 120 }}>{money(line)}</td>
                    <td style={{ width: 44 }}>
                      {!readOnly && items.length > 1 && (
                        <button className="btn btn-row-danger" onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))}>🗑</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <div style={{ marginTop: 8 }}>
            <Button onClick={() => setItems((p) => [...p, { ...EMPTY_ITEM, vat_rate: vatRate }])}>➕ إضافة بند</Button>
          </div>
        )}
      </div>

      <Field label="ملاحظات"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={readOnly} /></Field>

      <TotalsBar items={[
        { label: "الإجمالي قبل الضريبة", value: totals.net },
        { label: "ضريبة القيمة المضافة", value: totals.vat },
        { label: "الإجمالي شامل الضريبة", value: totals.total },
      ]} />

      {!readOnly && (
        <div style={{ marginTop: 14 }}>
          <Button variant="primary" onClick={save} disabled={saving}>💾 حفظ الفاتورة</Button>
        </div>
      )}
    </Modal>
  );
}

export default function PurchasesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["purchases"], queryFn: listPurchaseInvoices });

  const rows = useMemo(
    () => (data ?? []).map((p) => [
      String(p.number), p.date, p.purchase_type === "cash" ? "نقدي مباشر" : "آجل",
      p.supplier_name ?? "—", PURCHASE_EXPENSE_CATEGORIES[p.expense_category] ?? "أخرى",
      p.vehicle_plate || "—", p.purchase_type === "cash" ? (p.account_name || "—") : "ذمم الموردين",
      p.supplier_ref || "—", money(p.net), money(p.vat), money(p.total),
    ]),
    [data]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return { ids: (data ?? []).map((p) => p.id), rows };
    const pairs = (data ?? []).map((p, i) => ({ id: p.id, row: rows[i] })).filter((p) => matchesSearch(search, p.row));
    return { ids: pairs.map((p) => p.id), rows: pairs.map((p) => p.row) };
  }, [data, rows, search]);

  const headers = ["رقم", "التاريخ", "النوع", "المورّد", "بند P&L", "السيارة", "طريقة السداد", "المرجع", "قبل الضريبة", "الضريبة", "الإجمالي"];

  const totals = useMemo(() => {
    const src = (data ?? []).filter((_, i) => filtered.ids.includes((data ?? [])[i].id));
    return {
      net: src.reduce((a, r) => a + r.net, 0),
      vat: src.reduce((a, r) => a + r.vat, 0),
      total: src.reduce((a, r) => a + r.total, 0),
    };
  }, [data, filtered.ids]);

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف فاتورة المشتريات؟")) return;
    try {
      await deletePurchaseInvoice(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["cashbox"] });
      qc.invalidateQueries({ queryKey: ["bank"] });
      qc.invalidateQueries({ queryKey: ["report-pnl"] });
      qc.invalidateQueries({ queryKey: ["report-vehicles"] });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  return (
    <PageFrame
      title="فواتير المشتريات"
      subtitle="فاتورة آجلة على مورّد أو شراء نقدي مباشر من الخزينة/البنك — مع توجيه المصروف إلى P&L والسيارة اختيارياً"
      addText="➕ فاتورة مشتريات"
      onAdd={() => setDialog({ mode: "add" })}
      search={search}
      onSearch={setSearch}
      exportBar={
        <ExportBar
          onExcel={() => exportPage({ title: "فواتير المشتريات", headers, rows: filtered.rows, mode: "excel" })}
          onPdf={() => exportPage({ title: "فواتير المشتريات", headers, rows: filtered.rows, mode: "pdf" })}
          onPrint={() => exportPage({ title: "فواتير المشتريات", headers, rows: filtered.rows, mode: "print" })}
        />
      }
    >
      {isLoading ? <Spinner /> : (
        <>
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
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "الإجمالي قبل الضريبة", value: totals.net },
              { label: "ضريبة المدخلات", value: totals.vat },
              { label: "الإجمالي شامل الضريبة", value: totals.total },
            ]} />
          </div>
        </>
      )}
      {dialog && (
        <PurchaseDialog
          id={dialog.id}
          readOnly={dialog.mode === "view"}
          onClose={(saved) => {
            setDialog(null);
            if (saved) {
              qc.invalidateQueries({ queryKey: ["purchases"] });
              qc.invalidateQueries({ queryKey: ["suppliers"] });
              qc.invalidateQueries({ queryKey: ["payments"] });
              qc.invalidateQueries({ queryKey: ["cashbox"] });
              qc.invalidateQueries({ queryKey: ["bank"] });
              qc.invalidateQueries({ queryKey: ["report-pnl"] });
              qc.invalidateQueries({ queryKey: ["report-vehicles"] });
            }
          }}
        />
      )}
    </PageFrame>
  );
}
