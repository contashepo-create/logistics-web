import { createHmac, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasServiceKey, serviceClient } from "@/lib/server/supabase";
import { sameOrigin } from "@/lib/server/admin-session";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { sanitizeText } from "@/lib/security";

export const runtime = "nodejs";

const COOKIE_NAME = "logistics_visitor";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YEAR_SECONDS = 365 * 24 * 60 * 60;

function compactHeader(value: string | null, max: number): string {
  return sanitizeText(value ?? "", max).replace(/[\r\n]/g, " ");
}

function safeReferrer(value: string | null): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    // لا نخزّن query/hash لاحتمال احتوائهما على رموز أو بيانات حساسة.
    return compactHeader(`${url.origin}${url.pathname}`, 500);
  } catch {
    return "";
  }
}

export function parseUserAgent(ua: string): { browser: string; operatingSystem: string; deviceType: string } {
  let browser = "غير معروف";
  if (/Edg\//i.test(ua)) browser = "Microsoft Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/SamsungBrowser\//i.test(ua)) browser = "Samsung Internet";
  else if (/CriOS\//i.test(ua)) browser = "Chrome iOS";
  else if (/Chrome\//i.test(ua)) browser = "Google Chrome";
  else if (/FxiOS\//i.test(ua)) browser = "Firefox iOS";
  else if (/Firefox\//i.test(ua)) browser = "Mozilla Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  let operatingSystem = "غير معروف";
  if (/Windows NT 10/i.test(ua)) operatingSystem = "Windows";
  else if (/Android/i.test(ua)) operatingSystem = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) operatingSystem = "iOS / iPadOS";
  else if (/Mac OS X/i.test(ua)) operatingSystem = "macOS";
  else if (/CrOS/i.test(ua)) operatingSystem = "ChromeOS";
  else if (/Linux/i.test(ua)) operatingSystem = "Linux";

  let deviceType = "كمبيوتر";
  if (/bot|crawler|spider|slurp|headless/i.test(ua)) deviceType = "روبوت";
  else if (/iPad|Tablet/i.test(ua)) deviceType = "جهاز لوحي";
  else if (/Mobile|Android|iPhone|iPod/i.test(ua)) deviceType = "هاتف";

  return { browser, operatingSystem, deviceType };
}

/** تسجيل محدود من نفس الموقع؛ قاعدة البيانات لا ترى معرّف الكوكي الخام. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req) || req.headers.get("x-requested-with") !== "XMLHttpRequest") {
    return NextResponse.json({ success: false }, { status: 403 });
  }
  if (!hasServiceKey()) return NextResponse.json({ success: false }, { status: 503 });

  const ip = clientIp(req);
  if (!rateLimit(`visit:${ip}`, 30, 60_000).allowed) {
    return NextResponse.json({ success: false }, { status: 429 });
  }

  const ua = compactHeader(req.headers.get("user-agent"), 500);
  const parsedUa = parseUserAgent(ua);
  // لا نحتسب برامج الفهرسة والمراقبة الآلية كزوار بشريين.
  if (parsedUa.deviceType === "روبوت") return new NextResponse(null, { status: 204 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { /* المسار اختياري؛ الزيارة ما زالت صالحة */ }
  const rawPath = String(body.path ?? "/");
  const path = rawPath.startsWith("/") && !rawPath.startsWith("//")
    ? sanitizeText(rawPath.split("?")[0], 300)
    : "/";
  if (path.startsWith("/zerocold")) return new NextResponse(null, { status: 204 });

  const oldId = req.cookies.get(COOKIE_NAME)?.value ?? "";
  const visitorId = UUID_RE.test(oldId) ? oldId : randomUUID();
  const secret = process.env.VISITOR_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (secret.length < 16) return NextResponse.json({ success: false }, { status: 503 });
  const visitorKey = createHmac("sha256", secret).update(visitorId).digest("hex");

  const country = compactHeader(
    req.headers.get("x-vercel-ip-country") || req.headers.get("cf-ipcountry"), 80,
  );
  const region = compactHeader(req.headers.get("x-vercel-ip-country-region"), 120);
  let city = compactHeader(req.headers.get("x-vercel-ip-city"), 120);
  try { city = decodeURIComponent(city); } catch { /* قيمة المزود غير مرمّزة */ }

  const { error } = await serviceClient().rpc("record_site_visit_v18", {
    p_visitor_key: visitorKey,
    p_ip_address: ip,
    p_user_agent: ua,
    p_browser: parsedUa.browser,
    p_operating_system: parsedUa.operatingSystem,
    p_device_type: parsedUa.deviceType,
    p_country: country,
    p_region: region,
    p_city: city,
    p_path: path,
    p_referrer: safeReferrer(req.headers.get("referer")),
  });
  if (error) return NextResponse.json({ success: false }, { status: 500 });

  const res = new NextResponse(null, { status: 204 });
  if (visitorId !== oldId) {
    res.cookies.set(COOKIE_NAME, visitorId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: YEAR_SECONDS,
    });
  }
  return res;
}
