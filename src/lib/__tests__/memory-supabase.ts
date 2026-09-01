// محاكاة عميل Supabase في الذاكرة لاختبار طبقة الحسابات (calc.ts) والعمليات (repo.ts)
// يدعم السلسلة المستخدمة فعلياً في الكود: from().select().eq()....single() إلخ.

type Row = Record<string, any>;

const DB: Record<string, Row[]> = {};

export function resetDb(): void {
  for (const k of Object.keys(DB)) delete DB[k];
}

export function table(name: string): Row[] {
  if (!DB[name]) DB[name] = [];
  return DB[name];
}

export function seedTable(name: string, rows: Row[]): void {
  DB[name] = rows.map((r) => ({ ...r }));
}

export function nextId(name: string): number {
  const rows = table(name);
  return rows.reduce((m, r) => (typeof r.id === "number" && r.id > m ? r.id : m), 0) + 1;
}

// محاكاة سباق الترقيم: يجعل الإدراج التالي للجدول يفشل برمز 23505 (تكرار رقم)
const collisionCounters: Record<string, number> = {};
export function forceCollision(name: string, times = 1): void {
  collisionCounters[name] = (collisionCounters[name] ?? 0) + times;
}
const NUMBERED_TABLES = new Set(["invoices", "receipt_vouchers", "payment_vouchers", "payrolls", "credit_debit_notes"]);
// جداول العزل: يحاكي حارس set_company_id (يفرض company_id من المستخدم الحالي)
const TENANT_TABLES = new Set([
  "financial_years", "customers", "employees", "vehicles", "cashboxes", "banks",
  "invoices", "invoice_trips", "trip_expenses", "receipt_vouchers",
  "payment_vouchers", "payrolls", "advance_settlements", "year_snapshots", "activation_requests",
  "credit_debit_notes",
]);

// ---------------------------------------------------------------------------
// علاقات التضمين (embedded select): employees(name) / payrolls(...) / payment_vouchers(...)
// ---------------------------------------------------------------------------
const EMBED_FK: Record<string, Record<string, string>> = {
  payrolls: { employees: "employee_id" },
  advance_settlements: { payrolls: "payroll_id", payment_vouchers: "payment_voucher_id" },
  credit_debit_notes: { invoices: "invoice_id", customers: "customer_id" },
};

function resolveEmbeds(parentTable: string, row: Row, selectCols: string[]): Row {
  const out = { ...row };
  for (const col of selectCols) {
    const m = col.match(/^([a-z_]+)\s*\(([^)]*)\)$/);
    if (!m) continue;
    const rel = m[1];
    const fk = EMBED_FK[parentTable]?.[rel];
    if (!fk) continue;
    const fkVal = row[fk];
    const relRow = table(rel).find((r) => r.id === fkVal);
    if (!relRow) {
      out[rel] = null;
      continue;
    }
    const pick = m[2].split(",").map((s) => s.trim()).filter(Boolean);
    const obj: Row = {};
    for (const p of pick) obj[p] = relRow[p];
    out[rel] = obj;
  }
  return out;
}

// ---------------------------------------------------------------------------
// محرك الاستعلام
// ---------------------------------------------------------------------------
interface Filter {
  op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "is";
  col: string;
  val: any;
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col];
  switch (f.op) {
    case "is":
      return (row[f.col] ?? null) === (f.val ?? null);
    case "eq":
      return v === f.val;
    case "neq":
      return v !== f.val;
    case "lt":
      return v < f.val;
    case "lte":
      return v <= f.val;
    case "gt":
      return v > f.val;
    case "gte":
      return v >= f.val;
    case "in":
      return Array.isArray(f.val) && f.val.includes(v);
    default:
      return false;
  }
}

type OrderSpec = { col: string; asc: boolean };

class MemQuery {
  private filters: Filter[] = [];
  private orders: OrderSpec[] = [];
  private limitN: number | null = null;
  private single_ = false;
  private maybeSingle_ = false;
  private countExact = false;
  private head = false;
  private selectCols: string[] = ["*"];
  private pendingWrite: { op: "insert" | "update" | "delete" | "upsert"; payload?: Row | Row[] } | null = null;

  constructor(private tname: string) {}

