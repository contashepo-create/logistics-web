// عميل Supabase خادمي (anon key) + التحقق من جلسة المستخدم عبر JWT.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const ADMIN_EMAIL = (
  process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "conta.moha@gmail.com"
).trim().toLowerCase();

function baseClient(): SupabaseClient {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_SUPABASE_URL ||
    "https://placeholder.supabase.co";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_SUPABASE_ANON_KEY ||
    "placeholder-anon-key";
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** عميل بصلاحيات المستخدم الحالي (يمرّر JWT في الترويسة). */
export function userClient(accessToken: string): SupabaseClient {
  const c = baseClient();
  c.auth.setSession({ access_token: accessToken, refresh_token: "" });
  return c;
}

/** استخراج JWT من ترويسة Authorization أو كوكي الجلسة. */
export function extractAccessToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)sb-[a-z0-9-]+-auth-token=([^;]+)/i);
  if (m) {
    try {
      const decoded = decodeURIComponent(m[1]);
      const parsed = JSON.parse(decoded);
      return parsed?.access_token || null;
    } catch {
      return null;
    }
  }
  return null;
}

export interface AuthUser {
  id: string;
  email: string;
}

/** التحقق من جلسة Supabase واسترجاع المستخدم (يُستدعى في كل مسار محمي). */
export async function requireUser(req: Request): Promise<AuthUser | null> {
  const token = extractAccessToken(req);
  if (!token) return null;
  const c = userClient(token);
  const { data, error } = await c.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

/** التحقق من أن المستخدم هو المطوّر. */
export async function requireAdmin(req: Request): Promise<AuthUser | null> {
  const u = await requireUser(req);
  if (!u) return null;
  return u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? u : null;
}

/**
 * إعادة مصادقة المستخدم الحالي قبل العمليات المدمّرة. يُنشأ عميل مستقل حتى لا
 * تتأثر جلسة الطلب، ولا تُخزّن كلمة المرور أو تدخل سجل النشاط.
 */
export async function verifyCurrentUserPassword(email: string, password: string): Promise<boolean> {
  if (!email || !password) return false;
  const verifier = baseClient();
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  return !error && data.user?.email?.toLowerCase() === email.toLowerCase();
}

/** عميل بصلاحيات الخدمة (يتجاوز RLS) — للمسارات العامة المحكومة بالخادم فقط.
 *  لا يُستخدم إلا بعد التحقق من المدخلات وتقييد المعدل. */
export function serviceClient(): SupabaseClient {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_SUPABASE_URL ||
    "https://placeholder.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY غير مضبوط على الخادم.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** هل مفتاح الخدمة متاح؟ (لتفادي انهيار المسار عند غيابه) */
export function hasServiceKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
