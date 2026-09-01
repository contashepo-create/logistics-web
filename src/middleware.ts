import { NextResponse, type NextRequest } from "next/server";

/**
 * حماية على مستوى الحافة:
 *  • إسقاط ترويسة x-middleware-subrequest المزوّرة (CVE-2025-29927)
 *  • منع الطرق غير المستخدمة (TRACE/TRACK)
 *  • منع أجسام الطلبات الضخمة على مسارات JSON
 *  • منع فهرسة لوحة المطوّر
 * ملاحظة: الحماية الحقيقية للصلاحيات تتم داخل كل مسار API وفي RLS — هذه طبقة إضافية فقط.
 */
export function middleware(req: NextRequest) {
  if (req.headers.get("x-middleware-subrequest")) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (["TRACE", "TRACK", "CONNECT"].includes(req.method)) {
    return new NextResponse("Method Not Allowed", { status: 405 });
  }
  const len = Number(req.headers.get("content-length") || 0);
  const isUpload = req.nextUrl.pathname.startsWith("/api/subscription/request");
  if (len > (isUpload ? 5_000_000 : 100_000)) {
    return NextResponse.json({ success: false, message: "حجم الطلب كبير جداً." }, { status: 413 });
  }

  const res = NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/zerocold")) {
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
