"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  getAppSettings,
  telLink,
  whatsappLink,
  telegramLink,
  displayPhone,
  type AppSettings,
} from "@/lib/settings";

/** أزرار التواصل مع المطوّر (اتصال / واتساب / تليجرام). */
export function DeveloperLinks({ s, size = "md" }: { s: AppSettings; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "dev-link dev-link-sm" : "dev-link";
  return (
    <div className="dev-links">
      <a className={`${cls} dev-call`} href={telLink(s.phone)}>
        📞 اتصال
      </a>
      <a className={`${cls} dev-wa`} href={whatsappLink(s.whatsapp, "السلام عليكم، بخصوص نظام النقل المحاسبي")} target="_blank" rel="noopener noreferrer">
        💬 واتساب
      </a>
      <a className={`${cls} dev-tg`} href={telegramLink(s.telegram)} target="_blank" rel="noopener noreferrer">
        ✈️ تليجرام
      </a>
      {s.email && (
        <a className={`${cls} dev-mail`} href={`mailto:${s.email}`}>
          ✉️ بريد
        </a>
      )}
    </div>
  );
}

/** خطّاف بسيط لقراءة الإعدادات في مكوّنات العميل. */
export function useAppSettings(): AppSettings {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let alive = true;
    getAppSettings().then((v) => {
      if (alive) setS(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

/**
 * بطاقة «المطوّر والدعم الفني» — تُستخدم في صفحة الاشتراك وصفحة حول التطبيق.
 * كل بياناتها تأتي من جدول app_settings القابل للتعديل من لوحة المطوّر.
 */
export function DeveloperCard({ title = "👨‍💻 المطوّر والدعم الفني" }: { title?: string }) {
  const s = useAppSettings();
  return (
    <div className="dev-card">
      <div className="group-title">{title}</div>
      <div className="dev-row">
        <span className="dev-avatar">👨‍💼</span>
        <div>
          <div className="dev-name">
            {s.developer_title ? `${s.developer_title} / ` : ""}
            {s.developer_name}
          </div>
          <div className="dev-meta">
            {s.developer_country}
            {s.support_hours ? ` · ${s.support_hours}` : ""}
          </div>
          <div className="dev-phone" dir="ltr">
            {displayPhone(s.phone)}
          </div>
        </div>
      </div>
      <DeveloperLinks s={s} />
    </div>
  );
}

/** سطر حقوق النشر — نص قابل للتعديل من لوحة المطوّر. */
export function CopyrightLine({ className }: { className?: string }) {
  const s = useAppSettings();
  return (
    <div className={className}>
      © {new Date().getFullYear()} {s.app_name} — {s.copyright}
    </div>
  );
}

/** تذييل الصفحة التعريفية: بيانات المطوّر + روابط التواصل + الحقوق. */
export function LandingDeveloperFooter() {
  const s = useAppSettings();
  return (
    <div className="lp-dev">
      <div className="lp-dev-title">تواصل مع المطوّر</div>
      <div className="lp-dev-name">
        {s.developer_title ? `${s.developer_title} / ` : ""}
        {s.developer_name} — {s.developer_country}
      </div>
      <div className="lp-dev-phone" dir="ltr">
        {displayPhone(s.phone)}
      </div>
      <DeveloperLinks s={s} size="sm" />
    </div>
  );
}
