// tests/load-tests/audit-script.test.ts
import { describe, it, expect } from "vitest";
import { evaluateOutboxLag, evaluateCounterIntegrity } from "../../load-tests/scripts/audit-system-health";

describe("audit system health logic", () => {
  it("calculates outbox event lag and pending counts accurately", () => {
    const events = [
      { status: "PUBLISHED", createdAt: new Date("2026-10-11T12:00:00Z"), processedAt: new Date("2026-10-11T12:00:02Z") },
      { status: "PENDING", createdAt: new Date("2026-10-11T12:05:00Z"), processedAt: null },
    ];
    const lagReport = evaluateOutboxLag(events);
    expect(lagReport.pendingCount).toBe(1);
    expect(lagReport.publishedCount).toBe(1);
    expect(lagReport.maxLagSeconds).toBe(2);
  });

  it("flags counter inconsistencies when cached count differs from row count", () => {
    const discrepancies = evaluateCounterIntegrity([
      { id: "q1", likeCount: 5, actualLikes: 5 },
      { id: "q2", likeCount: 3, actualLikes: 2 },
    ]);
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].id).toBe("q2");
  });

  it("gracefully returns report with databaseConnected: false when database connection fails", async () => {
    const { auditSystemHealth } = await import("../../load-tests/scripts/audit-system-health");
    const mockPrismaFailing = {
      $connect: vi.fn().mockRejectedValue(new Error("Connection refused to Host B:5432")),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const mockRedis = {
      connect: vi.fn().mockResolvedValue(undefined),
      info: vi.fn().mockResolvedValue("used_memory:1048576"),
      zcard: vi.fn().mockResolvedValue(42),
      quit: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };

    const report = await auditSystemHealth({
      prismaClient: mockPrismaFailing as any,
      redisClient: mockRedis as any,
    });

    expect(report.databaseConnected).toBe(false);
    expect(report.redis.connected).toBe(true);
    expect(report.redis.feedForYouSize).toBe(42);
  });
});
