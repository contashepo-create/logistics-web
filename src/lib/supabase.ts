import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// persistSession + autoRefresh: تحفظ الجلسة بين التحميلات وتجددها تلقائياً.
// detectSessionInUrl: يتعامل مع روابط تأكيد البريد المرسلة من Supabase Auth.
export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const SUPABASE_CONFIGURED = Boolean(url && anonKey);

/** معرّف المستخدم الحالي (uuid) أو null إن لم يكن مسجلاً. */
export async function currentUserId(): Promise<string | null> {
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
