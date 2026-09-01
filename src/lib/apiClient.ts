// نداءات آمنة لمسارات الخادم:
//  • تُرفق توكن Supabase في ترويسة Authorization (الجلسة مخزّنة في المتصفح لا في كوكي)
//  • credentials: same-origin حتى تُرسل كوكي 2FA (httpOnly) دون تسريبها لأي أصل آخر
//  • ترويسة X-Requested-With تمنع طلبات CSRF البسيطة عبر النماذج
import { supabase } from "./supabase";

export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Requested-With", "XMLHttpRequest");
  return fetch(url, { ...init, headers, credentials: "same-origin" });
}

/** نداء JSON مبسّط يرمي رسالة عربية عند الفشل. */
export async function authPostJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  const res = await authFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || (out as any)?.success === false) {
    throw new Error((out as any)?.message || `فشل الطلب (${res.status}).`);
  }
  return out as T;
}
