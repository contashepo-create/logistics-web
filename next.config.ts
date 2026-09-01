import type { NextConfig } from "next";

// أسماء متغيّرات البيئة في Vercel هي: NEXT_SUPABASE_URL و NEXT_SUPABASE_ANON_KEY
// (بدون بادئة NEXT_PUBLIC_)، ولذلك لا يحقنها Next.js تلقائياً في حزمة المتصفّح.
// الحقل env أدناه يجسر القيم وقت البناء إلى الأسماء العامة التي يقرأها العميل،
// مع دعم الأسماء العامة أيضاً إن وُجدت (بيئة محلية أو نشر آخر).
const SUPABASE_URL =
  process.env.NEXT_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.NEXT_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// سياسة أمان المحتوى: تسمح بما يحتاجه Next.js و Supabase فقط.
const supabaseOrigin = (() => {
  try { return new URL(SUPABASE_URL).origin; } catch { return ""; }
})();

const CSP = [
  "default-src 'self'",
  // Next.js يحقن سكربتات مضمّنة للتهيئة؛ لا يُسمح بأي نطاق خارجي
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  supabaseOrigin
    ? `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace("https://", "wss://")}`
    : "connect-src 'self' https: wss:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    NEXT_PUBLIC_ADMIN_EMAIL:
      process.env.NEXT_PUBLIC_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "conta.moha@gmail.com",
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // لا تخزين مؤقت لأي استجابة API
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
      // لوحة المطوّر لا تُفهرس ولا تُخزَّن
      { source: "/zerocold/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] },
    ];
  },
};

export default nextConfig;
