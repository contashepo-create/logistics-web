"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  getAppSettings,
  telLink,
  whatsappLink,
  telegramLink,
  displayPhone,
  showField,
  isEnabled,
  activeCustomFields,
  customFieldHref,
  customFieldIcon,
  type AppSettings,
} from "@/lib/settings";

/** أزرار التواصل مع المطوّر (اتصال / واتساب / تليجرام / بريد + الحقول الإضافية). */
export function DeveloperLinks({ s, size = "md" }: { s: AppSettings; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "dev-link dev-link-sm" : "dev-link";
  const extras = activeCustomFields(s).filter((f) => f.type !== "text");
  return (
    <div className="dev-links">
      {showField(s, "phone") && (
        <a className={`${cls} dev-call`} href={telLink(s.phone)}>📞 اتصال</a>
      )}
      {showField(s, "whatsapp") && (
        <a className={`${cls} dev-wa`} href={whatsappLink(s.whatsapp, "السلام عليكم، بخصوص نظام النقل المحاسبي")} target="_blank" rel="noopener noreferrer">💬 واتساب</a>
      )}
      {showField(s, "telegram") && (
        <a className={`${cls} dev-tg`} href={telegramLink(s.telegram)} target="_blank" rel="noopener noreferrer">✈️ تليجرام</a>
      )}
      {showField(s, "email") && (
        <a className={`${cls} dev-mail`} href={`mailto:${s.email}`}>✉️ {s.email}</a>
      )}
      {extras.map((f) => (
        <a key={f.id} className={`${cls} dev-extra`} href={customFieldHref(f) ?? "#"} target={f.type === "phone" ? undefined : "_blank"} rel="noopener noreferrer">
          {customFieldIcon(f.type)} {f.label}
        </a>
      ))}
    </div>
  );
}

/** الحقول الإضافية النصية (تُعرض كأسطر معلومات لا كأزرار). */
export function CustomTextFields({ s }: { s: AppSettings }) {
  const rows = activeCustomFields(s).filter((f) => f.type === "text");
  if (!rows.length) return null;
  return (
    <div className="dev-extra-rows">
      {rows.map((f) => (
        <div key={f.id} className="dev-extra-row">
          <span className="dev-extra-label">{f.label}</span>
          <span className="dev-extra-value">{f.value}</span>
        </div>
      ))}
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

/** سطر الاسم: «الصفة / الاسم» مع إمكانية تعطيل الصفة. */
export function developerFullName(s: AppSettings): string {
  const title = showField(s, "developer_title") ? `${s.developer_title} / ` : "";
  return `${title}${s.developer_name}`;
}

/** السطر الثانوي: الجنسية ومواعيد الدعم (كلاهما قابل للتعطيل). */
export function developerMeta(s: AppSettings): string {
  return [showField(s, "developer_country") ? s.developer_country : "", showField(s, "support_hours") ? s.support_hours : ""]
    .filter(Boolean)
    .join(" · ");
}

/**
 * بطاقة «المطوّر والدعم الفني» — تُستخدم في صفحة الاشتراك وصفحة حول التطبيق.
 * كل بياناتها تأتي من جدول app_settings القابل للتعديل من لوحة المطوّر.
 */
export function DeveloperCard({ title = "👨‍💻 المطوّر والدعم الفني" }: { title?: string }) {
  const s = useAppSettings();
  return <DeveloperCardView s={s} title={title} />;
}

/** نفس البطاقة لكن ببيانات مُمرَّرة (تُستخدم للمعاينة داخل لوحة المطوّر). */
export function DeveloperCardView({ s, title, bare = false }: { s: AppSettings; title?: string; bare?: boolean }) {
  const meta = developerMeta(s);
  return (
    <div className="dev-card" style={bare ? { border: "none", padding: 0, boxShadow: "none" } : undefined}>
      {title && <div className="group-title">{title}</div>}
      <div className="dev-row">
        <span className="dev-avatar">👨‍💼</span>
        <div>
          <div className="dev-name">{developerFullName(s)}</div>
          {meta && <div className="dev-meta">{meta}</div>}
          {showField(s, "phone") && (
            <div className="dev-phone" dir="ltr">{displayPhone(s.phone)}</div>
          )}
        </div>
      </div>
      <CustomTextFields s={s} />
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

/** تذييل الصفحة التعريفية: بيانات المطوّر + روابط التواصل. */
export function LandingDeveloperFooter() {
  const s = useAppSettings();
  const meta = developerMeta(s);
  return (
    <div className="lp-dev">
      <div className="lp-dev-title">تواصل مع المطوّر</div>
      <div className="lp-dev-name">
        {developerFullName(s)}
        {meta ? ` — ${meta}` : ""}
      </div>
      {showField(s, "phone") && (
        <div className="lp-dev-phone" dir="ltr">{displayPhone(s.phone)}</div>
      )}
      <DeveloperLinks s={s} size="sm" />
    </div>
  );
}

/** يُستخدم في صفحة حول التطبيق لعرض معلومة الإصدار/الدعم مع احترام التعطيل. */
export function fieldVisible(s: AppSettings, key: string): boolean {
  return isEnabled(s, key);
}
