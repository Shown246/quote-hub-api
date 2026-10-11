import { describe, it, expect } from "vitest";
import { validateEnv, env } from "../../../src/app/config/env";

describe("validateEnv", () => {
  it("should parse valid environment variables", () => {
    const raw = {
      NODE_ENV: "test",
      PORT: "4000",
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:4000"
    };
    const result = validateEnv(raw);
    expect(result.PORT).toBe(4000);
    expect(result.NODE_ENV).toBe("test");
    expect(result.DATABASE_URL).toBe("postgresql://postgres:password@localhost:5432/quotehub_test");
    expect(result.REDIS_URL).toBe("redis://localhost:6379");
    expect(result.FRONTEND_ORIGIN).toBe("http://localhost:3000");
    expect(result.BETTER_AUTH_SECRET).toBe("0123456789abcdef0123456789abcdef");
    expect(result.BETTER_AUTH_URL).toBe("http://localhost:4000");
  });

  it("should throw error when DATABASE_URL is missing", () => {
    const raw = { PORT: "4000" };
    expect(() => validateEnv(raw as any)).toThrow();
  });

  it("should throw error when URLs are invalid", () => {
    const raw = {
      NODE_ENV: "test",
      PORT: "4000",
      DATABASE_URL: "invalid-url",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:4000"
    };
    expect(() => validateEnv(raw as any)).toThrow();
  });

  it("should throw error when PORT is not a valid number", () => {
    const raw = {
      NODE_ENV: "test",
      PORT: "invalid-port",
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:4000"
    };
    expect(() => validateEnv(raw as any)).toThrow();
  });

  it("should throw error when NODE_ENV is an invalid enum value", () => {
    const raw = {
      NODE_ENV: "staging",
      PORT: "4000",
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:4000"
    };
    expect(() => validateEnv(raw as any)).toThrow();
  });

  it("should use default PORT and NODE_ENV when not provided", () => {
    const raw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:4000"
    };
    const result = validateEnv(raw);
    expect(result.PORT).toBe(4000);
    expect(result.NODE_ENV).toBe("development");
  });

  it("should parse optional GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET when provided", () => {
    const raw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:4000",
      GOOGLE_CLIENT_ID: "google-client-id-123",
      GOOGLE_CLIENT_SECRET: "google-client-secret-456"
    };
    const result = validateEnv(raw);
    expect(result.GOOGLE_CLIENT_ID).toBe("google-client-id-123");
    expect(result.GOOGLE_CLIENT_SECRET).toBe("google-client-secret-456");
  });

  it("should leave GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET undefined when omitted", () => {
    const raw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:4000"
    };
    const result = validateEnv(raw);
    expect(result.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(result.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  it("should parse optional SENTRY_DSN when provided", () => {
    const raw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:4000",
      SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0"
    };
    const result = validateEnv(raw);
    expect(result.SENTRY_DSN).toBe("https://examplePublicKey@o0.ingest.sentry.io/0");
  });

  it("should leave SENTRY_DSN undefined when omitted", () => {
    const raw = {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
      REDIS_URL: "redis://localhost:6379",
      FRONTEND_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:4000"
    };
    const result = validateEnv(raw);
    expect(result.SENTRY_DSN).toBeUndefined();
  });

  it("should export env singleton", () => {
    expect(env).toBeDefined();
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("test");
    expect(env.DATABASE_URL).toBeDefined();
    expect(env.REDIS_URL).toBeDefined();
    expect(env.FRONTEND_ORIGIN).toBeDefined();
    expect(env.BETTER_AUTH_SECRET).toBeDefined();
    expect(env.BETTER_AUTH_URL).toBeDefined();
  });
});
