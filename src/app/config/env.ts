import { z } from "zod";

// Load .env file if available (Node.js 20+ built-in support)
if (process.env.NODE_ENV !== "test" && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // Ignore error if .env file does not exist (e.g. configured via environment)
  }
}

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
  SENTRY_DSN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Quote-Hub <noreply@quote-hub.local>"),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  return envSchema.parse(source);
}

const TEST_DEFAULTS: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "4000",
  DATABASE_URL: "postgresql://postgres:password@localhost:5432/quotehub_test",
  REDIS_URL: "redis://localhost:6379",
  FRONTEND_ORIGIN: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-better-auth-secret-1234567890",
  BETTER_AUTH_URL: "http://localhost:4000",
  R2_ACCOUNT_ID: "mock-account",
  R2_ACCESS_KEY_ID: "mock-access-key",
  R2_SECRET_ACCESS_KEY: "mock-secret-key",
  R2_BUCKET_NAME: "quotehub-avatars",
  R2_PUBLIC_URL: "https://media.quotehub.com",
};

export const env: EnvConfig = validateEnv(
  process.env.NODE_ENV === "test"
    ? { ...TEST_DEFAULTS, ...process.env }
    : process.env
);
