import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, serviceClient, hasServiceKey } from "@/lib/server/supabase";
import { verifyTwoFactorToken, COOKIE_NAME, sameOrigin } from "@/lib/server/admin-session";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { safeField } from "@/lib/security";
import { notifyAdmin } from "@/lib/server/telegram";

export const runtime = "nodejs";

const bad = (message: string, status = 400) => NextResponse.json({ success: false, message }, { status });

function twoFactorOk(req: NextRequest, email: string): boolean {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return verifyTwoFactorToken(token, email);
}

/** إدارة الشكاوى — للمطوّر فقط (جلسة صحيحة + كوكي 2FA موقّع). */
export async function POST(req: NextRequest) {
  if (!hasServiceKey()) return bad("الخدمة غير مهيأة.", 503);
  if (!rateLimit(`adm:ct:${clientIp(req)}`, 60, 60_000).allowed) return bad("طلبات كثيرة.", 429);

  if (!sameOrigin(req)) return bad("طلب مرفوض (أصل غير موثوق).", 403);

  const admin = await requireAdmin(req);
  if (!admin) return bad("غير مصرح.", 403);
  if (!twoFactorOk(req, admin.email)) return bad("مطلوب التحقق بخطوتين.", 401);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return bad("طلب غير صالح."); }

  const sb = serviceClient();
  const action = String(body.action ?? "list");

  if (action === "list") {
    const { data } = await sb.from("complaints").select("*").order("created_at", { ascending: false }).limit(300);
    return NextResponse.json({ success: true, complaints: data ?? [] });
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("معرّف غير صالح.");

  if (action === "thread") {
    const { data } = await sb.from("complaint_messages").select("sender, body, created_at")
      .eq("complaint_id", id).order("created_at");
    return NextResponse.json({ success: true, messages: data ?? [] });
  }

  if (action === "reply") {
    let text: string;
    try { text = safeField(body.body, { label: "الرد", max: 4000, min: 2, required: true }); }
    catch (e) { return bad(e instanceof Error ? e.message : "رد غير صالح."); }
    await sb.from("complaint_messages").insert({ complaint_id: id, sender: "admin", body: text });
    await sb.from("complaints").update({ status: "answered", updated_at: new Date().toISOString() }).eq("id", id);
    await notifyAdmin("✅ تم إرسال رد على شكوى.");
    return NextResponse.json({ success: true });
  }

  if (action === "status") {
    const status = String(body.status ?? "");
    if (!["open", "answered", "closed"].includes(status)) return bad("حالة غير صالحة.");
    await sb.from("complaints").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ success: true });
  }

  return bad("إجراء غير معروف.");
}
