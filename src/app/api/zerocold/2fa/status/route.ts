import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/supabase";
import { verifyTwoFactorToken, COOKIE_NAME } from "@/lib/server/admin-session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ success: false, message: "غير مصرح لك." }, { status: 403 });
  }
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const ok = verifyTwoFactorToken(token, admin.email);
  return NextResponse.json({ success: true, verified: ok });
}
