import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/app/config/env", () => ({
  env: {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
    FRONTEND_ORIGIN: "https://quotehub-production.vercel.app",
    BETTER_AUTH_URL: "https://quotehub-production.vercel.app",
    BETTER_AUTH_SECRET: "test-production-secret-12345678901234567890",
  },
}));

vi.mock("../../../../src/infrastructure/email/resend", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../../src/infrastructure/logging/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { auth, resolveFrontendOrigin } from "../../../../src/modules/auth/auth";
import { isAllowedOrigin } from "../../../../src/middleware/security";
import { logger } from "../../../../src/infrastructure/logging/logger";
import { sendVerificationEmail, sendPasswordResetEmail } from "../../../../src/infrastructure/email/resend";

const frontend = "https://quotehub-production.vercel.app";

describe("Production authentication through the frontend proxy", () => {
  it("uses the public frontend origin and requires email verification", () => {
    expect(auth.options.baseURL).toBe(frontend);
    expect(auth.options.trustedOrigins).toEqual([frontend]);
    expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(true);
  });

  it("rejects preview, tunnel, and loopback origins in production", () => {
    expect(isAllowedOrigin(frontend)).toBe(true);
    for (const origin of [
      "https://unrelated.vercel.app",
      "https://unrelated.trycloudflare.com",
      "http://localhost:3000",
      "http://127.0.0.1:4000",
      `${frontend}.attacker.com`,
    ]) {
      expect(isAllowedOrigin(origin)).toBe(false);
      expect(resolveFrontendOrigin(new Request("https://azure-upstream.example/api/auth/sign-up/email", {
        headers: { origin, referer: `${origin}/signup` },
      }))).toBe(frontend);
    }
  });

  it("sends frontend verification and reset links without logging their tokens", async () => {
    const token = "private-email-token";
    const payload = { user: { email: "user@example.com" }, token, url: `https://azure-upstream.example/?token=${token}` };
    await auth.options.emailVerification?.sendVerificationEmail?.(payload as any);
    await auth.options.emailAndPassword?.sendResetPassword?.(payload as any);

    expect(sendVerificationEmail).toHaveBeenCalledWith("user@example.com", `${frontend}/verify-email?token=${token}`);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith("user@example.com", `${frontend}/reset-password?token=${token}`);
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(token);
  });
});
