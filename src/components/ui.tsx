"use client";

import React, { useEffect, useRef, useState } from "react";
import { money, normalizeDigits, parseFloatSafe, balanceSide, balanceSideLabel } from "@/lib/format";

// ---------------------------------------------------------------------------
export function Button({
  variant = "default",
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" | "row" | "row-danger" }) {
  const cls =
    variant === "primary" ? "btn btn-primary" :
    variant === "danger" ? "btn btn-danger" :
    variant === "row" ? "btn btn-row" :
    variant === "row-danger" ? "btn btn-row-danger" : "btn";
  return (
    <button className={`${cls} ${className}`} {...props}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
export function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="field min-w-0">
      <label className="field-label">
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />;
}

// حقل مبلغ (نصي) يقبل الأرقام العربية — يُحفظ كنص ويُفسَّر عند الحفظ
export function AmountInput({
  value,
  onChange,
  disabled,
  readOnly,
  placeholder = "0.00",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      className="input"
      style={{ textAlign: "center" }}
      inputMode="decimal"
      dir="ltr"
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function DateInput({
  value,
  onChange,
  disabled,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  return (
    <input
      type="date"
      className="input"
      dir="ltr"
      disabled={disabled}
      readOnly={readOnly}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ---------------------------------------------------------------------------
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 640,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-card ${width >= 900 ? "wide" : ""}`} style={{ maxWidth: width }}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="btn btn-row" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={460}
      footer={
        <>
          <Button variant="danger" onClick={onConfirm}>نعم، تأكيد</Button>
          <Button onClick={onCancel}>إلغاء</Button>
        </>
      }
    >
      <p style={{ whiteSpace: "pre-line" }}>{message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export function TotalsBar({ items }: { items: { label: string; value: number }[] }) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {items.map((it) => (
        <div className="total-card" key={it.label}>
          <div className="total-label">{it.label}</div>
          <div className={`total-value ${it.value < 0 ? "neg" : ""}`}>{money(it.value)}</div>
        </div>
      ))}
    </div>
  );
}

export function ExportBar({
  onExcel,
  onPdf,
  onPrint,
}: {
  onExcel?: () => void;
  onPdf?: () => void;
  onPrint?: () => void;
}) {
  return (
    <div className="export-bar">
      <Button onClick={onExcel} title="تصدير إلى ملف Excel">📊 Excel</Button>
      <Button onClick={onPdf} title="تصدير إلى ملف PDF">📄 PDF</Button>
      <Button onClick={onPrint} title="طباعة بتنسيق احترافي">🖨️ طباعة</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function PageFrame({
  title,
  subtitle,
  addText,
  onAdd,
  search,
  onSearch,
  exportBar,
  children,
  toolbar,
}: {
  title: string;
  subtitle?: string;
  addText?: string;
  onAdd?: () => void;
  search?: string;
  onSearch?: (v: string) => void;
  exportBar?: React.ReactNode;
  toolbar?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-card">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="page-title">{title}</div>
          {subtitle && <div className="page-sub">{subtitle}</div>}
        </div>
        <div className="page-tools">
          {onAdd && (
            <Button variant="primary" onClick={onAdd}>{addText ?? "➕ إضافة"}</Button>
          )}
          {onSearch && (
            <input
              className="input page-search"
              placeholder="🔍 بحث سريع..."
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          )}
          {exportBar}
        </div>
      </div>
      {toolbar && <div style={{ marginTop: 12 }}>{toolbar}</div>}
      {children && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  );
}

// صف فلاتر موحد (من تاريخ / إلى تاريخ / فلاتر إضافية / زر عرض)
export function FilterRow({
  dFrom,
  dTo,
  onFrom,
  onTo,
  onRefresh,
  children,
}: {
  dFrom: string;
  dTo: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div>
        <label className="field-label">من تاريخ</label>
        <DateInput value={dFrom} onChange={onFrom} />
      </div>
      <div>
        <label className="field-label">إلى تاريخ</label>
        <DateInput value={dTo} onChange={onTo} />
      </div>
      {children}
      <Button variant="primary" onClick={onRefresh}>🔄 عرض</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Spinner() {
  return (
    <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>جارٍ التحميل…</div>
  );
}

export function EmptyState({ text = "لا توجد بيانات" }: { text?: string }) {
  return (
    <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>{text}</div>
  );
}

export function matchesSearch(text: string, row: (string | number)[]): boolean {
  const joined = normalizeDigits(row.map((c) => String(c)).join(" "));
  return joined.includes(normalizeDigits(text));
}

// قائمة اختيار عامة (كود - اسم)
export function DictSelect({
  value,
  onChange,
  options,
  placeholder = "— اختر —",
  disabled = false,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  options: { id: number; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </Select>
  );
}

// قائمة موحدة للخزائن والبنوك
export function AccountSelect({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: { kind: string; id: number } | null;
  onChange: (v: { kind: string; id: number } | null) => void;
  options: { kind: string; id: number; label: string }[];
  disabled?: boolean;
}) {
  const key = value ? `${value.kind}:${value.id}` : "";
  return (
    <Select
      value={key}
      disabled={disabled}
      onChange={(e) => {
        if (!e.target.value) return onChange(null);
        const [kind, id] = e.target.value.split(":");
        onChange({ kind, id: Number(id) });
      }}
    >
      <option value="">— اختر الخزينة أو البنك —</option>
      {options.map((o) => (
        <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>{o.label}</option>
      ))}
    </Select>
  );
}

/** رصيد عميل ملوّن مع بيان الجانب: أخضر = عليه، أحمر = له */
export function Balance({ value, pill = false }: { value: number; pill?: boolean }) {
  const side = balanceSide(value);
  const cls = side === "debit" ? "bal-debit" : side === "credit" ? "bal-credit" : "bal-zero";
  const v = Math.abs(Math.round((Number(value) || 0) * 100) / 100);
  return (
    <span className={`${pill ? "bal-pill" : "bal"} ${cls}`} title={side === "debit" ? "مستحق على العميل للشركة" : side === "credit" ? "مستحق للعميل على الشركة" : "لا توجد مديونية"}>
      {money(v)}
      <span className="bal-side">({balanceSideLabel(value)})</span>
    </span>
  );
}
