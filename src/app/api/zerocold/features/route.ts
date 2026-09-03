import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, userClient, extractAccessToken } from "@/lib/server/supabase";
import { COOKIE_NAME, sameOrigin, verifyTwoFactorToken } from "@/lib/server/admin-session";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/features";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad = (message: string, status = 400) => NextResponse.json({ success: false, message }, { status });

/** قراءة/تعديل مميزات شركة — مطوّر + جلسة 2FA فقط. */
export async function POST(req: NextRequest) {
  if (!rateLimit(`adm:features:${clientIp(req)}`, 120, 60_000).allowed) return bad("طلبات كثيرة جداً.", 429);
  if (!sameOrigin(req)) return bad("طلب مرفوض (أصل غير موثوق).", 403);

  const admin = await requireAdmin(req);
  if (!admin) return bad("غير مصرح لك.", 403);
  const twoFactor = req.cookies.get(COOKIE_NAME)?.value;
  if (!verifyTwoFactorToken(twoFactor, admin.email)) return bad("مطلوب التحقق بخطوتين.", 401);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return bad("طلب غير صالح."); }

  const companyId = String(body.company_id ?? "");
  if (!UUID_RE.test(companyId)) return bad("معرّف الشركة غير صالح.");

  const token = extractAccessToken(req);
  if (!token) return bad("انتهت جلسة الدخول.", 401);
  const sb = userClient(token);

  const action = String(body.action ?? "get");
  if (action === "get") {
    // SECURITY DEFINER RPC تتحقق من is_admin() داخلياً؛ لا توجد قراءة مباشرة
    // من companies/profiles، لذلك لا يظهر خطأ permission denied for companies.
    const { data, error } = await sb.rpc("admin_get_company_extras_v18", {
      p_company_id: companyId,
    });
    if (error) return bad(error.message, error.message.includes("غير موجودة") ? 404 : 500);

    const snapshot = (data ?? {}) as {
      features?: Record<string, boolean>;
      users?: Array<Record<string, unknown>>;
    };
    const features: Record<FeatureKey, boolean> = {
      tax_invoice: snapshot.features?.tax_invoice === true,
      additional_user: snapshot.features?.additional_user === true,
    };
    const users = (snapshot.users ?? []).map((u) => ({
      ...u,
      role: u.role === "additional" ? "additional" : "owner",
      phone: String(u.phone ?? ""),
      is_active: u.is_active !== false,
    }));
    return NextResponse.json({ success: true, features, users });
  }

  if (action === "set") {
    const feature = String(body.feature_key ?? "") as FeatureKey;
    if (!(FEATURE_KEYS as readonly string[]).includes(feature)) return bad("الميزة غير معروفة.");
    if (typeof body.enabled !== "boolean") return bad("حالة الميزة غير صالحة.");

    // المستخدم الإضافي يُدار من مسار الحسابات حتى تبقى حالته متزامنة مع الميزة.
    if (feature === "additional_user") return bad("أدر ميزة المستخدم الإضافي من قسم المستخدمين.");

    const { error } = await sb.rpc("admin_set_company_feature", {
      p_company_id: companyId,
      p_feature_key: feature,
      p_enabled: body.enabled,
    });
    if (error) return bad(error.message, 500);
    return NextResponse.json({ success: true });
  }

  return bad("إجراء غير معروف.");
}
