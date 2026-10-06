"use client";

import { useParams } from "next/navigation";
import { PageFrame } from "@/components/ui";
import InvoiceFullForm from "@/components/InvoiceFullForm";

export default function EditInvoicePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  return (
    <PageFrame title="تعديل فاتورة نقل">
      <InvoiceFullForm invoiceId={Number.isFinite(id) && id > 0 ? id : undefined} />
    </PageFrame>
  );
}
