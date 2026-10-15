import { PrismaClient, Quote } from "@prisma/client";
import Redis from "ioredis";
import { prisma } from "../../../infrastructure/database/prisma";
import { redis, safeRedisCall } from "../../../infrastructure/redis/redis";

export const FEED_FOR_YOU_REDIS_KEY = "feed:for-you";
/**
 * @deprecated Use FEED_FOR_YOU_REDIS_KEY instead. Maintained for backwards compatibility.
 */
export const TRENDING_REDIS_KEY = FEED_FOR_YOU_REDIS_KEY;
export const TRENDING_TTL_SECONDS = 24 * 3600;

/**
 * Calculates the trending velocity score for a quote based on engagement metrics
 * and a 24-hour recency decay window conforming to Technical Design Document Section 50.
 *
 * Formula: (likes * 1.0) + (reposts * 2.0) + recencyDecay(createdAt)
 * Where recencyDecay = Math.max(0, 24 - ageInHours)
 *
 * @param likes Number of likes on the quote
 * @param reposts Number of reposts of the quote
 * @param createdAt Creation timestamp of the quote
 * @param now Optional reference timestamp (defaults to Date.now())
 */
export function calculateTrendingScore(
  likes: number,
  reposts: number,
  createdAt: Date,
  now: Date | number = Date.now()
): number {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const ageInHours = (nowMs - createdAt.getTime()) / (3600 * 1000);
  const safeAgeInHours = Math.max(0, ageInHours);
  const recencyDecay = Math.max(0, 24 - safeAgeInHours);

  return likes * 1.0 + reposts * 2.0 + recencyDecay;
}

export class TrendingService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly redisClient: Redis = redis,
    private readonly safeCall: typeof safeRedisCall = safeRedisCall
  ) {}

  /**
   * Retrieves trending quotes up to limit.
   *
   * 1. Attempts to fetch sorted quote IDs from Redis Sorted Set `trending:global:24h` via `zrevrange`.
   * 2. If IDs are returned, fetches non-deleted quotes from PostgreSQL preserving Redis sorted score order.
   * 3. Fallback (if Redis is empty, throws, disconnects, or returns 0 non-deleted quotes):
   *    Queries PostgreSQL directly for active quotes in the past 24 hours ordered by likes, reposts, and creation time.
   *    If no active quotes exist in the 24h window, falls back to recent non-deleted quotes
   *    so zero-follow or low-traffic environments always return active quotes.
   *
   * @param limit Maximum number of quotes to return (default: 20)
   */
  async getTrendingQuotes(limit = 20): Promise<Quote[]> {
    const safeLimit = Math.max(1, limit);

    const ids = await this.safeCall(
      async (client) => {
        const target = client ?? this.redisClient;
        return await target.zrevrange(TRENDING_REDIS_KEY, 0, safeLimit - 1);
      },
      async () => []
    );

    if (ids && ids.length > 0) {
      const quotes = await this.db.quote.findMany({
        where: {
          id: { in: ids },
          deletedAt: null,
        },
        include: {
          user: true,
          theme: true,
        },
      });

      const quoteMap = new Map(quotes.map((q) => [q.id, q]));
      const orderedQuotes = ids
        .map((id) => quoteMap.get(id))
<<<<<<< HEAD
        .filter((q): q is (typeof quotes)[number] => q !== undefined);
=======
        .filter((q): q is NonNullable<typeof q> => q !== undefined);
>>>>>>> 7177f20 (Added proxy reverse proxy for cloudflare tunnel)

      if (orderedQuotes.length > 0) {
        return orderedQuotes;
      }
    }

    return this.getFallbackQuotes(safeLimit);
  }

  /**
   * Recalculates trending scores for all active quotes created within the past 24 hours.
   * Replaces Redis sorted set `trending:global:24h` with computed scores and sets a 24h TTL.
   */
  async recalculateTrendingScores(): Promise<void> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const quotes = await this.db.quote.findMany({
      where: {
        deletedAt: null,
        createdAt: { gte: twentyFourHoursAgo },
      },
      select: {
        id: true,
        likeCount: true,
        repostCount: true,
        createdAt: true,
      },
    });

    await this.safeCall(
      async (client) => {
        const target = client ?? this.redisClient;
        const pipeline = target.pipeline();
        const tmpKey = `${TRENDING_REDIS_KEY}:tmp`;

        if (quotes.length > 0) {
          pipeline.del(tmpKey);
          for (const quote of quotes) {
            const score = calculateTrendingScore(
              quote.likeCount,
              quote.repostCount,
              quote.createdAt
            );
            pipeline.zadd(tmpKey, score, quote.id);
          }
          pipeline.expire(tmpKey, TRENDING_TTL_SECONDS);
          pipeline.rename(tmpKey, TRENDING_REDIS_KEY);
        } else {
          pipeline.del(TRENDING_REDIS_KEY);
        }

        await pipeline.exec();
      },
      async () => {
        // Graceful fallback for background job execution
      }
    );
  }

  /**
   * Directly queries PostgreSQL when Redis cache is absent or unavailable.
   */
  private async getFallbackQuotes(limit: number): Promise<Quote[]> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const recent24hQuotes = await this.db.quote.findMany({
      where: {
        deletedAt: null,
        createdAt: { gte: twentyFourHoursAgo },
      },
      include: {
        user: true,
        theme: true,
      },
      orderBy: [
        { likeCount: "desc" },
        { repostCount: "desc" },
        { createdAt: "desc" },
      ],
      take: limit,
    });

    if (recent24hQuotes.length > 0) {
      return recent24hQuotes;
    }

    return this.db.quote.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        user: true,
        theme: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    });
  }
}

export const trendingService = new TrendingService();
