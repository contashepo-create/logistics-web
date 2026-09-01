// عميل Supabase خادمي (anon key) + التحقق من جلسة المستخدم عبر JWT.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const ADMIN_EMAIL = "conta.moha@gmail.com";

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
