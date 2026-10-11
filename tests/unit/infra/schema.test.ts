import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

describe("Prisma Schema Definition", () => {
  const schemaPath = join(__dirname, "../../../prisma/schema.prisma");
  const migrationPath = join(__dirname, "../../../prisma/migrations/0_init/migration.sql");

  it("should contain all domain models and separated auth models", () => {
    expect(existsSync(schemaPath)).toBe(true);
    const schema = readFileSync(schemaPath, "utf-8");

    // Domain models
    expect(schema).toContain("model User");
    expect(schema).toContain("model Quote");
    expect(schema).toContain("model Theme");
    expect(schema).toContain("model Like");
    expect(schema).toContain("model Repost");
    expect(schema).toContain("model Bookmark");
    expect(schema).toContain("model Follow");
    expect(schema).toContain("model Notification");
    expect(schema).toContain("model OutboxEvent");
    expect(schema).toContain("model IdempotencyKey");
    expect(schema).toContain("model AuditLog");
    expect(schema).toContain("model DailyMetric");

    // Better Auth models
    expect(schema).toContain("model AuthUser");
    expect(schema).toContain("model AuthSession");
    expect(schema).toContain("model AuthAccount");
    expect(schema).toContain("model AuthVerification");
  });

  it("should define custom enums with required variants", () => {
    const schema = readFileSync(schemaPath, "utf-8");
    expect(schema).toMatch(/enum\s+UserRole\s+\{[\s\S]*?USER[\s\S]*?ADMIN[\s\S]*?\}/);
    expect(schema).toMatch(/enum\s+UserStatus\s+\{[\s\S]*?ACTIVE[\s\S]*?SUSPENDED[\s\S]*?DELETED[\s\S]*?\}/);
    expect(schema).toMatch(/enum\s+NotificationType\s+\{[\s\S]*?LIKE[\s\S]*?REPOST[\s\S]*?FOLLOW[\s\S]*?\}/);
    expect(schema).toMatch(/enum\s+OutboxStatus\s+\{[\s\S]*?PENDING[\s\S]*?PROCESSING[\s\S]*?PUBLISHED[\s\S]*?FAILED[\s\S]*?\}/);
    expect(schema).toMatch(/enum\s+IdempotencyStatus\s+\{[\s\S]*?PENDING[\s\S]*?COMPLETED[\s\S]*?FAILED[\s\S]*?\}/);
  });

  it("should define User model with auth_id linkage and UUID primary key", () => {
    const schema = readFileSync(schemaPath, "utf-8");
    expect(schema).toContain("@id @db.Uuid");
    expect(schema).toContain("authId");
    expect(schema).toContain('@map("auth_id")');
    expect(schema).toContain('@@map("users")');
  });

  it("should have baseline migration SQL with required extensions, triggers, constraints and tables", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf-8");

    // Extensions & Triggers
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS "pg_trgm";');
    expect(migration).toContain("trigger_set_timestamp()");

    // Custom Types
    expect(migration).toContain("CREATE TYPE user_role AS ENUM");
    expect(migration).toContain("CREATE TYPE user_status AS ENUM");
    expect(migration).toContain("CREATE TYPE notification_type AS ENUM");
    expect(migration).toContain("CREATE TYPE outbox_status AS ENUM");
    expect(migration).toContain("CREATE TYPE idempotency_status AS ENUM");

    // Better Auth Tables
    expect(migration).toContain("CREATE TABLE auth_user");
    expect(migration).toContain("CREATE TABLE auth_session");
    expect(migration).toContain("CREATE TABLE auth_account");
    expect(migration).toContain("CREATE TABLE auth_verification");

    // Domain Tables
    expect(migration).toContain("CREATE TABLE users");
    expect(migration).toContain("CREATE TABLE quotes");
    expect(migration).toContain("CREATE TABLE themes");
    expect(migration).toContain("CREATE TABLE likes");
    expect(migration).toContain("CREATE TABLE reposts");
    expect(migration).toContain("CREATE TABLE bookmarks");
    expect(migration).toContain("CREATE TABLE follows");
    expect(migration).toContain("CREATE TABLE notifications");
    expect(migration).toContain("CREATE TABLE outbox_events");
    expect(migration).toContain("CREATE TABLE idempotency_keys");
    expect(migration).toContain("CREATE TABLE audit_logs");
    expect(migration).toContain("CREATE TABLE daily_metrics");

    // Check Constraints
    expect(migration).toContain("chk_quotes_text_length");
    expect(migration).toContain("chk_quotes_attribution_logic");
    expect(migration).toContain("chk_follows_no_self_follow");
    expect(migration).toContain("chk_quotes_like_count_non_negative");
    expect(migration).toContain("chk_quotes_repost_count_non_negative");
    expect(migration).toContain("chk_users_follower_count_non_negative");
    expect(migration).toContain("chk_users_following_count_non_negative");

    // Foreign Key ON DELETE policies
    expect(migration).toContain("REFERENCES users (id) ON DELETE RESTRICT");
    expect(migration).toContain("REFERENCES themes (id) ON DELETE RESTRICT");
    expect(migration).toContain("REFERENCES users (id) ON DELETE CASCADE");
    expect(migration).toContain("REFERENCES quotes (id) ON DELETE CASCADE");
    expect(migration).toContain("REFERENCES auth_user (id) ON DELETE SET NULL");

    // GIN Trigram & Partial Indexes
    expect(migration).toContain("USING gin (username gin_trgm_ops)");
    expect(migration).toContain("USING gin (display_name gin_trgm_ops)");
    expect(migration).toContain("USING gin (text gin_trgm_ops) WHERE deleted_at IS NULL");
    expect(migration).toContain("idx_quotes_feed_cursor");
    expect(migration).toContain("idx_outbox_pending_polling");
    expect(migration).toContain("idx_notifications_user_unread");
  });

  it("should have generated Prisma Client with all 16 model delegates", () => {
    const client = new PrismaClient();
    expect(client).toBeDefined();

    // Domain delegates
    expect(client.user).toBeDefined();
    expect(client.quote).toBeDefined();
    expect(client.theme).toBeDefined();
    expect(client.like).toBeDefined();
    expect(client.repost).toBeDefined();
    expect(client.bookmark).toBeDefined();
    expect(client.follow).toBeDefined();
    expect(client.notification).toBeDefined();
    expect(client.outboxEvent).toBeDefined();
    expect(client.idempotencyKey).toBeDefined();
    expect(client.auditLog).toBeDefined();
    expect(client.dailyMetric).toBeDefined();

    // Better Auth delegates
    expect(client.authUser).toBeDefined();
    expect(client.authSession).toBeDefined();
    expect(client.authAccount).toBeDefined();
    expect(client.authVerification).toBeDefined();
  });
});
