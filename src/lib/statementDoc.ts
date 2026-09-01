// كشف حساب العميل الاحترافي — مستند جاهز للإرسال للعميل للمطابقة.
// يعتمد قالب الطباعة المختار في الإعدادات (5 قوالب) ولونه الرئيسي.

import { money, balanceSideLabel, balanceSide, amountToArabicWords } from "@/lib/format";
import type { CustomerStatementFull } from "@/lib/calc";
import type { PrintSettings } from "@/lib/print";

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface StatementDocOptions {
  info: Record<string, string>;
  ps: PrintSettings;
  st: CustomerStatementFull;
}

/** يبني HTML كشف حساب احترافي (ترويسة + ملخص + حركات + تركيبة الرصيد + توقيع). */
export function customerStatementHtml({ info, ps, st }: StatementDocOptions): string {
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

  const rowsHtml = st.rows.map((r, i) => {
    const zebra = ps.zebra && i % 2 === 1 ? "background:#f7f9fc;" : "";
    const isInvoice = r.kind === "invoice";
    return `<tr style="${zebra}">
      <td style="padding:7px 8px;text-align:center;white-space:nowrap;">${esc(r.date)}</td>
      <td style="padding:7px 8px;text-align:center;white-space:nowrap;font-weight:700;color:${isInvoice ? soft : "#475569"};">${esc(r.doc)}</td>
      <td style="padding:7px 8px;text-align:right;">
        <div>${esc(r.desc)}</div>
        ${r.detail ? `<div style="color:#64748b;font-size:11px;margin-top:2px;">${esc(r.detail)}</div>` : ""}
      </td>
      <td style="padding:7px 8px;text-align:center;font-weight:${r.debit ? 700 : 400};">${r.debit ? money(r.debit) : "—"}</td>
      <td style="padding:7px 8px;text-align:center;font-weight:${r.credit ? 700 : 400};">${r.credit ? money(r.credit) : "—"}</td>
      <td style="padding:7px 8px;text-align:center;font-weight:800;">${money(r.balance)}</td>
    </tr>`;
  }).join("");

  const openItemsHtml = st.openItems.length
    ? `<div style="margin-top:14px;">
        <div style="font-weight:800;font-size:12.5px;color:${soft};margin-bottom:5px;">تركيبة الرصيد المستحق (تُسدَّد الدفعات بالأقدمية)</div>
        <table width="100%" style="border-collapse:collapse;font-size:12px;border:1px solid #e2e8f0;">
          <thead>
            <tr style="background:${ps.template === "minimal" ? "#f1f5f9" : soft};color:${ps.template === "minimal" ? "#111827" : "#fff"};">
              <th style="padding:6px 8px;">الفاتورة</th><th style="padding:6px 8px;">التاريخ</th>
              <th style="padding:6px 8px;">قيمتها</th><th style="padding:6px 8px;">المسدَّد</th><th style="padding:6px 8px;">المتبقي</th>
            </tr>
          </thead>
          <tbody>
            ${st.openItems.map((o) => `<tr>
              <td style="padding:6px 8px;text-align:center;font-weight:700;">INV-${String(o.number).padStart(5, "0")}</td>
              <td style="padding:6px 8px;text-align:center;">${esc(o.date)}</td>
              <td style="padding:6px 8px;text-align:center;">${money(o.total)}</td>
              <td style="padding:6px 8px;text-align:center;">${money(o.paid)}</td>
              <td style="padding:6px 8px;text-align:center;font-weight:800;">${money(o.remaining)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`
    : "";

  return `
  <div style="font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif;color:#0f172a;direction:rtl;">

    <table width="100%" style="border-collapse:collapse;margin-bottom:12px;">
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
            <div style="font-size:11.5px;opacity:.9;">ACCOUNT STATEMENT</div>
          </div>
          <table width="100%" style="margin-top:6px;border-collapse:collapse;">
            ${headerRow("من تاريخ", esc(st.from))}
            ${headerRow("إلى تاريخ", esc(st.to))}
            ${ps.show_date ? headerRow("تاريخ الإصدار", new Date().toISOString().slice(0, 10)) : ""}
          </table>
        </td>
      </tr>
    </table>

    <div style="height:3px;background:linear-gradient(90deg,${soft},transparent);border-radius:3px;margin-bottom:12px;"></div>

    <table width="100%" style="border-collapse:collapse;margin-bottom:12px;">
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
            <table width="100%" style="border-collapse:collapse;">
              ${headerRow("الرصيد الافتتاحي", `${money(st.opening)} ${esc(cur)}`)}
              ${headerRow("إجمالي الفواتير (مدين)", `${money(st.invoiced)} ${esc(cur)}`)}
              ${headerRow("إجمالي التحصيل (دائن)", `${money(st.collected)} ${esc(cur)}`)}
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

    <table width="100%" style="border-collapse:collapse;font-size:12.5px;border:1px solid #e2e8f0;">
      <thead>
        <tr style="background:${ps.template === "minimal" ? "#f1f5f9" : soft};color:${ps.template === "minimal" ? "#111827" : "#fff"};">
          <th style="padding:8px;width:86px;">التاريخ</th>
          <th style="padding:8px;width:120px;">المستند</th>
          <th style="padding:8px;text-align:right;">البيان</th>
          <th style="padding:8px;width:96px;">مدين (عليه)</th>
          <th style="padding:8px;width:96px;">دائن (له)</th>
          <th style="padding:8px;width:104px;">الرصيد</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#eef2f7;font-weight:800;">
          <td style="padding:7px 8px;text-align:center;">${esc(st.from)}</td>
          <td style="padding:7px 8px;text-align:center;">—</td>
          <td style="padding:7px 8px;text-align:right;">رصيد ما قبل الفترة (افتتاحي)</td>
          <td style="padding:7px 8px;text-align:center;">—</td>
          <td style="padding:7px 8px;text-align:center;">—</td>
          <td style="padding:7px 8px;text-align:center;">${money(st.opening)}</td>
        </tr>
        ${rowsHtml || `<tr><td colspan="6" style="padding:14px;text-align:center;color:#64748b;">لا توجد حركات خلال هذه الفترة</td></tr>`}
        <tr style="background:${ps.template === "minimal" ? "#f1f5f9" : "#eaf0fb"};font-weight:800;">
          <td colspan="3" style="padding:8px;text-align:center;">الإجماليات</td>
          <td style="padding:8px;text-align:center;">${money(st.invoiced)}</td>
          <td style="padding:8px;text-align:center;">${money(st.collected)}</td>
          <td style="padding:8px;text-align:center;color:${sideColor};">${money(st.closing)}</td>
        </tr>
      </tbody>
    </table>

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
    <table width="100%" style="margin-top:24px;border-collapse:collapse;font-size:12px;color:#475569;">
      <tr>
        <td style="text-align:center;"><div style="border-top:1px dashed #94a3b8;padding-top:6px;width:190px;margin:0 auto;">مطابقة العميل</div></td>
        <td style="text-align:center;"><div style="border-top:1px dashed #94a3b8;padding-top:6px;width:190px;margin:0 auto;">${esc(ps.signature_label || "عن الشركة")}</div></td>
      </tr>
    </table>` : ""}
  </div>`;
}
