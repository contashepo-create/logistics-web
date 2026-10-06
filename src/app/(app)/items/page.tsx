"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import {
  PageFrame, Spinner, ExportBar, Modal, Field, Input, Select, Textarea, AmountInput, Button, matchesSearch,
} from "@/components/ui";
import { notify } from "@/components/toast";
import { money } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";
import {
  ITEM_TYPES, listItems, getItem, saveItem, setItemActive, deleteItem, itemUsageCount, isRouteItem,
} from "@/lib/items";
import type { Item } from "@/lib/types";

const EMPTY = {
  name: "", item_type: "service", unit: "نقلة", default_price: "0",
  from_loc: "", to_loc: "", description: "", notes: "",
};

/**
 * كتالوج الخدمات والأصناف: كل خدمة نوعها «خدمة» بلا مخزون فعلي، ويمكن أن تكون
 * خط سير (من ← إلى) مخزَّناً داخلها مثل «نقل الرياض ← الدمام».
 */
function ItemDialog({ id, onClose }: { id?: number; onClose: (saved?: boolean) => void }) {
  const [f, setF] = useState({ ...EMPTY });
  const [used, setUsed] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const item = (await getItem(id)) as Item | null;
      if (!item) return;
      setF({
        name: item.name,
        item_type: item.item_type,
        unit: item.unit ?? "",
        default_price: String(item.default_price ?? 0),
        from_loc: String(item.from_loc ?? ""),
        to_loc: String(item.to_loc ?? ""),
        description: item.description ?? "",
        notes: item.notes ?? "",
      });
      setUsed(await itemUsageCount(id));
    })();
  }, [id]);

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const route = Boolean(f.from_loc.trim() && f.to_loc.trim());

  const save = async () => {
    setSaving(true);
    try {
      await saveItem({ ...f, default_price: parseFloat(f.default_price || "0") || 0 }, id);
      notify("تم حفظ الخدمة بنجاح.", "success");
      onClose(true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={id ? "تعديل خدمة/صنف" : "خدمة/صنف جديد"} onClose={() => onClose()} width={820}>
      {id && used != null && (
        <div className="group-box" style={{ marginTop: 0 }}>
          <div className="group-title">الاستخدام في النقلات</div>
          <div className="total-value">{used} نقلة</div>
          {used > 0 && <div className="field-hint">الخدمة مستخدمة في فواتير، لذلك لا يمكن حذفها — يمكن تعطيلها.</div>}
        </div>
      )}
      <div className="form-grid-2">
        <Field label="اسم الخدمة" required hint="مثال: نقل الرياض ← الدمام أو «أعمال تحميل»">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="النوع">
          <Select value={f.item_type} onChange={(e) => set("item_type", e.target.value)}>
            {Object.entries(ITEM_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
      </div>
      <div className="form-grid-2">
        <Field label="من (مكان الانطلاق)" hint="اتركه فارغاً لخدمة عامة بلا خط">
          <Input value={f.from_loc} onChange={(e) => set("from_loc", e.target.value)} />
        </Field>
        <Field label="إلى (مكان الوصول)">
          <Input value={f.to_loc} onChange={(e) => set("to_loc", e.target.value)} />
        </Field>
      </div>
      <div className="field-hint" style={{ marginBottom: 8 }}>
        {route
          ? "خدمة خط: عند اختيارها في نقلات الفاتورة يُعبَّأ «من/إلى» منها تلقائياً ويُقفلان، وتُبنى تقارير الخط من هذه الخدمة."
          : "خدمة عامة بلا خط: يُكتب «من/إلى» يدوياً في كل نقلة."}
      </div>
      <div className="form-grid-2">
        <Field label="الوحدة"><Input value={f.unit} onChange={(e) => set("unit", e.target.value)} /></Field>
        <Field label="السعر الافتراضي" hint="يُعبَّأ تلقائياً في سعر النقلة عند اختيار الخدمة">
          <AmountInput value={f.default_price} onChange={(v) => set("default_price", v)} />
        </Field>
      </div>
      <Field label="وصف الخدمة"><Textarea value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <Button variant="primary" onClick={save} disabled={saving || !f.name.trim()}>💾 حفظ</Button>
        <Button onClick={() => onClose()}>إلغاء</Button>
      </div>
    </Modal>
  );
}

export default function ItemsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "service" | "product">("");
  const [show, setShow] = useState<"active" | "all">("active");
  const [dialog, setDialog] = useState<{ id?: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["items", typeFilter, show],
    queryFn: () => listItems({ type: typeFilter || null, includeInactive: show === "all" }),
  });

  const headers = ["الكود", "الاسم", "النوع", "الخط (من ← إلى)", "الوحدة", "السعر الافتراضي", "الحالة"];
  const textRows = useMemo(
    () => (data ?? []).map((it) => [
      it.code, it.name,
      ITEM_TYPES[it.item_type] ?? it.item_type,
      isRouteItem(it) ? `${it.from_loc} ← ${it.to_loc}` : "—",
      it.unit || "—",
      money(it.default_price),
      it.is_active ? "✅ مفعّلة" : "⏸️ معطّلة",
    ]),
    [data]
  );
  const viewRows = useMemo(() => textRows, [textRows]);

  const filtered = useMemo(() => {
    if (!search.trim()) return { ids: (data ?? []).map((it) => it.id), rows: viewRows, text: textRows };
    const pairs = (data ?? [])
      .map((it, i) => ({ id: it.id, row: viewRows[i], text: textRows[i] }))
      .filter((p) => matchesSearch(search, p.text));
    return { ids: pairs.map((p) => p.id), rows: pairs.map((p) => p.row), text: pairs.map((p) => p.text) };
  }, [data, viewRows, textRows, search]);

  const toggleActive = async (id: number, active: boolean) => {
    try {
      await setItemActive(id, active);
      notify(active ? "تم تفعيل الخدمة." : "تم تعطيل الخدمة (تبقى في التقارير والقديم).", "success");
      qc.invalidateQueries({ queryKey: ["items"] });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const onDelete = async (id: number) => {
    if (!window.confirm("حذف الخدمة نهائياً؟ (يُرفض إن كانت مستخدمة في نقلات — الأفضل تعطيلها)")) return;
    try {
      await deleteItem(id);
      notify("تم حذف الخدمة.", "success");
      qc.invalidateQueries({ queryKey: ["items"] });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const subtitle = "خدمات نقل بلا مخزون فعلي — كل خدمة يمكن أن تكون خطاً (من ← إلى) يُعبَّأ تلقائياً في الفاتورة، وتُبنى من الاستخدام الفعلي تقارير الخدمات";

  return (
    <PageFrame
      title="الخدمات والأصناف"
      subtitle={subtitle}
      addText="➕ خدمة جديدة"
      onAdd={() => setDialog({})}
      search={search}
      onSearch={setSearch}
      toolbar={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="field-label">النوع</label>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
              <option value="">الكل</option>
              <option value="service">خدمات</option>
              <option value="product">أصناف مخزنية</option>
            </Select>
          </div>
          <div>
            <label className="field-label">العرض</label>
            <Select value={show} onChange={(e) => setShow(e.target.value as any)}>
              <option value="active">المفعّلة فقط</option>
              <option value="all">الكل (بما فيها المعطّلة)</option>
            </Select>
          </div>
          <Button onClick={() => qc.invalidateQueries({ queryKey: ["items"] })}>🔄 تحديث</Button>
        </div>
      }
      exportBar={
        <ExportBar
          onExcel={() => exportPage({ title: "الخدمات والأصناف", subtitle, headers, rows: filtered.text, mode: "excel" })}
          onPdf={() => exportPage({ title: "الخدمات والأصناف", subtitle, headers, rows: filtered.text, mode: "pdf" })}
          onPrint={() => exportPage({ title: "الخدمات والأصناف", subtitle, headers, rows: filtered.text, mode: "print" })}
        />
      }
    >
      {isLoading ? <Spinner /> : (
        <DataTable
          headers={headers}
          rows={filtered.rows}
          ids={filtered.ids}
          actions={["edit", "delete"]}
          extra={[{ key: "toggle", label: "⏯️", title: "تفعيل/تعطيل" }]}
          onAction={(id, key) => {
            const item = (data ?? []).find((it) => it.id === Number(id));
            if (key === "edit") setDialog({ id: Number(id) });
            else if (key === "delete") onDelete(Number(id));
            else if (key === "toggle" && item) toggleActive(Number(id), !item.is_active);
          }}
        />
      )}
      <div className="field-hint" style={{ marginTop: 10 }}>
        الحذف متاح للخدمات غير المستخدمة فقط؛ الخدمة المستخدمة في فواتير سابقة تُعطَّل حتى تبقى تقاريرها سليمة.
      </div>
      {dialog && (
        <ItemDialog
          id={dialog.id}
          onClose={(saved) => {
            setDialog(null);
            if (saved) {
              qc.invalidateQueries({ queryKey: ["items"] });
              qc.invalidateQueries({ queryKey: ["items-options"] });
            }
          }}
        />
      )}
    </PageFrame>
  );
}
