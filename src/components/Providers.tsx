"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            retry: 1,
            // البيانات تبقى «طازجة» دقيقتين: العودة لقسم سبق فتحه تعرضه فوراً
            // من الذاكرة بلا شاشة تحميل، والتحديث يتم عند الحفظ (invalidate) أو
            // بزرّ التحديث في شريط الأدوات.
            staleTime: 120_000,
            gcTime: 30 * 60_000,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
