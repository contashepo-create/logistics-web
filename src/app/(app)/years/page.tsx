"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { PageFrame, Spinner, ExportBar } from "@/components/ui";
import { YearDialog, SnapshotDialog } from "@/components/dialogs/master";
import { listYears, deleteYear, setYearStatus, createSnapshot, movementsCountInRange, yearsWithSnapshots, rolloverYear } from "@/lib/repo";
import { notify } from "@/components/toast";
import { exportPage } from "@/lib/exportHelper";

export default function YearsPage() {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ mode: string; id?: number } | null>(null);
  const [snapshot, setSnapshot] = useState<{ id: number; year: number } | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["years"], queryFn: listYears });

  const headers = ["السنة", "من تاريخ", "إلى تاريخ", "الحالة", "عدد الحركات", "لقطات الإغلاق"];
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [snaps, setSnaps] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const years = data ?? [];
    if (!years.length) return;
    let cancelled = false;
    // طلب واحد مجمّع للقطات + عدّ الحركات عبر التاريخ، بدل طلب لكل سنة
    // (كان يطلق طلب year_snapshots لكل سنة ويفشل بـ 406 عند غياب اللقطة).
    void (async () => {
      try {
        const [snapIds, counts] = await Promise.all([
          yearsWithSnapshots(years.map((y) => y.id)),
          Promise.all(years.map((y) => movementsCountInRange(y.date_from, y.date_to))),
        ]);
        if (cancelled) return;
        setCounts(() => Object.fromEntries(years.map((y, i) => [y.id, counts[i]])));
        setSnaps(() => Object.fromEntries(years.map((y) => [y.id, snapIds.has(y.id)])));
      } catch {
        /* بيانات عرضية؛ تبقى القيم الافتراضية بلا تنبيهات كونسول */
      }
    })();
    return () => { cancelled = true; };
  }, [data]);

  const rows = useMemo(
    () => (data ?? []).map((y) => [String(y.year), y.date_from, y.date_to, y.status === "open" ? "مفتوحة ✅" : "مغلقة 🔒", String(counts[y.id] ?? 0), snaps[y.id] ? "يوجد 🖼️" : "لا يوجد"]),
    [data, counts, snaps]
  );

  const onToggle = async (id: number) => {
    const y = (data ?? []).find((x) => x.id === id);
    if (!y) return;
    if (y.status === "open") {
      if (!window.confirm(`إغلاق السنة ${y.year}؟\nلن يمكن بعد الإغلاق تسجيل أو تعديل حركات داخل نطاقها، وستُنشأ لقطة إغلاق (Snapshot) بالأرصدة والأرباح.`)) return;
      try {
        await setYearStatus(id, "closed");
        await createSnapshot(id);
        notify(`تم إغلاق سنة ${y.year} وإنشاء لقطة الإغلاق بنجاح.`, "success");
        qc.invalidateQueries({ queryKey: ["years"] });
      } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    } else {
      if (!window.confirm(`إعادة فتح السنة ${y.year}؟`)) return;
      try {
        await setYearStatus(id, "open");
        notify("تم فتح السنة بنجاح.", "success");
        qc.invalidateQueries({ queryKey: ["years"] });
      } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
    }
  };

  const onRollover = async (id: number) => {
    const y = (data ?? []).find((x) => x.id === id);
    if (!y || y.status !== "closed") return notify("أغلق السنة السابقة أولاً.", "error");
    const next = y.year + 1;
    try {
      const newId = await rolloverYear(id, next, `${next}-01-01`, `${next}-12-31`);
      notify(`تم إنشاء سنة ${next} وترحيل الأرصدة الافتتاحية بنجاح.`, "success");
      qc.invalidateQueries({ queryKey: ["years"] });
      return newId;
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  const onDelete = async (id: number) => {
    if (!window.confirm("هل أنت متأكد من حذف هذه السنة المالية؟")) return;
    try {
      await deleteYear(id);
      notify("تم الحذف بنجاح.", "success");
      qc.invalidateQueries({ queryKey: ["years"] });
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };

  return (
    <PageFrame title="جدول السنوات المالية" subtitle="لا يمكن تسجيل/تعديل/حذف أي حركة خارج نطاق سنة مالية مفتوحة"
      onAdd={() => setDialog({ mode: "add" })}
      exportBar={<ExportBar
        onExcel={() => exportPage({ title: "جدول السنوات المالية", headers, rows, mode: "excel" })}
        onPdf={() => exportPage({ title: "جدول السنوات المالية", headers, rows, mode: "pdf" })}
        onPrint={() => exportPage({ title: "جدول السنوات المالية", headers, rows, mode: "print" })} />}>
      {isLoading ? <Spinner /> : (
        <DataTable headers={headers} rows={rows} ids={(data ?? []).map((y) => y.id)}
          extra={[
            { key: "snapshot", label: "🖼️", title: "لقطة الإغلاق Snapshot" },
            { key: "toggle", label: "🔐", title: "إغلاق / فتح السنة" },
            { key: "rollover", label: "➕", title: "فتح السنة التالية وترحيل الأرصدة" },
          ]}
          onAction={(id, key) => {
            if (key === "view") setDialog({ mode: "view", id: Number(id) });
            else if (key === "edit") setDialog({ mode: "edit", id: Number(id) });
            else if (key === "delete") onDelete(Number(id));
            else if (key === "toggle") onToggle(Number(id));
            else if (key === "rollover") onRollover(Number(id));
            else if (key === "snapshot") {
              const y = (data ?? []).find((x) => x.id === Number(id));
              if (y) setSnapshot({ id: y.id, year: y.year });
            }
          }} />
      )}
      {dialog && <YearDialog id={dialog.id} readOnly={dialog.mode === "view"} onClose={(saved) => { setDialog(null); if (saved) qc.invalidateQueries({ queryKey: ["years"] }); }} />}
      {snapshot && <SnapshotDialog yearId={snapshot.id} year={snapshot.year} onClose={(saved) => { setSnapshot(null); if (saved) qc.invalidateQueries({ queryKey: ["years"] }); }} />}
    </PageFrame>
  );
}
