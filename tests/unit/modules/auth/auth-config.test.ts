import { describe, it, expect } from "vitest";
import { auth } from "../../../../src/modules/auth/auth";

describe("Better Auth Engine", () => {
  it("should initialize better-auth instance with api handlers", () => {
    expect(auth).toBeDefined();
    expect(auth.api).toBeDefined();
    expect(typeof auth.handler).toBe("function");
  });

  it("should configure emailAndPassword with email verification disabled", () => {
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(false);
  });

  it("should configure baseURL and secret from env", () => {
    expect(auth.options.baseURL).toBeDefined();
    expect(auth.options.secret).toBeDefined();
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
});
