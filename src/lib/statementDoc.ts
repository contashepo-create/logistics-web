// كشف حساب العميل الاحترافي — مستند جاهز للإرسال للعميل للمطابقة.
// يعتمد قالب الطباعة المختار في الإعدادات (5 قوالب) ولونه الرئيسي.

import { money, balanceSideLabel, balanceSide, amountToArabicWords } from "@/lib/format";
import { buildTableHtml } from "@/lib/exporter";
import type { CustomerStatementFull } from "@/lib/calc";
import type { PrintSettings } from "@/lib/print";

function esc(s: unknown): string {
  // الاقتباسات مشمولة: القيم تُحقن داخل خصائص HTML أيضاً (src/style).
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface StatementDocOptions {
  info: Record<string, string>;
  ps: PrintSettings;
  st: CustomerStatementFull;
  printedBy?: string;
  printedAt?: string;
}

/** يبني HTML كشف حساب احترافي (ترويسة + ملخص + حركات + تركيبة الرصيد + توقيع). */
export function customerStatementHtml({ info, ps, st, printedBy, printedAt }: StatementDocOptions): string {
  const accent = ps.accent_color || "#1d4ed8";
  const soft = ps.template === "minimal" ? "#111827" : accent;
  const cur = info.currency || "";
  const side = balanceSide(st.closing);
  const sideLabel = balanceSideLabel(st.closing);
  const sideColor = side === "debit" ? "#047857" : side === "credit" ? "#b91c1c" : "#475569";
  const abs = Math.abs(st.closing);

  const headerRow = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:5px 10px;color:#475569;font-size:11.5px;">${label}</td>
      <td style="padding:5px 10px;text-align:left;font-weight:${strong ? 800 : 700};font-size:${strong ? "13.5px" : "12.5px"};white-space:nowrap;">${value}</td>
    </tr>`;

  // جدول الحركات يبني نفسه على نظام المستندات المشترك (.doc-table/.doc-cell-*)
  // بدل أنماط مضمّنة مكرّرة، فيرث تنسيق الطباعة وتكرار الرؤوس وتفادي قطع الصفوف.
  const moveHeaders = ["التاريخ", "المستند", "البيان", "مدين (عليه)", "دائن (له)", "الرصيد"];
  const moveRows: (string | number)[][] = [
    [st.from, "—", "رصيد ما قبل الفترة (افتتاحي)", "—", "—", money(st.opening)],
    ...st.rows.map((r) => [
      r.date,
      r.doc,
      r.detail ? `${r.desc} — ${r.detail}` : r.desc,
      r.debit ? money(r.debit) : "—",
      r.credit ? money(r.credit) : "—",
      money(r.balance),
    ]),
    [
      "",
      "الإجماليات",
      st.rows.length ? `${st.rows.length} حركة معروضة` : "لا توجد حركات خلال هذه الفترة",
      money(st.invoiced + st.notes_debit),
      money(st.collected + st.notes_credit),
      money(st.closing),
    ],
  ];
  const moveRowClasses: (string | null)[] = [
    "doc-open-row",
    ...st.rows.map(() => null),
    "doc-total-row",
  ];
  const rowsHtml = buildTableHtml(moveHeaders, moveRows, null, moveRowClasses);

  const openItemsHtml = st.openItems.length
    ? `<div class="doc-section">
        <div class="doc-section-title">تركيبة الرصيد المستحق (تُسدَّد الدفعات بالأقدمية)</div>
        ${buildTableHtml(
          ["الفاتورة", "التاريخ", "قيمتها", "المسدَّد", "المتبقي"],
          st.openItems.map((o) => [
            `INV-${String(o.number).padStart(5, "0")}`,
            o.date,
            money(o.total),
            money(o.paid),
            money(o.remaining),
          ])
        )}
      </div>`
    : "";

  return `
  <div style="font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;color:#0f172a;direction:rtl;">

    <table class="doc-plain" width="100%" style="border-collapse:collapse;margin-bottom:12px;">
      <tr>
        <td style="vertical-align:top;">
          ${ps.show_logo && ps.logo_url ? `<img src="${esc(ps.logo_url)}" style="max-height:60px;margin-bottom:6px;"/><br/>` : ""}
          <div style="font-size:19px;font-weight:800;color:${soft};">${esc(info.company_name || "")}</div>
          <div style="font-size:11.5px;color:#64748b;line-height:1.9;">
            ${ps.show_address && info.company_address ? esc(info.company_address) + "<br/>" : ""}
            ${ps.show_phone && info.company_phone ? "هاتف: " + esc(info.company_phone) : ""}
          </div>
        </td>
        <td style="vertical-align:top;text-align:left;width:250px;">
          <div style="background:${ps.template === "minimal" ? "#f1f5f9" : soft};color:${ps.template === "minimal" ? "#111827" : "#fff"};border-radius:8px;padding:9px 14px;text-align:center;">
            <div style="font-size:15px;font-weight:800;">كشف حساب عميل</div>
          </div>
          <table class="doc-plain" width="100%" style="margin-top:6px;border-collapse:collapse;">
            ${headerRow("من تاريخ", esc(st.from))}
            ${headerRow("إلى تاريخ", esc(st.to))}
            ${printedBy ? headerRow("طُبع بواسطة", esc(printedBy)) : ""}
            ${printedAt ? headerRow("وقت الطباعة", esc(printedAt)) : ""}
          </table>
        </td>
      </tr>
    </table>

    <div style="height:3px;background:linear-gradient(90deg,${soft},transparent);border-radius:3px;margin-bottom:12px;"></div>

    <table class="doc-plain" width="100%" style="border-collapse:collapse;margin-bottom:12px;">
      <tr>
        <td style="width:50%;vertical-align:top;padding-inline-end:8px;">
          <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <div style="background:#f1f5f9;padding:5px 10px;font-size:11px;font-weight:800;color:#475569;">بيانات العميل</div>
            <div style="padding:8px 10px;font-size:12.5px;line-height:1.9;">
              <div style="font-weight:800;font-size:13.5px;">${esc(st.customer?.name ?? "—")}</div>
              ${st.customer?.code ? `<div style="color:#64748b;">كود العميل: ${esc(st.customer.code)}</div>` : ""}
              ${st.customer?.phone ? `<div style="color:#475569;">هاتف: ${esc(st.customer.phone)}</div>` : ""}
              ${st.customer?.address ? `<div style="color:#475569;">${esc(st.customer.address)}</div>` : ""}
            </div>
          </div>
        </td>
        <td style="width:50%;vertical-align:top;">
          <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <div style="background:#f1f5f9;padding:5px 10px;font-size:11px;font-weight:800;color:#475569;">ملخص الحركة خلال الفترة</div>
            <table class="doc-plain" width="100%" style="border-collapse:collapse;">
              ${headerRow("الرصيد الافتتاحي", `${money(st.opening)} ${esc(cur)}`)}
              ${headerRow("إجمالي الفواتير (مدين)", `${money(st.invoiced)} ${esc(cur)}`)}
              ${headerRow("إجمالي التحصيل (دائن)", `${money(st.collected)} ${esc(cur)}`)}
              ${headerRow("إشعارات مدين", `${money(st.notes_debit)} ${esc(cur)}`)}
              ${headerRow("إشعارات دائن", `${money(st.notes_credit)} ${esc(cur)}`)}
              <tr><td colspan="2" style="padding:0;"><div style="height:1.5px;background:${soft};"></div></td></tr>
              <tr>
                <td style="padding:7px 10px;font-weight:800;font-size:13px;">الرصيد الختامي</td>
                <td style="padding:7px 10px;text-align:left;font-weight:800;font-size:14px;color:${sideColor};white-space:nowrap;">
                  ${money(abs)} ${esc(cur)} <span style="font-size:11.5px;">(${sideLabel})</span>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
    </table>

    <div class="doc-section">${rowsHtml}</div>

    ${openItemsHtml}

    <div style="margin-top:14px;border:1px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:12px;background:#f8fafc;">
      <b>الرصيد الختامي كتابةً:</b> ${esc(amountToArabicWords(abs, cur || "جنيه"))}
      <span style="color:${sideColor};font-weight:800;">(${sideLabel === "عليه" ? "مستحق على العميل" : sideLabel === "له" ? "مستحق للعميل" : "لا توجد مديونية"})</span>
    </div>

    <div style="margin-top:12px;font-size:11.5px;color:#64748b;line-height:1.9;">
      يرجى مطابقة هذا الكشف وإفادتنا بأي فروق خلال ١٥ يوماً من تاريخ الاستلام، وإلا اعتُبر مطابقاً.
      ${ps.footer_text ? `<br/>${esc(ps.footer_text)}` : ""}
    </div>

    ${ps.show_signature ? `
    <table class="doc-plain" width="100%" style="margin-top:24px;border-collapse:collapse;font-size:12px;color:#475569;">
      <tr>
        <td style="text-align:center;"><div style="border-top:1px dashed #94a3b8;padding-top:6px;width:190px;margin:0 auto;">مطابقة العميل</div></td>
        <td style="text-align:center;"><div style="border-top:1px dashed #94a3b8;padding-top:6px;width:190px;margin:0 auto;">${esc(ps.signature_label || "عن الشركة")}</div></td>
      </tr>
    </table>` : ""}
  </div>`;
}
