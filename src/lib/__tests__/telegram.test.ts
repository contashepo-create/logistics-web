// اختبارات طبقة تليجرام الخادمية: تعقيم HTML، قراءة الإعدادات، وإرسال الرسائل.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getBotToken, getAdminChatId, getBackupChatId,
  escapeTelegramHtml, sendTelegramCode, notifyAdmin, notifyAdminWithPhoto,
} from "@/lib/server/telegram";

const ENV_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ADMIN_CHAT_ID", "TELEGRAM_BACKUP_CHAT_ID"] as const;
function setEnv(k: string, v: string | undefined) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

describe("escapeTelegramHtml", () => {
  it("يعقّم الرموز الخطرة في ترميز HTML", () => {
    expect(escapeTelegramHtml('<b>&</b>"')).toBe("&lt;b&gt;&amp;&lt;/b&gt;\"");
    expect(escapeTelegramHtml("a < b > c & d")).toBe("a &lt; b &gt; c &amp; d");
    expect(escapeTelegramHtml("")).toBe("");
    expect(escapeTelegramHtml(null as unknown as string)).toBe("");
  });
});

describe("قراءة الإعدادات", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) setEnv(k, saved[k]);
  });

  it("يعيد فارغاً عند غياب الإعداد", () => {
    expect(getBotToken()).toBe("");
    expect(getAdminChatId()).toBe("");
    expect(getBackupChatId()).toBe("");
  });
  it("ينظف المسافات و BOM", () => {
    setEnv("TELEGRAM_BOT_TOKEN", "\uFEFF  123:ABC  ");
    setEnv("TELEGRAM_ADMIN_CHAT_ID", " 555 ");
    expect(getBotToken()).toBe("123:ABC");
    expect(getAdminChatId()).toBe("555");
  });
});

describe("إرسال الرسائل", () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    setEnv("TELEGRAM_BOT_TOKEN", "tok");
    setEnv("TELEGRAM_ADMIN_CHAT_ID", "111");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    for (const k of ENV_KEYS) setEnv(k, saved[k]);
    vi.unstubAllGlobals();
  });

  const okResponse = () => ({ ok: true, status: 200, text: async () => "" }) as unknown as Response;

  it("لا يرسل عند غياب التوكن أو chat_id", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await sendTelegramCode("123456")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("يرسل رمز 2FA ويشمل تعقيماً للرمز", async () => {
    fetchMock.mockResolvedValue(okResponse());
    expect(await sendTelegramCode("123456")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/bottok/sendMessage");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("111");
    expect(body.text).toContain("<code>123456</code>");
    expect(body.parse_mode).toBe("HTML");
  });

  it("يعيد false عند فشل الشبكة", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    expect(await sendTelegramCode("123456")).toBe(false);
  });

  it("يعيد false عند رد غير ناجح (HTTP غير 2xx)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "Unauthorized" } as unknown as Response);
    expect(await sendTelegramCode("123456")).toBe(false);
  });

  it("notifyAdmin يرسل للدردشة الأساسية والاحتياطية", async () => {
    setEnv("TELEGRAM_BACKUP_CHAT_ID", "222");
    fetchMock.mockResolvedValue(okResponse());
    expect(await notifyAdmin("hello")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const chats = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).chat_id);
    expect(chats).toContain("111");
    expect(chats).toContain("222");
  });

  it("notifyAdminWithPhoto يرسل صورة عبر sendPhoto", async () => {
    fetchMock.mockResolvedValue(okResponse());
    expect(await notifyAdminWithPhoto("وصل", "https://x/receipt.png")).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/sendPhoto");
    expect(JSON.parse(opts.body).photo).toBe("https://x/receipt.png");
  });

  it("notifyAdminWithPhoto يعيد false بدون رابط", async () => {
    expect(await notifyAdminWithPhoto("وصل", "")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
