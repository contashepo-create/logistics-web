"use client";

import { assertDateRange } from "@/lib/dateRange";
import { useEffect, useState } from "react";
import { Modal, DateInput, Button, ExportBar, Balance } from "@/components/ui";
import { notify } from "@/components/toast";
import { money, todayIso, balanceText } from "@/lib/format";
import { customerStatementFull, accountStatement } from "@/lib/calc";
import type { CustomerStatementFull } from "@/lib/calc";
import { customerStatementHtml } from "@/lib/statementDoc";
import { getCustomer, getAccount, companyInfo } from "@/lib/repo";
import { buildReportHtml, exportExcel, exportPdfHtml, printHtml } from "@/lib/exporter";
import { getPrintSettings, pdfDocOptions, printCss } from "@/lib/print";
import { docOptions, printMeta } from "@/lib/exportHelper";

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

// ---------------------------------------------------------------------------
export function CustomerStatementDialog({ customerId, onClose }: {
  customerId: number; onClose: () => void;
}) {
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [st, setSt] = useState<CustomerStatementFull | null>(null);
  const owner = st?.customer ? `${st.customer.code} - ${st.customer.name}` : "—";

  const load = async () => {
    try {
      assertDateRange(dFrom, dTo);
      setSt(await customerStatementFull(customerId, dFrom, dTo));
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };
  useEffect(() => { load(); }, [customerId]);

  const headers = ["التاريخ", "المستند", "البيان", "مدين (عليه)", "دائن (له)", "الرصيد"];
  const textRows: (string | number)[][] = [
    [st?.from ?? dFrom, "رصيد افتتاحي", "رصيد ما قبل الفترة (افتتاحي)", "", "", money(st?.opening ?? 0)],
    ...(st?.rows ?? []).map((r) => [
      r.date, r.doc, r.detail ? `${r.desc} — ${r.detail}` : r.desc,
      r.debit ? money(r.debit) : "", r.credit ? money(r.credit) : "", money(r.balance),
    ]),
    [
      "", "الإجماليات", `${st?.rows.length ?? 0} حركة معروضة`,
      money((st?.invoiced ?? 0) + (st?.notes_debit ?? 0)),
      money((st?.collected ?? 0) + (st?.notes_credit ?? 0)),
      money(st?.closing ?? 0),
    ],
  ];

  const doExport = async (mode: "excel" | "pdf" | "print") => {
    if (!st) return;
    const [info, ps, meta] = await Promise.all([companyInfo(), getPrintSettings(), printMeta()]);
    const title = `كشف حساب عميل: ${owner}`;
    if (mode === "excel") {
      const summary: [string, string][] = [
        ["العميل", owner],
        ["الرصيد الافتتاحي", money(st.opening)],
        ["إجمالي الفواتير", money(st.invoiced)],
        ["إجمالي التحصيل", money(st.collected)],
        ["إشعارات مدين", money(st.notes_debit)],
        ["إشعارات دائن", money(st.notes_credit)],
        ["الرصيد الختامي", balanceText(st.closing)],
      ];
      await exportExcel({ info, title, headers, rows: textRows, summaryLines: summary, defaultName: `${title}.xlsx` });
      return;
    }
    const html = customerStatementHtml({ info, ps, st, printedBy: meta.printedBy, printedAt: meta.printedAt });
    if (mode === "pdf") {
      await exportPdfHtml(html, `${title}.pdf`, pdfDocOptions(ps, {
        title, printedBy: meta.printedBy, printedAt: meta.printedAt,
      }));
    }
    else printHtml(html, title, { css: printCss(ps), watermark: ps.watermark });
  };

  return (
    <Modal title={`كشف حساب عميل: ${owner}`} onClose={onClose} width={1000}
      footer={<ExportBar onExcel={() => doExport("excel")} onPdf={() => doExport("pdf")} onPrint={() => doExport("print")} />}>
      <div className="stmt-toolbar">
        <div><label className="field-label">من تاريخ</label><DateInput value={dFrom} onChange={setDFrom} /></div>
        <div><label className="field-label">إلى تاريخ</label><DateInput value={dTo} onChange={setDTo} /></div>
        <Button variant="primary" onClick={load}>🔄 عرض</Button>
      </div>

      <div className="stmt-cards">
        <div className="stmt-card"><span className="k">الرصيد الافتتاحي</span><span className="v">{money(st?.opening ?? 0)}</span></div>
        <div className="stmt-card"><span className="k">إجمالي الفواتير</span><span className="v">{money(st?.invoiced ?? 0)}</span></div>
        <div className="stmt-card"><span className="k">إجمالي التحصيل</span><span className="v">{money(st?.collected ?? 0)}</span></div>
        <div className="stmt-card"><span className="k">إشعارات مدين/دائن</span><span className="v">{money((st?.notes_debit ?? 0) - (st?.notes_credit ?? 0))}</span></div>
        <div className="stmt-card"><span className="k">الرصيد الختامي</span><span className="v"><Balance value={st?.closing ?? 0} /></span></div>
      </div>

      <div className="table-wrap">
        <table className="data-table stmt-table">
          <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>
            <tr className="stmt-opening">
              <td>{st?.from ?? dFrom}</td><td>—</td><td>رصيد ما قبل الفترة (افتتاحي)</td>
              <td>—</td><td>—</td><td>{money(st?.opening ?? 0)}</td>
            </tr>
            {(st?.rows ?? []).map((r, i) => (
              <tr key={i}>
                <td>{r.date}</td>
                <td className={r.kind === "invoice" ? "stmt-doc-inv" : "stmt-doc-rec"}>{r.doc}</td>
                <td>
                  <div>{r.desc}</div>
                  {r.detail && <div className="stmt-detail">{r.detail}</div>}
                </td>
                <td>{r.debit ? money(r.debit) : "—"}</td>
                <td>{r.credit ? money(r.credit) : "—"}</td>
                <td style={{ fontWeight: 700 }}>{money(r.balance)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td colSpan={3}>الإجماليات</td>
              <td>{money((st?.invoiced ?? 0) + (st?.notes_debit ?? 0))}</td>
              <td>{money((st?.collected ?? 0) + (st?.notes_credit ?? 0))}</td>
              <td><Balance value={st?.closing ?? 0} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {!!st?.openItems.length && (
        <>
          <div className="inv-sec-title" style={{ marginTop: 14 }}>
            <span>تركيبة الرصيد المستحق (السداد بالأقدمية)</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>الفاتورة</th><th>التاريخ</th><th>قيمتها</th><th>المسدَّد</th><th>المتبقي</th></tr></thead>
              <tbody>
                {st.openItems.map((o) => (
                  <tr key={o.number}>
                    <td>INV-{String(o.number).padStart(5, "0")}</td>
                    <td>{o.date}</td>
                    <td>{money(o.total)}</td>
                    <td>{money(o.paid)}</td>
                    <td style={{ fontWeight: 700 }}>{money(o.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export function AccountStatementDialog({ kind, accountId, onClose }: {
  kind: string; accountId: number; onClose: () => void;
}) {
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [owner, setOwner] = useState("—");
  const [st, setSt] = useState<{ opening: number; rows: any[]; closing: number } | null>(null);

  const load = async () => {
    const a = await getAccount(kind, accountId);
    const kindLabel = kind === "cashbox" ? "خزينة" : "بنك";
    if (a) setOwner(`${kindLabel}: ${a.code} - ${a.name}`);
    try {
      assertDateRange(dFrom, dTo);
      setSt(await accountStatement(kind, accountId, dFrom, dTo));
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  useEffect(() => { load(); }, [kind, accountId]);

  const headers = ["التاريخ", "المستند", "البيان", "وارد", "منصرف", "الرصيد"];
  const moves = st?.rows ?? [];
  const totalIn = moves.reduce((a, r) => a + r.in, 0);
  const totalOut = moves.reduce((a, r) => a + r.out, 0);
  // صفوف التصدير تبدأ بالرصيد الافتتاحي وتنتهي بالإجماليات، والخانات الصفرية تُترك فارغة.
  const rows: (string | number)[][] = [
    [dFrom, "رصيد افتتاحي", "الرصيد قبل الفترة (افتتاحي)", "", "", money(st?.opening ?? 0)],
    ...moves.map((r) => [
      r.date, r.doc, r.desc,
      r.in ? money(r.in) : "", r.out ? money(r.out) : "", money(r.balance),
    ]),
    ["", "الإجماليات", `${moves.length} حركة معروضة`, money(totalIn), money(totalOut), money(st?.closing ?? 0)],
  ];

  const doExport = async (mode: "excel" | "pdf" | "print") => {
    const [info, ps, meta] = await Promise.all([companyInfo(), getPrintSettings(), printMeta()]);
    const kindLabel = kind === "cashbox" ? "خزينة" : "بنك";
    const title = `كشف حساب ${kindLabel}`;
    const summary: [string, string][] = [
      ["الحساب", owner],
      ["الرصيد الافتتاحي", money(st?.opening ?? 0)],
      ["إجمالي الوارد", money(totalIn)],
      ["إجمالي المنصرف", money(totalOut)],
      ["الرصيد الحالي", money(st?.closing ?? 0)],
    ];
    if (mode === "excel") {
      await exportExcel({ info, title, headers, rows, summaryLines: summary, defaultName: `${title}.xlsx` });
    } else {
      const html = buildReportHtml({ info, title, subtitle: `${owner} | الفترة: من ${dFrom} إلى ${dTo}`, headers, rows, summaryLines: summary, doc: docOptions(ps, meta.printedBy, meta.printedAt) });
      if (mode === "pdf") {
        await exportPdfHtml(html, `${title}.pdf`, pdfDocOptions(ps, {
          title, printedBy: meta.printedBy, printedAt: meta.printedAt,
        }));
      }
      else printHtml(html, title, { css: printCss(ps), watermark: ps.watermark });
    }
  };

  return (
    <Modal title={`كشف حساب ${kind === "cashbox" ? "خزينة" : "بنك"}: ${owner}`} onClose={onClose} width={960}
      footer={<ExportBar onExcel={() => doExport("excel")} onPdf={() => doExport("pdf")} onPrint={() => doExport("print")} />}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 12 }}>
        <div><label className="field-label">من تاريخ</label><DateInput value={dFrom} onChange={setDFrom} /></div>
        <div><label className="field-label">إلى تاريخ</label><DateInput value={dTo} onChange={setDTo} /></div>
        <Button variant="primary" onClick={load}>🔄 عرض</Button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">التاريخ</th>
              <th>المستند</th>
              <th style={{ textAlign: "right" }}>البيان</th>
              <th className="num">وارد</th>
              <th className="num">منصرف</th>
              <th className="num">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            <tr className="stmt-opening">
              <td className="num">{dFrom}</td>
              <td>—</td>
              <td className="data-cell-wrap">رصيد ما قبل الفترة (افتتاحي)</td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td className="num">{money(st?.opening ?? 0)}</td>
            </tr>
            {moves.map((r, i) => (
              <tr key={i}>
                <td className="num">{r.date}</td>
                <td>{r.doc}</td>
                <td className="data-cell-wrap">{r.desc}</td>
                <td className="num">{r.in ? money(r.in) : "—"}</td>
                <td className="num">{r.out ? money(r.out) : "—"}</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(r.balance)}</td>
              </tr>
            ))}
            {!moves.length && (
              <tr><td colSpan={headers.length} style={{ color: "var(--muted)" }}>لا توجد حركات في هذه الفترة</td></tr>
            )}
            <tr className="total-row">
              <td className="num"></td>
              <td>الإجماليات</td>
              <td className="data-cell-wrap">{moves.length} حركة معروضة</td>
              <td className="num">{money(totalIn)}</td>
              <td className="num">{money(totalOut)}</td>
              <td className="num">{money(st?.closing ?? 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="section-label" style={{ marginTop: 10 }}>
        الرصيد الافتتاحي: {money(st?.opening ?? 0)} &nbsp;&nbsp; الرصيد الختامي (الحالي): {money(st?.closing ?? 0)}
      </div>
    </Modal>
  );
}
