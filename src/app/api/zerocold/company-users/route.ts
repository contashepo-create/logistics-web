import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, serviceClient, hasServiceKey } from "@/lib/server/supabase";
import { COOKIE_NAME, sameOrigin, verifyTwoFactorToken } from "@/lib/server/admin-session";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { checkPassword, checkSignupEmail, safePersonName, safePhone } from "@/lib/security";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad = (message: string, status = 400) => NextResponse.json({ success: false, message }, { status });

/** جدول/دالة غير موجودة في القاعدة — ترحيلة ناقصة وليست خطأ بيانات. */
function isMissingRelation(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("does not exist") || m.includes("could not find the table") || m.includes("schema cache");
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already") || m.includes("registered") || m.includes("exists")) return "البريد الإلكتروني مستخدم في حساب آخر.";
  if (m.includes("password")) return "كلمة المرور لا تحقق متطلبات الأمان.";
  // GoTrue يخفي رسالة أي مشغّل على auth.users خلف رسالة عامة واحدة.
  if (m.includes("database error")) {
    return "تعذّر إنشاء الحساب بسبب قيود قاعدة البيانات (مشغّل تحقق التسجيل على auth.users). شغّل ملف supabase/migration_fix_additional_user_creation_v24.sql في Supabase SQL Editor ثم أعد المحاولة.";
  }
  return message || "تعذّر إنشاء حساب المستخدم.";
}

/** حد المستخدمين الإضافيين لشركة، مع افتراض آمن قبل تشغيل ترحيلة v25. */
function userLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(Math.trunc(n), 10);
}

/**
 * يعيد ضبط ميزة additional_user لتعكس الواقع: مفعّلة ما دام هناك مستخدم إضافي
 * نشط واحد على الأقل. مع تعدّد المستخدمين لم يعد جائزاً أن يُطفئ إيقافُ حسابٍ
 * واحد الوصولَ عن بقية الحسابات، لأن الميزة بوابة على مستوى الشركة في RLS.
 */
