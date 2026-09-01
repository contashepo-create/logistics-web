// منطق الشكاوى على الخادم: إنشاء، تتبّع، رد — بلا أي وصول مباشر من المتصفح لقاعدة البيانات.
import "server-only";
import { createHash } from "crypto";
import { serviceClient } from "./supabase";
import { generateTicketCode, isValidTicketCode, normalizeCode, safeEmail, safeField, safePersonName, safePhone } from "@/lib/security";

export interface ComplaintPublic {
  ticket: string;
  subject: string;
  status: "open" | "answered" | "closed";
  created_at: string;
  messages: { sender: "visitor" | "admin"; body: string; created_at: string }[];
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`ct:${ip}`).digest("hex").slice(0, 32);
}

/** بريد للتتبّع: أي بريد صحيح الصيغة (الزائر قد لا يملك حساباً). */
function normalizeEmail(v: unknown): string {
  return safeEmail(v, true);
}

export interface NewComplaintInput {
  name: unknown;
  email: unknown;
  phone: unknown;
  subject: unknown;
  body: unknown;
  ip: string;
}

/** إنشاء شكوى جديدة وإرجاع رقم التتبع. */
export async function createComplaint(input: NewComplaintInput): Promise<{ ticket: string }> {
  const name = safePersonName(input.name, "الاسم");
  const email = normalizeEmail(input.email);
  const phone = safePhone(input.phone, false);
  const subject = safeField(input.subject, { label: "موضوع الشكوى", max: 140, min: 4, required: true });
  const body = safeField(input.body, { label: "تفاصيل الشكوى", max: 4000, min: 10, required: true });

  const sb = serviceClient();

  // حد إضافي على مستوى قاعدة البيانات: 3 شكاوى لكل بريد في الساعة
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb
    .from("complaints")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", since);
  if ((count ?? 0) >= 3) throw new Error("لقد أرسلت شكاوى كثيرة خلال الساعة الماضية. حاول لاحقاً.");

  let ticket = "";
  for (let i = 0; i < 8; i++) {
    const candidate = generateTicketCode();
    const { data: exists } = await sb.from("complaints").select("id").eq("ticket", candidate).maybeSingle();
    if (!exists) { ticket = candidate; break; }
  }
  if (!ticket) throw new Error("تعذّر توليد رقم شكوى. حاول مرة أخرى.");

  const { data, error } = await sb
    .from("complaints")
    .insert({ ticket, name, email, phone, subject, body, ip_hash: hashIp(input.ip), status: "open" })
    .select("id")
    .single();
  if (error) throw new Error("تعذّر تسجيل الشكوى.");

  await sb.from("complaint_messages").insert({ complaint_id: data.id, sender: "visitor", body });
  return { ticket };
}

/** جلب شكوى بالتتبع: يتطلب رقم الشكوى **والبريد** معاً (منع تصفّح شكاوى الغير). */
export async function trackComplaint(rawTicket: unknown, rawEmail: unknown): Promise<ComplaintPublic> {
  const ticket = normalizeCode(rawTicket);
  if (!isValidTicketCode(ticket)) throw new Error("رقم الشكوى غير صحيح.");
  const email = normalizeEmail(rawEmail);

  const sb = serviceClient();
  const { data: c } = await sb
    .from("complaints")
    .select("id, ticket, subject, status, created_at, email")
    .eq("ticket", ticket)
    .maybeSingle();

  // رسالة موحّدة حتى لا يُستدل على وجود رقم من عدمه
  if (!c || String(c.email).toLowerCase() !== email) {
    throw new Error("لا توجد شكوى بهذا الرقم مع هذا البريد.");
  }

  const { data: msgs } = await sb
    .from("complaint_messages")
    .select("sender, body, created_at")
    .eq("complaint_id", c.id)
    .order("created_at");

  return {
    ticket: c.ticket,
    subject: c.subject,
    status: c.status,
    created_at: c.created_at,
    messages: (msgs ?? []) as ComplaintPublic["messages"],
  };
}

/** رد الزائر على شكواه (بالتحقق نفسه: رقم + بريد). */
export async function replyToComplaint(rawTicket: unknown, rawEmail: unknown, rawBody: unknown): Promise<ComplaintPublic> {
  const body = safeField(rawBody, { label: "الرد", max: 2000, min: 2, required: true });
  const thread = await trackComplaint(rawTicket, rawEmail);

  const sb = serviceClient();
  const { data: c } = await sb.from("complaints").select("id").eq("ticket", thread.ticket).single();

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb
    .from("complaint_messages")
    .select("id", { count: "exact", head: true })
    .eq("complaint_id", c!.id)
    .eq("sender", "visitor")
    .gte("created_at", since);
  if ((count ?? 0) >= 10) throw new Error("ردود كثيرة خلال وقت قصير. حاول لاحقاً.");

  await sb.from("complaint_messages").insert({ complaint_id: c!.id, sender: "visitor", body });
  await sb.from("complaints").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", c!.id);
  return trackComplaint(thread.ticket, rawEmail);
}
