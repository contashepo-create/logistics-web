// تقييد معدل الطلبات على الخادم (in-memory — مناسب لنشر نسخة واحدة).
// لكل حقل/نقطة نهاية ميزانية مستقلة. للتوسّع الأفقي استبدل المخزن بـ Redis/DB.
import "server-only";

interface Bucket {
  count: number;
  resetAt: number;
}

// مفاتيح -> دلاء. تُنظّف دورياً لتجنّب نمو الذاكرة بلا حدود.
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export function sanitizeIp(ip: string): string {
  const v = (ip || "").trim();
  if (v === "" || v === "unknown") return "unknown";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) {
    const octets = v.split(".").map(Number);
    if (octets.every((o) => o >= 0 && o <= 255)) return v;
    return "unknown";
  }
  if (/^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/.test(v)) return v;
  if (/^::ffff:(\d{1,3}\.){3}\d{1,3}$/.test(v)) return v;
  return "unknown"; // رفض أي صيغة قد تُحقن في الفلاتر
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return sanitizeIp(fwd.split(",")[0] || "");
  return sanitizeIp(req.headers.get("x-real-ip") || "unknown");
}

/**
 * يفحص إن كان الطلب ضمن الميزانية؛ يزيد العدّاد إن كان مسموحاً.
 * key: مفتاح فريد (مثل `${scope}:${ip}` أو `${scope}:${identifier}`).
 */
export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  sweep();
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  if (b.count >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { allowed: true, retryAfter: 0 };
}
