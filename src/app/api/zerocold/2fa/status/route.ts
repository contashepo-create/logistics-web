import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/supabase";
import { verifyTwoFactorToken, COOKIE_NAME, hasSessionSecret } from "@/lib/server/admin-session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ success: false, message: "غير مصرح لك." }, { status: 403 });
  }
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const ok = verifyTwoFactorToken(token, admin.email);
  const reason = !hasSessionSecret()
    ? "no-secret"      // سر الخادم غير مضبوط ⇒ لا يمكن الوثوق بأي جلسة
    : !token
      ? "no-cookie"    // الكوكي غير موجود (جلسة جديدة أو مُسحت)
      : ok
        ? "ok"
        : "invalid";   // كوكي قديم/موقّع بسر مختلف
  return NextResponse.json({ success: true, verified: ok, reason });
}