  select(cols: string | Record<string, unknown> = "*", opts?: { count?: string; head?: boolean }): MemQuery {
    if (typeof cols === "string") {
      // تقسيم يحترم الأقواس: "a, b, rel(x, y)" ⇒ ["a","b","rel(x, y)"]
      const parts: string[] = [];
      let depth = 0, cur = "";
      for (const ch of cols) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
        cur += ch;
      }
      parts.push(cur);
      this.selectCols = parts.map((s) => s.trim()).filter(Boolean);
    } else {
      this.selectCols = ["*"];
    }
    if (opts?.count === "exact") this.countExact = true;
    if (opts?.head) this.head = true;
    return this;
  }

  eq(col: string, val: any): MemQuery { this.filters.push({ op: "eq", col, val }); return this; }
  neq(col: string, val: any): MemQuery { this.filters.push({ op: "neq", col, val }); return this; }
  lt(col: string, val: any): MemQuery { this.filters.push({ op: "lt", col, val }); return this; }
  lte(col: string, val: any): MemQuery { this.filters.push({ op: "lte", col, val }); return this; }
  gt(col: string, val: any): MemQuery { this.filters.push({ op: "gt", col, val }); return this; }
  gte(col: string, val: any): MemQuery { this.filters.push({ op: "gte", col, val }); return this; }
  in(col: string, val: any[]): MemQuery { this.filters.push({ op: "in", col, val }); return this; }
  is(col: string, val: any): MemQuery { this.filters.push({ op: "is", col, val }); return this; }

  order(col: string, opts?: { ascending?: boolean }): MemQuery {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number): MemQuery { this.limitN = n; return this; }

  insert(payload: Row | Row[]): MemQuery { this.pendingWrite = { op: "insert", payload }; return this; }
  update(payload: Row): MemQuery { this.pendingWrite = { op: "update", payload }; return this; }
  upsert(payload: Row | Row[]): MemQuery { this.pendingWrite = { op: "upsert", payload }; return this; }
  delete(): MemQuery { this.pendingWrite = { op: "delete" }; return this; }

  single(): MemQuery { this.single_ = true; return this; }
  maybeSingle(): MemQuery { this.maybeSingle_ = true; return this; }

  // thenable — يُنفَّذ عند await
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }

  private exec(): any {
    if (this.pendingWrite) return this.execWrite();
    return this.execRead();
  }

  private rows(): Row[] {
    const all = table(this.tname);
    let rows = all.filter((r) => this.filters.every((f) => matches(r, f)));
    // محاكاة RLS: لا تُقرأ صفوف شركة أخرى إطلاقاً (إلا للمطوّر)
    if (TENANT_TABLES.has(this.tname)) {
      const cid = currentUser
        ? table("profiles").find((p) => p.id === currentUser!.id)?.company_id ?? null
        : null;
      const isAdminUser = (currentUser?.email ?? "").toLowerCase() === "conta.moha@gmail.com";
      if (!isAdminUser) rows = rows.filter((r) => r.company_id == null || r.company_id === cid);
    }
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of this.orders) {
          const av = a[o.col];
          const bv = b[o.col];
          if (av < bv) return o.asc ? -1 : 1;
          if (av > bv) return o.asc ? 1 : -1;
        }
        return 0;
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  private project(row: Row): Row {
    const cols = this.selectCols;
    const embedCols = cols.filter((c) => /^[a-z_]+\s*\([^)]*\)$/.test(c));
    const explicit = cols.filter((c) => c !== "*" && !/^[a-z_]+\s*\([^)]*\)$/.test(c));
    const hasStar = cols.includes("*");
    const out: Row = {};
    if (hasStar || explicit.length === 0) Object.assign(out, row);
    for (const c of explicit) out[c] = row[c];
    return resolveEmbeds(this.tname, out, embedCols);
  }

  private execRead(): any {
    if (this.countExact && this.head) {
      return { count: this.rows().length, error: null };
    }
    const rows = this.rows().map((r) => this.project(r));
    if (this.single_ || this.maybeSingle_) {
      if (rows.length === 0) return { data: null, error: this.single_ ? { message: "not found" } : null };
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  private nextId(): number {
    const rows = table(this.tname);
    const max = rows.reduce((m, r) => (typeof r.id === "number" && r.id > m ? r.id : m), 0);
    return max + 1;
  }

  private stampTenant(row: Row): Row {
    // يحاكي مُشغِّل set_company_id: يفرض عزل الشركة من المستخدم الحالي
    if (TENANT_TABLES.has(this.tname) && currentUser) {
      const cid = table("profiles").find((p) => p.id === currentUser!.id)?.company_id ?? null;
      if (cid != null) row.company_id = cid;
    }
    return row;
  }

  /** محاكاة RLS على الكتابة: لا تعديل/حذف لصفوف شركة أخرى. */
  private tenantScoped(list: Row[]): Row[] {
    if (!TENANT_TABLES.has(this.tname)) return list;
    const isAdminUser = (currentUser?.email ?? "").toLowerCase() === "conta.moha@gmail.com";
    if (isAdminUser) return list;
    const cid = currentUser
      ? table("profiles").find((p) => p.id === currentUser!.id)?.company_id ?? null
      : null;
    return list.filter((r) => r.company_id == null || r.company_id === cid);
  }

  private execWrite(): any {
    const rows = table(this.tname);
    const op = this.pendingWrite!.op;
    if (op === "insert") {
      const payload = this.pendingWrite!.payload;
      const list = Array.isArray(payload) ? payload : [payload];
      // محاكاة قيد فريد (company_id, number) + سباق الترقيم
      if (NUMBERED_TABLES.has(this.tname) && (collisionCounters[this.tname] ?? 0) > 0) {
        collisionCounters[this.tname] -= 1;
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      const inserted: Row[] = [];
      for (const p of list) {
        const row: Row = this.stampTenant({ ...p });
        if (row.id == null) row.id = this.nextId();
        rows.push(row);
        inserted.push(row);
      }
      const projected = inserted.map((r) => this.project(r));
      if (this.single_ || this.maybeSingle_) return { data: projected[0], error: null };
      return { data: projected, error: null };
    }
    if (op === "upsert") {
      const payload = this.pendingWrite!.payload;
      const list = Array.isArray(payload) ? payload : [payload];
      for (const p of list) {
        const idx = rows.findIndex((r) => r.id === p.id);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...this.stampTenant({ ...p }) };
        else rows.push({ ...this.stampTenant({ ...p }), id: p.id ?? this.nextId() });
      }
      return { error: null };
    }
    if (op === "update") {
      const target = this.tenantScoped(rows.filter((r) => this.filters.every((f) => matches(r, f))));
      for (const r of target) Object.assign(r, this.pendingWrite!.payload);
      return { error: null };
    }
    if (op === "delete") {
      const target = this.tenantScoped(rows.filter((r) => this.filters.every((f) => matches(r, f))));
      for (const r of target) {
        rows.splice(rows.indexOf(r), 1);
        applyCascade(this.tname, r);
      }
      return { error: null };
    }
    return { error: { message: "unknown op" } };
  }
}


// ---------------------------------------------------------------------------
// محاكاة قيود المفاتيح الأجنبية عند الحذف (مطابقة لـ supabase/schema.sql)
// ---------------------------------------------------------------------------
const CASCADE_RULES: Record<string, { table: string; column: string; action: "cascade" | "set null" }[]> = {
  invoices: [{ table: "invoice_trips", column: "invoice_id", action: "cascade" }],
  invoice_trips: [
    { table: "trip_expenses", column: "trip_id", action: "cascade" },
    { table: "payment_vouchers", column: "trip_id", action: "set null" },
  ],
  trip_expenses: [{ table: "payment_vouchers", column: "source_expense_id", action: "cascade" }],
  payment_vouchers: [{ table: "advance_settlements", column: "payment_voucher_id", action: "cascade" }],
  payrolls: [{ table: "advance_settlements", column: "payroll_id", action: "cascade" }],
  financial_years: [{ table: "year_snapshots", column: "year_id", action: "cascade" }],
};

function applyCascade(parentTable: string, deleted: Record<string, any>): void {
  for (const rule of CASCADE_RULES[parentTable] ?? []) {
    const child = table(rule.table);
    if (rule.action === "set null") {
      for (const row of child) if (row[rule.column] === deleted.id) row[rule.column] = null;
      continue;
    }
    const doomed = child.filter((row) => row[rule.column] === deleted.id);
    for (const row of doomed) {
      child.splice(child.indexOf(row), 1);
      applyCascade(rule.table, row);
    }
  }
}

// عدّاد الاستعلامات — يُستخدم في اختبارات الأداء لمنع عودة نمط N+1
let queryCount = 0;

export function resetQueryCount(): void {
  queryCount = 0;
}

export function getQueryCount(): number {
  return queryCount;
}

function from(name: string): MemQuery {
  queryCount += 1;
  return new MemQuery(name);
}

// ---------------------------------------------------------------------------
// حالة الجلسة (auth)
// ---------------------------------------------------------------------------
let currentUser: { id: string; email: string } | null = null;

export function setUser(u: { id: string; email: string } | null): void {
  currentUser = u;
}

const auth = {
  getUser: () => Promise.resolve({ data: { user: currentUser }, error: null }),
  getSession: () =>
    Promise.resolve({
      data: { session: currentUser ? { user: currentUser } : null },
      error: null,
    }),
};

function err(msg: string): { data: null; error: { message: string } } {
  return { data: null, error: { message: msg } };
}

function companyOfUser(): string | null {
  const u = currentUser;
  if (!u) return null;
  return table("profiles").find((p) => p.id === u.id)?.company_id ?? null;
}

function openYearContains(cid: string, date: string): boolean {
  return table("financial_years").some(
    (y) => y.company_id === cid && y.status === "open" && y.date_from <= date && y.date_to >= date
  );
}

// محاكاة save_invoice (SQL) — ذرّية مع ترقيم مُقفَل
function rpcSaveInvoice(args: any): { data: any; error: any } {
  const cid = companyOfUser();
  if (!cid) return err("لا توجد شركة مرتبطة بحسابك.");
  const trips = Array.isArray(args.p_trips) ? args.p_trips : [];
  if (!args.p_customer_id) return err("اختر العميل.");
  if (!trips.length) return err("أضف نقلة واحدة على الأقل للفاتورة.");
  if (!table("customers").some((c) => c.id === args.p_customer_id && c.company_id === cid)) {
    return err("العميل المحدد غير موجود.");
  }

  let invoiceId: number;
  if (args.p_invoice_id == null) {
    if (!openYearContains(cid, args.p_date)) return err("لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.");
    const number = table("invoices").filter((r) => r.company_id === cid).reduce((m, r) => Math.max(m, r.number ?? 0), 0) + 1;
    invoiceId = nextId("invoices");
    table("invoices").push({ id: invoiceId, company_id: cid, number, date: args.p_date, customer_id: args.p_customer_id, vat_rate: args.p_vat_rate, notes: args.p_notes ?? "", attachments: args.p_attachments ?? [], container_number: args.p_container_number ?? "" });
  } else {
    const inv = table("invoices").find((r) => r.id === args.p_invoice_id && r.company_id === cid);
    if (!inv) return err("الفاتورة غير موجودة.");
    if (!openYearContains(cid, inv.date)) return err("لا يمكن تعديل حركة بتاريخ قديم خارج السنة المالية المفتوحة.");
    if (!openYearContains(cid, args.p_date)) return err("لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.");
    Object.assign(inv, { date: args.p_date, customer_id: args.p_customer_id, vat_rate: args.p_vat_rate, notes: args.p_notes ?? "", attachments: args.p_attachments ?? [], container_number: args.p_container_number ?? "" });
    invoiceId = inv.id;
  }

  const kept = new Set(trips.filter((t: any) => t.id != null).map((t: any) => Number(t.id)));
  for (const t of table("invoice_trips").filter((t) => t.invoice_id === invoiceId && !kept.has(t.id))) {
    if (table("payment_vouchers").some((v) => v.voucher_type === "trip" && v.trip_id === t.id && v.source_expense_id == null)) {
      return err("لا يمكن حذف نقلة مرتبطة بسندات دفع يدوية. احذف السندات المرتبطة أولاً.");
    }
  }
  for (const t of table("invoice_trips").filter((t) => t.invoice_id === invoiceId && !kept.has(t.id))) {
    for (const v of table("payment_vouchers").filter((v) => v.trip_id === t.id && v.source_expense_id != null)) {
      table("payment_vouchers").splice(table("payment_vouchers").indexOf(v), 1);
    }
    table("invoice_trips").splice(table("invoice_trips").indexOf(t), 1);
  }

  const round2 = (x: number) => Math.round(x * 100) / 100;

  for (const t of trips) {
    const qty = Math.max(1, Math.trunc(Number(t.qty ?? 1) || 1));
    const unit = Number(t.unit_price ?? 0) > 0 ? Number(t.unit_price) : Number(t.price ?? 0) / qty;
    const line = round2(qty * unit);
    if (!(line > 0)) return err("سعر النقلة يجب أن يكون أكبر من صفر.");
    let tripId: number;
    const base = {
      vehicle_id: t.vehicle_id ?? null, driver_id: t.driver_id ?? null,
      from_loc: t.from_loc ?? "", to_loc: t.to_loc ?? "",
      qty, unit_price: unit, price: line, notes: t.notes ?? "",
    };
    if (t.id != null) {
      tripId = Number(t.id);
      const tr = table("invoice_trips").find((x) => x.id === tripId && x.invoice_id === invoiceId);
      if (!tr) return err("النقلة غير موجودة ضمن هذه الفاتورة.");
      Object.assign(tr, base);
      for (const e of table("trip_expenses").filter((e) => e.trip_id === tripId)) {
        // السندات التلقائية تتبع مصروفها (حذف تتابعي)
        for (const v of table("payment_vouchers").filter((v) => v.source_expense_id === e.id)) {
          table("payment_vouchers").splice(table("payment_vouchers").indexOf(v), 1);
        }
        table("trip_expenses").splice(table("trip_expenses").indexOf(e), 1);
      }
    } else {
      tripId = nextId("invoice_trips");
      table("invoice_trips").push({ id: tripId, company_id: cid, invoice_id: invoiceId, ...base });
    }

    for (const e of t.expenses ?? []) {
      const eqty = Number(e.qty ?? 1) || 1;
      const eunit = Number(e.unit_amount ?? 0) > 0 ? Number(e.unit_amount) : Number(e.amount ?? 0) / eqty;
      const amount = round2(eqty * eunit);
      if (!(amount > 0)) return err("مبلغ مصروف النقلة يجب أن يكون أكبر من صفر.");
      const source = e.source ?? "cash";
      if (!["cash", "driver", "supplier", "customer"].includes(source)) return err("مصدر تمويل المصروف غير صالح.");
      if (source === "cash") {
        if (!e.account_kind || !e.account_id) return err("اختر الخزينة أو البنك الذي صُرف منه المصروف النقدي.");
        const tbl = e.account_kind === "cashbox" ? "cashboxes" : "banks";
        if (!table(tbl).some((a) => a.id === Number(e.account_id) && a.company_id === cid)) {
          return err(e.account_kind === "cashbox" ? "الخزينة المحددة غير موجودة." : "البنك المحدد غير موجود.");
        }
      }
      if (source === "driver" && !base.driver_id) return err("حدّد السائق في النقلة قبل تسجيل مصروف من عهدته.");

      const expId = nextId("trip_expenses");
      table("trip_expenses").push({
        id: expId, company_id: cid, trip_id: tripId, expense_type: e.expense_type ?? "other",
        qty: eqty, unit_amount: eunit, amount, source,
        account_kind: source === "cash" ? e.account_kind : null,
        account_id: source === "cash" ? Number(e.account_id) : null,
        supplier_name: e.supplier_name ?? "", notes: e.notes ?? "",
      });

      if (source === "cash") {
        const pnum = table("payment_vouchers").filter((r) => r.company_id === cid).reduce((m, r) => Math.max(m, r.number ?? 0), 0) + 1;
        table("payment_vouchers").push({
          id: nextId("payment_vouchers"), company_id: cid, number: pnum, date: args.p_date,
          account_kind: e.account_kind, account_id: Number(e.account_id), voucher_type: "trip",
          trip_id: tripId, employee_id: base.driver_id, vehicle_id: base.vehicle_id,
          amount, description: `مصروف نقلة (تلقائي): ${e.notes ?? e.expense_type ?? ""}`,
          source_expense_id: expId,
        });
      }
    }
  }
  return { data: invoiceId, error: null };
}

// محاكاة save_payroll (SQL) — ذرّية مع ترقيم مُقفَل وفحص المتبقي من السلف
function rpcSavePayroll(args: any): { data: any; error: any } {
  const cid = companyOfUser();
  if (!cid) return err("لا توجد شركة مرتبطة بحسابك.");
  if (!args.p_employee_id) return err("اختر الموظف/السائق.");
  if (!table("employees").some((e) => e.id === args.p_employee_id && e.company_id === cid)) return err("الموظف المحدد غير موجود.");
  if (args.p_account_kind === "cashbox") {
    if (!table("cashboxes").some((a) => a.id === args.p_account_id && a.company_id === cid)) return err("الخزينة المحددة غير موجودة.");
  } else if (args.p_account_kind === "bank") {
    if (!table("banks").some((a) => a.id === args.p_account_id && a.company_id === cid)) return err("البنك المحدد غير موجود.");
  } else return err("جهة الصرف غير صالحة.");
  if (args.p_period_month < 1 || args.p_period_month > 12) return err("شهر الراتب يجب أن يكون بين 1 و 12.");
  if (args.p_period_year < 1900 || args.p_period_year > 2200) return err("سنة الراتب غير منطقية.");
  if (args.p_base_salary <= 0) return err("الراتب الأساسي يجب أن يكون أكبر من صفر.");

  const settlements: [number, number][] = (args.p_settlements ?? []).map((p: any) => [Number(p[0]), Number(p[1])]);
  const total = Math.round(settlements.reduce((a, [, amt]) => a + amt, 0) * 100) / 100;
  if (Math.abs(total - args.p_advance_deduction) > 0.001) return err("مجموع خصومات السلف الموزعة لا يطابق قيمة الخصم من السلف.");
  const net = Math.round((args.p_base_salary + args.p_additions - args.p_advance_deduction - args.p_other_deductions) * 100) / 100;
  if (net < 0) return err("صافي الراتب سالب: راجع الإضافات والخصومات.");

  let payrollId: number;
  if (args.p_payroll_id == null) {
    if (!openYearContains(cid, args.p_date)) return err("لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.");
    const number = table("payrolls").filter((r) => r.company_id === cid).reduce((m, r) => Math.max(m, r.number ?? 0), 0) + 1;
    payrollId = nextId("payrolls");
    table("payrolls").push({
      id: payrollId, company_id: cid, number, date: args.p_date, employee_id: args.p_employee_id,
      period_year: args.p_period_year, period_month: args.p_period_month, account_kind: args.p_account_kind,
      account_id: args.p_account_id, base_salary: args.p_base_salary, additions: args.p_additions,
      additions_note: args.p_additions_note ?? "", advance_deduction: args.p_advance_deduction,
      other_deductions: args.p_other_deductions, net_salary: net, notes: args.p_notes ?? "",
    });
  } else {
    const pr = table("payrolls").find((r) => r.id === args.p_payroll_id && r.company_id === cid);
    if (!pr) return err("الراتب غير موجود.");
    if (!openYearContains(cid, pr.date)) return err("لا يمكن تعديل حركة بتاريخ قديم خارج السنة المالية المفتوحة.");
    if (!openYearContains(cid, args.p_date)) return err("لا يمكن تسجيل حركة بهذا التاريخ: خارج نطاق أي سنة مالية مفتوحة.");
    Object.assign(pr, {
      date: args.p_date, employee_id: args.p_employee_id, period_year: args.p_period_year, period_month: args.p_period_month,
      account_kind: args.p_account_kind, account_id: args.p_account_id, base_salary: args.p_base_salary, additions: args.p_additions,
      additions_note: args.p_additions_note ?? "", advance_deduction: args.p_advance_deduction, other_deductions: args.p_other_deductions,
      net_salary: net, notes: args.p_notes ?? "",
    });
    payrollId = pr.id;
    for (const s of table("advance_settlements").filter((s) => s.payroll_id === payrollId)) {
      table("advance_settlements").splice(table("advance_settlements").indexOf(s), 1);
    }
  }

  for (const [vid, amt] of settlements) {
    if (amt <= 0) continue;
    const adv = table("payment_vouchers").find((v) => v.id === vid && v.voucher_type === "advance" && v.employee_id === args.p_employee_id && v.company_id === cid);
    if (!adv) return err("سلفة غير موجودة أو لا تخص هذا الموظف.");
    const settled = table("advance_settlements").filter((s) => s.payment_voucher_id === vid).reduce((a, s) => a + (s.amount ?? 0), 0);
    if (amt > (adv.amount - settled) + 0.001) return err("قيمة الخصم من إحدى السلف أكبر من المتبقي منها.");
    table("advance_settlements").push({ id: nextId("advance_settlements"), company_id: cid, payment_voucher_id: vid, payroll_id: payrollId, amount: amt });
  }
  return { data: payrollId, error: null };
}

const rpc = async (fn: string, args?: any) => {
  if (fn === "register_company") {
    throw new Error("rpc register_company not implemented in memory mock");
  }
  if (fn === "save_invoice") return rpcSaveInvoice(args);
  if (fn === "save_payroll") return rpcSavePayroll(args);
  return { data: null, error: { message: `rpc ${fn} not mocked` } };
};

const storage = {
  from: () => ({
    upload: () => Promise.resolve({ data: { path: "x" }, error: null }),
    getPublicUrl: (p: string) => ({ publicUrl: `https://mock/${p}` }),
  }),
};

export const supabaseMock = { from, auth, rpc, storage };
