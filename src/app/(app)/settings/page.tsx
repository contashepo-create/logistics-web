"use client";

import { useEffect, useState } from "react";
import { PageFrame, Field, Input, Button } from "@/components/ui";
import { getSetting, setSetting, companyInfo } from "@/lib/repo";
import { notify } from "@/components/toast";

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [currency, setCurrency] = useState("");
  const [vatNote, setVatNote] = useState("");
  const [vatRate, setVatRate] = useState("15");

  useEffect(() => {
    companyInfo().then((info) => {
      setName(info.company_name);
      setPhone(info.company_phone);
      setAddress(info.company_address);
      setCurrency(info.currency);
      setVatNote(info.company_vat_note);
      setVatRate(info.vat_rate ?? "15");
    });
  }, []);

  const save = async () => {
    try {
      await setSetting("company_name", name);
      await setSetting("company_phone", phone);
      await setSetting("company_address", address);
      await setSetting("currency", currency);
      await setSetting("company_vat_note", vatNote);
      await setSetting("vat_rate", vatRate || "15");
      notify("تم حفظ الإعدادات بنجاح.", "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  return (
    <PageFrame title="إعدادات النظام" subtitle="بيانات الشركة تظهر في ترويسة كل التقارير والفواتير">
      <div className="group-box" style={{ marginTop: 0 }}>
        <div className="group-title">بيانات الشركة</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="اسم الشركة"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="هاتف الشركة"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="عنوان الشركة"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label="رمز العملة"><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
          <Field label="نسبة ضريبة القيمة المضافة %"><Input value={vatRate} onChange={(e) => setVatRate(e.target.value)} dir="ltr" /></Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="عبارة أسفل الفواتير"><Input value={vatNote} onChange={(e) => setVatNote(e.target.value)} /></Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="primary" onClick={save}>💾 حفظ الإعدادات</Button>
        </div>
      </div>

      <div className="group-box">
        <div className="group-title">معلومات النظام</div>
        <ul style={{ lineHeight: 2, color: "var(--muted)" }}>
          <li>التطبيق: النظام المحاسبي المتكامل لشركة النقل — الإصدار 1.0.0</li>
          <li>قاعدة البيانات: Supabase (PostgreSQL)</li>
          <li>النظام يعمل على الويب، والبيانات تُحفظ في Supabase.</li>
        </ul>
      </div>
    </PageFrame>
  );
}
