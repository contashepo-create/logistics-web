// المصادقة وإدارة الجلسة (Supabase Auth) + الشركة والملف الشخصي.
// العزل عبر company_id: كل مستخدم يملك شركة واحدة، والمطوّر (ADMIN_EMAIL) بلا شركة.

import { supabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";
import type { Company, Profile } from "./types";
import { checkSignupEmail, checkPassword, sanitizeText } from "./security";
import { translateDbError } from "./db";

/**
 * البريد الإلكتروني للمطوّر — يمنح صاحبه لوحة تحكم خاصة.
 * يجب أن يطابق البريد المُرمَّز في supabase/schema.sql (دالة is_admin).
 */
export const ADMIN_EMAIL = (
  process.env.NEXT_PUBLIC_ADMIN_EMAIL || "conta.moha@gmail.com"
).trim().toLowerCase();

/** يمنع تعليق الواجهة إلى الأبد إن تعذّر الوصول للخادم. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`تعذّر إكمال ${label} — انتهت المهلة. تحقق من اتصالك ثم أعد المحاولة.`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export type AuthResult =
  | { ok: true; session: Session | null }
  | { ok: false; message: string };

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/** الاستماع لتغيّرات الجلسة. */
export function onAuthChange(cb: (session: Session | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    clearIdentityCache();
    cb(session);
  });
  return data.subscription;
}

/** تسجيل الدخول بالبريد وكلمة المرور. */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  return { ok: true, session: data.session };
}

/**
 * إنشاء حساب جديد ثم إنشاء الشركة عبر دالة خادمية محمية (register_company).
 * إذا كانت رسائل التأكيد مفعّلة فلن توجد جلسة فوراً — نعيد حالة "verify".
 */
export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  companyName: string;
  phone?: string;
}): Promise<AuthResult & { needsVerification?: boolean; needsOnboarding?: boolean }> {
  // منع أي بريد وهمي/مؤقت قبل مغادرة المتصفح (والتحقق مكرر في قاعدة البيانات)
  const em = checkSignupEmail(input.email);
  if (!em.ok) return { ok: false, message: em.message };
  const pw = checkPassword(input.password);
  if (!pw.ok) return { ok: false, message: pw.message };

  const name = sanitizeText(input.name, 120);
  const companyName = sanitizeText(input.companyName, 120);
  if (!companyName) return { ok: false, message: "اسم الشركة مطلوب." };

  const { data, error } = await withTimeout(supabase.auth.signUp({
    email: em.email,
    password: input.password,
    options: { data: { name, company_name: companyName } },
  }), 25000, "إنشاء الحساب");
  if (error) return { ok: false, message: error.message };

  if (!data.session) {
    // تأكيد البريد مطلوب — تُنشأ الشركة عند أول دخول بعد التأكيد
    return { ok: true, session: null, needsVerification: true };
  }

  try {
    await withTimeout(
      registerCurrentCompany({ companyName, name, phone: input.phone }),
      20000,
      "إنشاء الشركة"
    );
  } catch (e) {
    // الحساب أُنشئ لكن الشركة لم تُنشأ — نكمل عبر شاشة التهيئة بدل التعليق
    return { ok: true, session: data.session, needsOnboarding: true, message: e instanceof Error ? e.message : String(e) } as AuthResult & { needsOnboarding?: boolean; message?: string };
  }
  return { ok: true, session: data.session };
}

/** إنشاء شركة المستخدم الحالي (بعد التسجيل أو عند غيابها). */
export async function registerCurrentCompany(input: {
  companyName: string;
  name?: string;
  phone?: string;
}): Promise<string | null> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("register_company", {
        p_company_name: input.companyName,
        p_name: input.name ?? "",
        p_phone: input.phone ?? "",
      })
    ),
    20000,
    "إنشاء الشركة"
  );
  if (error) throw new Error(translateDbError(error.message));
  return (data as string) ?? null;
}

export { translateDbError } from "./db";

