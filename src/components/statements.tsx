"use client";

import { useEffect, useState } from "react";
import { Modal, DateInput, Button, ExportBar } from "@/components/ui";
import { notify } from "@/components/toast";
import { money, todayIso } from "@/lib/format";
import { customerStatement, accountStatement } from "@/lib/calc";
import { getCustomer, getAccount, companyInfo } from "@/lib/repo";
import { buildReportHtml, exportExcel, exportPdfHtml, printHtml } from "@/lib/exporter";

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

// ---------------------------------------------------------------------------
export function CustomerStatementDialog({ customerId, onClose }: {
  customerId: number; onClose: () => void;
}) {
  const [dFrom, setDFrom] = useState(yearStart());
  const [dTo, setDTo] = useState(todayIso());
  const [owner, setOwner] = useState("—");
  const [st, setSt] = useState<{ opening: number; rows: any[]; closing: number } | null>(null);

  const load = async () => {
    const c = await getCustomer(customerId);
    if (c) setOwner(`${c.code} - ${c.name}`);
    setSt(await customerStatement(customerId, dFrom, dTo));
  };

  useEffect(() => { load(); }, [customerId]);

  const headers = ["التاريخ", "المستند", "البيان", "مدين (عليه)", "دائن (له)", "الرصيد"];
  const rows = (st?.rows ?? []).map((r) => [r.date, r.doc, r.desc, money(r.debit), money(r.credit), money(r.balance)]);

  const doExport = async (mode: "excel" | "pdf" | "print") => {
    const info = await companyInfo();
    const summary: [string, string][] = [
      ["العميل", owner],
      ["الرصيد الافتتاحي", money(st?.opening ?? 0)],
      ["إجمالي الفواتير", money((st?.rows ?? []).reduce((a, r) => a + r.debit, 0))],
      ["إجمالي التحصيل", money((st?.rows ?? []).reduce((a, r) => a + r.credit, 0))],
      ["الرصيد الحالي", money(st?.closing ?? 0)],
    ];
    const title = `كشف حساب عميل: ${owner}`;
    if (mode === "excel") {
      await exportExcel({ info, title, headers, rows, summaryLines: summary, defaultName: `${title}.xlsx` });
    } else {
      const html = buildReportHtml({ info, title, subtitle: `الفترة: من ${dFrom} إلى ${dTo}`, headers, rows, summaryLines: summary, centerFrom: 1 });
      if (mode === "pdf") await exportPdfHtml(html, `${title}.pdf`);
      else printHtml(html, title);
    }
  };

  return (
    <Modal title={`كشف حساب عميل: ${owner}`} onClose={onClose} width={960}
      footer={<ExportBar onExcel={() => doExport("excel")} onPdf={() => doExport("pdf")} onPrint={() => doExport("print")} />}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 12 }}>
        <div><label className="field-label">من تاريخ</label><DateInput value={dFrom} onChange={setDFrom} /></div>
        <div><label className="field-label">إلى تاريخ</label><DateInput value={dTo} onChange={setDTo} /></div>
        <Button variant="primary" onClick={load}>🔄 عرض</Button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
            <tr style={{ fontWeight: 700 }}>
              <td></td><td>الإجمالي / الرصيد النهائي</td><td></td>
              <td>{money((st?.rows ?? []).reduce((a, r) => a + r.debit, 0))}</td>
              <td>{money((st?.rows ?? []).reduce((a, r) => a + r.credit, 0))}</td>
              <td>{money(st?.closing ?? 0)}</td>
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
    setSt(await accountStatement(kind, accountId, dFrom, dTo));
  };

  useEffect(() => { load(); }, [kind, accountId]);

  const headers = ["التاريخ", "المستند", "البيان", "وارد", "منصرف", "الرصيد"];
  const rows = (st?.rows ?? []).map((r) => [r.date, r.doc, r.desc, money(r.in), money(r.out), money(r.balance)]);

  const doExport = async (mode: "excel" | "pdf" | "print") => {
    const info = await companyInfo();
    const kindLabel = kind === "cashbox" ? "خزينة" : "بنك";
    const title = `كشف حساب ${kindLabel}`;
    const summary: [string, string][] = [
      ["الحساب", owner],
      ["الرصيد الافتتاحي", money(st?.opening ?? 0)],
      ["إجمالي الوارد", money((st?.rows ?? []).reduce((a, r) => a + r.in, 0))],
      ["إجمالي المنصرف", money((st?.rows ?? []).reduce((a, r) => a + r.out, 0))],
      ["الرصيد الحالي", money(st?.closing ?? 0)],
    ];
    if (mode === "excel") {
      await exportExcel({ info, title, headers, rows, summaryLines: summary, defaultName: `${title}.xlsx` });
    } else {
      const html = buildReportHtml({ info, title, subtitle: `${owner} | الفترة: من ${dFrom} إلى ${dTo}`, headers, rows, summaryLines: summary, centerFrom: 1 });
      if (mode === "pdf") await exportPdfHtml(html, `${title}.pdf`);
      else printHtml(html, title);
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
          <thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
            <tr style={{ fontWeight: 700 }}>
              <td></td><td>الإجمالي / الرصيد النهائي</td><td></td>
              <td>{money((st?.rows ?? []).reduce((a, r) => a + r.in, 0))}</td>
              <td>{money((st?.rows ?? []).reduce((a, r) => a + r.out, 0))}</td>
              <td>{money(st?.closing ?? 0)}</td>
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
