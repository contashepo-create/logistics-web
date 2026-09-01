// طبقة العمليات (CRUD) لكل كيانات النظام مع التحقق وقواعد النظام العامة.
// مكافئ حرفي لـ app/core/repo.py

import { supabase } from "./supabase";
import { normalizeTaxProfile, validateTaxProfile } from "./tax";
import { num, accountTable, accountKindLabel } from "./calc";
import type { Company } from "./types";
import {
  RuleError,
  ensureDateInOpenYear,
  ensureMovementEditable,
  ensureNotBlank,
  ensureSufficientFunds,
  ensurePositive,
  roundMoney,
  txt,
} from "./rules";
import type {
  Bank,
  Cashbox,
  Customer,
  Employee,
  FinancialYear,
  Invoice,
  Payroll,
  PaymentVoucher,
  ReceiptVoucher,
  Vehicle,
  YearSnapshot,
} from "./types";

// حقول الشركة (تُستخدم في ترويسة الفواتير والتقارير والإعدادات)
const DEFAULT_SETTINGS: Record<string, string> = {
  company_name: "شركة النقل للخدمات اللوجستية",
  company_name_en: "",
  company_phone: "",
  company_email: "",
  company_website: "",
  company_address: "",
  company_vat_note: "فاتورة مرجعية — ضريبة القيمة المضافة 15%",
  currency: "ر.س",
  vat_rate: "15",
  // البيانات الضريبية والسجلات الرسمية
  company_tax_number: "",
  company_commercial_reg: "",
  company_unified_number: "",
  company_entity_type: "establishment",
  company_tax_status: "taxable",
  // العنوان الوطني التفصيلي
  company_country: "SA",
  company_region: "",
  company_city: "",
  company_district: "",
  company_street: "",
  company_building_no: "",
  company_postal_code: "",
  company_additional_no: "",
  company_address_note: "",
};

// خريطة مفاتيح الإعدادات ← أعمدة جدول الشركات
const COMPANY_FIELDS: Record<string, string> = {
  company_name: "name",
  company_name_en: "name_en",
  company_phone: "phone",
  company_email: "email",
  company_website: "website",
  company_address: "address",
  company_vat_note: "vat_note",
  currency: "currency",
  vat_rate: "vat_rate",
  company_tax_number: "tax_number",
  company_commercial_reg: "commercial_reg",
  company_unified_number: "unified_number",
  company_entity_type: "entity_type",
  company_tax_status: "tax_status",
  company_country: "country",
  company_region: "region",
  company_city: "city",
  company_district: "district",
  company_street: "street",
  company_building_no: "building_no",
  company_postal_code: "postal_code",
  company_additional_no: "additional_no",
  company_address_note: "address_note",
};

// ---------------------------------------------------------------------------
// الشركة والإعدادات (تُحفظ في جدول companies — عزل عبر company_id)
// ---------------------------------------------------------------------------
// كاش قصير لبيانات الشركة: كانت كل قراءة إعداد تُنفّذ ثلاث رحلات شبكة،
// و`companyInfo()` تقرأ ~29 إعداداً ⇒ عشرات الرحلات في كل شاشة.
// يُعطَّل الكاش في بيئة الاختبار حتى تُقرأ البيانات المزروعة حديثاً دائماً.
const CACHE_ENABLED = process.env.NODE_ENV !== "test";
const COMPANY_TTL_MS = 20_000;
let companyCache: { at: number; value: Company | null } | null = null;
let companyInFlight: Promise<Company | null> | null = null;

/** إبطال كاش الشركة (يُستدعى بعد أي تعديل على بياناتها). */
export function invalidateCompanyCache(): void {
  companyCache = null;
  companyInFlight = null;
}

export async function getCompany(force = false): Promise<Company | null> {
  if (!force && CACHE_ENABLED && companyCache && Date.now() - companyCache.at < COMPANY_TTL_MS) return companyCache.value;
  if (!force && companyInFlight) return companyInFlight;

  companyInFlight = (async () => {
    const { data: me } = await supabase.auth.getUser();
    if (!me.user) return null;
    const { data: p } = await supabase.from("profiles").select("company_id").eq("id", me.user.id).maybeSingle();
    if (!p?.company_id) return null;
    const { data } = await supabase.from("companies").select("*").eq("id", p.company_id).maybeSingle();
    return (data as Company) ?? null;
  })();

  try {
    const value = await companyInFlight;
    companyCache = { at: Date.now(), value };
    return value;
  } finally {
    companyInFlight = null;
  }
}

export async function updateCompany(fields: Record<string, unknown>): Promise<void> {
  const c = await getCompany();
  if (!c) throw new RuleError("لا توجد شركة مرتبطة بحسابك.");
  const { error } = await supabase.from("companies").update(fields).eq("id", c.id);
  invalidateCompanyCache();
  if (error) throw new RuleError(error.message);
}

function settingFrom(c: Company | null, key: string, def: string): string {
  const col = COMPANY_FIELDS[key];
  const raw = col && c ? (c as unknown as Record<string, unknown>)[col] : null;
  return raw != null ? String(raw) : def;
}

export async function getSetting(key: string, def = ""): Promise<string> {
  return settingFrom(await getCompany(), key, def);
}

export async function setSetting(key: string, value: string): Promise<void> {
  const col = COMPANY_FIELDS[key];
  if (!col) throw new RuleError(`إعداد غير معروف: ${key}`);
  const v = col === "vat_rate" ? Number(value) : value;
  await updateCompany({ [col]: v });
}

/** كل بيانات الشركة باستعلام واحد (كانت تُنفَّذ رحلة شبكة لكل إعداد). */
export async function companyInfo(): Promise<Record<string, string>> {
  const c = await getCompany();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) out[k] = settingFrom(c, k, v);
  return out;
}

/** نسبة ضريبة القيمة المضافة الحالية (افتراضي 15%). */
export async function currentVatRate(): Promise<number> {
  const raw = await getSetting("vat_rate", "15");
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 15;
}

// ---------------------------------------------------------------------------
// أدوات مساعدة
// ---------------------------------------------------------------------------
async function nextNumber(table: string): Promise<number> {
  const { data } = await supabase
    .from(table)
    .select("number")
    .order("number", { ascending: false })
    .limit(1);
  return (data && data.length ? num(data[0].number) : 0) + 1;
}

/**
 * إدراج مستند مرقّم مع إعادة المحاولة عند تصادم الرقم.
 * القيد الفريد (company_id, number) في قاعدة البيانات هو الضامن النهائي،
 * وهذه الدالة تعيد الحساب تلقائياً عند حدوث التصادم النادر (تزامن/تبويبين).
 */