// ---------------------------------------------------------------------------
// كاش الهوية (الملف الشخصي + الشركة)
// ---------------------------------------------------------------------------
// الملف الشخصي وبيانات الشركة تُطلب عشرات المرات في كل شاشة (الإعدادات، ترويسة
// الفواتير، حالة الاشتراك…). بلا كاش كان كل انتقال بين الأقسام يُنفّذ رحلات شبكة
// متكرّرة فيظهر «جاري تحميل البيانات» في كل مرة. الكاش صالح لمدة قصيرة ويُبطَل
// عند تغيّر الجلسة أو تعديل بيانات الشركة.
// يُعطَّل الكاش في بيئة الاختبار حتى تُقرأ البيانات المزروعة حديثاً دائماً.
const CACHE_ENABLED = process.env.NODE_ENV !== "test";
const IDENTITY_TTL_MS = 60_000;
let profileCache: { at: number; value: Profile | null; promise?: Promise<Profile | null> } | null = null;
let companyCache: { at: number; value: Company | null; promise?: Promise<Company | null> } | null = null;

/** إبطال كاش الهوية (بعد تسجيل الدخول/الخروج أو تعديل بيانات الشركة). */
export function clearIdentityCache(): void {
  profileCache = null;
  companyCache = null;
}

const fresh = (c: { at: number } | null) => CACHE_ENABLED && !!c && Date.now() - c.at < IDENTITY_TTL_MS;

/** جلب الملف الشخصي للمستخدم الحالي (مع كاش قصير المدى). */
export async function getProfile(force = false): Promise<Profile | null> {
  if (!force && fresh(profileCache)) return profileCache!.value;
  if (!force && profileCache?.promise) return profileCache.promise;

  const promise = (async () => {
    const user = await getCurrentUser();
    if (!user) return null;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    // مهم: لا نبتلع الأخطاء. ابتلاعها كان يحوّل خطأ صلاحيات (403) إلى «لا يوجد
    // ملف شخصي» فيُعاد توجيه المستخدم إلى /onboarding في حلقة لا تنتهي.
    if (error) throw new Error(translateDbError(error.message));
    return (data as Profile) ?? null;
  })();

  profileCache = { at: Date.now(), value: null, promise };
  try {
    const value = await promise;
    profileCache = { at: Date.now(), value };
    return value;
  } catch (e) {
    profileCache = null;
    throw e;
  }
}

/** جلب شركة المستخدم الحالي (أو null للمطوّر) — مع كاش قصير المدى. */
export async function getCompany(force = false): Promise<Company | null> {
  if (!force && fresh(companyCache)) return companyCache!.value;
  if (!force && companyCache?.promise) return companyCache.promise;

  const promise = (async () => {
    const profile = await getProfile(force);
    if (!profile?.company_id) return null;
    const { data, error } = await supabase.from("companies").select("*").eq("id", profile.company_id).maybeSingle();
    // خطأ صلاحيات/شبكة ≠ «لا توجد شركة». التمييز بينهما ضروري وإلا دخل
    // المستخدم حلقة إنشاء شركة متكرّرة رغم امتلاكه شركة فعلاً.
    if (error) throw new Error(translateDbError(error.message));
    return (data as Company) ?? null;
  })();

  companyCache = { at: Date.now(), value: null, promise };
  try {
    const value = await promise;
    companyCache = { at: Date.now(), value };
    return value;
  } catch (e) {
    companyCache = null;
    throw e;
  }
}

export type SubscriptionStatus = "active" | "expired" | "suspended";

/** حالة الاشتراك الحالية للشركة. */
export function subscriptionStatus(c: Company | null): SubscriptionStatus {
  if (!c) return "expired";
  if (!c.is_active) return "suspended";
  if (!c.subscription_end) return "active"; // مفتوح
  const end = new Date(c.subscription_end);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end >= today ? "active" : "expired";
}

/** وصف حالة الاشتراك للعرض. */
export function subscriptionLabel(c: Company | null): string {
  const st = subscriptionStatus(c);
  if (st === "suspended") return "الشركة موقوفة";
  if (st === "expired") return "الاشتراك منتهي";
  if (c?.plan_type === "trial") return "الباقة التجريبية";
  if (c?.plan_type === "open") return "اشتراك مفتوح";
  if (c?.plan_type === "yearly") return "اشتراك سنوي";
  return "اشتراك شهري";
}

export async function signOut(): Promise<void> {
  clearIdentityCache();
  await supabase.auth.signOut();
}

/** هل المستخدم الحالي هو المطوّر؟ */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return (user.email ?? "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
