// اختبارات عميل Supabase الخادمي: استخراج JWT والتحقق من المستخدم/المطوّر.
import { describe, it, expect, beforeEach, vi } from "vitest";

// محاكاة createClient من @supabase/supabase-js (لأن requireUser/requireAdmin تستدعيانه)
const { getUserMock, setSessionMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  setSessionMock: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      setSession: setSessionMock,
    },
  }),
}));

import { extractAccessToken, requireUser, requireAdmin, ADMIN_EMAIL } from "@/lib/server/supabase";

function req(headers: Record<string, string> = {}): Request {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as unknown as Request;
}

beforeEach(() => {
  getUserMock.mockReset();
  setSessionMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
});

describe("extractAccessToken", () => {
  it("يقرأ Bearer من الترويسة", () => {
    expect(extractAccessToken(req({ authorization: "Bearer abc123" }))).toBe("abc123");
  });
  it("يقرأ JWT من كوكي sb-*-auth-token", () => {
    const cookie = `sb-myproj-auth-token=${encodeURIComponent(JSON.stringify({ access_token: "tok-from-cookie" }))}; path=/`;
    expect(extractAccessToken(req({ cookie }))).toBe("tok-from-cookie");
  });
  it("يعيد null عند غياب الاثنين", () => {
    expect(extractAccessToken(req())).toBeNull();
  });
  it("يتجاهل كوكي غير صالح بصمت", () => {
    expect(extractAccessToken(req({ cookie: "sb-x-auth-token=not-json" }))).toBeNull();
  });
});

describe("requireUser", () => {
  it("يعيد null عند غياب الرمز", async () => {
    expect(await requireUser(req())).toBeNull();
  });
  it("يعيد المستخدم عند نجاح التحقق", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.c" } }, error: null });
    const u = await requireUser(req({ authorization: "Bearer tok" }));
    expect(u).toEqual({ id: "u1", email: "a@b.c" });
    expect(getUserMock).toHaveBeenCalledWith("tok");
  });
  it("يعيد null عند فشل التحقق", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    expect(await requireUser(req({ authorization: "Bearer tok" }))).toBeNull();
  });
});

describe("requireAdmin", () => {
  it("يقبل بريد المطوّر فقط (تجاهل حالة الأحرف)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: "CONTA.MOHA@gmail.com" } }, error: null });
    expect(await requireAdmin(req({ authorization: "Bearer t" }))).not.toBeNull();

    getUserMock.mockResolvedValue({ data: { user: { id: "u2", email: "x@y.com" } }, error: null });
    expect(await requireAdmin(req({ authorization: "Bearer t" }))).toBeNull();
  });
  it("ADMIN_EMAIL يطابق القيمة المُرمَّزة في schema", () => {
    expect(ADMIN_EMAIL).toBe("conta.moha@gmail.com");
  });
});