async function insertNumbered<T>(table: string, row: Record<string, unknown>, retries = 5): Promise<T> {
  for (let i = 0; i < retries; i++) {
    const number = await nextNumber(table);
    const { data, error } = await supabase
      .from(table)
      .insert({ number, ...row })
      .select()
      .single();
    if (!error) return data as T;
    if (error.code === "23505") continue; // رقم مكرر — أعد الحساب
    throw new RuleError(error.message);
  }
  throw new RuleError("تعذّر حفظ المستند بسبب تكرار الرقم. حاول مجدداً.");
}

async function stampCode(table: string, rowId: number, prefix: string): Promise<string> {
  const code = `${prefix}-${String(rowId).padStart(4, "0")}`;
  await supabase.from(table).update({ code }).eq("id", rowId);
  return code;
}

async function count(
  table: string,
  column: string,
  value: unknown,
  extra?: { column: string; value: unknown }
): Promise<number> {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (extra) q = q.eq(extra.column, extra.value);
  const { count: c } = await q;
  return c ?? 0;
}

// ---------------------------------------------------------------------------
// السنوات المالية
// ---------------------------------------------------------------------------
export async function listYears(): Promise<FinancialYear[]> {
  const { data, error } = await supabase
    .from("financial_years")
    .select("*")
    .order("year", { ascending: false });
  if (error) throw new RuleError(error.message);
  return (data ?? []) as FinancialYear[];
}

export async function getYear(yearId: number): Promise<FinancialYear | null> {
  const { data } = await supabase.from("financial_years").select("*").eq("id", yearId).single();
  return (data as FinancialYear) ?? null;
}

export async function saveYear(data: Record<string, unknown>, yearId?: number | null): Promise<number> {
  const year = Number(data.year);
  const dateFrom = String(data.date_from ?? "");
  const dateTo = String(data.date_to ?? "");
  ensureNotBlank(String(year), "السنة");
  ensureNotBlank(dateFrom, "تاريخ البداية");
  ensureNotBlank(dateTo, "تاريخ النهاية");
  if (dateFrom >= dateTo) throw new RuleError("تاريخ بداية السنة يجب أن يكون قبل تاريخ نهايتها.");

  const { data: dup } = await supabase
    .from("financial_years")
    .select("id")
    .eq("year", year)
    .neq("id", yearId ?? -1);
  if (dup && dup.length) throw new RuleError(`السنة المالية ${year} مسجلة مسبقاً.`);

  const { data: overlap } = await supabase
    .from("financial_years")
    .select("year")
    .neq("id", yearId ?? -1)
    .lte("date_from", dateTo)
    .gte("date_to", dateFrom);
  if (overlap && overlap.length) {
    throw new RuleError(
      `نطاق هذه السنة يتداخل مع السنة المالية ${overlap[0].year} المسجلة مسبقاً ` +
        "(التداخل يسبب احتساباً مزدوجاً في التقارير ولقطات الإغلاق)."
    );
  }

  if (yearId) {
    const { error } = await supabase
      .from("financial_years")
      .update({ year, date_from: dateFrom, date_to: dateTo, notes: data.notes ?? "" })
      .eq("id", yearId);
    if (error) throw new RuleError(error.message);
    return yearId;
  }
  const { data: inserted, error } = await supabase
    .from("financial_years")
    .insert({ year, date_from: dateFrom, date_to: dateTo, status: "open", notes: data.notes ?? "" })
    .select()
    .single();
  if (error) throw new RuleError(error.message);
  return inserted.id;
}

export async function setYearStatus(yearId: number, status: string): Promise<void> {
  if (status !== "open" && status !== "closed") throw new RuleError("حالة غير صالحة للسنة المالية.");
  const { error } = await supabase.from("financial_years").update({ status }).eq("id", yearId);
  if (error) throw new RuleError(error.message);
}

export async function movementsCountInRange(dFrom: string, dTo: string): Promise<number> {
  let total = 0;
  for (const table of ["invoices", "receipt_vouchers", "payment_vouchers", "payrolls"]) {
    const { count: c } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .gte("date", dFrom)
      .lte("date", dTo);
    total += c ?? 0;
  }
  return total;
}

export async function deleteYear(yearId: number): Promise<void> {
  const y = await getYear(yearId);
  if (!y) return;
  const n = await movementsCountInRange(y.date_from, y.date_to);
  if (n) {
    throw new RuleError(
      `لا يمكن حذف السنة ${y.year}: توجد ${n} حركة مسجلة ضمن نطاقها.\n` +
        "احذف الحركات أولاً أو أبقِ السنة للأرشفة."
    );
  }
  const { error } = await supabase.from("financial_years").delete().eq("id", yearId);
  if (error) throw new RuleError(error.message);
}

export async function createSnapshot(yearId: number): Promise<Record<string, unknown>> {
  const { yearSnapshotData } = await import("./calc");
  const data = await yearSnapshotData(yearId);
  if (!data || !data.year) throw new RuleError("السنة المالية غير موجودة.");
  const { error } = await supabase
    .from("year_snapshots")
    .upsert({ year_id: yearId, data });
  if (error) throw new RuleError(error.message);
  return data;
}

export async function getSnapshot(yearId: number): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from("year_snapshots").select("data").eq("year_id", yearId).single();
  return data ? (data.data as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// العملاء
// ---------------------------------------------------------------------------
export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase.from("customers").select("*").order("code");
  if (error) throw new RuleError(error.message);
  return (data ?? []) as Customer[];
}

export async function getCustomer(customerId: number): Promise<Customer | null> {
  const { data } = await supabase.from("customers").select("*").eq("id", customerId).single();
  return (data as Customer) ?? null;
}

