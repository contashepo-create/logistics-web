import { companyInfo } from "./repo";
import { getProfile } from "./auth";
import { buildReportHtml, exportExcel, exportPdfHtml, printHtml, type DocOptions } from "./exporter";
import { getPrintSettings, printCss, type PrintSettings } from "./print";

export type ExportMode = "excel" | "pdf" | "print";

/** تحويل إعدادات الطباعة إلى خيارات المستند. */
export function docOptions(ps: PrintSettings, printedBy?: string, printedAt?: string): DocOptions {
  return {
    showHeader: ps.show_header,
    showPhone: ps.show_phone,
    showAddress: ps.show_address,
    showLogo: ps.show_logo,
    logoUrl: ps.logo_url,
    headerNote: ps.header_note,
    showDate: ps.show_date,
    showCount: ps.show_count,
    footerText: ps.footer_text,
    showSignature: ps.show_signature,
    signatureLabel: ps.signature_label,
    printedBy,
    printedAt,
  };
}

/** استخراج اسم عرض مقروء من البريد عند غياب الاسم الصريح — لا يُظهر البريد كاملاً. */
function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] || "";
  if (!local) return "";
  // استبدال الفواصل الشائعة بمسافة وتنظيف
  const cleaned = local.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  // إبقاء الأحرف كما هي (قد تكون عربية/إنجليزية) مع تكبير أول حرف لكل كلمة إن كانت لاتينية
  return cleaned
    .split(" ")
    .map((w) => {
      if (/^[a-z]/i.test(w) && w.toLowerCase() === w) return w.charAt(0).toUpperCase() + w.slice(1);
      return w;
    })
    .join(" ");
}

/** اسم من يقوم بالطباعة + وقتها (يظهر في ترويسة كل المطبوعات). 
 *  الأولوية: اسم الملف الشخصي → اسم من بيانات مصادقة المستخدم → اسم مستنتج من البريد → فارغ.
 *  لا نعرض البريد الإلكتروني الكامل أبداً في خانة الإعداد/الطابع.
 */
export async function printMeta(): Promise<{ printedBy: string; printedAt: string }> {
  let profile: Awaited<ReturnType<typeof getProfile>> = null;
  try {
    profile = await getProfile();
  } catch {
    profile = null;
  }
  const at = new Date().toLocaleString("ar-EG");

  // 1) اسم الملف الشخصي
  const profileName = String(profile?.name || "").trim();
  if (profileName) return { printedBy: profileName, printedAt: at };

  // 2) محاولة قراءة الاسم من بيانات جلسة Supabase (user_metadata)
  try {
    const { getCurrentUser } = await import("./auth");
    const user = await getCurrentUser();
    const meta = (user as unknown as { user_metadata?: Record<string, unknown> })?.user_metadata || {};
    const candidates = [
      meta.name,
      meta.full_name,
      meta.fullName,
      meta.display_name,
      meta.displayName,
      meta.user_name,
      meta.username,
    ];
    for (const c of candidates) {
      const s = String(c || "").trim();
      if (s && !s.includes("@")) return { printedBy: s, printedAt: at };
    }
    // 3) اشتقاق اسم من البريد (بدون إظهار النطاق)
    const email = String(profile?.email || (user as unknown as { email?: string })?.email || "").trim();
    if (email) {
      const derived = displayNameFromEmail(email);
      if (derived) return { printedBy: derived, printedAt: at };
    }
  } catch {
    // تجاهل أخطاء الجلب — نعود للاشتقاق من البريد إن وجد
  }

  // 4) اشتقاق أخير من بريد الملف الشخصي إن وجد
  const fallbackEmail = String(profile?.email || "").trim();
  if (fallbackEmail) {
    const derived = displayNameFromEmail(fallbackEmail);
    if (derived) return { printedBy: derived, printedAt: at };
  }

  return { printedBy: "", printedAt: at };
}

/** تصدير/طباعة جدول صفحة كاملة وفق إعدادات الطباعة الخاصة بالشركة. */
export async function exportPage(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  summaryLines?: [string, string | number][];
  mode: ExportMode;
}): Promise<void> {
  const [info, ps, meta] = await Promise.all([companyInfo(), getPrintSettings(), printMeta()]);
  const { title, subtitle = "", headers, rows, summaryLines, mode } = opts;
  if (mode === "excel") {
    await exportExcel({ info, title, headers, rows, summaryLines, defaultName: `${title}.xlsx` });
    return;
  }
  const html = buildReportHtml({ info, title, subtitle, headers, rows, summaryLines, centerFrom: 1, doc: docOptions(ps, meta.printedBy, meta.printedAt) });
  if (mode === "pdf") await exportPdfHtml(html, `${title}.pdf`);
  else printHtml(html, title, { css: printCss(ps), watermark: ps.watermark });
}
