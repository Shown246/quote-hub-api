// tests/load-tests/seed-script.test.ts
import { describe, it, expect } from "vitest";
import { generateSeedUsers, generateSeedQuotes } from "../../load-tests/scripts/seed-load-data";

describe("seed load data logic", () => {
  it("generates specified number of users with valid 30-day session tokens", () => {
    const { users, sessions } = generateSeedUsers(10);
    expect(users).toHaveLength(10);
    expect(sessions).toHaveLength(10);
    expect(users[0].username).toBe("perf_user_001");
    expect(sessions[0].token).toMatch(/^perf_sess_/);
    expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
  });

  it("generates quotes with valid 280-char lengths and tags", () => {
    const userIds = ["u1", "u2"];
    const quotes = generateSeedQuotes(userIds, 5);
    expect(quotes).toHaveLength(10);
    quotes.forEach((q) => {
      expect(q.content.length).toBeLessThanOrEqual(280);
      expect(userIds).toContain(q.userId);
    });
  });
});
