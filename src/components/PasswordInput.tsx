"use client";

import { useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  showLabel?: string;
  hideLabel?: string;
};

/** حقل كلمة مرور موحّد مع زر إظهار/إخفاء قابل للوصول بلوحة المفاتيح وقارئ الشاشة. */
export default function PasswordInput({
  showLabel = "إظهار كلمة المرور",
  hideLabel = "إخفاء كلمة المرور",
  className = "",
  ...props
}: Props) {
  const [visible, setVisible] = useState(false);
  const label = visible ? hideLabel : showLabel;

  return (
    <div className="password-input-wrap">
      <input {...props} type={visible ? "text" : "password"} className={className} />
      <button
        type="button"
        className="password-visibility-btn"
        onClick={() => setVisible((value) => !value)}
        aria-label={label}
        title={label}
        aria-pressed={visible}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 4.2A10.7 10.7 0 0112 4c5.5 0 9.5 5.2 9.5 8 0 1.1-.7 2.5-1.9 3.9M6.2 6.3C3.9 7.9 2.5 10.4 2.5 12c0 2.8 4 8 9.5 8 1.5 0 2.9-.4 4.1-1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12c0-2.8 4-8 9.5-8s9.5 5.2 9.5 8-4 8-9.5 8-9.5-5.2-9.5-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
