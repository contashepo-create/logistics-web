"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  SETTINGS_FIELDS,
  getAppSettings,
  updateAppSettings,
  displayPhone,
  type AppSettings,
} from "@/lib/settings";
import { DeveloperLinks } from "@/components/DeveloperInfo";
import { notify } from "@/components/toast";

/**
 * تحرير بيانات المطوّر ومعلومات التطبيق.
 * تنعكس فوراً على: الصفحة التعريفية، صفحة حول التطبيق، وصفحة الاشتراك عند العملاء.
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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await updateAppSettings(form);
      setForm(saved);
      notify("تم حفظ البيانات وستظهر في كل الشاشات فوراً.", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="page-title">بيانات المطوّر ومعلومات التطبيق</div>
      <div className="page-sub" style={{ marginBottom: 16 }}>
        هذه البيانات تظهر في الصفحة الرئيسية للموقع، صفحة «حول التطبيق»، وصفحة الاشتراك لدى العملاء.
      </div>

      <form onSubmit={save} className="page-card" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {SETTINGS_FIELDS.filter((f) => !f.multiline).map((f) => (
            <div key={f.key}>
              <label className="field-label">{f.label}</label>
              <input
                className="input-base"
                dir={f.ltr ? "ltr" : undefined}
                value={form[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
              />
              {f.hint && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{f.hint}</div>}
            </div>
          ))}
        </div>

        {SETTINGS_FIELDS.filter((f) => f.multiline).map((f) => (
          <div key={f.key}>
            <label className="field-label">{f.label}</label>
            <textarea className="textarea" rows={3} value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            {f.hint && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{f.hint}</div>}
          </div>
        ))}

        <div>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "جارٍ الحفظ…" : "💾 حفظ البيانات"}
          </button>
        </div>
      </form>

      <div className="page-card" style={{ marginTop: 16 }}>
        <div className="group-title">معاينة كما يراها العميل</div>
        <div className="dev-card" style={{ border: "none", padding: 0 }}>
          <div className="dev-row">
            <span className="dev-avatar">👨‍💼</span>
            <div>
              <div className="dev-name">
                {form.developer_title ? `${form.developer_title} / ` : ""}
                {form.developer_name}
              </div>
              <div className="dev-meta">
                {form.developer_country}
                {form.support_hours ? ` · ${form.support_hours}` : ""}
              </div>
              <div className="dev-phone" dir="ltr">{displayPhone(form.phone)}</div>
            </div>
          </div>
          <DeveloperLinks s={form} />
        </div>
      </div>
    </div>
  );
}
