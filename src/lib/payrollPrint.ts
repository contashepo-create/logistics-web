import { accountName } from "./calc";
import { companyInfo, getEmployee, getPayroll } from "./repo";
import { amountToArabicWords, EMP_TYPES, money, periodLabel } from "./format";
import { escapeHtml } from "./security";
import { getPrintSettings, printCss } from "./print";
import { openPrintPreview, printHtml } from "./exporter";
import { printMeta } from "./exportHelper";
import { notify } from "@/components/toast";

const h = (value: unknown) => escapeHtml(String(value ?? ""));

export async function payrollSlipHtml(payrollId: number): Promise<{ html: string; number: number; css: string } | null> {
  const payroll = await getPayroll(payrollId);
  if (!payroll) return null;
  const [employee, company, settings, meta, paidFrom] = await Promise.all([
    getEmployee(payroll.employee_id),
    companyInfo(),
    getPrintSettings(),
    printMeta(),
    accountName(payroll.account_kind, payroll.account_id),
  ]);
  if (!employee) return null;

  const gross = Number(payroll.base_salary) + Number(payroll.additions);
  const currency = company.currency || "ر.س";
  const deductionTotal = Number(payroll.deduction_deduction ?? 0);
  const settlementRows = (payroll.settlements ?? []).map((s) => `
    <tr>
      <td>PV-${String(s.voucher_number ?? "").padStart(5, "0")}</td>
      <td>${h(s.voucher_date || "—")}</td>
      <td>${money(Number(s.amount) || 0)}</td>
    </tr>`).join("");
  const deductionRows = (payroll.deduction_settlements ?? []).map((s) => `
    <tr>
      <td>DED-${String(s.deduction_number ?? "").padStart(5, "0")}${s.deduction_reason ? ` — ${h(s.deduction_reason)}` : ""}</td>
      <td>${h(s.deduction_date || "—")}</td>
      <td>${money(Number(s.amount) || 0)}</td>
    </tr>`).join("");

  const html = `
    <section class="payroll-slip" dir="rtl">
      <header class="payroll-slip-head">
        <div>
          <h1>${h(company.company_name || "الشركة")}</h1>
          <div>${h(company.company_address || "")}</div>
          <div>${h(company.company_phone || "")}</div>
        </div>
        <div class="payroll-slip-title">
          <strong>مسير راتب موظف</strong>
          <span>PAY-${String(payroll.number).padStart(5, "0")}</span>
        </div>
      </header>

      <div class="payroll-slip-period">راتب ${h(employee.name)} عن ${h(periodLabel(payroll.period_year, payroll.period_month))}</div>

      <table class="data-table payroll-slip-info"><tbody>
        <tr><th>اسم الموظف</th><td>${h(employee.name)}</td><th>كود الموظف</th><td>${h(employee.code)}</td></tr>
        <tr><th>الوظيفة/النوع</th><td>${h(EMP_TYPES[employee.emp_type] ?? employee.emp_type)}</td><th>تاريخ الصرف</th><td>${h(payroll.date)}</td></tr>
        <tr><th>جهة الصرف</th><td>${h(paidFrom)}</td><th>شهر الاستحقاق</th><td>${h(periodLabel(payroll.period_year, payroll.period_month))}</td></tr>
      </tbody></table>

      <table class="data-table payroll-slip-values">
        <thead><tr><th>البيان</th><th>استحقاق</th><th>استقطاع</th></tr></thead>
        <tbody>
          <tr><td>الراتب الأساسي</td><td>${money(payroll.base_salary)}</td><td>—</td></tr>
          <tr><td>الإضافات والحوافز${payroll.additions_note ? ` — ${h(payroll.additions_note)}` : ""}</td><td>${money(payroll.additions)}</td><td>—</td></tr>
          <tr><td>خصم السلفيات</td><td>—</td><td>${money(payroll.advance_deduction)}</td></tr>
          <tr><td>خصم الخصومات (جزاءات/تسويات)</td><td>—</td><td>${money(deductionTotal)}</td></tr>
          <tr><td>خصومات أخرى</td><td>—</td><td>${money(payroll.other_deductions)}</td></tr>
          <tr class="payroll-slip-total"><td>الصافي المنصرف</td><td colspan="2">${money(payroll.net_salary)} ${h(currency)}</td></tr>
        </tbody>
      </table>

      <div class="payroll-slip-words">${h(amountToArabicWords(payroll.net_salary, currency))}</div>
      ${settlementRows ? `
        <h3>تفاصيل السلف المخصومة في هذا الشهر</h3>
        <table class="data-table"><thead><tr><th>سند السلفة</th><th>تاريخ السلفة</th><th>المخصوم</th></tr></thead><tbody>${settlementRows}</tbody></table>
      ` : ""}
      ${deductionRows ? `
        <h3>تفاصيل الخصومات المقتطعة في هذا الشهر</h3>
        <table class="data-table"><thead><tr><th>بند الخصم</th><th>تاريخ تسجيل الخصم</th><th>المخصوم</th></tr></thead><tbody>${deductionRows}</tbody></table>
      ` : ""}
      ${payroll.notes ? `<div class="payroll-slip-notes"><b>ملاحظات:</b> ${h(payroll.notes)}</div>` : ""}

      <footer class="payroll-slip-signatures">
        <div>توقيع الموظف<br><span>................................</span></div>
        <div>إعداد<br><span>${h(meta.printedBy || "................................")}</span></div>
        <div>اعتماد الإدارة<br><span>................................</span></div>
      </footer>
      <div class="payroll-slip-print-meta">تاريخ الطباعة: ${h(meta.printedAt)}</div>
    </section>`;

  const extraCss = `
    .payroll-slip{max-width:900px;margin:auto;border:1px solid #cbd5e1;padding:24px;border-radius:12px;background:#fff;color:#0f172a}
    .payroll-slip-head{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid var(--print-accent,#1d4ed8);padding-bottom:16px}.payroll-slip-head h1{margin:0 0 6px;font-size:22px}.payroll-slip-title{text-align:center;border:1px solid #cbd5e1;border-radius:10px;padding:10px 20px;display:grid;gap:4px}.payroll-slip-title strong{font-size:20px;color:var(--print-accent,#1d4ed8)}
    .payroll-slip-period{text-align:center;font-size:19px;font-weight:800;margin:18px 0}.payroll-slip-info th{width:17%;background:#f8fafc}.payroll-slip-values{margin-top:18px}.payroll-slip-total{font-size:18px;font-weight:800;background:#eff6ff}.payroll-slip-words{text-align:center;border:1px dashed #94a3b8;padding:10px;margin:14px 0;font-weight:700}.payroll-slip-notes{margin-top:14px;padding:10px;background:#f8fafc}.payroll-slip-signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:30px;text-align:center;margin-top:45px;font-weight:700}.payroll-slip-signatures span{display:inline-block;margin-top:24px;font-weight:400}.payroll-slip-print-meta{text-align:center;color:#64748b;font-size:11px;margin-top:30px}
    @media print{.payroll-slip{border:0;padding:0}.payroll-slip-signatures{break-inside:avoid}}
  `;
  return { html, number: payroll.number, css: `${printCss(settings)}\n${extraCss}` };
}

export async function printPayrollSlip(payrollId: number): Promise<void> {
  const preview = openPrintPreview("معاينة مسير الراتب");
  if (!preview) return notify("اسمح بالنوافذ المنبثقة لفتح معاينة مسير الراتب.", "error");
  try {
    const result = await payrollSlipHtml(payrollId);
    if (!result) {
      preview.close();
      return notify("مسير الراتب غير موجود.", "error");
    }
    printHtml(result.html, `مسير راتب PAY-${String(result.number).padStart(5, "0")}`, { css: result.css }, preview);
  } catch (error) {
    preview.close();
    notify(error instanceof Error ? error.message : "تعذّر تجهيز مسير الراتب للطباعة.", "error");
  }
}
