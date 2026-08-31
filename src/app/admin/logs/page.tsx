"use client";

import { useEffect, useState } from "react";
import { listActivityLogs, type ActivityLog } from "@/lib/admin";
import { notify } from "@/components/toast";

const ACTION_LABELS: Record<string, string> = {
  signup: "تسجيل شركة جديدة",
  "admin.activate_company": "تفعيل شركة",
  "admin.deactivate_company": "إيقاف شركة",
  "admin.set_subscription": "تغيير الاشتراك",
  "admin.delete_company": "حذف شركة",
};

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[] | null>(null);

  useEffect(() => {
    listActivityLogs().then(setLogs).catch((e) => notify(e.message, "error"));
  }, []);

  return (
    <div>
      <h1 className="page-title">سجل النشاط</h1>
      <p className="page-sub">التسجيلات وإجراءات المطوّر (آخر 1000 حدث)</p>

      {!logs ? (
        <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>جارٍ التحميل…</div>
      ) : (
        <table className="data-table" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>الوقت</th><th>الفاعل</th><th>الحدث</th><th>الكيان</th><th>التفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>لا توجد أحداث بعد.</td></tr>
            )}
            {logs.map((l) => (
              <tr key={l.id}>
                <td dir="ltr">{l.created_at ? l.created_at.slice(0, 19).replace("T", " ") : "—"}</td>
                <td dir="ltr">{l.actor_email || "—"}</td>
                <td>{ACTION_LABELS[l.action] ?? l.action}</td>
                <td>{l.entity || "—"}</td>
                <td>{l.detail || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
