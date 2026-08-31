"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "app-theme";

/** قراءة الثيم الحالي من العنصر الجذري. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return (document.documentElement.getAttribute("data-theme") as Theme) || "light";
}

/** تطبيق الثيم وحفظه. */
export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* تجاهل */
  }
}

/** زر تبديل الوضع الفاتح/الداكن. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => setTheme(currentTheme()), []);

  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  const label = theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن";
  const icon = theme === "dark" ? "☀️" : "🌙";

  if (compact) {
    return (
      <button type="button" className="icon-btn" onClick={flip} title={label} aria-label={label}>
        {icon}
      </button>
    );
  }
  return (
    <button type="button" className="btn btn-sm btn-block" onClick={flip} title={label}>
      {icon} {label}
    </button>
  );
}

/** يُستدعى مرة في تخطيط الجذر — يزامن الحالة مع نظام التشغيل عند غياب اختيار محفوظ. */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('${KEY}');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-theme', s || (m?'dark':'light'));}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
