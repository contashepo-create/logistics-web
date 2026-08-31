"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  SETTINGS_FIELDS,
  CUSTOM_FIELD_TYPES,
  getAppSettings,
  updateAppSettings,
  newCustomField,
  isEnabled,
  type AppSettings,
  type CustomField,
  type CustomFieldType,
} from "@/lib/settings";
import { DeveloperCardView } from "@/components/DeveloperInfo";
import { notify } from "@/components/toast";

/**
 * تحرير بيانات المطوّر ومعلومات التطبيق.
 * كل حقل يمكن تعطيله (فيختفي من كل الشاشات) ويمكن إضافة حقول جديدة بمسميات حرة.
 * تنعكس التغييرات على: الصفحة التعريفية، صفحة حول التطبيق، وصفحة الاشتراك.
 */
export default function ZerocoldSettingsPage() {
  const [form, setForm] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAppSettings().then((s) => {
      setForm(s);
      setLoading(false);
    });
  }, []);

  const set = (k: keyof AppSettings, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k: string, on: boolean) =>
    setForm((f) => ({ ...f, visibility: { ...f.visibility, [k]: on } }));

  const setCustom = (id: string, patch: Partial<CustomField>) =>
    setForm((f) => ({ ...f, custom_fields: f.custom_fields.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const addCustom = () => setForm((f) => ({ ...f, custom_fields: [...f.custom_fields, newCustomField()] }));
  const removeCustom = (id: string) =>
    setForm((f) => ({ ...f, custom_fields: f.custom_fields.filter((c) => c.id !== id) }));
  const moveCustom = (id: string, dir: -1 | 1) =>
    setForm((f) => {
      const arr = [...f.custom_fields];
      const i = arr.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return f;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...f, custom_fields: arr };
    });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await updateAppSettings(form);
      setForm(saved);
      notify("تم الحفظ — البيانات محدّثة في كل الشاشات.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <div style={{ maxWidth: 920 }}>
      <div className="page-title">بيانات المطوّر ومعلومات التطبيق</div>
      <div className="page-sub" style={{ marginBottom: 16 }}>
        تظهر في الصفحة الرئيسية للموقع، صفحة «حول التطبيق»، وصفحة الاشتراك لدى العملاء.
        أزل علامة «مفعّل» لإخفاء أي حقل من كل الشاشات دون حذف قيمته.
      </div>

      <form onSubmit={save}>
        {/* الحقول الأساسية */}
        <div className="page-card" style={{ marginBottom: 16 }}>
          <div className="group-title">🧾 الحقول الأساسية</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            {SETTINGS_FIELDS.filter((f) => !f.multiline).map((f) => {
              const on = f.alwaysOn || isEnabled(form, f.key);
              return (
                <div key={f.key} className={`set-field ${on ? "" : "set-off"}`}>
                  <div className="set-head">
                    <label className="field-label" style={{ margin: 0 }}>{f.label}</label>
                    {!f.alwaysOn && (
                      <label className="set-toggle">
                        <input type="checkbox" checked={on} onChange={(e) => toggle(f.key, e.target.checked)} />
                        <span>{on ? "مفعّل" : "معطّل"}</span>
                      </label>
                    )}
                  </div>
                  <input
                    className="input-base"
                    dir={f.ltr ? "ltr" : undefined}
                    value={form[f.key] ?? ""}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                  {f.hint && <div className="set-hint">{f.hint}</div>}
                </div>
              );
            })}
          </div>

          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            {SETTINGS_FIELDS.filter((f) => f.multiline).map((f) => {
              const on = f.alwaysOn || isEnabled(form, f.key);
              return (
                <div key={f.key} className={`set-field ${on ? "" : "set-off"}`}>
                  <div className="set-head">
                    <label className="field-label" style={{ margin: 0 }}>{f.label}</label>
                    {!f.alwaysOn && (
                      <label className="set-toggle">
                        <input type="checkbox" checked={on} onChange={(e) => toggle(f.key, e.target.checked)} />
                        <span>{on ? "مفعّل" : "معطّل"}</span>
                      </label>
                    )}
                  </div>
                  <textarea className="textarea" rows={3} value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                </div>
              );
            })}
          </div>
        </div>

        {/* الحقول الإضافية */}
        <div className="page-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div className="group-title" style={{ margin: 0 }}>➕ حقول إضافية</div>
            <button type="button" className="btn btn-primary" onClick={addCustom}>إضافة حقل جديد</button>
          </div>
          <div className="set-hint" style={{ marginBottom: 12 }}>
            أضف أي معلومة بمسمى من اختيارك (رقم بديل، حساب بنكي، رابط موقع…). النوع يحدد شكل العرض:
            «نص عادي» يظهر كسطر معلومة، وباقي الأنواع تظهر كزر تواصل قابل للنقر.
          </div>

          {form.custom_fields.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 14 }}>لا توجد حقول إضافية بعد.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {form.custom_fields.map((c, i) => (
                <div key={c.id} className={`set-custom ${c.enabled ? "" : "set-off"}`}>
                  <div className="set-custom-grid">
                    <div>
                      <label className="field-label">المسمى</label>
                      <input className="input-base" value={c.label} placeholder="مثال: رقم بديل" onChange={(e) => setCustom(c.id, { label: e.target.value })} />
                    </div>
                    <div>
                      <label className="field-label">القيمة</label>
                      <input className="input-base" dir="auto" value={c.value} onChange={(e) => setCustom(c.id, { value: e.target.value })} />
                    </div>
                    <div>
                      <label className="field-label">النوع</label>
                      <select className="select" value={c.type} onChange={(e) => setCustom(c.id, { type: e.target.value as CustomFieldType })}>
                        {CUSTOM_FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="set-custom-actions">
                    <label className="set-toggle">
                      <input type="checkbox" checked={c.enabled} onChange={(e) => setCustom(c.id, { enabled: e.target.checked })} />
                      <span>{c.enabled ? "مفعّل" : "معطّل"}</span>
                    </label>
                    <button type="button" className="btn btn-row" disabled={i === 0} onClick={() => moveCustom(c.id, -1)}>▲</button>
                    <button type="button" className="btn btn-row" disabled={i === form.custom_fields.length - 1} onClick={() => moveCustom(c.id, 1)}>▼</button>
                    <button type="button" className="btn btn-danger" onClick={() => removeCustom(c.id)}>حذف</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="page-card" style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={saving}>{saving ? "جارٍ الحفظ…" : "💾 حفظ البيانات"}</button>
          <button type="button" className="btn" disabled={saving} onClick={async () => setForm(await getAppSettings())}>↺ استرجاع المحفوظ</button>
        </div>
      </form>

      <div className="page-card">
        <div className="group-title">👁️ معاينة كما يراها العميل</div>
        <DeveloperCardView s={form} bare />
      </div>
    </div>
  );
}
