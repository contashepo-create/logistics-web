import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, serviceClient, hasServiceKey } from "@/lib/server/supabase";
import { COOKIE_NAME, sameOrigin, verifyTwoFactorToken } from "@/lib/server/admin-session";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/features";
import { isPermissionError } from "@/lib/db";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad = (message: string, status = 400) => NextResponse.json({ success: false, message }, { status });

/** دالة RPC غير موجودة في القاعدة — ترحيلة ناقصة وليست خطأ بيانات. */
function isMissingRpc(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("could not find the function") || m.includes("does not exist") || m.includes("schema cache");
}

/** خطأ EXECUTE ناقص للدور authenticated (إعادة تشغيل v8 على قاعدة أحدث) — رسالة إجرائية. */
function rpcError(message: string, status: number) {
  if (isPermissionError(message)) {
    return bad(
      "صلاحيات قاعدة البيانات غير مكتملة. نفّذ ملف " +
        "supabase/migration_fix_admin_rpc_grants_v21.sql في Supabase SQL Editor ثم أعد المحاولة.",
      status,
    );
  }
  return bad(message, status);
}

/** قراءة/تعديل مميزات شركة — مطوّر + جلسة 2FA فقط. */
export async function POST(req: NextRequest) {
  if (!rateLimit(`adm:features:${clientIp(req)}`, 120, 60_000).allowed) return bad("طلبات كثيرة جداً.", 429);
  if (!sameOrigin(req)) return bad("طلب مرفوض (أصل غير موثوق).", 403);

  const admin = await requireAdmin(req);
  if (!admin) return bad("غير مصرح لك.", 403);
  const twoFactor = req.cookies.get(COOKIE_NAME)?.value;
  if (!verifyTwoFactorToken(twoFactor, admin.email)) return bad("مطلوب التحقق بخطوتين.", 401);

  if (!hasServiceKey()) return bad("مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط على الخادم.", 503);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return bad("طلب غير صالح."); }

  const companyId = String(body.company_id ?? "");
  if (!UUID_RE.test(companyId)) return bad("معرّف الشركة غير صالح.");

  // serviceClient: أكثر موثوقية من JWT (لا ينتهي ولا يتأثر بـ refresh tokens)
  // الأمان محفوظ: requireAdmin + 2FA أعلاه + is_admin() داخل الدالة.
  const sb = serviceClient();

  const action = String(body.action ?? "get");
  if (action === "get") {
    // SECURITY DEFINER RPC تتحقق من is_admin() داخلياً؛ لا توجد قراءة مباشرة
    // من companies/profiles، لذلك لا يظهر خطأ permission denied for companies.
    const { data, error } = await sb.rpc("admin_get_company_extras_v18", {
      p_company_id: companyId,
    });
    if (error) return rpcError(error.message, error.message.includes("غير موجودة") ? 404 : 500);

    const snapshot = (data ?? {}) as {
      features?: Record<string, boolean>;
      users?: Array<Record<string, unknown>>;
      max_additional_users?: number;
      used_additional_users?: number;
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
    // القاعدة قبل ترحيلة v25 لا ترجع الحد؛ الافتراضي الآمن مستخدم واحد.
    const maxAdditional = Number.isFinite(snapshot.max_additional_users)
      ? Math.max(0, Math.min(10, Number(snapshot.max_additional_users)))
      : 1;
    const usedAdditional = Number.isFinite(snapshot.used_additional_users)
      ? Number(snapshot.used_additional_users)
      : users.filter((u) => u.role === "additional").length;

    return NextResponse.json({
      success: true,
      features,
      users,
      max_additional_users: maxAdditional,
      used_additional_users: usedAdditional,
    });
  }

  if (action === "set_user_limit") {
    const max = Number(body.max);
    if (!Number.isInteger(max) || max < 0 || max > 10) {
      return bad("عدد المستخدمين الإضافيين يجب أن يكون بين 0 و10.");
    }
    const { error } = await sb.rpc("admin_set_company_user_limit_v25", {
      p_company_id: companyId,
      p_max: max,
    });
    if (error) {
      if (isMissingRpc(error.message)) {
        return bad(
          "دالة ضبط عدد المستخدمين غير موجودة. نفّذ ملف " +
            "supabase/migration_multi_company_users_v25.sql في Supabase SQL Editor ثم أعد المحاولة.",
          500,
        );
      }
      return rpcError(error.message, 400);
    }
    return NextResponse.json({ success: true });
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
    if (error) return rpcError(error.message, 500);
    return NextResponse.json({ success: true });
  }

  return bad("إجراء غير معروف.");
}
