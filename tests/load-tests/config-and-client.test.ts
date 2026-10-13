// tests/load-tests/config-and-client.test.ts
import { describe, it, expect } from "vitest";
import { getConfig } from "../../load-tests/config/env.js";
import { generateUuid, buildHeaders } from "../../load-tests/utils/http-client.js";

describe("load-tests config & client utils", () => {
  it("defaults BASE_URL to http://192.168.0.108:4000 when unset", () => {
    const config = getConfig({});
    expect(config.baseUrl).toBe("http://192.168.0.108:4000");
    expect(config.thresholds.http_req_failed).toContain("rate<0.01");
    expect(config.summaryTrendStats).toContain("p(99)");
    expect(config.summaryTrendStats).toContain("count");
  });

  it("allows overriding BASE_URL via environment options", () => {
    const config = getConfig({ BASE_URL: "http://localhost:4000" });
    expect(config.baseUrl).toBe("http://localhost:4000");
    expect(config.summaryTrendStats).toContain("p(99)");
  });

  it("generates unique UUID strings", () => {
    const u1 = generateUuid();
    const u2 = generateUuid();
    expect(u1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(u1).not.toBe(u2);
  });

  it("generates 1000 unique UUIDs across simulated concurrent virtual users", () => {
    const set = new Set<string>();
    for (let vu = 1; vu <= 100; vu++) {
      (globalThis as any).__VU = vu;
      for (let iter = 0; iter < 10; iter++) {
        const id = generateUuid();
        expect(set.has(id)).toBe(false);
        set.add(id);
      }
    }
    delete (globalThis as any).__VU;
    expect(set.size).toBe(1000);
  });

  it("builds auth and idempotency headers correctly", () => {
    const headers = buildHeaders(
      { id: "u-1", username: "u1", token: "tok123", cookie: "better-auth.session_token=tok123" },
      "idemp-key-xyz"
    );
    expect(headers["Authorization"]).toBe("Bearer tok123");
    expect(headers["Cookie"]).toBe("better-auth.session_token=tok123");
    expect(headers["Idempotency-Key"]).toBe("idemp-key-xyz");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
