import { NextRequest, NextResponse } from "next/server";
import { requireUser, userClient, extractAccessToken } from "@/lib/server/supabase";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { notifyAdmin, notifyAdminWithPhoto, escapeTelegramHtml } from "@/lib/server/telegram";

export const runtime = "nodejs";

/**
 * إشعار المطوّر بطلب اشتراك جديد. يتلقى request_id فقط، ويقرأ تفاصيل الطلب
 * من قاعدة البيانات تحت RLS (بيانات الشركة نفسها) — لا يثق بأي محتوى من العميل.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`notify:${ip}`, 10, 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, message: "طلبات كثيرة جداً." }, { status: 429 });
  }

  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ success: false, message: "يجب تسجيل الدخول." }, { status: 401 });
  }

  let requestId = "";
  try {
    const body = await req.json();
    requestId = typeof body.request_id === "string" ? body.request_id : "";
  } catch {
    return NextResponse.json({ success: false, message: "طلب غير صالح." }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return NextResponse.json({ success: false, message: "معرّف غير صالح." }, { status: 400 });
  }

  const token = extractAccessToken(req)!;
  const sb = userClient(token);

  const { data: reqData } = await sb
    .from("activation_requests")
    .select("id, plan_type, status, receipt_url, notes, created_at, company_id")
    .eq("id", requestId)
    .maybeSingle();

  if (!reqData) {
    return NextResponse.json({ success: false, message: "الطلب غير موجود." }, { status: 404 });
  }

  const { data: company } = await sb.from("companies").select("name").eq("id", reqData.company_id).maybeSingle();

  const planLabel = reqData.plan_type === "yearly" ? "سنوي" : "شهري";
  const caption = [
    "🆕 <b>طلب اشتراك جديد</b>",
    `🏢 الشركة: <b>${escapeTelegramHtml(company?.name || "—")}</b>`,
    `📦 الباقة: <b>${planLabel}</b>`,
    `📅 التاريخ: ${escapeTelegramHtml(String(reqData.created_at || "").slice(0, 10))}`,
  ];
  if (reqData.notes) caption.push(`📝 ملاحظة: ${escapeTelegramHtml(String(reqData.notes).slice(0, 300))}`);

  const text = caption.join("\n") + "\n\n📎 راجع الطلب من لوحة المطوّر وقم بالموافقة أو الرفض.";

  // إن وُجد وصل (رابط عام) يُرسل كصورة مع الشرح
  const receiptUrl = typeof reqData.receipt_url === "string" && reqData.receipt_url ? reqData.receipt_url : null;
  const ok = receiptUrl
    ? await notifyAdminWithPhoto(text, receiptUrl)
    : await notifyAdmin(text);

  return NextResponse.json({ success: true, notified: ok });
}