export async function saveCustomer(data: Record<string, any>, customerId?: number | null): Promise<number> {
  ensureNotBlank(data.name, "اسم العميل");
  const name = txt(data.name, "اسم العميل");
  const address = txt(data.address ?? "", "العنوان");
  const phone = txt(data.phone ?? "", "الهاتف");
  const notes = txt(data.notes ?? "", "الملاحظات");
  const opening = roundMoney(data.opening_balance ?? 0);

  // البيانات الضريبية والعنوان الوطني (تُطبَّع وتُتحقّق قبل الحفظ)
  const profile = normalizeTaxProfile({
    tax_number: String(data.tax_number ?? ""),
    commercial_reg: String(data.commercial_reg ?? ""),
    entity_type: String(data.entity_type ?? "company"),
    tax_status: String(data.tax_status ?? "taxable"),
    country: String(data.country ?? "SA"),
    region: String(data.region ?? ""),
    city: String(data.city ?? ""),
    district: String(data.district ?? ""),
    street: String(data.street ?? ""),
    building_no: String(data.building_no ?? ""),
    postal_code: String(data.postal_code ?? ""),
    additional_no: String(data.additional_no ?? ""),
  });
  const problems = validateTaxProfile(profile);
  if (problems.length) throw new RuleError(problems[0]);

  const extra = {
    ...profile,
    name_en: txt(data.name_en ?? "", "الاسم بالإنجليزية"),
    email: txt(data.email ?? "", "البريد الإلكتروني"),
    contact_person: txt(data.contact_person ?? "", "مسؤول التواصل"),
    credit_limit: roundMoney(data.credit_limit ?? 0),
    payment_terms: Math.max(0, Math.trunc(Number(data.payment_terms ?? 0) || 0)),
  };

  if (customerId) {
    const { error } = await supabase
      .from("customers")
      .update({ name, address, phone, opening_balance: opening, notes, ...extra })
      .eq("id", customerId);
    if (error) throw new RuleError(error.message);
    return customerId;
  }
  const { data: inserted, error } = await supabase
    .from("customers")
    .insert({ name, address, phone, opening_balance: opening, notes, ...extra })
    .select()
    .single();
  if (error) throw new RuleError(error.message);
  await stampCode("customers", inserted.id, "CUST");
  return inserted.id;
}

export async function deleteCustomer(customerId: number): Promise<void> {
  const nInv = await count("invoices", "customer_id", customerId);
  const nRec = await count("receipt_vouchers", "customer_id", customerId);
  if (nInv || nRec) {
    throw new RuleError(
      `لا يمكن حذف العميل لوجود حركات مرتبطة به (${nInv} فاتورة، ${nRec} سند قبض).`
    );
  }
  const { error } = await supabase.from("customers").delete().eq("id", customerId);
  if (error) throw new RuleError(error.message);
}

// ---------------------------------------------------------------------------
// الموظفون والسائقون
// ---------------------------------------------------------------------------
export async function listEmployees(empType?: string | null): Promise<Employee[]> {
  let q = supabase.from("employees").select("*").order("code");
  if (empType) q = q.eq("emp_type", empType);
  const { data, error } = await q;
  if (error) throw new RuleError(error.message);
  return (data ?? []) as Employee[];
}

export async function getEmployee(employeeId: number): Promise<Employee | null> {
  const { data } = await supabase.from("employees").select("*").eq("id", employeeId).single();
  return (data as Employee) ?? null;
}

export async function saveEmployee(data: Record<string, any>, employeeId?: number | null): Promise<number> {
  ensureNotBlank(data.name, "اسم الموظف");
  if (data.emp_type !== "driver" && data.emp_type !== "admin") {
    throw new RuleError("اختر نوع الموظف (سائق / إداري).");
  }
  const name = txt(data.name, "الاسم");
  const nationality = txt(data.nationality ?? "", "الجنسية");
  const phone = txt(data.phone ?? "", "الهاتف");
  const notes = txt(data.notes ?? "", "الملاحظات");
  const baseSalary = roundMoney(data.base_salary ?? 0);
  if (baseSalary < 0) throw new RuleError("الراتب الأساسي لا يمكن أن يكون سالباً.");

  if (employeeId) {
    const old = await getEmployee(employeeId);
    if (old && old.emp_type !== data.emp_type) {
      const linked =
        (await count("invoice_trips", "driver_id", employeeId)) +
        (await count("payrolls", "employee_id", employeeId)) +
        (await count("payment_vouchers", "employee_id", employeeId)) +
        (await count("vehicles", "default_driver_id", employeeId));
      if (linked) {
        throw new RuleError(
          `لا يمكن تغيير نوع الموظف لوجود حركات/سيارات مرتبطة به (${linked} ارتباطاً).`
        );
      }
    }
    const { error } = await supabase
      .from("employees")
      .update({ name, nationality, phone, emp_type: data.emp_type, base_salary: baseSalary, notes })
      .eq("id", employeeId);
    if (error) throw new RuleError(error.message);
    return employeeId;
  }
  const { data: inserted, error } = await supabase
    .from("employees")
    .insert({ name, nationality, phone, emp_type: data.emp_type, base_salary: baseSalary, notes })
    .select()
    .single();
  if (error) throw new RuleError(error.message);
  await stampCode("employees", inserted.id, "EMP");
  return inserted.id;
}

export async function deleteEmployee(employeeId: number): Promise<void> {
  const nPay = await count("payrolls", "employee_id", employeeId);
  const nAdv = await count("payment_vouchers", "employee_id", employeeId);
  const nTrips = await count("invoice_trips", "driver_id", employeeId);
  if (nPay || nAdv || nTrips) {
    throw new RuleError(
      `لا يمكن حذف الموظف لوجود حركات مرتبطة به (رواتب: ${nPay}، سلف: ${nAdv}، نقلات: ${nTrips}).`
    );
  }
  const { error } = await supabase.from("employees").delete().eq("id", employeeId);
  if (error) throw new RuleError(error.message);
}

// ---------------------------------------------------------------------------
// السيارات
// ---------------------------------------------------------------------------
export async function listVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase.from("vehicles").select("*").order("code");
  if (error) throw new RuleError(error.message);
  const { data: emps } = await supabase.from("employees").select("id, name");
  const empMap = new Map((emps ?? []).map((e) => [e.id, e.name]));
  return (data ?? []).map((v) => ({ ...v, driver_name: empMap.get(v.default_driver_id ?? 0) ?? null }));
}

export async function getVehicle(vehicleId: number): Promise<Vehicle | null> {
  const { data } = await supabase.from("vehicles").select("*").eq("id", vehicleId).single();
  return (data as Vehicle) ?? null;
}

