// قناة الرسائل بين العميل والمطوّر (عبر Supabase + RLS؛ التعقيم وحدود الإغراق في قاعدة البيانات).
import { supabase } from "./supabase";
import { sanitizeText, looksMalicious } from "./security";

export interface SupportMessage {
  id: number;
  company_id: string;
  sender: "client" | "admin";
  body: string;
  is_read: boolean;
  created_at: string;
}

/** رسائل شركتي (أو رسائل شركة محددة إن كان المستدعي هو المطوّر). */
export async function listSupportMessages(companyId?: string): Promise<SupportMessage[]> {
  let q = supabase.from("support_messages").select("*").order("created_at", { ascending: true }).limit(500);
  if (companyId) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as SupportMessage[];
}

/** إرسال رسالة. sender يُفرض من قاعدة البيانات (العميل لا يستطيع انتحال المطوّر). */
export async function sendSupportMessage(body: string, opts?: { companyId?: string; asAdmin?: boolean }): Promise<void> {
  if (looksMalicious(body)) throw new Error("المحتوى المُدخل غير مسموح به.");
  const clean = sanitizeText(body, 2000);
  if (clean.length < 2) throw new Error("اكتب رسالة صحيحة.");
  const row: Record<string, unknown> = { body: clean, sender: opts?.asAdmin ? "admin" : "client" };
  if (opts?.companyId) row.company_id = opts.companyId;
  const { error } = await supabase.from("support_messages").insert(row);
  if (error) throw new Error(error.message);
}

/** آخر رسالة لكل شركة (للوحة المطوّر). */
export async function listSupportThreads(): Promise<{ company_id: string; last: SupportMessage; unread: number }[]> {
  const { data, error } = await supabase
    .from("support_messages").select("*").order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  const map = new Map<string, { company_id: string; last: SupportMessage; unread: number }>();
  for (const m of (data ?? []) as SupportMessage[]) {
    const cur = map.get(m.company_id);
    if (!cur) map.set(m.company_id, { company_id: m.company_id, last: m, unread: 0 });
    if (m.sender === "client" && !m.is_read) map.get(m.company_id)!.unread += 1;
  }
  return [...map.values()];
}
