import { NextRequest, NextResponse } from "next/server";
import {
  extractAccessToken,
  hasServiceKey,
  requireAdmin,
  serviceClient,
  userClient,
  verifyCurrentUserPassword,
} from "@/lib/server/supabase";
import { COOKIE_NAME, sameOrigin, verifyTwoFactorToken } from "@/lib/server/admin-session";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { checkPassword, safeCompanyName, safeEmail, safePhone } from "@/lib/security";
import { isPermissionError } from "@/lib/db";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad = (message: string, status = 400) => NextResponse.json({ success: false, message }, { status });

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already") || m.includes("registered") || m.includes("exists")) {
    return "البريد الإلكتروني مستخدم في حساب آخر.";
  }
  if (m.includes("password")) return "كلمة المرور الجديدة لا تحقق متطلبات الأمان.";
  return message || "تعذّر تعديل حساب العميل.";
}

/** تعديل هوية الشركة/حساب مالكها وإعادة ضبط بيانات عملها — للمطوّر وحده. */
export async function POST(req: NextRequest) {
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
  const action = String(body.action ?? "");
  const ip = clientIp(req);

  if (action === "reset") {
    if (!rateLimit(`adm:company-reset:${admin.id}:${ip}`, 5, 10 * 60_000).allowed) {
      return bad("تم تجاوز عدد محاولات إعادة الضبط. انتظر قليلاً ثم أعد المحاولة.", 429);
    }

    const confirmName = String(body.confirm_name ?? "").trim();
    const password = String(body.developer_password ?? "");
    if (!confirmName || !password) return bad("اكتب اسم الشركة وكلمة مرور المطوّر للتأكيد.");

    // نقرأ الاسم عبر جلسة المطوّر؛ تنفيذ RPC نفسه يعيد التحقق من is_admin().
    const token = extractAccessToken(req);
    if (!token) return bad("انتهت جلسة الدخول.", 401);
    const sb = userClient(token);
    // المسار الأساسي: قراءة مباشرة عبر RLS (يحق للمطوّر رؤية كل الشركات).
    // المسار الاحتياطي: إن فشلت القراءة بصلاحية ناقصة (permission denied)
    // نقرأ بمفتاح الخدمة على الخادم بعد تأكدنا من أن الجلسة للمطوّر + 2FA،
    // فلا يتعطّل التصفير بسبب خلل صلاحيات على قاعدة بيانات قديمة.
    let { data: company, error: companyError } = await sb
      .from("companies").select("id, name").eq("id", companyId).maybeSingle();
    if (companyError && hasServiceKey()) {
      const svc = serviceClient();
      const fallback = await svc.from("companies").select("id, name").eq("id", companyId).maybeSingle();
      company = fallback.data;
      companyError = fallback.error;
    }
    if (companyError) return bad(companyError.message, 500);
    if (!company) return bad("الشركة غير موجودة.", 404);
    if (confirmName !== company.name) return bad("اسم الشركة غير مطابق. اكتب الاسم كما يظهر تماماً.");

    const passwordValid = await verifyCurrentUserPassword(admin.email, password);
    if (!passwordValid) return bad("كلمة مرور المطوّر غير صحيحة.", 401);

    if (!hasServiceKey()) return bad("مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط على الخادم.", 503);

    // serviceClient: أكثر موثوقية من JWT للعمليات الإدارية المدمّرة
    const adminSb = serviceClient();
    const { data, error } = await adminSb.rpc("admin_reset_company_data_v18", {
      p_company_id: companyId,
    });
    if (error) {
      if (isPermissionError(error.message)) {
        return bad(
          "صلاحية تنفيذ دالة التصفير ناقصة في قاعدة البيانات. نفّذ ملف " +
            "supabase/migration_fix_admin_rpc_grants_v21.sql ثم supabase/migration_fix_database_health_v22.sql في Supabase SQL Editor ثم أعد المحاولة.",
          500,
        );
      }
      return bad(error.message, 500);
    }
    return NextResponse.json({ success: true, result: data });
  }

  if (action !== "update") return bad("إجراء غير معروف.");
  if (!rateLimit(`adm:company-update:${admin.id}:${ip}`, 30, 10 * 60_000).allowed) {
    return bad("طلبات تعديل كثيرة جداً. انتظر قليلاً ثم أعد المحاولة.", 429);
  }
  if (!hasServiceKey()) return bad("مفتاح SUPABASE_SERVICE_ROLE_KEY غير مضبوط على الخادم.", 503);

  let name: string;
  let phone: string;
  let email: string;
  try {
    name = safeCompanyName(body.name);
    phone = safePhone(body.phone, true);
    email = safeEmail(body.email, true);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "البيانات غير صالحة.");
  }
  const newPassword = String(body.new_password ?? "");
  if (newPassword) {
    const checked = checkPassword(newPassword);
    if (!checked.ok) return bad(checked.message);
  }

  const sb = serviceClient();
  const { data: company, error: companyError } = await sb
    .from("companies").select("id, name, phone, email").eq("id", companyId).maybeSingle();
  if (companyError) return bad(companyError.message, 500);
  if (!company) return bad("الشركة غير موجودة.", 404);

  const { data: owner, error: ownerError } = await sb
    .from("profiles")
    .select("id, email, phone")
    .eq("company_id", companyId)
    .eq("role", "owner")
    .maybeSingle();
  if (ownerError) return bad(ownerError.message, 500);
  if (!owner) return bad("حساب مالك الشركة غير موجود.", 409);

  const oldCompany = { name: company.name, phone: company.phone, email: company.email };
  const oldOwner = { email: owner.email, phone: owner.phone };

  const { error: updateCompanyError } = await sb.from("companies").update({ name, phone, email }).eq("id", companyId);
  if (updateCompanyError) return bad(updateCompanyError.message, 500);

  const { error: updateProfileError } = await sb.from("profiles").update({ email, phone }).eq("id", owner.id);
  if (updateProfileError) {
    await sb.from("companies").update(oldCompany).eq("id", companyId);
    return bad(updateProfileError.message, 500);
  }

  const authChanges: { email?: string; password?: string; email_confirm?: boolean; user_metadata?: Record<string, string> } = {
    user_metadata: { phone },
  };
  if (email.toLowerCase() !== String(owner.email ?? "").toLowerCase()) {
    authChanges.email = email;
    authChanges.email_confirm = true;
  }
  if (newPassword) authChanges.password = newPassword;

  const { error: authError } = await sb.auth.admin.updateUserById(owner.id, authChanges);
  if (authError) {
    // محاولة تعويض تحديث قاعدة البيانات؛ كلمة المرور لم تتغير لأن Auth رفض الطلب.
    await Promise.all([
      sb.from("companies").update(oldCompany).eq("id", companyId),
      sb.from("profiles").update(oldOwner).eq("id", owner.id),
    ]);
    return bad(friendlyAuthError(authError.message), 400);
  }

  await sb.from("activity_logs").insert({
    actor_id: admin.id,
    actor_email: admin.email,
    action: "admin.update_company_identity",
    entity: "company",
    entity_id: companyId,
    detail: `name=${name}; email=${email}; password_changed=${Boolean(newPassword)}`,
  });

  return NextResponse.json({ success: true });
}
