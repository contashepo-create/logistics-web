import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  userClient: vi.fn(),
  extractAccessToken: vi.fn(() => "token"),
  serviceClient: vi.fn(),
  hasServiceKey: vi.fn(() => true),
  verifyTwoFactorToken: vi.fn(() => true),
  sameOrigin: vi.fn(() => true),
}));

vi.mock("@/lib/server/supabase", () => ({
  requireAdmin: mocks.requireAdmin,
  userClient: mocks.userClient,
  extractAccessToken: mocks.extractAccessToken,
  serviceClient: mocks.serviceClient,
  hasServiceKey: mocks.hasServiceKey,
}));
vi.mock("@/lib/server/admin-session", () => ({
  COOKIE_NAME: "admin_2fa",
  verifyTwoFactorToken: mocks.verifyTwoFactorToken,
  sameOrigin: mocks.sameOrigin,
}));

import { POST as featuresPost } from "@/app/api/zerocold/features/route";
import { POST as usersPost } from "@/app/api/zerocold/company-users/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
let ip = 100;

function req(body: Record<string, unknown>): any {
  ip += 1;
  return {
    headers: new Headers({ authorization: "Bearer token", "x-forwarded-for": `10.40.0.${ip}` }),
    cookies: { get: () => ({ value: "valid-2fa" }) },
    json: async () => body,
  };
}

/** بناء استعلام وهمي يدعم count/head المستخدم في عدّ المستخدمين. */
function query(result: { data?: any; error?: any; count?: number }) {
  const settle = {
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  };
  const q: any = {
    select: () => q,
    eq: () => q,
    order: () => q,
    insert: () => q,
    update: () => q,
    upsert: () => q,
    delete: () => q,
    maybeSingle: async () => settle,
    then: (ok: (v: any) => any, fail: (e: any) => any) => Promise.resolve(settle).then(ok, fail),
  };
  return q;
}

/**
 * عميل وهمي لشركة حدّها `limit` ولديها `existing` مستخدماً إضافياً،
 * منهم `active` نشط. يسجّل كل عمليات upsert على company_features.
 */
function clientFor(opts: {
  limit?: number;
  existing?: number;
  active?: number;
  omitLimitColumn?: boolean;
}) {
  const featureUpserts: any[] = [];
  const profileInserts: any[] = [];
  const deleted: string[] = [];
  let profileSelects = 0;
  let companySelects = 0;

  const companyRow: any = { id: COMPANY_ID, name: "شركة" };
  if (!opts.omitLimitColumn) companyRow.max_additional_users = opts.limit ?? 1;

  const sb: any = {
    auth: {
      admin: {
        createUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
        deleteUser: vi.fn(async (id: string) => { deleted.push(id); return { error: null }; }),
      },
    },
    from: vi.fn((table: string) => {
      if (table === "companies") {
        if (opts.omitLimitColumn) {
          // أول استدعاء يطلب العمود غير الموجود، والثاني هو المسار الاحتياطي.
          companySelects += 1;
          return companySelects === 1
            ? query({ error: { message: 'column companies.max_additional_users does not exist' } })
            : query({ data: companyRow });
        }
        return query({ data: companyRow });
      }
      if (table === "profiles") {
        profileSelects += 1;
        // الاستدعاء الأول: عدّ الموجودين. الثاني: فحص تفرّد الهاتف.
        const isCount = profileSelects === 1;
        const q = query({
          data: null,
          count: isCount ? (opts.existing ?? 0) : (opts.active ?? 0),
        });
        q.insert = (payload: any) => { profileInserts.push(payload); return query({ data: null }); };
        return q;
      }
      if (table === "company_features") {
        const q = query({ data: null });
        q.upsert = (payload: any) => { featureUpserts.push(payload); return query({ data: null }); };
        return q;
      }
      return query({ data: null });
    }),
  };
  return { sb, featureUpserts, profileInserts, deleted };
}

