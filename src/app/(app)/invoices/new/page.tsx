"use client";

import { PageFrame } from "@/components/ui";
import InvoiceFullForm from "@/components/InvoiceFullForm";

export default function NewInvoicePage() {
  return (
    <PageFrame title="إصدار فاتورة نقل">
      <InvoiceFullForm />
    </PageFrame>
  );
}
