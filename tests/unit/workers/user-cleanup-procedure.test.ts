import { describe, it, expect, vi } from "vitest";
import { prisma } from "../../../src/infrastructure/database/prisma";
import { cleanupDeletedUserJob } from "../../../src/workers/user-cleanup.worker";
import fs from "fs";
import path from "path";

describe("purge_deleted_user_data migration & procedure", () => {
  it("migration SQL file exists and contains CREATE OR REPLACE PROCEDURE", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../prisma/migrations/20261010120000_purge_deleted_user_data/migration.sql"
    );
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql).toContain("CREATE OR REPLACE PROCEDURE purge_deleted_user_data");
    expect(sql).toContain("DELETE FROM likes WHERE user_id = target_user_id;");
    expect(sql).toContain("DELETE FROM reposts WHERE user_id = target_user_id;");
    expect(sql).toContain("DELETE FROM bookmarks WHERE user_id = target_user_id;");
    expect(sql).toContain("DELETE FROM follows WHERE follower_id = target_user_id OR following_id = target_user_id;");
    expect(sql).toContain("UPDATE quotes");
    expect(sql).toContain("DELETE FROM notifications WHERE user_id = target_user_id;");
  });

  it("invokes procedure via prisma.$executeRaw", async () => {
    const spy = vi.spyOn(prisma, "$executeRaw").mockResolvedValueOnce(1 as any);
    await cleanupDeletedUserJob("018f972b-5b3a-7d4e-8fa1-0123456789ab");
    expect(spy).toHaveBeenCalled();
  });
});
