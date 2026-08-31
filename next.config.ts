import type { NextConfig } from "next";

// أسماء متغيّرات البيئة في Vercel هي: NEXT_SUPABASE_URL و NEXT_SUPABASE_ANON_KEY
// (بدون بادئة NEXT_PUBLIC_)، ولذلك لا يحقنها Next.js تلقائياً في حزمة المتصفّح.
// الحقل env أدناه يجسر القيم وقت البناء إلى الأسماء العامة التي يقرأها العميل،
// مع دعم الأسماء العامة أيضاً إن وُجدت (بيئة محلية أو نشر آخر).
const SUPABASE_URL =
  process.env.NEXT_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY =
  process.env.NEXT_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  },
};

export default nextConfig;
