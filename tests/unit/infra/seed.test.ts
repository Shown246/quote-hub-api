import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

describe("Database seed configuration and structure", () => {
  it("prisma/seed.ts exists and package.json contains prisma.seed configuration", () => {
    const seedPath = path.resolve(__dirname, "../../../prisma/seed.ts");
    expect(fs.existsSync(seedPath)).toBe(true);

    const pkgPath = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    expect(pkg.prisma?.seed).toBe("tsx prisma/seed.ts");
  });

  it("exports seedDatabase function that performs transactional seeding", async () => {
    const { seedDatabase } = await import("../../../prisma/seed");
    expect(typeof seedDatabase).toBe("function");

    const mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      theme: { upsert: vi.fn().mockResolvedValue({ id: "theme-1" }) },
      authUser: { upsert: vi.fn().mockResolvedValue({ id: "auth-1" }) },
      user: { upsert: vi.fn().mockResolvedValue({ id: "user-1" }) },
      quote: { upsert: vi.fn().mockResolvedValue({ id: "quote-1" }) },
      follow: { upsert: vi.fn().mockResolvedValue({ followerId: "u1", followingId: "u2" }) },
      like: { upsert: vi.fn().mockResolvedValue({ userId: "u1", quoteId: "q1" }) },
      repost: { upsert: vi.fn().mockResolvedValue({ id: "r1" }) },
      bookmark: { upsert: vi.fn().mockResolvedValue({ userId: "u1", quoteId: "q1" }) },
      notification: { upsert: vi.fn().mockResolvedValue({ id: "n1" }) },
    };

    await expect(seedDatabase(mockPrisma as any)).resolves.not.toThrow();
    expect(mockPrisma.theme.upsert).toHaveBeenCalled();
    expect(mockPrisma.user.upsert).toHaveBeenCalled();
    expect(mockPrisma.quote.upsert).toHaveBeenCalled();
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith("CALL reconcile_all_counters();");
  });
});
