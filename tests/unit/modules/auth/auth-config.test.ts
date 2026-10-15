import { describe, it, expect } from "vitest";
import { auth, resolveFrontendOrigin } from "../../../../src/modules/auth/auth";
import { env } from "../../../../src/app/config/env";

describe("Better Auth Engine", () => {
  it("should initialize better-auth instance with api handlers", () => {
    expect(auth).toBeDefined();
    expect(auth.api).toBeDefined();
    expect(typeof auth.handler).toBe("function");
  });

  it("should configure emailAndPassword with email verification disabled in non-production", () => {
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(false);
  });

  it("should configure baseURL and secret from env with dynamic tunnel support", () => {
    expect(auth.options.baseURL).toBeDefined();
    expect(auth.options.secret).toBeDefined();

    const baseURLConfig = auth.options.baseURL as any;
    expect(baseURLConfig.allowedHosts).toContain("*.trycloudflare.com");
    expect(baseURLConfig.fallback).toBe(env.BETTER_AUTH_URL);
    expect(baseURLConfig.protocol).toBe("auto");
  });

  it("should configure advanced settings with trustedProxyHeaders and SameSite=None secure cookies", () => {
    expect(auth.options.advanced?.trustedProxyHeaders).toBe(true);
    expect(auth.options.advanced?.defaultCookieAttributes?.sameSite).toBe("none");
    expect(auth.options.advanced?.defaultCookieAttributes?.secure).toBe(true);
  });

  it("should configure trustedOrigins including local and wildcard tunnel/vercel domains", () => {
    const trustedOrigins = auth.options.trustedOrigins as string[];
    expect(trustedOrigins).toContain("https://*.trycloudflare.com");
    expect(trustedOrigins).toContain("https://*.vercel.app");
    expect(trustedOrigins).toContain("http://localhost:3000");
  });

  it("should map core models to auth_* Prisma models", () => {
    expect(auth.options.user?.modelName).toBe("authUser");
    expect(auth.options.session?.modelName).toBe("authSession");
    expect(auth.options.account?.modelName).toBe("authAccount");
    expect(auth.options.verification?.modelName).toBe("authVerification");
  });

  it("should configure socialProviders as undefined when Google client credentials are not provided", () => {
    expect(auth.options.socialProviders).toBeUndefined();
  });

  it("should configure emailVerification and sendResetPassword hooks", () => {
    expect(typeof auth.options.emailAndPassword?.sendResetPassword).toBe("function");
    expect(typeof auth.options.emailVerification?.sendVerificationEmail).toBe("function");
  });

  describe("resolveFrontendOrigin helper", () => {
    it("should return request origin when it is a trusted origin", () => {
      const localReq = new Request("http://localhost:4000/api/auth/sign-up/email", {
        headers: { origin: "http://localhost:3000" },
      });
      expect(resolveFrontendOrigin(localReq)).toBe("http://localhost:3000");

      const cfReq = new Request("http://localhost:4000/api/auth/sign-up/email", {
        headers: { origin: "https://my-app.trycloudflare.com" },
      });
      expect(resolveFrontendOrigin(cfReq)).toBe("https://my-app.trycloudflare.com");

      const vercelReq = new Request("http://localhost:4000/api/auth/sign-up/email", {
        headers: { origin: "https://quote-hub.vercel.app" },
      });
      expect(resolveFrontendOrigin(vercelReq)).toBe("https://quote-hub.vercel.app");
    });

    it("should fallback to referer origin if origin header is omitted", () => {
      const reqWithReferer = new Request("http://localhost:4000/api/auth/verify-email", {
        headers: { referer: "https://quote-hub-preview.vercel.app/verify-email" },
      });
      expect(resolveFrontendOrigin(reqWithReferer)).toBe("https://quote-hub-preview.vercel.app");
    });

    it("should fallback to env.FRONTEND_ORIGIN if origin is untrusted or missing", () => {
      const untrustedReq = new Request("http://localhost:4000/api/auth/sign-up/email", {
        headers: { origin: "http://attacker.com" },
      });
      expect(resolveFrontendOrigin(untrustedReq)).toBe(env.FRONTEND_ORIGIN);

      expect(resolveFrontendOrigin(undefined)).toBe(env.FRONTEND_ORIGIN);
    });
  });
});
