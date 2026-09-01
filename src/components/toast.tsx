"use client";

import { useEffect, useState } from "react";

export type ToastType = "info" | "error" | "success";
type Toast = { id: number; text: string; type: ToastType };

let listeners: ((t: Toast) => void)[] = [];
let idCounter = 0;

export function notify(text: string, type: ToastType = "info"): void {
  const t = { id: ++idCounter, text, type };
  listeners.forEach((l) => l(t));
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const l = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 4500);
    };
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);

  const colors: Record<ToastType, string> = {
    info: "#1f4e79",
    error: "#b02a37",
    success: "#1e7d43",
  };

  return (
    <div className="toast-host" style={{ position: "fixed", bottom: 18, left: 18, right: 18, zIndex: 100, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, pointerEvents: "none" }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: "#fff",
            borderRight: `4px solid ${colors[t.type]}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            borderRadius: 8,
            padding: "10px 16px",
            fontSize: 14,
            maxWidth: 380,
            whiteSpace: "pre-line",
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
