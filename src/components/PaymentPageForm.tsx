"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { PaymentDialog } from "@/components/dialogs/operations";
import { Button, PageFrame } from "@/components/ui";

export function PaymentPageForm({ id, readOnly = false }: { id?: number; readOnly?: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const back = (saved = false) => {
    if (saved) {
      for (const key of ["payments", "report-trips", "report-pnl", "customers", "invoices", "cashbox", "bank", "advances-tracking"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    }
    router.push("/payments");
  };
  const title = id ? (readOnly ? "عرض سند دفع" : "تعديل سند دفع") : "سند دفع جديد";

  return (
    <PageFrame
      title={title}
      subtitle="صفحة كاملة قابلة للتمرير — السند لا يُعرض داخل نافذة منبثقة"
      exportBar={<Button onClick={() => back()}>↩ العودة إلى سندات الدفع</Button>}
    >
      <PaymentDialog id={id} readOnly={readOnly} embedded onClose={(saved) => back(Boolean(saved))} />
    </PageFrame>
  );
}
