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
let ip = 20;

function req(body: Record<string, unknown>): any {
  ip += 1;
  return {
    headers: new Headers({ authorization: "Bearer token", "x-forwarded-for": `10.30.0.${ip}` }),
    cookies: { get: () => ({ value: "valid-2fa" }) },
    json: async () => body,
  };
}

function query(result: { data?: any; error?: any }) {
  const q: any = {
    select: () => q,
    eq: () => q,
    order: () => q,
    insert: () => q,
    update: () => q,
    upsert: () => q,
    maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
    then: (ok: (v: any) => any, fail: (e: any) => any) =>
      Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(ok, fail),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "conta.moha@gmail.com" });
  mocks.verifyTwoFactorToken.mockReturnValue(true);
  mocks.sameOrigin.mockReturnValue(true);
  mocks.hasServiceKey.mockReturnValue(true);
});

describe("API المميزات الإضافية", () => {
  it("يرفض العملية الحساسة بلا تحقق ثنائي", async () => {
    mocks.verifyTwoFactorToken.mockReturnValue(false);
    const res = await featuresPost(req({ action: "get", company_id: COMPANY_ID }));
    expect(res.status).toBe(401);
  });

  it("يعيد false لكل ميزة عبر RPC محمية دون قراءة companies مباشرة", async () => {
    const rpc = vi.fn(async () => ({ data: { features: {}, users: [] }, error: null }));
    const from = vi.fn(() => { throw new Error("لا ينبغي قراءة الجداول مباشرة"); });
    mocks.serviceClient.mockReturnValue({ from, rpc });
    const res = await featuresPost(req({ action: "get", company_id: COMPANY_ID }));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.features).toEqual({ tax_invoice: false, additional_user: false });
    expect(rpc).toHaveBeenCalledWith("admin_get_company_extras_v18", { p_company_id: COMPANY_ID });
    expect(from).not.toHaveBeenCalled();
  });

  it("يمرر تفعيل الفاتورة الضريبية إلى RPC المحمي", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    mocks.serviceClient.mockReturnValue({
      from: () => query({ data: { id: COMPANY_ID } }),
      rpc,
    });
    const res = await featuresPost(req({
      action: "set", company_id: COMPANY_ID, feature_key: "tax_invoice", enabled: true,
    }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_set_company_feature", {
      p_company_id: COMPANY_ID,
      p_feature_key: "tax_invoice",
      p_enabled: true,
    });
  });
});

describe("API المستخدم الإضافي", () => {
  it("ينشئ الحساب ببريد مؤكد ويربطه بالشركة كـ additional", async () => {
    const createUser = vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null }));
    const deleteUser = vi.fn(async () => ({ error: null }));
    const inserted: any[] = [];
    const sb = {
      auth: { admin: { createUser, deleteUser } },
      from: vi.fn((table: string) => {
        if (table === "companies") return query({ data: { id: COMPANY_ID, name: "شركة" } });
        if (table === "profiles") {
          const q = query({ data: null });
          q.insert = (payload: any) => { inserted.push(payload); return query({ data: null }); };
          return q;
        }
        return query({ data: null });
      }),
    };
    mocks.serviceClient.mockReturnValue(sb);

    const res = await usersPost(req({
      action: "create",
      company_id: COMPANY_ID,
      name: "مستخدم إضافي",
      email: "extra.user@gmail.com",
      phone: "+201001234567",
      password: "Strong1234",
    }));

    expect(res.status).toBe(200);
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "extra.user@gmail.com",
      email_confirm: true,
      user_metadata: expect.objectContaining({ phone: "201001234567" }),
      app_metadata: { managed_by_developer: true },
    }));
    expect(inserted).toContainEqual(expect.objectContaining({
      id: USER_ID,
      company_id: COMPANY_ID,
      role: "additional",
      is_active: true,
    }));
  });

  it("لا يحاول إنشاء المستخدم إذا كان مفتاح الخدمة غائباً", async () => {
    mocks.hasServiceKey.mockReturnValue(false);
    const res = await usersPost(req({ action: "create", company_id: COMPANY_ID }));
    expect(res.status).toBe(503);
    expect(mocks.serviceClient).not.toHaveBeenCalled();
  });
});
