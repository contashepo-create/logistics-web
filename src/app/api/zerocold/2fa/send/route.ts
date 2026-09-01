import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/supabase";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { sendTelegramCode } from "@/lib/server/telegram";
import { issueOtp, canResend } from "@/lib/server/otp-store";
import { generateOtp } from "@/lib/server/admin-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // تقييد معدل الإرسال (يمنع إغراق التليجرام/الخادم)
  const rl = rateLimit(`2fa-send:${ip}`, 5, 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, message: "طلبات كثيرة جداً. حاول بعد قليل." }, { status: 429 });
  }

  // التحقق من هوية المطوّر (JWT صادر من Supabase)
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ success: false, message: "غير مصرح لك." }, { status: 403 });
  }

  if (!canResend(admin.email)) {
    return NextResponse.json({ success: false, message: "يرجى الانتظار دقيقة قبل إعادة الإرسال." }, { status: 429 });
  }

  const code = generateOtp();
  const sent = await sendTelegramCode(code);

  if (!sent) {
    return NextResponse.json(
      { success: false, message: "تعذّر إرسال الرمز عبر تليجرام. تأكد من إعداد البوت ثم أعد المحاولة." },
      { status: 503 }
    );
  }

  issueOtp(admin.email, code);
  return NextResponse.json({ success: true, message: "تم إرسال رمز التحقق إلى تليجرام." });
}
