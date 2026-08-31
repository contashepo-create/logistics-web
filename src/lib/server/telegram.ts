// إرسال الرسائل إلى تليجرام (خادمي فقط — الرمز لا يغادر الخادم).
import "server-only";

function clean(s: string): string {
  return (s || "").replace(/^\uFEFF/, "").trim();
}

export function getBotToken(): string {
  return clean(process.env.TELEGRAM_BOT_TOKEN || "");
}

export function getAdminChatId(): string {
  return clean(process.env.TELEGRAM_ADMIN_CHAT_ID || "");
}

export function getBackupChatId(): string {
  return clean(process.env.TELEGRAM_BACKUP_CHAT_ID || "");
}

const TELEGRAM_API = "https://api.telegram.org";

/** تعقيم النصوص قبل إدراجها في HTML الخاص بتليجرام (منع حقن الترميز). */
export function escapeTelegramHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function callTelegram(method: "sendMessage" | "sendPhoto", payload: Record<string, unknown>): Promise<boolean> {
  const token = getBotToken();
  if (!token) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[telegram] ${method} failed ${res.status}:`, body.slice(0, 300));
    }
    return res.ok;
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[telegram] ${method} error:`, err);
    return false;
  }
}

/** إرسال رمز 2FA إلى دردشة المطوّر. */
export async function sendTelegramCode(code: string): Promise<boolean> {
  const chatId = getAdminChatId();
  if (!getBotToken() || !chatId) return false;
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text: `🔐 رمز التحقق للوحة المطوّر:\n\n<code>${escapeTelegramHtml(code)}</code>\n\nصلاحية الرمز: 5 دقائق`,
    parse_mode: "HTML",
  });
}

/** إشعار عام للمطوّر (طريقة آمنة ومحدودة زمنياً). */
export async function notifyAdmin(text: string): Promise<boolean> {
  const chatId = getAdminChatId();
  if (!getBotToken() || !chatId) return false;
  const ok = await callTelegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
  const backup = getBackupChatId();
  if (backup && backup !== chatId) {
    await callTelegram("sendMessage", { chat_id: backup, text, parse_mode: "HTML" });
  }
  return ok;
}

/** إرسال صورة (وصل) إلى المطوّر عبر رابط عام أو bytes. */
export async function notifyAdminWithPhoto(caption: string, photoUrl: string): Promise<boolean> {
  const chatId = getAdminChatId();
  if (!getBotToken() || !chatId || !photoUrl) return false;
  return callTelegram("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
  });
}
