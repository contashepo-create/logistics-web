"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar, matchesSearch } from "@/components/ui";
import { customersWithBalance } from "@/lib/calc";
import { balanceSideLabel } from "@/lib/customerReport";
import { money } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

/** فهرس العملاء للوصول إلى التقرير الشامل لكل عميل. */
export default function CustomersReportIndexPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["customers"], queryFn: customersWithBalance });

  const headers = ["الكود", "الاسم", "الهاتف", "الرصيد الحالي", "الحالة"];
  const all = useMemo(
    () => (data ?? []).map((c) => ({
      id: c.id,
      cells: [c.code || "—", c.name, c.phone || "—", money(c.balance ?? 0), balanceSideLabel(c.balance ?? 0)],
    })),
    [data]
  );
  const filtered = useMemo(
    () => (search.trim() ? all.filter((r) => matchesSearch(search, r.cells)) : all),
    [all, search]
  );
  const rows = filtered.map((r) => r.cells);
  const subtitle = "اختر عميلاً لعرض التقرير الشامل عنه (بياناته + فواتيره ونقلاته وخدماته + سنداته وإشعاراته + أرصدته وأعمار ديونه) مع تصدير Excel/PDF/طباعة";

  return (
    <PageFrame
      title="التقرير الشامل للعملاء"
      subtitle={subtitle}
      search={search}
      onSearch={setSearch}
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "أرصدة العملاء", subtitle, headers, rows, mode: "excel" })}
        onPdf={() => exportPage({ title: "أرصدة العملاء", subtitle, headers, rows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "أرصدة العملاء", subtitle, headers, rows, mode: "print" })}
      />}
    >
      {isLoading ? <Spinner /> : (
        <DataTable
          headers={headers}
          rows={rows}
          ids={filtered.map((r) => r.id)}
          actions={[]}
          extra={[{ key: "report", label: "📊 التقرير الشامل", title: "تقرير شامل عن العميل" }]}
          onAction={(id, key) => {
            if (key === "report") router.push(`/reports/customers/${id}`);
          }}
        />
      )}
      <div className="field-hint" style={{ marginTop: 10 }}>
        يمكنك أيضاً الوصول للتقرير من شاشة العملاء عبر زر «التقرير الشامل»، ومن كشف الحساب للعميل نفسه.
      </div>
    </PageFrame>
  );
}