const createBody = (email = "extra.one@gmail.com") => ({
  action: "create",
  company_id: COMPANY_ID,
  name: "مستخدم إضافي",
  email,
  phone: "+201001234567",
  password: "Strong1234",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "conta.moha@gmail.com" });
  mocks.verifyTwoFactorToken.mockReturnValue(true);
  mocks.sameOrigin.mockReturnValue(true);
  mocks.hasServiceKey.mockReturnValue(true);
});

describe("حد المستخدمين الإضافيين لكل شركة", () => {
  it("يسمح بإنشاء مستخدم ثالث ما دام الحد يتسع له", async () => {
    const { sb, profileInserts } = clientFor({ limit: 5, existing: 2 });
    mocks.serviceClient.mockReturnValue(sb);

    const res = await usersPost(req(createBody()));
    expect(res.status).toBe(200);
    expect(profileInserts).toContainEqual(expect.objectContaining({
      company_id: COMPANY_ID, role: "additional", is_active: true,
    }));
  });

  it("يرفض التجاوز عند بلوغ الحد ولا ينشئ حساب مصادقة", async () => {
    const { sb } = clientFor({ limit: 3, existing: 3 });
    mocks.serviceClient.mockReturnValue(sb);

    const res = await usersPost(req(createBody("extra.two@gmail.com")));
    expect(res.status).toBe(409);
    const out = await res.json();
    expect(out.message).toContain("الحد المسموح");
    expect(sb.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("يرفض الإنشاء نهائياً عندما يكون الحد صفراً", async () => {
    const { sb } = clientFor({ limit: 0, existing: 0 });
    mocks.serviceClient.mockReturnValue(sb);

    const res = await usersPost(req(createBody("extra.three@gmail.com")));
    expect(res.status).toBe(409);
    expect(sb.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("يعود إلى حد مستخدم واحد إذا لم تُشغَّل ترحيلة v25 بعد", async () => {
    const { sb } = clientFor({ omitLimitColumn: true, existing: 1 });
    mocks.serviceClient.mockReturnValue(sb);

    const res = await usersPost(req(createBody("extra.four@gmail.com")));
    // الشركة تُقرأ بالمسار الاحتياطي، والحد الافتراضي 1 وقد استُهلك.
    expect(res.status).toBe(409);
  });
});

describe("مزامنة ميزة additional_user مع الواقع", () => {
  it("تبقى الميزة مفعّلة عند إيقاف مستخدم واحد وبقاء آخر نشطاً", async () => {
    // العدّ الثاني (النشطون بعد التعديل) = 1 ⇒ الميزة تبقى مفعّلة.
    const { sb, featureUpserts } = clientFor({ limit: 5, existing: 2, active: 1 });
    sb.from = vi.fn((table: string) => {
      if (table === "companies") return query({ data: { id: COMPANY_ID, name: "شركة", max_additional_users: 5 } });
      if (table === "profiles") {
        const q = query({ data: { id: USER_ID, company_id: COMPANY_ID, role: "additional", is_active: true }, count: 1 });
        return q;
      }
      if (table === "company_features") {
        const q = query({ data: null });
        q.upsert = (payload: any) => { featureUpserts.push(payload); return query({ data: null }); };
        return q;
      }
      return query({ data: null });
    });
    mocks.serviceClient.mockReturnValue(sb);

    const res = await usersPost(req({
      action: "status", company_id: COMPANY_ID, user_id: USER_ID, active: false,
    }));
    expect(res.status).toBe(200);
    expect(featureUpserts.at(-1)).toEqual(expect.objectContaining({
      feature_key: "additional_user", enabled: true,
    }));
  });

  it("تُطفأ الميزة فقط عندما لا يبقى أي مستخدم إضافي نشط", async () => {
    const featureUpserts: any[] = [];
    const sb: any = {
      auth: { admin: { deleteUser: vi.fn(async () => ({ error: null })) } },
      from: vi.fn((table: string) => {
        if (table === "companies") return query({ data: { id: COMPANY_ID, name: "شركة", max_additional_users: 5 } });
        if (table === "profiles") {
          return query({
            data: { id: USER_ID, company_id: COMPANY_ID, role: "additional", is_active: true, email: "x@gmail.com" },
            count: 0,
          });
        }
        if (table === "company_features") {
          const q = query({ data: null });
          q.upsert = (payload: any) => { featureUpserts.push(payload); return query({ data: null }); };
          return q;
        }
        return query({ data: null });
      }),
    };
    mocks.serviceClient.mockReturnValue(sb);

    const res = await usersPost(req({ action: "delete", company_id: COMPANY_ID, user_id: USER_ID }));
    expect(res.status).toBe(200);
    // الحذف يسبق المزامنة حتى لا يفقد الباقون وصولهم أثناء العملية.
    expect(sb.auth.admin.deleteUser).toHaveBeenCalled();
    expect(featureUpserts.at(-1)).toEqual(expect.objectContaining({
      feature_key: "additional_user", enabled: false,
    }));
  });
});

describe("مسار ضبط حد المستخدمين", () => {
  it("يمرر الحد إلى RPC المحمي", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    mocks.serviceClient.mockReturnValue({ from: () => query({ data: { id: COMPANY_ID } }), rpc });

    const res = await featuresPost(req({ action: "set_user_limit", company_id: COMPANY_ID, max: 4 }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_set_company_user_limit_v25", {
      p_company_id: COMPANY_ID,
      p_max: 4,
    });
  });

  it("يرفض القيم خارج النطاق أو غير الصحيحة", async () => {
    const rpc = vi.fn();
    mocks.serviceClient.mockReturnValue({ from: () => query({ data: { id: COMPANY_ID } }), rpc });

    for (const max of [-1, 11, 2.5, "ثلاثة"]) {
      const res = await featuresPost(req({ action: "set_user_limit", company_id: COMPANY_ID, max }));
      expect(res.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("يرشد إلى ترحيلة v25 عندما تكون الدالة مفقودة", async () => {
    const rpc = vi.fn(async () => ({
      error: { message: "Could not find the function public.admin_set_company_user_limit_v25" },
    }));
    mocks.serviceClient.mockReturnValue({ from: () => query({ data: { id: COMPANY_ID } }), rpc });

    const res = await featuresPost(req({ action: "set_user_limit", company_id: COMPANY_ID, max: 3 }));
    expect(res.status).toBe(500);
    const out = await res.json();
    expect(out.message).toContain("migration_multi_company_users_v25.sql");
  });

  it("يظل محمياً بالتحقق الثنائي", async () => {
    mocks.verifyTwoFactorToken.mockReturnValue(false);
    const res = await featuresPost(req({ action: "set_user_limit", company_id: COMPANY_ID, max: 3 }));
    expect(res.status).toBe(401);
  });

  it("يعيد الحد والاستهلاك ضمن لقطة الشركة", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        features: { additional_user: true },
        users: [
          { id: "1", role: "owner", is_active: true },
          { id: "2", role: "additional", is_active: true },
        ],
        max_additional_users: 4,
        used_additional_users: 1,
      },
      error: null,
    }));
    mocks.serviceClient.mockReturnValue({ from: () => query({ data: null }), rpc });

    const res = await featuresPost(req({ action: "get", company_id: COMPANY_ID }));
    const out = await res.json();
    expect(out.max_additional_users).toBe(4);
    expect(out.used_additional_users).toBe(1);
  });

  it("يفترض حد مستخدم واحد إذا لم ترجعه القاعدة بعد", async () => {
    const rpc = vi.fn(async () => ({ data: { features: {}, users: [] }, error: null }));
    mocks.serviceClient.mockReturnValue({ from: () => query({ data: null }), rpc });

    const res = await featuresPost(req({ action: "get", company_id: COMPANY_ID }));
    const out = await res.json();
    expect(out.max_additional_users).toBe(1);
    expect(out.used_additional_users).toBe(0);
  });
});