export async function saveVehicle(data: Record<string, any>, vehicleId?: number | null): Promise<number> {
  ensureNotBlank(data.plate_number, "رقم اللوحة");
  const plate = txt(data.plate_number, "رقم اللوحة");
  const vtype = txt(data.vehicle_type ?? "", "النوع");
  const notes = txt(data.notes ?? "", "الملاحظات");
  const drv = data.default_driver_id ?? null;
  if (drv != null) {
    const emp = await getEmployee(drv);
    if (!emp || emp.emp_type !== "driver") {
      throw new RuleError("السائق الافتراضي يجب أن يكون موظفاً من نوع (سائق).");
    }
  }
  if (vehicleId) {
    const { error } = await supabase
      .from("vehicles")
      .update({ plate_number: plate, vehicle_type: vtype, default_driver_id: drv, notes })
      .eq("id", vehicleId);
    if (error) throw new RuleError(error.message);
    return vehicleId;
  }
  const { data: inserted, error } = await supabase
    .from("vehicles")
    .insert({ plate_number: plate, vehicle_type: vtype, default_driver_id: drv, notes })
    .select()
    .single();
  if (error) throw new RuleError(error.message);
  await stampCode("vehicles", inserted.id, "VEH");
  return inserted.id;
}

export async function deleteVehicle(vehicleId: number): Promise<void> {
  const nTrips = await count("invoice_trips", "vehicle_id", vehicleId);
  const nPay = await count("payment_vouchers", "vehicle_id", vehicleId);
  if (nTrips || nPay) {
    throw new RuleError(
      `لا يمكن حذف السيارة لوجود حركات مرتبطة بها (نقلات: ${nTrips}، سندات صيانة: ${nPay}).`
    );
  }
  const { error } = await supabase.from("vehicles").delete().eq("id", vehicleId);
  if (error) throw new RuleError(error.message);
}

// ---------------------------------------------------------------------------
// الخزائن والبنوك
// ---------------------------------------------------------------------------
export async function listAccounts(kind: string): Promise<(Cashbox | Bank)[]> {
  const { data, error } = await supabase.from(accountTable(kind)).select("*").order("code");
  if (error) throw new RuleError(error.message);
  return (data ?? []) as (Cashbox | Bank)[];
}

export async function getAccount(kind: string, accountId: number): Promise<(Cashbox | Bank) | null> {
  const { data } = await supabase.from(accountTable(kind)).select("*").eq("id", accountId).single();
  return (data as Cashbox | Bank) ?? null;
}

export async function saveAccount(
  kind: string,
  data: Record<string, any>,
  accountId?: number | null
): Promise<number> {
  const tbl = accountTable(kind);
  const prefix = kind === "cashbox" ? "CB" : "BNK";
  ensureNotBlank(data.name, "اسم " + accountKindLabel(kind));
  const name = txt(data.name, "الاسم");
  const notes = txt(data.notes ?? "", "الملاحظات");
  const opening = roundMoney(data.opening_balance ?? 0);

  if (kind === "bank") {
    const accountNumber = txt(data.account_number ?? "", "رقم الحساب");
    const iban = txt(data.iban ?? "", "الآيبان");
    if (accountId) {
      const { error } = await supabase
        .from("banks")
        .update({ name, created_date: data.created_date, account_number: accountNumber, iban, opening_balance: opening, notes })
        .eq("id", accountId);
      if (error) throw new RuleError(error.message);
      return accountId;
    }
    const { data: inserted, error } = await supabase
      .from("banks")
      .insert({ name, created_date: data.created_date, account_number: accountNumber, iban, opening_balance: opening, notes })
      .select()
      .single();
    if (error) throw new RuleError(error.message);
    await stampCode("banks", inserted.id, prefix);
    return inserted.id;
  }

  if (accountId) {
    const { error } = await supabase
      .from("cashboxes")
      .update({ name, created_date: data.created_date, opening_balance: opening, notes })
      .eq("id", accountId);
    if (error) throw new RuleError(error.message);
    return accountId;
  }
  const { data: inserted, error } = await supabase
    .from("cashboxes")
    .insert({ name, created_date: data.created_date, opening_balance: opening, notes })
    .select()
    .single();
  if (error) throw new RuleError(error.message);
  await stampCode("cashboxes", inserted.id, prefix);
  return inserted.id;
}

export async function deleteAccount(kind: string, accountId: number): Promise<void> {
  // المطابقة على نوع الحساب أيضاً: الخزائن والبنوك ترقيمهما مستقل وقد يتشابه المعرّف
  const k = { column: "account_kind", value: kind };
  const nRec = await count("receipt_vouchers", "account_id", accountId, k);
  const nPay = await count("payment_vouchers", "account_id", accountId, k);
  const nSal = await count("payrolls", "account_id", accountId, k);
  if (nRec || nPay || nSal) {
    throw new RuleError(
      `لا يمكن الحذف لوجود حركات مرتبطة (قبض: ${nRec}، دفع: ${nPay}، رواتب: ${nSal}).`
    );
  }
  const { error } = await supabase.from(accountTable(kind)).delete().eq("id", accountId);
  if (error) throw new RuleError(error.message);
}

// ---------------------------------------------------------------------------
// فواتير النقل
// ---------------------------------------------------------------------------
export async function listInvoicesRaw(): Promise<(Invoice & { customer_name: string })[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("date", { ascending: false })
    .order("number", { ascending: false });
  if (error) throw new RuleError(error.message);
  const { data: custs } = await supabase.from("customers").select("id, name");
  const custMap = new Map((custs ?? []).map((c) => [c.id, c.name]));
  return (data ?? []).map((i) => ({ ...i, customer_name: custMap.get(i.customer_id) ?? "—" }));
}

