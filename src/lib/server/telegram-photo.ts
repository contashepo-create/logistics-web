// إرسال صورة إلى تليجرام كـ multipart دون تخزينها في أي مكان.
import "server-only";
import { getBotToken, getAdminChatId, getBackupChatId } from "./telegram";

const TELEGRAM_API = "https://api.telegram.org";

export interface InMemoryPhoto {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

/** أنواع الصور المسموح بها فقط (يُتحقق من البصمة الثنائية لا من الامتداد). */
export function detectImageMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // 3 ميجابايت

/** يرسل الصورة (من الذاكرة) مع شرح إلى دردشة المطوّر. لا يُكتب أي ملف على القرص. */
export async function sendPhotoToAdmin(caption: string, photo: InMemoryPhoto): Promise<boolean> {
  const token = getBotToken();
  const chatId = getAdminChatId();
  if (!token || !chatId) return false;

  const send = async (chat: string): Promise<boolean> => {
    const fd = new FormData();
    fd.set("chat_id", chat);
    fd.set("caption", caption.slice(0, 1024));
    fd.set("parse_mode", "HTML");
    const view = new Uint8Array(photo.bytes);
    fd.set("photo", new Blob([view.slice().buffer], { type: photo.mime }), photo.filename);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${token}/sendPhoto`, {
        method: "POST", body: fd, signal: controller.signal,
      });
      clearTimeout(t);
      return res.ok;
    } catch {
      clearTimeout(t);
      return false;
    }
  };

  const ok = await send(chatId);
  const backup = getBackupChatId();
  if (backup && backup !== chatId) await send(backup);
  return ok;
}
