import { NextRequest, NextResponse } from "next/server";
import { requireUser, userClient, extractAccessToken } from "@/lib/server/supabase";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";
import { notifyAdmin, escapeTelegramHtml } from "@/lib/server/telegram";
import { sendPhotoToAdmin, detectImageMime, MAX_PHOTO_BYTES } from "@/lib/server/telegram-photo";
import { safeField, safePhone } from "@/lib/security";
import { sameOrigin } from "@/lib/server/admin-session";

export const runtime = "nodejs";

const KINDS = new Set(["new", "upgrade", "renew"]);
const PLANS = new Set(["monthly", "yearly"]);
const METHODS = new Set(["instapay", "vodafone_cash", "bank_transfer", "cash", "other"]);

const bad = (message: string, status = 400) =>
  NextResponse.json({ success: false, message }, { status });

/**
 * طلب اشتراك / ترقية / تجديد.
 *  • يتطلب جلسة صحيحة (لا يُقبل أي معرّف شركة من العميل — يُشتق من الجلسة عبر RLS).
 *  • يعقّم كل حقل ويمنع الحقن، ويقيّد المعدل لكل مستخدم ولكل IP.
 *  • صورة الوصل تُمرَّر إلى تليجرام المطوّر من الذاكرة ولا تُخزَّن على الموقع إطلاقاً.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!rateLimit(`subreq:ip:${ip}`, 8, 10 * 60 * 1000).allowed) {
    return bad("طلبات كثيرة جداً. حاول بعد قليل.", 429);
  }

  if (!sameOrigin(req)) return bad("طلب مرفوض (أصل غير موثوق).", 403);

  const user = await requireUser(req);
  if (!user) return bad("يجب تسجيل الدخول.", 401);
  if (!rateLimit(`subreq:user:${user.id}`, 4, 10 * 60 * 1000).allowed) {
    return bad("لقد أرسلت طلبات كثيرة. انتظر قليلاً.", 429);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("صيغة الطلب غير صالحة.");
  }

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };

  const plan = str("plan_type");
  const kind = str("request_kind") || "new";
  if (!PLANS.has(plan)) return bad("الباقة المختارة غير صالحة.");
  if (!KINDS.has(kind)) return bad("نوع الطلب غير صالح.");

  const method = str("pay_method");
  if (method && !METHODS.has(method)) return bad("طريقة الدفع غير صالحة.");

  let payerName: string, payerPhone: string, transferRef: string, notes: string;
  try {
    payerName = safeField(str("payer_name"), { label: "اسم المُحوِّل", max: 120, required: true, min: 3 });
    payerPhone = safePhone(str("payer_phone"), true);
    transferRef = safeField(str("transfer_ref"), { label: "رقم العملية", max: 80 });
    notes = safeField(str("notes"), { label: "ملاحظات", max: 800 });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "بيانات غير صالحة.");
  }

  const amount = Number(str("amount"));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return bad("قيمة المبلغ غير منطقية.");

  // صورة الوصل (اختيارية) — تُفحص بالبصمة الثنائية لا بالامتداد
  let photo: { bytes: Uint8Array; mime: string } | null = null;
  const file = form.get("receipt");
  if (file && typeof file !== "string") {
    if (file.size > MAX_PHOTO_BYTES) return bad("حجم صورة الوصل أكبر من 3 ميجابايت.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectImageMime(bytes);
    if (!mime) return bad("صيغة الصورة غير مدعومة (JPG أو PNG أو WEBP فقط).");
    photo = { bytes, mime };
  }

  const token = extractAccessToken(req)!;
  const sb = userClient(token);

  const { data: profile } = await sb.from("profiles").select("company_id, name").eq("id", user.id).maybeSingle();
  if (!profile?.company_id) return bad("لا توجد شركة مرتبطة بحسابك.", 403);

  const { data: company } = await sb
    .from("companies")
    .select("id, name, client_code, plan_type, subscription_end, trial_end, vat_rate")
    .eq("id", profile.company_id)
    .maybeSingle();

  if (!company) return bad("بيانات الشركة غير موجودة.", 403);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = company.subscription_end ? new Date(`${company.subscription_end}T00:00:00`) : null;
  const remaining = end ? Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000)) : 0;
  const activePaid = Boolean(company.plan_type === "monthly" || company.plan_type === "yearly") && !!end && remaining > 0;

  // حماية خادمية: لا نعتمد على نوع الطلب/المبلغ المرسل من المتصفح.
  if (activePaid) {
    if (company.plan_type === "yearly" && plan === "monthly") {
      return bad("لا يمكن الانتقال إلى باقة أقل أثناء سريان الاشتراك السنوي.");
    }
    if (plan === company.plan_type && remaining > 4) {
      return bad("لا يمكن تجديد أو تغيير الباقة قبل آخر 4 أيام من انتهائها.");
    }
  }
  const netPrice = plan === "yearly" ? 1000 : 100;
  const vatRate = Number(company.vat_rate) >= 0 ? Number(company.vat_rate) : 15;
  const expectedAmount = Math.round(netPrice * (1 + vatRate / 100) * 100) / 100;
  if (Math.abs(amount - expectedAmount) > 0.01) {
    return bad(`المبلغ الصحيح لهذه الباقة هو ${expectedAmount.toFixed(2)} ريال سعودي شامل الضريبة.`);
  }

  const { data: inserted, error } = await sb
    .from("activation_requests")
    .insert({
      plan_type: plan,
      request_kind: kind,
      amount,
      payer_name: payerName,
      payer_phone: payerPhone,
      pay_method: method,
      transfer_ref: transferRef,
      notes,
      receipt_sent: Boolean(photo),
    })
    .select()
    .single();

  if (error) {
    const msg = error.code === "23505"
      ? "لديك طلب معلق بالفعل. انتظر مراجعته أو ألغه أولاً."
      : "تعذّر تسجيل الطلب.";
    return bad(msg, 409);
  }

  const kindLabel = kind === "upgrade" ? "ترقية باقة" : kind === "renew" ? "تجديد اشتراك" : "اشتراك جديد";
  const lines = [
    `🆕 <b>${kindLabel}</b>`,
    `🏢 الشركة: <b>${escapeTelegramHtml(company?.name ?? "—")}</b>`,
    `🆔 رقم العميل: <code>${escapeTelegramHtml(company?.client_code ?? "—")}</code>`,
    `📦 الباقة المطلوبة: <b>${plan === "yearly" ? "سنوي" : "شهري"}</b>`,
    `💰 المبلغ المحوَّل: <b>${amount.toLocaleString("en-US")} ر.س</b>`,
    `👤 المُحوِّل: ${escapeTelegramHtml(payerName)} — ${escapeTelegramHtml(payerPhone)}`,
    `🏦 الطريقة: ${escapeTelegramHtml(method || "—")}`,
    `🔖 مرجع العملية: ${escapeTelegramHtml(transferRef || "—")}`,
    `📧 حساب العميل: ${escapeTelegramHtml(user.email)}`,
  ];
  if (notes) lines.push(`📝 ${escapeTelegramHtml(notes)}`);
  lines.push("\n📋 راجع الطلب من لوحة المطوّر للموافقة أو الرفض.");
  const text = lines.join("\n");

  let notified = false;
  if (photo) {
    notified = await sendPhotoToAdmin(text, {
      bytes: photo.bytes,
      filename: `receipt-${Date.now()}.${photo.mime.split("/")[1]}`,
      mime: photo.mime,
    });
    if (!notified) notified = await notifyAdmin(text + "\n\n⚠️ تعذّر تمرير صورة الوصل.");
  } else {
    notified = await notifyAdmin(text);
  }

  return NextResponse.json({ success: true, notified, request: inserted });
}
