// المصادقة وإدارة الجلسة (Supabase Auth) + الشركة والملف الشخصي.
// العزل عبر company_id: كل مستخدم يملك شركة واحدة، والمطوّر (ADMIN_EMAIL) بلا شركة.

import { supabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";
import type { Company, Profile } from "./types";

/**
 * البريد الإلكتروني للمطوّر — يمنح صاحبه لوحة تحكم خاصة.
 * يجب أن يطابق البريد المُرمَّز في supabase/schema.sql (دالة is_admin).
 */
export const ADMIN_EMAIL = "conta.moha@gmail.com";

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
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
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
}): Promise<AuthResult & { needsVerification?: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { name: input.name, company_name: input.companyName } },
  });
  if (error) return { ok: false, message: error.message };

  if (!data.session) {
    // تأكيد البريد مطلوب — تُنشأ الشركة عند أول دخول بعد التأكيد
    return { ok: true, session: null, needsVerification: true };
  }

  await registerCurrentCompany({
    companyName: input.companyName,
    name: input.name,
    phone: input.phone,
  });
  return { ok: true, session: data.session };
}

/** إنشاء شركة المستخدم الحالي (بعد التسجيل أو عند غيابها). */
export async function registerCurrentCompany(input: {
  companyName: string;
  name?: string;
  phone?: string;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc("register_company", {
    p_company_name: input.companyName,
    p_name: input.name ?? "",
    p_phone: input.phone ?? "",
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? null;
}

/** جلب الملف الشخصي للمستخدم الحالي. */
export async function getProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return (data as Profile) ?? null;
}

/** جلب شركة المستخدم الحالي (أو null للمطوّر). */
export async function getCompany(): Promise<Company | null> {
  const profile = await getProfile();
  if (!profile?.company_id) return null;
  const { data } = await supabase.from("companies").select("*").eq("id", profile.company_id).maybeSingle();
  return (data as Company) ?? null;
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
  if (c?.plan_type === "open") return "اشتراك مفتوح";
  if (c?.plan_type === "yearly") return "اشتراك سنوي";
  return "اشتراك شهري";
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** هل المستخدم الحالي هو المطوّر؟ */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return (user.email ?? "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
