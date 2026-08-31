// تعبئة بيانات تجريبية واقعية — مكافئ لـ scripts/seed_demo.py
// التشغيل: npm run seed   (يتطلب وجود الجداول أولاً — نفّذ supabase/schema.sql)
// يسجّل الدخول كمستخدم تجريبي (SEED_EMAIL/SEED_PASSWORD) ثم يعبّئ بياناته المعزولة.
// ملاحظة: يجب تعطيل «تأكيد البريد» في Supabase أو تأكيد البريد قبل التشغيل.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error("❌ عرّف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}
const supabase = createClient(url, anonKey, { auth: { persistSession: false } });

const SEED_EMAIL = process.env.SEED_EMAIL || "demo@example.com";
const SEED_PASSWORD = process.env.SEED_PASSWORD || "demo123456";
const SEED_COMPANY = process.env.SEED_COMPANY || "شركة النقل التجريبية";

async function authenticate() {
  // محاولة تسجيل الدخول أولاً
  let { data, error } = await supabase.auth.signInWithPassword({ email: SEED_EMAIL, password: SEED_PASSWORD });
  if (!error && data.session) return;
  // إنشاء حساب جديد
  ({ data, error } = await supabase.auth.signUp({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    options: { data: { name: "مستخدم تجريبي", company_name: SEED_COMPANY } },
  }));
  if (error) throw new Error(`تعذّر إنشاء/تسجيل المستخدم التجريبي: ${error.message}`);
  if (!data.session) {
    throw new Error("الحساب أنشئ لكن تأكيد البريد مطلوب. عطّل «Confirm email» في Supabase أو أكّد البريد ثم أعد التشغيل.");
  }
  // إنشاء الشركة والملف الشخصي عبر دالة خادمية محمية (register_company)
  const { error: rpcErr } = await supabase.rpc("register_company", {
    p_company_name: SEED_COMPANY, p_name: "مستخدم تجريبي", p_phone: "",
  });
  if (rpcErr) throw new Error(`تعذّر إنشاء الشركة: ${rpcErr.message}`);
}

async function nextNumber(table) {
  const { data } = await supabase.from(table).select("number").order("number", { ascending: false }).limit(1);
  return (data && data.length ? Number(data[0].number) : 0) + 1;
}

async function stampCode(table, id, prefix) {
  const code = `${prefix}-${String(id).padStart(4, "0")}`;
  await supabase.from(table).update({ code }).eq("id", id);
  return code;
}

