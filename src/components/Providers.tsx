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
            // "always" = عند كل دخول لقسم (مونت مكوّن الصفحة) تُعرض البيانات
            // المخزّنة فوراً بلا شاشة تحميل، ثم يُجلب التحديث من الخادم في
            // الخلفية. هكذا يبقى التنقل سريعاً والبيانات لا تبقى قديمة — لا
            // حاجة لإعادة تحميل الصفحة لرؤية أحدث البيانات.
            refetchOnMount: "always",
            retry: 1,
            // بيانات الشركة/القوائم المرجعية نادرة التغيّر؛ الصلاحية هنا تؤثر
            // فقط على إعادة الجلب في الخلفية (التركيز/إعادة الاتصال) وليس على
            // التنقل بين الأقسام.
            staleTime: 120_000,
            gcTime: 30 * 60_000,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
