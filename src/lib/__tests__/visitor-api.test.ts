import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasServiceKey: vi.fn(() => true),
  serviceClient: vi.fn(),
  sameOrigin: vi.fn(() => true),
}));

vi.mock("@/lib/server/supabase", () => ({
  hasServiceKey: mocks.hasServiceKey,
  serviceClient: mocks.serviceClient,
}));
vi.mock("@/lib/server/admin-session", () => ({ sameOrigin: mocks.sameOrigin }));

import { POST, parseUserAgent } from "@/app/api/visits/route";

let ip = 120;
function req(path: string, cookie = "", ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"): any {
  ip += 1;
  return {
    headers: new Headers({
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "x-forwarded-for": `10.50.0.${ip}`,
      "x-requested-with": "XMLHttpRequest",
      "user-agent": ua,
      "x-vercel-ip-country": "EG",
      "x-vercel-ip-country-region": "DK",
      "x-vercel-ip-city": "Al%20Mansurah",
    }),
    cookies: { get: () => cookie ? { value: cookie } : undefined },
    json: async () => ({ path }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VISITOR_HASH_SECRET = "visitor-test-secret-that-is-long-enough";
  mocks.hasServiceKey.mockReturnValue(true);
  mocks.sameOrigin.mockReturnValue(true);
});

describe("تسجيل الزائر الفريد", () => {
  it("يتعرف إلى المتصفح والنظام والجهاز من User-Agent", () => {
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/125.0 Safari/537.36"))
      .toEqual({ browser: "Google Chrome", operatingSystem: "Windows", deviceType: "كمبيوتر" });
    expect(parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit Version/17.0 Mobile Safari/604.1"))
      .toEqual({ browser: "Safari", operatingSystem: "iOS / iPadOS", deviceType: "هاتف" });
  });

  it("لا يرسل معرّف Cookie الخام إلى قاعدة البيانات ويعيد نفس التجزئة للجهاز", async () => {
    const calls: Array<Record<string, string>> = [];
    const rpc = vi.fn(async (_name: string, args: Record<string, string>) => {
      calls.push(args);
      return { error: null };
    });
    mocks.serviceClient.mockReturnValue({ rpc });

    const first = await POST(req("/login"));
    expect(first.status).toBe(204);
    const setCookie = first.headers.get("set-cookie") ?? "";
    const rawId = /logistics_visitor=([^;]+)/.exec(setCookie)?.[1] ?? "";
    expect(rawId).toMatch(/^[0-9a-f-]{36}$/i);

    const second = await POST(req("/customers", rawId));
    expect(second.status).toBe(204);
    expect(calls).toHaveLength(2);
    expect(calls[0].p_visitor_key).toBe(calls[1].p_visitor_key);
    expect(calls[0].p_visitor_key).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(calls)).not.toContain(rawId);
    expect(calls[0].p_city).toBe("Al Mansurah");
  });

  it("لا يحتسب لوحة المطوّر أو برامج الفهرسة", async () => {
    const rpc = vi.fn();
    mocks.serviceClient.mockReturnValue({ rpc });
    expect((await POST(req("/zerocold"))).status).toBe(204);
    expect((await POST(req("/", "", "Googlebot/2.1"))).status).toBe(204);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("يرفض الطلب العابر للأصول قبل لمس قاعدة البيانات", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    const rpc = vi.fn();
    mocks.serviceClient.mockReturnValue({ rpc });
    expect((await POST(req("/"))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
