// بيانات ضريبية وعنوان وطني (المملكة العربية السعودية / هيئة الزكاة والضريبة والجمارك).
// تُستخدم في بيانات المنشأة والعملاء والموردين، وفي الفاتورة الضريبية.

export type EntityType = "establishment" | "company" | "individual" | "nonprofit" | "government";
export type TaxStatus = "taxable" | "exempt" | "not_registered";

export const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: "establishment", label: "مؤسسة فردية" },
  { value: "company", label: "شركة" },
  { value: "individual", label: "فرد" },
  { value: "nonprofit", label: "جهة غير ربحية" },
  { value: "government", label: "جهة حكومية" },
];

export const TAX_STATUSES: { value: TaxStatus; label: string }[] = [
  { value: "taxable", label: "خاضع لضريبة القيمة المضافة" },
  { value: "exempt", label: "معفى من الضريبة" },
  { value: "not_registered", label: "غير مسجّل ضريبياً" },
];

/** مناطق المملكة (للعنوان الوطني). */
export const SA_REGIONS = [
  "الرياض", "مكة المكرمة", "المدينة المنورة", "القصيم", "الشرقية", "عسير",
  "تبوك", "حائل", "الحدود الشمالية", "جازان", "نجران", "الباحة", "الجوف",
];

export const COUNTRIES: { code: string; label: string }[] = [
  { code: "SA", label: "المملكة العربية السعودية" },
  { code: "AE", label: "الإمارات العربية المتحدة" },
  { code: "KW", label: "الكويت" },
  { code: "QA", label: "قطر" },
  { code: "BH", label: "البحرين" },
  { code: "OM", label: "عُمان" },
  { code: "EG", label: "مصر" },
  { code: "OTHER", label: "دولة أخرى" },
];

/** تُبقي الأرقام الإنجليزية فقط (مع تحويل الأرقام العربية). */
export function digitsOnly(v: string): string {
  const map: Record<string, string> = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };
  return String(v ?? "")
    .replace(/[٠-٩]/g, (d) => map[d] ?? d)
    .replace(/\D/g, "");
}

/** الرقم الضريبي السعودي: 15 رقماً يبدأ وينتهي بـ 3. */
export function isValidTaxNumber(v: string): boolean {
  const d = digitsOnly(v);
  return /^3\d{13}3$/.test(d);
}

/** رقم السجل التجاري: 10 أرقام. */
export function isValidCommercialReg(v: string): boolean {
  return /^\d{10}$/.test(digitsOnly(v));
}

/** الرمز البريدي: 5 أرقام. */
export function isValidPostalCode(v: string): boolean {
  return /^\d{5}$/.test(digitsOnly(v));
}

/** رقم المبنى / الرقم الإضافي: 4 أرقام. */
export function isValidBuildingNo(v: string): boolean {
  return /^\d{4}$/.test(digitsOnly(v));
}

export interface NationalAddress {
  country?: string;
  region?: string;
  city?: string;
  district?: string;
  street?: string;
  building_no?: string;
  postal_code?: string;
  additional_no?: string;
  address_note?: string;
}

/** صياغة العنوان الوطني في سطر واحد (بالترتيب المعتمد). */
export function formatNationalAddress(a: NationalAddress): string {
  const parts = [
    a.building_no ? `مبنى ${a.building_no}` : "",
    a.street ?? "",
    a.district ? `حي ${a.district}` : "",
    a.city ?? "",
    a.postal_code ?? "",
    a.additional_no ?? "",
    a.region ?? "",
    a.country && a.country !== "SA" ? countryLabel(a.country) : "",
  ].filter((x) => String(x).trim() !== "");
  return parts.join("، ");
}

export function countryLabel(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.label ?? code;
}

export function entityLabel(v: string): string {
  return ENTITY_TYPES.find((e) => e.value === v)?.label ?? v;
}

export function taxStatusLabel(v: string): string {
  return TAX_STATUSES.find((t) => t.value === v)?.label ?? v;
}

export interface TaxProfile extends NationalAddress {
  tax_number?: string;
  commercial_reg?: string;
  entity_type?: string;
  tax_status?: string;
}

/**
 * تحقّق شامل يُعيد قائمة أخطاء عربية جاهزة للعرض (فارغة = سليم).
 * الحقول الفارغة مقبولة إلا إذا كانت الجهة «خاضعة للضريبة» ومطلوب منها رقم ضريبي.
 */
export function validateTaxProfile(p: TaxProfile, opts: { requireTaxNumber?: boolean } = {}): string[] {
  const errors: string[] = [];
  const has = (v?: string) => String(v ?? "").trim() !== "";

  if (opts.requireTaxNumber && p.tax_status === "taxable" && !has(p.tax_number)) {
    errors.push("الرقم الضريبي مطلوب للجهات الخاضعة لضريبة القيمة المضافة.");
  }
  if (has(p.tax_number) && !isValidTaxNumber(p.tax_number!)) {
    errors.push("الرقم الضريبي يجب أن يكون 15 رقماً يبدأ وينتهي بالرقم 3.");
  }
  if (has(p.commercial_reg) && !isValidCommercialReg(p.commercial_reg!)) {
    errors.push("رقم السجل التجاري يجب أن يكون 10 أرقام.");
  }
  if (has(p.postal_code) && !isValidPostalCode(p.postal_code!)) {
    errors.push("الرمز البريدي يجب أن يكون 5 أرقام.");
  }
  if (has(p.building_no) && !isValidBuildingNo(p.building_no!)) {
    errors.push("رقم المبنى يجب أن يكون 4 أرقام.");
  }
  if (has(p.additional_no) && !isValidBuildingNo(p.additional_no!)) {
    errors.push("الرقم الإضافي يجب أن يكون 4 أرقام.");
  }
  return errors;
}

/** تطبيع القيم قبل الحفظ (أرقام إنجليزية + إزالة الفراغات الزائدة). */
export function normalizeTaxProfile<T extends TaxProfile>(p: T): T {
  const out = { ...p };
  for (const k of ["tax_number", "commercial_reg", "postal_code", "building_no", "additional_no"] as const) {
    if (out[k] !== undefined) (out as Record<string, unknown>)[k] = digitsOnly(String(out[k] ?? ""));
  }
  for (const k of ["region", "city", "district", "street", "address_note"] as const) {
    if (out[k] !== undefined) (out as Record<string, unknown>)[k] = String(out[k] ?? "").trim().replace(/\s+/g, " ");
  }
  return out;
}
