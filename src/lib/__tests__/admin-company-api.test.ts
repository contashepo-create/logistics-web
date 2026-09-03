import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  extractAccessToken: vi.fn(() => "token"),
  hasServiceKey: vi.fn(() => true),
  serviceClient: vi.fn(),
  userClient: vi.fn(),
  verifyCurrentUserPassword: vi.fn(),
  verifyTwoFactorToken: vi.fn(() => true),
  sameOrigin: vi.fn(() => true),
}));

vi.mock("@/lib/server/supabase", () => ({
  requireAdmin: mocks.requireAdmin,
  extractAccessToken: mocks.extractAccessToken,
  hasServiceKey: mocks.hasServiceKey,
  serviceClient: mocks.serviceClient,
  userClient: mocks.userClient,
  verifyCurrentUserPassword: mocks.verifyCurrentUserPassword,
}));
vi.mock("@/lib/server/admin-session", () => ({
  COOKIE_NAME: "admin_2fa",
  verifyTwoFactorToken: mocks.verifyTwoFactorToken,
  sameOrigin: mocks.sameOrigin,
}));

import { POST } from "@/app/api/zerocold/companies/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
let ip = 80;

function req(body: Record<string, unknown>): any {
  ip += 1;
  return {
    headers: new Headers({
      authorization: "Bearer token",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-forwarded-for": `10.40.0.${ip}`,
    }),
    cookies: { get: () => ({ value: "valid-2fa" }) },
    json: async () => body,
  };
}

function resultQuery(data: unknown = null, error: unknown = null): any {
  const q: any = {
    select: () => q,
    eq: () => q,
    update: () => q,
    insert: () => q,
    maybeSingle: async () => ({ data, error }),
    then: (ok: (value: unknown) => unknown, fail: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(ok, fail),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "conta.moha@gmail.com",
  });
  mocks.sameOrigin.mockReturnValue(true);
  mocks.verifyTwoFactorToken.mockReturnValue(true);
  mocks.verifyCurrentUserPassword.mockResolvedValue(true);
  mocks.hasServiceKey.mockReturnValue(true);
});

describe("API إدارة الشركات الحساسة", () => {
  it("يرفض كل إجراء دون جلسة 2FA", async () => {
    mocks.verifyTwoFactorToken.mockReturnValue(false);
    const res = await POST(req({ action: "reset", company_id: COMPANY_ID }));
    expect(res.status).toBe(401);
    expect(mocks.userClient).not.toHaveBeenCalled();
  });

  it("لا ينفذ التصفير عند خطأ كلمة مرور المطوّر", async () => {
    const rpc = vi.fn();
    mocks.userClient.mockReturnValue({
      from: () => resultQuery({ id: COMPANY_ID, name: "شركة الدلتا للنقل" }),
      rpc,
    });
    mocks.verifyCurrentUserPassword.mockResolvedValue(false);

    const res = await POST(req({
      action: "reset",
      company_id: COMPANY_ID,
      confirm_name: "شركة الدلتا للنقل",
      developer_password: "wrong-password",
    }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("يتطلب تطابق اسم الشركة ثم يستدعي RPC التصفير الذرية", async () => {
    const rpc = vi.fn(async () => ({
      data: { deleted_rows: 18, new_financial_year: 2026 },
      error: null,
    }));
    mocks.userClient.mockReturnValue({
      from: () => resultQuery({ id: COMPANY_ID, name: "شركة الدلتا للنقل" }),
      rpc,
    });

    const res = await POST(req({
      action: "reset",
      company_id: COMPANY_ID,
      confirm_name: "شركة الدلتا للنقل",
      developer_password: "AdminStrong123",
    }));
    expect(res.status).toBe(200);
    expect(mocks.verifyCurrentUserPassword).toHaveBeenCalledWith("conta.moha@gmail.com", "AdminStrong123");
    expect(rpc).toHaveBeenCalledWith("admin_reset_company_data_v18", { p_company_id: COMPANY_ID });
  });

  it("يحوّل permission denied من دالة التصفير إلى رسالة إجرائية ترشد لملف الإصلاح", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "permission denied for function admin_reset_company_data_v18" },
    }));
    mocks.userClient.mockReturnValue({
      from: () => resultQuery({ id: COMPANY_ID, name: "شركة الدلتا للنقل" }),
      rpc,
    });

    const res = await POST(req({
      action: "reset",
      company_id: COMPANY_ID,
      confirm_name: "شركة الدلتا للنقل",
      developer_password: "AdminStrong123",
    }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("migration_fix_admin_rpc_grants_v21.sql");
    expect(body.message).not.toContain("permission denied");
    expect(rpc).toHaveBeenCalledWith("admin_reset_company_data_v18", { p_company_id: COMPANY_ID });
  });

  it("يحدّث الشركة والمالك وSupabase Auth ولا يسجل كلمة المرور", async () => {
    const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const activityRows: Array<Record<string, unknown>> = [];
    const updateUserById = vi.fn(async () => ({ error: null }));
    const sb = {
      auth: { admin: { updateUserById } },
      from: vi.fn((table: string) => {
        if (table === "companies") {
          const q = resultQuery({ id: COMPANY_ID, name: "شركة قديمة", phone: "201111111111", email: "old@gmail.com" });
          q.update = (payload: Record<string, unknown>) => {
            updates.push({ table, payload });
            return resultQuery();
          };
          return q;
        }
        if (table === "profiles") {
          const q = resultQuery({ id: OWNER_ID, email: "old@gmail.com", phone: "201111111111" });
          q.update = (payload: Record<string, unknown>) => {
            updates.push({ table, payload });
            return resultQuery();
          };
          return q;
        }
        const q = resultQuery();
        q.insert = (payload: Record<string, unknown>) => {
          activityRows.push(payload);
          return resultQuery();
        };
        return q;
      }),
    };
    mocks.serviceClient.mockReturnValue(sb);

    const res = await POST(req({
      action: "update",
      company_id: COMPANY_ID,
      name: "شركة الدلتا للنقل",
      phone: "+201001234567",
      email: "owner.new@gmail.com",
      new_password: "ClientStrong123",
    }));
    expect(res.status).toBe(200);
    expect(updates).toContainEqual(expect.objectContaining({
      table: "companies",
      payload: { name: "شركة الدلتا للنقل", phone: "201001234567", email: "owner.new@gmail.com" },
    }));
    expect(updateUserById).toHaveBeenCalledWith(OWNER_ID, expect.objectContaining({
      email: "owner.new@gmail.com",
      email_confirm: true,
      password: "ClientStrong123",
    }));
    expect(JSON.stringify(activityRows)).not.toContain("ClientStrong123");
  });
});
