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
  "admin.reset_company_data": "تصفير بيانات عمل شركة",
  "admin.update_company_identity": "تعديل بيانات شركة وحساب مالكها",
  "admin.create_additional_user": "إنشاء مستخدم إضافي",
  "admin.activate_additional_user": "تفعيل مستخدم إضافي",
  "admin.deactivate_additional_user": "إيقاف مستخدم إضافي",
  "admin.delete_additional_user": "حذف مستخدم إضافي",
};

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[] | null>(null);

  useEffect(() => {
    listActivityLogs().then(setLogs).catch((e) => notify(e.message, "error"));
  }, []);

  return (
    <div>
      <h1 className="page-title">سجل نشاط المطوّر</h1>
      <p className="page-sub">إجراءات حساب المطوّر الحالي فقط (آخر 1000 حدث) — لا تظهر أنشطة مستخدمي الشركات</p>

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
