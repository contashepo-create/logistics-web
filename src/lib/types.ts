// الأنواع المطابقة لأعمدة قاعدة البيانات (snake_case كما في المصدر)

export interface Settings {
  company_id?: string;
  key: string;
  value: string;
}

/** الشركة — وحدة العزل والاشتراك. */
export interface Company {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  vat_rate: number;
  vat_note: string;
  plan_type: "trial" | "monthly" | "yearly" | "open";
  /** رقم العميل الفريد (8 خانات عشوائية غير متتابعة). */
  client_code?: string;
  trial_end: string | null;
  subscription_start: string | null;
  subscription_end: string | null; // null = مفتوح بلا تحديد
  is_active: boolean;
  created_at?: string;
}

/** الملف الشخصي — رابط المستخدم بشركته (بلا نظام أدوار/صلاحيات). */
export interface Profile {
  id: string;
  company_id: string | null;
  email: string;
  name: string;
  created_at?: string;
}

export interface FinancialYear {
  id: number;
  year: number;
  date_from: string;
  date_to: string;
  status: "open" | "closed";
  notes: string;
}

export interface Customer {
  id: number;
  code: string;
  name: string;
  address: string;
  phone: string;
  opening_balance: number;
  notes: string;
  created_at?: string;
}

export interface Employee {
  id: number;
  code: string;
  name: string;
  nationality: string;
  phone: string;
  emp_type: "driver" | "admin";
  /** الراتب الشهري الأساسي المسجّل (يُقترح تلقائياً في المسير) */
  base_salary: number;
  notes: string;
  created_at?: string;
}

export interface Vehicle {
  id: number;
  code: string;
  plate_number: string;
  vehicle_type: string;
  default_driver_id: number | null;
  notes: string;
  driver_name?: string;
  created_at?: string;
}

export interface Cashbox {
  id: number;
  code: string;
  name: string;
  created_date: string;
  opening_balance: number;
  notes: string;
  created_at?: string;
}

export interface Bank {
  id: number;
  code: string;
  name: string;
  created_date: string;
  account_number: string;
  iban: string;
  opening_balance: number;
  notes: string;
  created_at?: string;
}

export interface Invoice {
  id: number;
  number: number;
  date: string;
  customer_id: number;
  vat_rate: number;
  notes: string;
  attachments: string[];
  created_at?: string;
}

export interface InvoiceTrip {
  id?: number;
  invoice_id?: number;
  vehicle_id: number | null;
  driver_id: number | null;
  from_loc: string;
  to_loc: string;
  /** عدد النقلات لنفس الوجهة */
  qty: number;
  /** سعر النقلة الواحدة */
  unit_price: number;
  /** إجمالي السطر = qty × unit_price */
  price: number;
  notes: string;
  expenses: TripExpense[];
}

/** مصدر تمويل مصروف النقلة. */
export type ExpenseSource = "cash" | "driver" | "supplier" | "customer";

export interface TripExpense {
  id?: number;
  trip_id?: number;
  expense_type: "trip" | "fuel" | "card" | "other";
  /** العدد (مثال: 3 كارتات) */
  qty: number;
  /** قيمة الوحدة */
  unit_amount: number;
  /** الإجمالي = qty × unit_amount */
  amount: number;
  /** من أين مُوِّل المصروف */
  source: ExpenseSource;
  /** للمصروف النقدي فقط: الخزينة/البنك المصروف منه */
  account_kind?: "cashbox" | "bank" | null;
  account_id?: number | null;
  /** للمصروف الآجل: اسم المورد/المحطة */
  supplier_name?: string;
  notes: string;
}

export interface ReceiptVoucher {
  id: number;
  number: number;
  date: string;
  account_kind: "cashbox" | "bank";
  account_id: number;
  voucher_type: "customer" | "other";
  customer_id: number | null;
  amount: number;
  description: string;
  created_at?: string;
  // انضمامات للعرض
  customer_name?: string | null;
  account_name?: string | null;
}

export interface PaymentVoucher {
  id: number;
  number: number;
  date: string;
  account_kind: "cashbox" | "bank";
  account_id: number;
  voucher_type: "trip" | "advance" | "vehicle" | "general";
  trip_id: number | null;
  employee_id: number | null;
  vehicle_id: number | null;
  vehicle_expense: string;
  amount: number;
  description: string;
  created_at?: string;
  // انضمامات للعرض
  employee_name?: string | null;
  plate_number?: string | null;
  customer_name?: string | null;
  inv_number?: number | null;
  account_name?: string | null;
}

export interface Payroll {
  id: number;
  number: number;
  date: string;
  employee_id: number;
  period_year: number;
  period_month: number;
  account_kind: "cashbox" | "bank";
  account_id: number;
  base_salary: number;
  additions: number;
  additions_note: string;
  advance_deduction: number;
  other_deductions: number;
  net_salary: number;
  notes: string;
  created_at?: string;
  employee_name?: string;
  emp_type?: string;
  account_name?: string | null;
  settlements?: AdvanceSettlementRow[];
}

export interface AdvanceSettlement {
  id: number;
  payment_voucher_id: number;
  payroll_id: number;
  amount: number;
}

export interface AdvanceSettlementRow {
  id: number;
  payment_voucher_id: number;
  payroll_id: number;
  amount: number;
  voucher_number: number;
  voucher_date: string;
}

export interface YearSnapshot {
  id?: number;
  year_id: number;
  created_at?: string;
  data: Record<string, unknown>;
}

export type AccountKind = "cashbox" | "bank";
