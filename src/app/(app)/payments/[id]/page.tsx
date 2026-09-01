"use client";

import { useParams, useSearchParams } from "next/navigation";
import { PaymentPageForm } from "@/components/PaymentPageForm";

export default function PaymentDetailsPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = Number(params.id);
  const readOnly = search.get("mode") === "view";

  if (!Number.isSafeInteger(id) || id <= 0) return <div className="page-card">رقم سند الدفع غير صالح.</div>;
  return <PaymentPageForm id={id} readOnly={readOnly} />;
}
