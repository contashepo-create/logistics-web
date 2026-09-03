"use client";

import React from "react";
import { Button, EmptyState } from "./ui";

export interface RowAction {
  key: string;
  label: string;
  title?: string;
  danger?: boolean;
}

export function DataTable({
  headers,
  rows,
  ids,
  actions = ["view", "edit", "delete"],
  extra = [],
  rowClasses = [],
  onAction,
  loading = false,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  ids: (number | string)[];
  actions?: string[];
  extra?: RowAction[];
  rowClasses?: string[];
  onAction?: (id: number | string, key: string) => void;
  loading?: boolean;
}) {
  const allActionLabels: RowAction[] = [];
  if (actions.includes("view")) allActionLabels.push({ key: "view", label: "👁️", title: "عرض" });
  if (actions.includes("edit")) allActionLabels.push({ key: "edit", label: "✏️", title: "تعديل" });
  for (const e of extra) allActionLabels.push({ key: e.key, label: e.label, title: e.title, danger: e.danger });
  if (actions.includes("delete")) allActionLabels.push({ key: "delete", label: "🗑️", title: "حذف", danger: true });

  const showActions = allActionLabels.length > 0;

  if (loading) return <EmptyState text="جارٍ التحميل…" />;
  if (!rows.length) return <EmptyState text="لا توجد بيانات" />;

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
            {showActions && <th style={{ minWidth: allActionLabels.length * 40 + 10 }}>العمليات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={rowClasses[r] || undefined}>
              {row.map((cell, c) => (
                <td key={c}>{cell}</td>
              ))}
              {showActions && (
                <td>
                  <div className="row-actions">
                    {allActionLabels.map((a) => (
                      <Button
                        key={a.key}
                        variant={a.danger ? "row-danger" : "row"}
                        title={a.title}
                        onClick={() => onAction?.(ids[r], a.key)}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
