import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/supabase";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { verifyOtp, clearOtp } from "@/lib/server/otp-store";
import { createTwoFactorToken, COOKIE_NAME, COOKIE_OPTIONS, sameOrigin } from "@/lib/server/admin-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`2fa-verify:${ip}`, 10, 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, message: "محاولات كثيرة. حاول بعد قليل." }, { status: 429 });
  }

  if (!sameOrigin(req)) {
    return NextResponse.json({ success: false, message: "طلب مرفوض (أصل غير موثوق)." }, { status: 403 });
  }

  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ success: false, message: "غير مصرح لك." }, { status: 403 });
  }

  let code = "";
  try {
    const body = await req.json();
    code = typeof body.code === "string" ? body.code.trim() : "";
  } catch {
    return NextResponse.json({ success: false, message: "طلب غير صالح." }, { status: 400 });
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ success: false, message: "أدخل رمزاً مكوّناً من 6 أرقام." }, { status: 400 });
  }

  const result = verifyOtp(admin.email, code);
  if (!result.ok) {
    if (result.reason === "locked") {
      clearOtp(admin.email);
      return NextResponse.json({ success: false, message: "تم تجاوز عدد المحاولات. أعد إرسال الرمز." }, { status: 429 });
    }
    if (result.reason === "expired") {
      return NextResponse.json({ success: false, message: "انتهت صلاحية الرمز. أعد الإرسال." }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, message: result.reason === "missing" ? "أرسل الرمز أولاً." : "رمز التحقق غير صحيح." },
      { status: 401 }
    );
  }

  const token = createTwoFactorToken(admin.email);
  const res = NextResponse.json({ success: true, message: "تم التحقق بنجاح." });
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
  return res;
}
