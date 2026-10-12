// load-tests/scripts/audit-system-health.ts
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

export interface OutboxLagReport {
  pendingCount: number;
  publishedCount: number;
  processingCount: number;
  failedCount: number;
  maxLagSeconds: number;
}

export interface CounterDiscrepancy {
  id: string;
  likeCount: number;
  actualLikes: number;
}

export interface HealthAuditReport {
  databaseConnected: boolean;
  outbox: OutboxLagReport;
  counterDiscrepancies: CounterDiscrepancy[];
  completedIdempotencyKeys: number;
  redis: {
    connected: boolean;
    memoryInfo?: string;
    feedForYouSize?: number;
  };
}

/**
 * Calculates outbox backlog statistics and max processing lag.
 */
export function evaluateOutboxLag(
  events: Array<{ status: string; createdAt: Date; processedAt?: Date | null }>
): OutboxLagReport {
  let pendingCount = 0;
  let publishedCount = 0;
  let processingCount = 0;
  let failedCount = 0;
  let maxLagSeconds = 0;

  for (const e of events) {
    const status = String(e.status).toUpperCase();
    if (status === "PENDING") pendingCount++;
    else if (status === "PUBLISHED") publishedCount++;
    else if (status === "PROCESSING") processingCount++;
    else if (status === "FAILED") failedCount++;

    if (e.processedAt) {
      const lag = (new Date(e.processedAt).getTime() - new Date(e.createdAt).getTime()) / 1000;
      if (lag > maxLagSeconds) {
        maxLagSeconds = lag;
      }
    }
  }

  return {
    pendingCount,
    publishedCount,
    processingCount,
    failedCount,
    maxLagSeconds,
  };
}

/**
 * Detects discrepancies between denormalized quote likeCount and actual relational like count.
 */
export function evaluateCounterIntegrity(
  quotes: Array<{ id: string; likeCount: number; actualLikes: number }>
): CounterDiscrepancy[] {
  return quotes.filter((q) => q.likeCount !== q.actualLikes);
}

/**
 * Audits the target backend database and Redis instance post-run.
 */
export async function auditSystemHealth(options?: {
  prismaClient?: PrismaClient;
  redisClient?: Redis;
}): Promise<HealthAuditReport> {
  const prisma = options?.prismaClient ?? new PrismaClient();
  const redis = options?.redisClient ?? new Redis(process.env.REDIS_URL || "redis://192.168.0.112:6379", {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
  });

  let outboxReport: OutboxLagReport = {
    pendingCount: 0,
    publishedCount: 0,
    processingCount: 0,
    failedCount: 0,
    maxLagSeconds: 0,
  };
  let counterDiscrepancies: CounterDiscrepancy[] = [];
  let completedIdempotencyKeys = 0;
  let databaseConnected = false;

  // 1. Audit Database (Outbox, Counters, Idempotency)
  try {
    await prisma.$connect();
    databaseConnected = true;

    // Outbox events
    const recentOutboxEvents = await prisma.outboxEvent.findMany({
      select: { status: true, createdAt: true, processedAt: true },
      take: 5000,
      orderBy: { createdAt: "desc" },
    });
    outboxReport = evaluateOutboxLag(recentOutboxEvents);

    // Counter consistency check
    const rawQuotes = await prisma.$queryRaw<Array<{ id: string; like_count: number; actual_likes: bigint | number }>>`
      SELECT q.id, q.like_count, count(l.quote_id)::int as actual_likes
      FROM quotes q
      LEFT JOIN likes l ON l.quote_id = q.id
      GROUP BY q.id
      HAVING q.like_count != count(l.quote_id)
      LIMIT 100;
    `;
    counterDiscrepancies = evaluateCounterIntegrity(
      rawQuotes.map((r) => ({
        id: r.id,
        likeCount: Number(r.like_count),
        actualLikes: Number(r.actual_likes),
      }))
    );

    // Idempotency keys
    completedIdempotencyKeys = await prisma.idempotencyKey.count({
      where: { status: "COMPLETED" },
    });
  } catch (err: any) {
    databaseConnected = false;
    console.error("\n=======================================================");
    console.error("DIAGNOSTIC ERROR: Database connection failed during system health audit.");
    console.error(`Reason: ${err?.message || err}`);
    console.error("Hint: Verify DATABASE_URL points to reachable PostgreSQL instance on Host B.");
    console.error("Example: DATABASE_URL=\"postgresql://quotehub:quotehub_secret@192.168.0.112:5432/quotehub?schema=public\"");
    console.error("=======================================================\n");
  } finally {
    if (!options?.prismaClient) {
      await prisma.$disconnect().catch(() => {});
    }
  }

  // 2. Audit Redis
  let redisConnected = false;
  let memoryInfo = "";
  let feedForYouSize = 0;
  try {
    await redis.connect();
    redisConnected = true;
    memoryInfo = await redis.info("memory");
    feedForYouSize = await redis.zcard("feed:for-you");
  } catch (err: any) {
    console.warn(`[Audit] Warning: Could not reach Redis at ${process.env.REDIS_URL || "default URL"}: ${err?.message}`);
  } finally {
    if (!options?.redisClient) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
  }

  return {
    databaseConnected,
    outbox: outboxReport,
    counterDiscrepancies,
    completedIdempotencyKeys,
    redis: {
      connected: redisConnected,
      memoryInfo,
      feedForYouSize,
    },
  };
}

// CLI entrypoint
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].includes("audit-system-health")
) {
  auditSystemHealth()
    .then((report) => {
      console.log("\n================ SYSTEM HEALTH AUDIT REPORT ================");
      console.log(`Database Connected:           ${report.databaseConnected ? "YES" : "NO"}`);
      console.log(`Outbox Backlog (Pending):      ${report.outbox.pendingCount}`);
      console.log(`Outbox Published:             ${report.outbox.publishedCount}`);
      console.log(`Outbox Max Lag:               ${report.outbox.maxLagSeconds.toFixed(2)} seconds`);
      console.log(`Counter Inconsistencies:      ${report.counterDiscrepancies.length}`);
      console.log(`Completed Idempotency Keys:   ${report.completedIdempotencyKeys}`);
      console.log(`Redis Connected:              ${report.redis.connected ? "YES" : "NO"}`);
      console.log(`Redis 'feed:for-you' Size:    ${report.redis.feedForYouSize ?? 0}`);
      console.log("============================================================\n");
      const isHealthy = report.databaseConnected && report.counterDiscrepancies.length === 0;
      process.exit(isHealthy ? 0 : 1);
    })
    .catch(() => {
      process.exit(1);
    });
}