async function insert(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

async function seed() {
  await authenticate();
  const y = new Date().getFullYear();
  const d = (m, day) => `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // السنة
  await insert("financial_years", { year: y, date_from: `${y}-01-01`, date_to: `${y}-12-31`, status: "open", notes: "سنة تشغيلية" });

  // العملاء
  const cust1 = await insert("customers", { name: "مؤسسة الرياض للإنشاءات", phone: "0551112222", address: "الرياض — حي الصناعية", opening_balance: 15000, notes: "عميل مشاريع" });
  await stampCode("customers", cust1.id, "CUST");
  const cust2 = await insert("customers", { name: "شركة مكة للمقاولات", phone: "0563334444", address: "مكة المكرمة", opening_balance: 0, notes: "" });
  await stampCode("customers", cust2.id, "CUST");

  // الموظفون
  const drv1 = await insert("employees", { name: "أحمد الغامدي", nationality: "سعودي", phone: "0501111111", emp_type: "driver", notes: "" });
  await stampCode("employees", drv1.id, "EMP");
  const drv2 = await insert("employees", { name: "خالد المصري", nationality: "مصري", phone: "0502222222", emp_type: "driver", notes: "" });
  await stampCode("employees", drv2.id, "EMP");
  const adm1 = await insert("employees", { name: "سالم الحربي", nationality: "سعودي", phone: "0503333333", emp_type: "admin", notes: "مسؤول حركة" });
  await stampCode("employees", adm1.id, "EMP");

  // السيارات
  const veh1 = await insert("vehicles", { plate_number: "أ ب ج 1234", vehicle_type: "تريلة", default_driver_id: drv1.id, notes: "" });
  await stampCode("vehicles", veh1.id, "VEH");
  const veh2 = await insert("vehicles", { plate_number: "د هـ و 5678", vehicle_type: "سطحة", default_driver_id: drv2.id, notes: "" });
  await stampCode("vehicles", veh2.id, "VEH");

  // الخزينة والبنك
  const cb = await insert("cashboxes", { name: "الخزينة الرئيسية", created_date: `${y}-01-01`, opening_balance: 20000, notes: "" });
  await stampCode("cashboxes", cb.id, "CB");
  const bnk = await insert("banks", { name: "بنك الراجحي — الجاري", created_date: `${y}-01-01`, account_number: "0021156688", iban: "SA00 8000 0000 6080 1016 7519", opening_balance: 80000, notes: "" });
  await stampCode("banks", bnk.id, "BNK");

  // فاتورة 1
  const inv1 = await insert("invoices", { number: await nextNumber("invoices"), date: d(2, 10), customer_id: cust1.id, notes: "مشروع برج الملك", attachments: [] });
  const t1 = await insert("invoice_trips", { invoice_id: inv1.id, vehicle_id: veh1.id, driver_id: drv1.id, from_loc: "الرياض", to_loc: "الدمام", price: 4500, notes: "" });
  await insert("trip_expenses", { trip_id: t1.id, expense_type: "trip", amount: 350, notes: "" });
  await insert("trip_expenses", { trip_id: t1.id, expense_type: "fuel", amount: 260, notes: "" });
  await insert("trip_expenses", { trip_id: t1.id, expense_type: "card", amount: 90, notes: "" });
  const t2 = await insert("invoice_trips", { invoice_id: inv1.id, vehicle_id: veh2.id, driver_id: drv2.id, from_loc: "الرياض", to_loc: "القصيم", price: 3000, notes: "" });
  await insert("trip_expenses", { trip_id: t2.id, expense_type: "trip", amount: 250, notes: "" });
  await insert("trip_expenses", { trip_id: t2.id, expense_type: "fuel", amount: 180, notes: "" });

  // فاتورة 2
  const inv2 = await insert("invoices", { number: await nextNumber("invoices"), date: d(3, 5), customer_id: cust2.id, notes: "", attachments: [] });
  const t3 = await insert("invoice_trips", { invoice_id: inv2.id, vehicle_id: veh1.id, driver_id: drv1.id, from_loc: "جدة", to_loc: "مكة", price: 1800, notes: "" });
  await insert("trip_expenses", { trip_id: t3.id, expense_type: "trip", amount: 150, notes: "" });
  await insert("trip_expenses", { trip_id: t3.id, expense_type: "fuel", amount: 100, notes: "" });

  // سندات قبض
  await insert("receipt_vouchers", { number: await nextNumber("receipt_vouchers"), date: d(2, 25), account_kind: "cashbox", account_id: cb.id, voucher_type: "customer", customer_id: cust1.id, amount: 5000, description: "دفعة تحت الحساب" });
  await insert("receipt_vouchers", { number: await nextNumber("receipt_vouchers"), date: d(3, 12), account_kind: "bank", account_id: bnk.id, voucher_type: "other", customer_id: null, amount: 750, description: "بيع خردة سيارات" });

  // سندات دفع
  await insert("payment_vouchers", { number: await nextNumber("payment_vouchers"), date: d(3, 1), account_kind: "cashbox", account_id: cb.id, voucher_type: "trip", trip_id: t1.id, amount: 220, description: "رسوم تفريغ بالدمام" });
  const adv = await insert("payment_vouchers", { number: await nextNumber("payment_vouchers"), date: d(3, 3), account_kind: "cashbox", account_id: cb.id, voucher_type: "advance", employee_id: drv1.id, amount: 1000, description: "سلفة ظروف خاصة" });
  await insert("payment_vouchers", { number: await nextNumber("payment_vouchers"), date: d(3, 8), account_kind: "bank", account_id: bnk.id, voucher_type: "vehicle", vehicle_id: veh1.id, vehicle_expense: "maintenance", amount: 850, description: "صيانة مكيف" });
  await insert("payment_vouchers", { number: await nextNumber("payment_vouchers"), date: d(3, 15), account_kind: "cashbox", account_id: cb.id, voucher_type: "general", amount: 1200, description: "إيجار المكتب شهري" });

  // رواتب
  const pay1 = await insert("payrolls", { number: await nextNumber("payrolls"), date: d(3, 28), employee_id: drv1.id, period_year: y, period_month: 3, account_kind: "cashbox", account_id: cb.id, base_salary: 3500, additions: 300, additions_note: "مكافئة التزام", advance_deduction: 400, other_deductions: 0, net_salary: 3400, notes: "" });
  await insert("advance_settlements", { payment_voucher_id: adv.id, payroll_id: pay1.id, amount: 400 });
  await insert("payrolls", { number: await nextNumber("payrolls"), date: d(3, 28), employee_id: drv2.id, period_year: y, period_month: 3, account_kind: "cashbox", account_id: cb.id, base_salary: 3200, additions: 0, advance_deduction: 0, other_deductions: 150, net_salary: 3050, notes: "خصم يومي غياب" });

  console.log("✅ تمت تعبئة البيانات التجريبية بنجاح.");
}

seed().catch((e) => {
  console.error("❌ فشلت التعبئة:", e.message);
  process.exit(1);
});
