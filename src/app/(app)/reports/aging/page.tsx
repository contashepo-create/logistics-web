"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageFrame, Spinner, ExportBar, TotalsBar, Button } from "@/components/ui";
import { suppliersAging } from "@/lib/suppliers";
import { customersAging } from "@/lib/customerAging";
import { money, todayIso } from "@/lib/format";
import { exportPage } from "@/lib/exportHelper";

type AgingTab = "customers" | "suppliers";

/**
 * أعمار الديون: تبويبان — عملاء (ما لنا عليهم) وموردون (ما علينا لهم).
 * نفس المنطق في الاثنين: توزيع كل فاتورة على شريحة عمرية حسب تاريخها،
 * والسداد يُخصم بالأقدم أولاً (FIFO)، والرصيد الافتتاحي يدخل كأقدم حركة.
 */
export default function AgingReportPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<AgingTab>("customers");

  const customersQuery = useQuery({
    queryKey: ["aging-customers"],
    queryFn: () => customersAging(),
    enabled: tab === "customers",
  });
  const suppliersQuery = useQuery({
    queryKey: ["aging-suppliers"],
    queryFn: () => suppliersAging(),
    enabled: tab === "suppliers",
  });

  const data = (tab === "customers" ? customersQuery.data : suppliersQuery.data) ?? [];
  const isLoading = tab === "customers" ? customersQuery.isLoading : suppliersQuery.isLoading;

  const isCustomers = tab === "customers";
  const partyLabel = isCustomers ? "العميل" : "المورّد";
  const title = isCustomers ? "أعمار ديون العملاء" : "أعمار ديون الموردين";
  const subtitle = isCustomers
    ? "توزيع المستحق على كل عميل حسب عمر الفاتورة (السداد يُخصم بالأقدم أولاً، والرصيد الافتتاحي يُحتسب كأقدم حركة)"
    : "توزيع المستحق لكل مورّد حسب عمر الفاتورة (السداد يُخصم بأسلوب الأقدم أولاً)";

  const headers = [partyLabel, "حتى 30 يوم", "31 – 60", "61 – 90", "أكثر من 90", "الإجمالي المستحق"];
  const rows = useMemo(
    () => data.map((r) => [r.name, money(r.current), money(r.d31_60), money(r.d61_90), money(r.over90), money(r.total)]),
    [data]
  );

  const totals = useMemo(() => {
    const src = data;
    return {
      current: src.reduce((a, r) => a + r.current, 0),
      d31_60: src.reduce((a, r) => a + r.d31_60, 0),
      d61_90: src.reduce((a, r) => a + r.d61_90, 0),
      over90: src.reduce((a, r) => a + r.over90, 0),
      total: src.reduce((a, r) => a + r.total, 0),
    };
  }, [data]);

  const summaryLines: [string, string | number][] = [
    ["نوع التقرير", title],
    ["التاريخ المرجعي", todayIso()],
    ["عدد الحسابات المدينة", data.length],
    ["حتى 30 يوم", money(totals.current)],
    ["31 – 60 يوم", money(totals.d31_60)],
    ["61 – 90 يوم", money(totals.d61_90)],
    ["أكثر من 90 يوم", money(totals.over90)],
    ["الإجمالي المستحق", money(totals.total)],
  ];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["aging-customers"] });
    qc.invalidateQueries({ queryKey: ["aging-suppliers"] });
  };

  return (
    <PageFrame
      title={title}
      subtitle={subtitle}
      toolbar={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button variant={isCustomers ? "primary" : "default"} onClick={() => setTab("customers")}>
            🧑‍💼 أعمار ديون العملاء
          </Button>
          <Button variant={!isCustomers ? "primary" : "default"} onClick={() => setTab("suppliers")}>
            🏭 أعمار ديون الموردين
          </Button>
          <Button onClick={refresh}>🔄 تحديث</Button>
        </div>
      }
      exportBar={
        <ExportBar
          onExcel={() => exportPage({ title, subtitle, headers, rows, summaryLines, mode: "excel" })}
          onPdf={() => exportPage({ title, subtitle, headers, rows, summaryLines, mode: "pdf" })}
          onPrint={() => exportPage({ title, subtitle, headers, rows, summaryLines, mode: "print" })}
        />
      }
    >
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>
          {isCustomers ? "لا توجد مستحقات قائمة على العملاء 🎉" : "لا توجد مستحقات قائمة للموردين 🎉"}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{partyLabel}</th>
                  <th className="num">حتى 30 يوم</th>
                  <th className="num">31 – 60</th>
                  <th className="num">61 – 90</th>
                  <th className="num">أكثر من 90</th>
                  <th className="num">الإجمالي المستحق</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={`${tab}-${r.id}`}>
                    <td style={{ textAlign: "right" }}>
                      {isCustomers ? (
                        <button
                          className="btn btn-sm"
                          onClick={() => router.push(`/reports/customers/${r.id}`)}
                          title="فتح التقرير الشامل عن العميل"
                        >
                          {r.name}
                        </button>
                      ) : r.name}
                    </td>
                    <td className="num">{money(r.current)}</td>
                    <td className="num">{money(r.d31_60)}</td>
                    <td className="num">{money(r.d61_90)}</td>
                    <td className={`num${r.over90 > 0 ? " cell-danger" : ""}`}>{money(r.over90)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{money(r.total)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>الإجمالي</td>
                  <td className="num">{money(totals.current)}</td>
                  <td className="num">{money(totals.d31_60)}</td>
                  <td className="num">{money(totals.d61_90)}</td>
                  <td className="num">{money(totals.over90)}</td>
                  <td className="num">{money(totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <TotalsBar items={[
              { label: "حتى 30 يوم", value: totals.current },
              { label: "31 – 60", value: totals.d31_60 },
              { label: "61 – 90", value: totals.d61_90 },
              { label: "أكثر من 90", value: totals.over90 },
              { label: "الإجمالي المستحق", value: totals.total },
            ]} />
          </div>
          {isCustomers && (
            <div className="field-hint" style={{ marginTop: 10 }}>
              اضغط على اسم العميل لفتح تقريره الشامل (فواتيره ونقلاته وسنداته وأعمار ديونه مع التصدير).
            </div>
          )}
        </>
      )}
    </PageFrame>
  );
}
