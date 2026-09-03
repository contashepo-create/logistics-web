"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// يمنع تكرار React Strict Mode وإعادة تركيب التخطيط أثناء التنقل. عند إعادة تحميل
// الصفحة يبدأ bundle جديد، لكن Cookie الخادم نفسها تمنع زيادة الزوار الفريدين.
let visitSentForThisLoad = false;

/**
 * يُركّب مرة واحدة في Root Layout؛ تنقل Next.js بين الأقسام لا يعيد احتساب
 * زائر جديد. وحتى عند إعادة التحميل تتعرف API إلى Cookie الجهاز نفسها.
 */
export default function VisitorTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/zerocold") || visitSentForThisLoad) return;
    visitSentForThisLoad = true;
    fetch("/api/visits", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => undefined);
    // لا نضيف pathname للتبعيات عمداً: المطلوب تسجيل تحميل التطبيق فقط، لا كل صفحة.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
