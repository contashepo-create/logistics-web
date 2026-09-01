import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { hasServiceKey } from "@/lib/server/supabase";
import { createComplaint, trackComplaint, replyToComplaint } from "@/lib/server/complaints";
import { notifyAdmin, escapeTelegramHtml } from "@/lib/server/telegram";
import { sameOrigin } from "@/lib/server/admin-session";

export const runtime = "nodejs";

const bad = (message: string, status = 400) => NextResponse.json({ success: false, message }, { status });

async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  const type = req.headers.get("content-type") || "";
  if (!type.includes("application/json")) return null;
  const raw = await req.text();
  if (raw.length > 20_000) return null;      // منع الأجسام الضخمة
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

/**
 * نقطة واحدة لثلاث عمليات عامة (بلا تسجيل دخول):
 *   action=create  → إنشاء شكوى وإرجاع رقم تتبّع عشوائي
 *   action=track   → عرض الشكوى (يتطلب الرقم + البريد معاً)
 *   action=reply   → رد الزائر على شكواه
 * جميعها مقيّدة بالمعدل ومحميّة بحقل فخّ (honeypot) وتعقيم كامل للمدخلات.
 */
export async function POST(req: NextRequest) {
  if (!hasServiceKey()) return bad("خدمة الشكاوى غير مهيأة على الخادم.", 503);

  if (!sameOrigin(req)) return bad("طلب مرفوض (أصل غير موثوق).", 403);

  const ip = clientIp(req);
  const body = await readJson(req);
  if (!body) return bad("صيغة الطلب غير صالحة.");

  // حقل فخّ: تملؤه الروبوتات فقط
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ success: true, ticket: "CT-XXXXXXXXXX" });
  }

  const action = String(body.action ?? "");

  try {
    if (action === "create") {
      if (!rateLimit(`ct:create:${ip}`, 3, 60 * 60 * 1000).allowed) {
        return bad("لا يمكن إرسال أكثر من ٣ شكاوى في الساعة.", 429);
      }
      const { ticket } = await createComplaint({
        name: body.name, email: body.email, phone: body.phone,
        subject: body.subject, body: body.body, ip,
      });
      await notifyAdmin(
        `📨 <b>شكوى جديدة</b>\n🔖 رقم التتبع: <code>${escapeTelegramHtml(ticket)}</code>\n` +
        `👤 ${escapeTelegramHtml(String(body.name ?? ""))}\n📧 ${escapeTelegramHtml(String(body.email ?? ""))}\n` +
        `📝 ${escapeTelegramHtml(String(body.subject ?? "")).slice(0, 200)}`
      );
      return NextResponse.json({ success: true, ticket });
    }

    if (action === "track") {
      if (!rateLimit(`ct:track:${ip}`, 20, 10 * 60 * 1000).allowed) {
        return bad("محاولات كثيرة. حاول بعد قليل.", 429);
      }
      const thread = await trackComplaint(body.ticket, body.email);
      return NextResponse.json({ success: true, complaint: thread });
    }

    if (action === "reply") {
      if (!rateLimit(`ct:reply:${ip}`, 10, 60 * 60 * 1000).allowed) {
        return bad("ردود كثيرة. حاول لاحقاً.", 429);
      }
      const thread = await replyToComplaint(body.ticket, body.email, body.body);
      await notifyAdmin(`💬 رد جديد على الشكوى <code>${escapeTelegramHtml(thread.ticket)}</code>`);
      return NextResponse.json({ success: true, complaint: thread });
    }

    return bad("إجراء غير معروف.");
  } catch (e) {
    return bad(e instanceof Error ? e.message : "تعذّر تنفيذ الطلب.");
  }
}