async function syncAdditionalFeature(
  sb: ReturnType<typeof serviceClient>,
  companyId: string,
  adminId: string,
): Promise<string | null> {
  const { count, error } = await sb
    .from("profiles").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).eq("role", "additional").eq("is_active", true);
  if (error) return error.message;

  const { error: featureError } = await sb.from("company_features").upsert({
    company_id: companyId,
    feature_key: "additional_user",
    enabled: (count ?? 0) > 0,
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_id,feature_key" });
  return featureError?.message ?? null;
}

/** كل عمليات المستخدم الإضافي حساسة وتُنفذ حصراً من الخادم بمفتاح الخدمة. */
export async function POST(req: NextRequest) {
  if (!rateLimit(`adm:company-users:${clientIp(req)}`, 40, 60_000).allowed) return bad("طلبات كثيرة جداً.", 429);
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

  const sb = serviceClient();
  let { data: company, error: companyError } = await sb
    .from("companies").select("id, name, max_additional_users").eq("id", companyId).maybeSingle();
  if (companyError && isMissingRelation(companyError.message)) {
    // قاعدة لم تُشغَّل عليها ترحيلة v25 بعد: الحد الافتراضي مستخدم واحد.
    ({ data: company, error: companyError } = await sb
      .from("companies").select("id, name").eq("id", companyId).maybeSingle());
  }
  if (companyError) return bad(companyError.message, 500);
  if (!company) return bad("الشركة غير موجودة.", 404);

  const action = String(body.action ?? "");

  if (action === "create") {
    let name: string;
    let phone: string;
    try {
      name = safePersonName(body.name, "اسم المستخدم");
      phone = safePhone(body.phone, true);
    } catch (e) {
      return bad(e instanceof Error ? e.message : "البيانات غير صالحة.");
    }

    const emailCheck = checkSignupEmail(String(body.email ?? ""));
    if (!emailCheck.ok) return bad(emailCheck.message);
    const password = String(body.password ?? "");
    const passwordCheck = checkPassword(password);
    if (!passwordCheck.ok) return bad(passwordCheck.message);

    // الحد لكل شركة (v25). العمود قد يكون غائباً قبل تشغيل الترحيلة، فنعود
    // إلى القيمة القديمة (مستخدم واحد) بدل رفض العملية.
    const limit = userLimit(company.max_additional_users);
    const { count: usedCount, error: existingError } = await sb
      .from("profiles").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).eq("role", "additional");
    if (existingError) return bad(existingError.message, 500);
    const used = usedCount ?? 0;
    if (used >= limit) {
      return bad(
        limit === 0
          ? "المستخدمون الإضافيون غير مسموح بهم لهذه الشركة."
          : `بلغت هذه الشركة الحد المسموح به للمستخدمين الإضافيين (${limit}). ارفع الحد أولاً أو احذف حساباً قائماً.`,
        409,
      );
    }

    const { data: phoneOwner, error: phoneError } = await sb
      .from("profiles").select("id").eq("phone", phone).maybeSingle();
    if (phoneError) return bad(phoneError.message, 500);
    if (phoneOwner) return bad("رقم الهاتف مستخدم في حساب آخر.", 409);

    // تذكرة إنشاء خادمية (v24): GoTrue تكتب app_metadata بعد الإدراج بـ UPDATE
    // منفصل، فلا يراها مشغّل BEFORE INSERT على auth.users ويطبّق تحققات المالك
    // على المستخدم الإضافي فيفشل بـ «Database error creating new user».
    // التذكرة تُقرأ بالبريد وقت الإدراج، وتُستهلك مرة واحدة، ولا يمكن تزويرها
    // من المتصفح (RLS بلا سياسات + service_role فقط).
    const ticket = {
      email: emailCheck.email,
      company_id: companyId,
      requested_by: admin.id,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      consumed_at: null,
    };
    const { error: ticketError } = await sb
      .from("managed_signups").upsert(ticket, { onConflict: "email" });
    if (ticketError) {
      return bad(
        isMissingRelation(ticketError.message)
          ? "جدول تذاكر الإنشاء غير موجود. نفّذ ملف supabase/migration_fix_additional_user_creation_v24.sql في Supabase SQL Editor ثم أعد المحاولة."
          : ticketError.message,
        500,
      );
    }

    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email: emailCheck.email,
      password,
      email_confirm: true,
      user_metadata: { name, phone },
      // مسار احتياطي فقط؛ لا تصل إلى مشغّل الإدراج (انظر التذكرة أعلاه).
      app_metadata: { managed_by_developer: true },
    });
    if (authError || !authData.user) {
      await sb.from("managed_signups").delete().eq("email", emailCheck.email);
      return bad(friendlyAuthError(authError?.message ?? ""), 400);
    }
    await sb.from("managed_signups").delete().eq("email", emailCheck.email);

    const userId = authData.user.id;
    const profile = {
      id: userId,
      company_id: companyId,
      name,
      email: emailCheck.email,
      phone,
      role: "additional",
      is_active: true,
    } as const;

    const { error: profileError } = await sb.from("profiles").insert(profile);
    if (profileError) {
      await sb.auth.admin.deleteUser(userId).catch(() => undefined);
      return bad(
        profileError.code === "23505"
          ? "البريد أو الهاتف مستخدم في حساب آخر."
          : profileError.message,
        409,
      );
    }

    const featureError = await syncAdditionalFeature(sb, companyId, admin.id);
    if (featureError) {
      await sb.auth.admin.deleteUser(userId).catch(() => undefined);
      return bad(featureError, 500);
    }

    await sb.from("activity_logs").insert({
      actor_id: admin.id,
      actor_email: admin.email,
      action: "admin.create_additional_user",
      entity: "profile",
      entity_id: userId,
      detail: `${companyId} | ${emailCheck.email}`,
    });

    return NextResponse.json({ success: true, user: profile });
  }

  const userId = String(body.user_id ?? "");
  if (!UUID_RE.test(userId)) return bad("معرّف المستخدم غير صالح.");
  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("id, company_id, name, email, phone, role, is_active, created_at")
    .eq("id", userId).eq("company_id", companyId).eq("role", "additional").maybeSingle();
  if (profileError) return bad(profileError.message, 500);
  if (!profile) return bad("المستخدم الإضافي غير موجود.", 404);

  if (action === "status") {
    if (typeof body.active !== "boolean") return bad("حالة المستخدم غير صالحة.");
    const active = body.active;
    const oldActive = profile.is_active !== false;

    const { error: statusError } = await sb.from("profiles").update({ is_active: active }).eq("id", userId);
    if (statusError) return bad(statusError.message, 500);

    const featureError = await syncAdditionalFeature(sb, companyId, admin.id);
    if (featureError) {
      await sb.from("profiles").update({ is_active: oldActive }).eq("id", userId);
      return bad(featureError, 500);
    }

    await sb.from("activity_logs").insert({
      actor_id: admin.id,
      actor_email: admin.email,
      action: active ? "admin.activate_additional_user" : "admin.deactivate_additional_user",
      entity: "profile",
      entity_id: userId,
      detail: companyId,
    });
    return NextResponse.json({ success: true });
  }

  if (action === "delete") {
    // نحذف أولاً ثم نزامن الميزة: الإطفاء المسبق كان يقطع الوصول عن بقية
    // المستخدمين الإضافيين للشركة نفسها.
    const { error: deleteError } = await sb.auth.admin.deleteUser(userId);
    if (deleteError) return bad(friendlyAuthError(deleteError.message), 500);

    const featureError = await syncAdditionalFeature(sb, companyId, admin.id);
    if (featureError) return bad(featureError, 500);

    await sb.from("activity_logs").insert({
      actor_id: admin.id,
      actor_email: admin.email,
      action: "admin.delete_additional_user",
      entity: "profile",
      entity_id: userId,
      detail: `${companyId} | ${profile.email}`,
    });
    return NextResponse.json({ success: true });
  }

  return bad("إجراء غير معروف.");
}
