import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ملاحظة مهمة: أي متغيّر بيئة يُقرأ داخل المتصفّح يجب أن يبدأ بـ NEXT_PUBLIC_
// وإلا فلن يُحقن في حزمة العميل وستظهر الرسالة: "supabaseUrl is required".
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_SUPABASE_URL ||
  "";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_SUPABASE_ANON_KEY ||
  "";

export const SUPABASE_CONFIGURED = Boolean(url && anonKey);

// عند غياب الإعدادات نستخدم قيَماً بديلة صالحة شكلياً حتى لا يرمي createClient
// استثناءً وقت تحميل الوحدة (الذي يُسقِط الصفحة بالكامل). الواجهة تعرض حينها
// رسالة إعداد واضحة بدل شاشة الخطأ البيضاء.
const effectiveUrl = url || "https://placeholder.supabase.co";
const effectiveKey = anonKey || "placeholder-anon-key";

// persistSession + autoRefresh: تحفظ الجلسة بين التحميلات وتجددها تلقائياً.
// detectSessionInUrl: يتعامل مع روابط تأكيد البريد المرسلة من Supabase Auth.
export const supabase: SupabaseClient = createClient(effectiveUrl, effectiveKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** معرّف المستخدم الحالي (uuid) أو null إن لم يكن مسجلاً. */
export async function currentUserId(): Promise<string | null> {
  if (!SUPABASE_CONFIGURED) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** معرّف شركة المستخدم الحالي أو null (المطوّر بلا شركة). */
export async function currentCompanyId(): Promise<string | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  const { data } = await supabase.from("profiles").select("company_id").eq("id", uid).maybeSingle();
  return (data?.company_id as string) ?? null;
}