export async function saveInvoice(data: Record<string, any>, invoiceId?: number | null): Promise<number> {
  const date = String(data.date ?? "");
  ensureNotBlank(date, "تاريخ الفاتورة");
  if (!data.customer_id) throw new RuleError("اختر العميل.");
  const trips: Record<string, any>[] = data.trips ?? [];
  if (!trips.length) throw new RuleError("أضف نقلة واحدة على الأقل للفاتورة.");
  const notes = txt(data.notes ?? "", "ملاحظات الفاتورة");

  for (const t of trips) {
    t.from_loc = txt(t.from_loc ?? "", "مكان الانطلاق");
    t.to_loc = txt(t.to_loc ?? "", "مكان الوصول");
    t.notes = txt(t.notes ?? "", "ملاحظات النقلة");
    for (const e of t.expenses ?? []) {
      e.notes = txt(e.notes ?? "", "بيان المصروف");
    }
  }
  for (const t of trips) {
    const qty = Math.max(1, Math.trunc(num(t.qty ?? 1)));
    t.qty = qty;
    t.unit_price = roundMoney(t.unit_price ?? (num(t.price) / qty));
    t.price = roundMoney(qty * t.unit_price);
    if (t.price <= 0) throw new RuleError("سعر النقلة يجب أن يكون أكبر من صفر.");
    for (const e of t.expenses ?? []) {
      const eq = num(e.qty ?? 1) || 1;
      e.qty = eq;
      e.unit_amount = roundMoney(e.unit_amount ?? (num(e.amount) / eq));
      e.amount = roundMoney(eq * e.unit_amount);
      if (e.amount <= 0) throw new RuleError("مبلغ مصروف النقلة يجب أن يكون أكبر من صفر.");
      const src = e.source ?? "cash";
      if (!["cash", "driver", "supplier", "customer"].includes(src)) {
        throw new RuleError("مصدر تمويل المصروف غير صالح.");
      }
      e.source = src;
      if (src === "cash" && (!e.account_kind || !e.account_id)) {
        throw new RuleError("اختر الخزينة أو البنك الذي صُرف منه المصروف النقدي.");
      }
      if (src === "driver" && !t.driver_id) {
        throw new RuleError("حدّد السائق في النقلة قبل تسجيل مصروف من عهدته.");
      }
    }
  }

  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const vatRate = num(data.vat_rate) > 0 ? num(data.vat_rate) : await currentVatRate();

  // تحقق مبكر (لرسائل خطأ ودّية) — الدالة الخادمية تعيد التحقق بصلاحية كاملة
  if (invoiceId) {
    const { data: old } = await supabase.from("invoices").select("date").eq("id", invoiceId).single();
    if (!old) throw new RuleError("الفاتورة غير موجودة.");
    await ensureMovementEditable(old.date, date);
  } else {
    await ensureDateInOpenYear(date);
  }

  // حفظ ذرّي (رأس + نقلات + مصروفات + ترقيم مُقفَل) في معاملة واحدة
  const tripsPayload = trips.map((t) => ({
    id: t.id ? Number(t.id) : null,
    vehicle_id: t.vehicle_id ?? null,
    driver_id: t.driver_id ?? null,
    from_loc: t.from_loc ?? "",
    to_loc: t.to_loc ?? "",
    qty: t.qty ?? 1,
    unit_price: roundMoney(t.unit_price ?? 0),
    price: roundMoney(t.price ?? 0),
    notes: t.notes ?? "",
    expenses: (t.expenses ?? []).map((e: any) => ({
      expense_type: e.expense_type,
      qty: e.qty ?? 1,
      unit_amount: roundMoney(e.unit_amount ?? 0),
      amount: roundMoney(e.amount ?? 0),
      source: e.source ?? "cash",
      account_kind: e.source === "cash" ? (e.account_kind ?? null) : null,
      account_id: e.source === "cash" && e.account_id ? Number(e.account_id) : null,
      supplier_name: e.supplier_name ?? "",
      notes: e.notes ?? "",
    })),
  }));

  // منع الرصيد السالب: مجموع المصروفات النقدية لكل جهة صرف (مع استثناء
  // السندات التلقائية القديمة لهذه الفاتورة لأنها ستُستبدل)
  const cashNeeded = new Map<string, number>();
  for (const t of tripsPayload) {
    for (const e of t.expenses) {
      if (e.source !== "cash" || !e.account_kind || !e.account_id) continue;
      const key = `${e.account_kind}:${e.account_id}`;
      cashNeeded.set(key, (cashNeeded.get(key) ?? 0) + e.amount);
    }
  }
  if (cashNeeded.size) {
    let oldExpenseIds: number[] = [];
    if (invoiceId) {
      const { data: oldTrips } = await supabase.from("invoice_trips").select("id").eq("invoice_id", invoiceId);
      const oldTripIds = (oldTrips ?? []).map((t) => t.id);
      if (oldTripIds.length) {
        const { data: oldExps } = await supabase.from("trip_expenses").select("id").in("trip_id", oldTripIds);
        oldExpenseIds = (oldExps ?? []).map((e) => e.id);
      }
    }
    for (const [key, amount] of cashNeeded) {
      const [kind, accId] = key.split(":");
      await ensureSufficientFunds(kind, Number(accId), amount, { sourceExpenseIds: oldExpenseIds });
    }
  }

  const { data: savedId, error } = await supabase.rpc("save_invoice", {
    p_invoice_id: invoiceId ?? null,
    p_date: date,
    p_customer_id: data.customer_id,
    p_vat_rate: vatRate,
    p_notes: notes,
    p_attachments: attachments,
    p_trips: tripsPayload,
  });
  if (error) throw new RuleError(error.message);
  return savedId as number;
}

