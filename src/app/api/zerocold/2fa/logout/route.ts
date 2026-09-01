import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, COOKIE_OPTIONS, sameOrigin } from "@/lib/server/admin-session";

export const runtime = "nodejs";

/** إنهاء جلسة التحقق بخطوتين ومسح الكوكي فوراً. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ success: false, message: "طلب مرفوض." }, { status: 403 });
  }
  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