export async function deleteInvoice(invoiceId: number): Promise<void> {
  const { data: inv } = await supabase.from("invoices").select("date").eq("id", invoiceId).single();
  if (!inv) return;
  await ensureMovementEditable(inv.date);

  const { data: trips } = await supabase.from("invoice_trips").select("id").eq("invoice_id", invoiceId);
  const tripIds = (trips ?? []).map((t) => t.id);
  let linked = 0;
  if (tripIds.length) {
    const { count: c } = await supabase
      .from("payment_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("voucher_type", "trip")
      // السندات المتولّدة تلقائياً من مصروفات الفاتورة تُحذف معها تتابعياً
      .is("source_expense_id", null)
      .in("trip_id", tripIds);
    linked = c ?? 0;
  }
  if (linked) {
    throw new RuleError(
      "لا يمكن حذف الفاتورة: توجد سندات دفع (مصروفات رحلات) مرتبطة بنقلاتها.\nاحذف السندات المرتبطة أولاً."
    );
  }
  const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
  if (error) throw new RuleError(error.message);
}

async function ensureAccountExists(kind: string, accountId: number): Promise<void> {
  const a = await getAccount(kind, accountId);
  if (!a) {
    throw new RuleError(`جهة ${accountKindLabel(kind)} المحددة غير موجودة.`);
  }
}

// ---------------------------------------------------------------------------
// سندات القبض
// ---------------------------------------------------------------------------
export async function listReceipts(
  dFrom?: string | null,
  dTo?: string | null,
  voucherType?: string | null
): Promise<ReceiptVoucher[]> {
  let q = supabase.from("receipt_vouchers").select("*").order("date", { ascending: false }).order("number", { ascending: false });
  if (dFrom) q = q.gte("date", dFrom);
  if (dTo) q = q.lte("date", dTo);
  if (voucherType) q = q.eq("voucher_type", voucherType);
  const { data, error } = await q;
  if (error) throw new RuleError(error.message);

  // جداول المسمّيات تُجلب على التوازي بدل التسلسل
  const [{ data: custs }, { data: cbs }, { data: bks }] = await Promise.all([
    supabase.from("customers").select("id, name"),
    supabase.from("cashboxes").select("id, name"),
    supabase.from("banks").select("id, name"),
  ]);
  const custMap = new Map((custs ?? []).map((c) => [c.id, c.name]));
  const cbMap = new Map((cbs ?? []).map((c) => [c.id, c.name]));
  const bkMap = new Map((bks ?? []).map((b) => [b.id, b.name]));

  return (data ?? []).map((v) => ({
    ...v,
    customer_name: custMap.get(v.customer_id ?? 0) ?? null,
    account_name: v.account_kind === "cashbox" ? cbMap.get(v.account_id) ?? null : bkMap.get(v.account_id) ?? null,
  }));
}

export async function saveReceipt(data: Record<string, any>, voucherId?: number | null): Promise<number> {
  const date = String(data.date ?? "");
  const amount = roundMoney(data.amount ?? 0);
  ensureNotBlank(date, "تاريخ السند");
  ensurePositive(amount, "المبلغ");
  if (data.voucher_type !== "customer" && data.voucher_type !== "other") {
    throw new RuleError("اختر نوع السند.");
  }
  if (data.voucher_type === "customer" && !data.customer_id) {
    throw new RuleError("اختر العميل المحصَّل منه.");
  }
  const description = txt(data.description ?? "", "البيان");
  if ((data.account_kind !== "cashbox" && data.account_kind !== "bank") || !data.account_id) {
    throw new RuleError("اختر جهة الإيداع (خزينة أو بنك).");
  }
  await ensureAccountExists(data.account_kind, data.account_id);

  let customerId: number | null = null;
  if (data.voucher_type === "customer") {
    const c = await getCustomer(data.customer_id);
    if (!c) throw new RuleError("العميل المحدد غير موجود.");
    customerId = data.customer_id;
  }

  const row = {
    date,
    account_kind: data.account_kind,
    account_id: data.account_id,
    voucher_type: data.voucher_type,
    customer_id: customerId,
    amount,
    description,
  };

  if (voucherId) {
    const { data: old } = await supabase.from("receipt_vouchers").select("date").eq("id", voucherId).single();
    if (!old) throw new RuleError("السند غير موجود.");
    await ensureMovementEditable(old.date, date);
    const { error } = await supabase.from("receipt_vouchers").update(row).eq("id", voucherId);
    if (error) throw new RuleError(error.message);
    return voucherId;
  }
  await ensureDateInOpenYear(date);
  const inserted = await insertNumbered<{ id: number }>("receipt_vouchers", row);
  return inserted.id;
}

export async function getReceipt(voucherId: number): Promise<ReceiptVoucher | null> {
  const { data } = await supabase.from("receipt_vouchers").select("*").eq("id", voucherId).maybeSingle();
  return (data as ReceiptVoucher) ?? null;
}

export async function deleteReceipt(voucherId: number): Promise<void> {
  const { data: v } = await supabase.from("receipt_vouchers").select("date").eq("id", voucherId).single();
  if (!v) return;
  await ensureMovementEditable(v.date);
  const { error } = await supabase.from("receipt_vouchers").delete().eq("id", voucherId);
  if (error) throw new RuleError(error.message);
}

// ---------------------------------------------------------------------------
// سندات الدفع
// ---------------------------------------------------------------------------
export async function listPayments(
  dFrom?: string | null,
  dTo?: string | null,
  voucherType?: string | null
): Promise<PaymentVoucher[]> {
  let q = supabase.from("payment_vouchers").select("*").order("date", { ascending: false }).order("number", { ascending: false });
  if (dFrom) q = q.gte("date", dFrom);
  if (dTo) q = q.lte("date", dTo);
  if (voucherType) q = q.eq("voucher_type", voucherType);
  const { data, error } = await q;
  if (error) throw new RuleError(error.message);

  // كل جداول المسمّيات على التوازي (كانت ثمانية استعلامات متتابعة)
  const [
    { data: emps }, { data: vehs }, { data: trips }, { data: invs },
    { data: custs }, { data: cbs }, { data: bks }, { data: sups },
  ] = await Promise.all([
    supabase.from("employees").select("id, name"),
    supabase.from("vehicles").select("id, plate_number"),
    supabase.from("invoice_trips").select("id, invoice_id"),
    supabase.from("invoices").select("id, number, customer_id"),
    supabase.from("customers").select("id, name"),
    supabase.from("cashboxes").select("id, name"),
    supabase.from("banks").select("id, name"),
    supabase.from("suppliers").select("id, name"),
  ]);

  const supMap = new Map((sups ?? []).map((x) => [x.id, x.name]));
  const empMap = new Map((emps ?? []).map((e) => [e.id, e.name]));
  const vehMap = new Map((vehs ?? []).map((v) => [v.id, v.plate_number]));
  const tripMap = new Map((trips ?? []).map((t) => [t.id, t.invoice_id]));
  const invMap = new Map((invs ?? []).map((i) => [i.id, i]));
  const custMap = new Map((custs ?? []).map((c) => [c.id, c.name]));
  const cbMap = new Map((cbs ?? []).map((c) => [c.id, c.name]));
  const bkMap = new Map((bks ?? []).map((b) => [b.id, b.name]));

  return (data ?? []).map((v) => {
    const invId = v.trip_id ? tripMap.get(v.trip_id) : null;
    const inv = invId ? invMap.get(invId) : null;
    return {
      ...v,
      employee_name: empMap.get(v.employee_id ?? 0) ?? null,
      plate_number: vehMap.get(v.vehicle_id ?? 0) ?? null,
      inv_number: inv?.number ?? null,
      customer_name: inv ? custMap.get(inv.customer_id) ?? null : null,
      supplier_name: supMap.get(v.supplier_id ?? 0) ?? null,
      account_name: v.account_kind === "cashbox" ? cbMap.get(v.account_id) ?? null : bkMap.get(v.account_id) ?? null,
    };
  });
}

async function validatePayment(data: Record<string, any>): Promise<void> {
  const vt = data.voucher_type;
  if (!["trip", "advance", "vehicle", "general", "supplier"].includes(vt)) {
    throw new RuleError("اختر نوع السند.");
  }
  const amount = roundMoney(data.amount ?? 0);
  ensurePositive(amount);
  if ((data.account_kind !== "cashbox" && data.account_kind !== "bank") || !data.account_id) {
    throw new RuleError("اختر جهة الصرف (خزينة أو بنك).");
  }
  await ensureAccountExists(data.account_kind, data.account_id);
  if (vt === "trip" && !data.trip_id) throw new RuleError("اختر الرحلة (النقلة) التي يخصها المصروف.");
  if (vt === "advance" && !data.employee_id) throw new RuleError("اختر الموظف/السائق للسلفة.");
  if (vt === "vehicle" && !data.vehicle_id) throw new RuleError("اختر السيارة لمصروف الصيانة.");
  if (vt === "supplier" && !data.supplier_id) throw new RuleError("اختر المورّد المستفيد من السداد.");
  if (vt === "supplier") {
    const { data: sup } = await supabase.from("suppliers").select("id").eq("id", data.supplier_id).maybeSingle();
    if (!sup) throw new RuleError("المورّد المحدد غير موجود.");
  }
  if (data.trip_id) {
    const { data: t } = await supabase.from("invoice_trips").select("id").eq("id", data.trip_id).single();
    if (!t) throw new RuleError("الرحلة المحددة غير موجودة.");
  }
  if (vt === "advance" && !(await getEmployee(data.employee_id))) {
    throw new RuleError("الموظف المحدد غير موجود.");
  }
  if (vt === "vehicle" && !(await getVehicle(data.vehicle_id))) {
    throw new RuleError("السيارة المحددة غير موجودة.");
  }
}

export async function savePayment(data: Record<string, any>, voucherId?: number | null): Promise<number> {
  const date = String(data.date ?? "");
  ensureNotBlank(date, "تاريخ السند");
  await validatePayment(data);

  const row = {
    date,
    account_kind: data.account_kind,
    account_id: data.account_id,
    voucher_type: data.voucher_type,
    trip_id: data.voucher_type === "trip" ? data.trip_id ?? null : null,
    employee_id: data.voucher_type === "advance" ? data.employee_id ?? null : null,
    vehicle_id: data.voucher_type === "vehicle" ? data.vehicle_id ?? null : null,
    vehicle_expense: data.voucher_type === "vehicle" ? data.vehicle_expense ?? "" : "",
    supplier_id: data.voucher_type === "supplier" ? data.supplier_id ?? null : null,
    purchase_invoice_id: data.voucher_type === "supplier" ? data.purchase_invoice_id ?? null : null,
    amount: roundMoney(data.amount ?? 0),
    description: txt(data.description ?? "", "البيان"),
  };

  if (voucherId) {
    const { data: old } = await supabase
      .from("payment_vouchers")
      .select("date, voucher_type")
      .eq("id", voucherId)
      .single();
    if (!old) throw new RuleError("السند غير موجود.");
    if (old.voucher_type === "advance") {
      const { count: settled } = await supabase
        .from("advance_settlements")
        .select("id", { count: "exact", head: true })
        .eq("payment_voucher_id", voucherId);
      if (settled) {
        throw new RuleError(
          "لا يمكن تعديل سلفة تم خصم جزء/كل منها في مسير رواتب.\nاحذف الرواتب المرتبطة بها أولاً ثم عدّل السلفة."
        );
      }
    }
    await ensureMovementEditable(old.date, date);
    await ensureSufficientFunds(row.account_kind, row.account_id, row.amount, { paymentId: voucherId });
    const { error } = await supabase.from("payment_vouchers").update(row).eq("id", voucherId);
    if (error) throw new RuleError(error.message);
    return voucherId;
  }
  await ensureDateInOpenYear(date);
  await ensureSufficientFunds(row.account_kind, row.account_id, row.amount);
  const inserted = await insertNumbered<{ id: number }>("payment_vouchers", row);
  return inserted.id;
}

export async function getPayment(voucherId: number): Promise<PaymentVoucher | null> {
  const { data } = await supabase.from("payment_vouchers").select("*").eq("id", voucherId).maybeSingle();
  return (data as PaymentVoucher) ?? null;
}

export async function deletePayment(voucherId: number): Promise<void> {
  const { data: v } = await supabase
    .from("payment_vouchers")
    .select("date, voucher_type")
    .eq("id", voucherId)
    .single();
  if (!v) return;
  if (v.voucher_type === "advance") {
    const { count: settled } = await supabase
      .from("advance_settlements")
      .select("id", { count: "exact", head: true })
      .eq("payment_voucher_id", voucherId);
    if (settled) {
      throw new RuleError("لا يمكن حذف سلفة تم خصمها في مسير رواتب.\nاحذف الرواتب المرتبطة بها أولاً.");
    }
  }
  await ensureMovementEditable(v.date);
  const { error } = await supabase.from("payment_vouchers").delete().eq("id", voucherId);
  if (error) throw new RuleError(error.message);
}

// ---------------------------------------------------------------------------
// السلف
// ---------------------------------------------------------------------------
export async function employeeAdvances(
  employeeId: number,
  includeSettled = true
): Promise<(PaymentVoucher & { settled: number; remaining: number })[]> {
  const { data } = await supabase
    .from("payment_vouchers")
    .select("*")
    .eq("voucher_type", "advance")
    .eq("employee_id", employeeId)
    .order("date")
    .order("id");
  const out: (PaymentVoucher & { settled: number; remaining: number })[] = [];
  for (const r of data ?? []) {
    const { data: settles } = await supabase
      .from("advance_settlements")
      .select("amount")
      .eq("payment_voucher_id", r.id);
    const settled = (settles ?? []).reduce((a, s) => a + num(s.amount), 0);
    const remaining = num(r.amount) - settled;
    if (!includeSettled && remaining <= 0.009) continue;
    out.push({ ...r, settled, remaining });
  }
  return out;
}

// ---------------------------------------------------------------------------
// الرواتب
// ---------------------------------------------------------------------------
export async function listPayrolls(
  dFrom?: string | null,
  dTo?: string | null,
  employeeId?: number | null
): Promise<Payroll[]> {
  let q = supabase.from("payrolls").select("*").order("date", { ascending: false }).order("number", { ascending: false });
  if (dFrom) q = q.gte("date", dFrom);
  if (dTo) q = q.lte("date", dTo);
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q;
  if (error) throw new RuleError(error.message);

  const { data: emps } = await supabase.from("employees").select("id, name, emp_type");
  const { data: cbs } = await supabase.from("cashboxes").select("id, name");
  const { data: bks } = await supabase.from("banks").select("id, name");
  const empMap = new Map((emps ?? []).map((e) => [e.id, e]));
  const cbMap = new Map((cbs ?? []).map((c) => [c.id, c.name]));
  const bkMap = new Map((bks ?? []).map((b) => [b.id, b.name]));

  return (data ?? []).map((p) => {
    const emp = empMap.get(p.employee_id);
    return {
      ...p,
      employee_name: emp?.name ?? "—",
      emp_type: emp?.emp_type ?? "—",
      account_name: p.account_kind === "cashbox" ? cbMap.get(p.account_id) ?? null : bkMap.get(p.account_id) ?? null,
    };
  });
}

export async function getPayroll(payrollId: number): Promise<Payroll | null> {
  const { data } = await supabase.from("payrolls").select("*").eq("id", payrollId).single();
  if (!data) return null;
  const { data: settles } = await supabase
    .from("advance_settlements")
    .select("*, payment_vouchers(number, date)")
    .eq("payroll_id", payrollId);
  const settlements = (settles ?? []).map((s) => ({
    ...s,
    voucher_number: Array.isArray(s.payment_vouchers) ? (s.payment_vouchers as any[])[0]?.number : (s.payment_vouchers as any)?.number,
    voucher_date: Array.isArray(s.payment_vouchers) ? (s.payment_vouchers as any[])[0]?.date : (s.payment_vouchers as any)?.date,
  }));
  return { ...(data as Payroll), settlements };
}

export async function savePayroll(data: Record<string, any>, payrollId?: number | null): Promise<number> {
  const date = String(data.date ?? "");
  ensureNotBlank(date, "تاريخ الصرف");
  if (!data.employee_id) throw new RuleError("اختر الموظف/السائق.");
  if (!(await getEmployee(data.employee_id))) throw new RuleError("الموظف المحدد غير موجود.");
  if ((data.account_kind !== "cashbox" && data.account_kind !== "bank") || !data.account_id) {
    throw new RuleError("اختر جهة الصرف (خزينة أو بنك).");
  }
  await ensureAccountExists(data.account_kind, data.account_id);

  const base = roundMoney(data.base_salary ?? 0);
  const additions = roundMoney(data.additions ?? 0);
  const otherDed = roundMoney(data.other_deductions ?? 0);
  ensurePositive(base, "الراتب الأساسي");

  const pMonth = Number(data.period_month);
  const pYear = Number(data.period_year);
  if (!Number.isFinite(pMonth) || !Number.isFinite(pYear)) throw new RuleError("شهر/سنة الراتب غير صالحة.");
  if (pMonth < 1 || pMonth > 12) throw new RuleError("شهر الراتب يجب أن يكون بين 1 و 12.");
  if (pYear < 1900 || pYear > 2200) throw new RuleError("سنة الراتب غير منطقية.");
  if (additions < 0 || otherDed < 0) throw new RuleError("لا يمكن إدخال قيم سالبة في الإضافات أو الخصومات.");

  // يقبل صيغتين (حماية من اختلاف شكل المدخلات بين الواجهات):
  //   صفوف [معرّف السلفة, المبلغ] أو كائنات { payment_voucher_id, amount }
  const settlements: [number, number][] = (data.settlements ?? []).map((s: any) => {
    if (Array.isArray(s)) return [Number(s[0]), roundMoney(s[1])];
    const vid = s.payment_voucher_id ?? s.voucher_id ?? s.id;
    return [Number(vid), roundMoney(s.amount)];
  });
  const totalSettled = Math.round(settlements.reduce((a, [, amt]) => a + amt, 0) * 100) / 100;
  const advDed = roundMoney(data.advance_deduction ?? totalSettled);
  if (advDed < 0) throw new RuleError("لا يمكن إدخال قيم سالبة في الإضافات أو الخصومات.");
  if (Math.abs(totalSettled - advDed) > 0.01) {
    throw new RuleError("مجموع خصومات السلف الموزعة لا يطابق قيمة الخصم من السلف.");
  }

  const remMap = new Map<number, number>();
  for (const a of await employeeAdvances(data.employee_id)) {
    remMap.set(a.id, a.remaining);
  }
  if (payrollId) {
    const { data: existing } = await supabase
      .from("advance_settlements")
      .select("payment_voucher_id, amount")
      .eq("payroll_id", payrollId);
    for (const s of existing ?? []) {
      remMap.set(s.payment_voucher_id, (remMap.get(s.payment_voucher_id) ?? 0) + num(s.amount));
    }
  }

  for (const [vid, amt] of settlements) {
    if (amt <= 0) continue;
    if (!remMap.has(vid)) throw new RuleError("سلفة غير موجودة أو لا تخص هذا الموظف.");
    if (amt > (remMap.get(vid) ?? 0) + 0.01) {
      throw new RuleError("قيمة الخصم من إحدى السلف أكبر من المتبقي منها.");
    }
  }

  const net = Math.round((base + additions - advDed - otherDed) * 100) / 100;
  if (net < 0) throw new RuleError("صافي الراتب سالب: راجع الإضافات والخصومات.");

  // تحقق مبكر (لرسائل خطأ ودّية) — الدالة الخادمية تعيد التحقق بصلاحية كاملة
  if (payrollId) {
    const { data: old } = await supabase.from("payrolls").select("date").eq("id", payrollId).single();
    if (!old) throw new RuleError("الراتب غير موجود.");
    await ensureMovementEditable(old.date, date);
  } else {
    await ensureDateInOpenYear(date);
  }

  await ensureSufficientFunds(data.account_kind, data.account_id, net, { payrollId: payrollId ?? null });

  // حفظ ذرّي (صف الراتب + تسويات السلف + ترقيم مُقفَل) في معاملة واحدة
  const { data: savedId, error } = await supabase.rpc("save_payroll", {
    p_payroll_id: payrollId ?? null,
    p_date: date,
    p_employee_id: data.employee_id,
    p_period_year: pYear,
    p_period_month: pMonth,
    p_account_kind: data.account_kind,
    p_account_id: data.account_id,
    p_base_salary: base,
    p_additions: additions,
    p_additions_note: txt(data.additions_note ?? "", "بيان الإضافات"),
    p_advance_deduction: advDed,
    p_other_deductions: otherDed,
    p_notes: txt(data.notes ?? "", "الملاحظات"),
    p_settlements: settlements,
  });
  if (error) throw new RuleError(error.message);
  return savedId as number;
}

export async function deletePayroll(payrollId: number): Promise<void> {
  const { data: p } = await supabase.from("payrolls").select("date").eq("id", payrollId).single();
  if (!p) return;
  await ensureMovementEditable(p.date);
  const { error } = await supabase.from("payrolls").delete().eq("id", payrollId);
  if (error) throw new RuleError(error.message);
}
