import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { Quote } from "@prisma/client";
import {
  calculateTrendingScore,
  TrendingService,
  TRENDING_REDIS_KEY,
  TRENDING_TTL_SECONDS,
} from "../../../../src/modules/trending/services/trending.service";
import { TrendingController } from "../../../../src/modules/trending/controllers/trending.controller";
import { createApp } from "../../../../src/app/app";

describe("Trending Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateTrendingScore", () => {
    it("should calculate weighted score based on likes, reposts, and age", () => {
      const now = Date.now();
      const item1HourOld = {
        likes: 10,
        reposts: 5,
        createdAt: new Date(now - 3600 * 1000),
      };
      const item20HoursOld = {
        likes: 10,
        reposts: 5,
        createdAt: new Date(now - 20 * 3600 * 1000),
      };

      const scoreFresh = calculateTrendingScore(
        item1HourOld.likes,
        item1HourOld.reposts,
        item1HourOld.createdAt,
        now
      );
      const scoreOld = calculateTrendingScore(
        item20HoursOld.likes,
        item20HoursOld.reposts,
        item20HoursOld.createdAt,
        now
      );

      expect(scoreFresh).toBeGreaterThan(scoreOld);
    });

    it("should compute exact formula values according to (likes * 1) + (reposts * 2) + recencyDecay", () => {
      const fixedNow = 1700000000000;

      // 1 hour old: age=1, recency = 24 - 1 = 23
      const oneHourAgo = new Date(fixedNow - 3600 * 1000);
      const score1 = calculateTrendingScore(10, 5, oneHourAgo, fixedNow);
      // 10*1.0 + 5*2.0 + 23 = 10 + 10 + 23 = 43
      expect(score1).toBe(43);

      // 20 hours old: age=20, recency = 24 - 20 = 4
      const twentyHoursAgo = new Date(fixedNow - 20 * 3600 * 1000);
      const score2 = calculateTrendingScore(10, 5, twentyHoursAgo, fixedNow);
      // 10*1.0 + 5*2.0 + 4 = 10 + 10 + 4 = 24
      expect(score2).toBe(24);

      // 24 hours old: age=24, recency = 0
      const twentyFourHoursAgo = new Date(fixedNow - 24 * 3600 * 1000);
      const score3 = calculateTrendingScore(10, 5, twentyFourHoursAgo, fixedNow);
      // 10*1.0 + 5*2.0 + 0 = 20
      expect(score3).toBe(20);

      // > 24 hours old: recency should clamp to 0
      const thirtyHoursAgo = new Date(fixedNow - 30 * 3600 * 1000);
      const score4 = calculateTrendingScore(10, 5, thirtyHoursAgo, fixedNow);
      // 10*1.0 + 5*2.0 + 0 = 20
      expect(score4).toBe(20);
    });

    it("should handle clock skew gracefully when createdAt is in the future", () => {
      const fixedNow = 1700000000000;
      const futureDate = new Date(fixedNow + 5000);
      const score = calculateTrendingScore(0, 0, futureDate, fixedNow);
      // safeAge = 0, recency = 24
      expect(score).toBe(24);
    });

    it("should allow high engagement on older quotes to outscore low engagement on fresh quotes", () => {
      const fixedNow = 1700000000000;
      const twelveHoursAgo = new Date(fixedNow - 12 * 3600 * 1000);
      const oneHourAgo = new Date(fixedNow - 3600 * 1000);

      const highEngagementOlder = calculateTrendingScore(
        100,
        50,
        twelveHoursAgo,
        fixedNow
      );
      const lowEngagementFresh = calculateTrendingScore(
        1,
        0,
        oneHourAgo,
        fixedNow
      );

      expect(highEngagementOlder).toBeGreaterThan(lowEngagementFresh);
    });
  });

  describe("TrendingService", () => {
    const mockQuote1: Quote = {
      id: "quote-1",
      userId: "user-1",
      text: "Trending Quote 1",
      isOriginal: true,
      authorName: null,
      themeId: "theme-1",
      likeCount: 50,
      repostCount: 20,
      createdAt: new Date("2026-10-08T00:00:00Z"),
      updatedAt: new Date("2026-10-08T00:00:00Z"),
      deletedAt: null,
    };

    const mockQuote2: Quote = {
      id: "quote-2",
      userId: "user-2",
      text: "Trending Quote 2",
      isOriginal: false,
      authorName: "Author",
      themeId: "theme-2",
      likeCount: 30,
      repostCount: 10,
      createdAt: new Date("2026-10-08T02:00:00Z"),
      updatedAt: new Date("2026-10-08T02:00:00Z"),
      deletedAt: null,
    };

    const mockQuote3: Quote = {
      id: "quote-3",
      userId: "user-3",
      text: "Trending Quote 3",
      isOriginal: true,
      authorName: null,
      themeId: "theme-1",
      likeCount: 10,
      repostCount: 5,
      createdAt: new Date("2026-10-08T04:00:00Z"),
      updatedAt: new Date("2026-10-08T04:00:00Z"),
      deletedAt: null,
    };

    describe("getTrendingQuotes", () => {
      it("should fetch quotes from Redis sorted set and preserve score order", async () => {
        const mockRedis = {
          zrevrange: vi.fn().mockResolvedValue(["quote-2", "quote-1", "quote-3"]),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi
              .fn()
              .mockResolvedValue([mockQuote1, mockQuote3, mockQuote2]), // Postgres returns in arbitrary order
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        const result = await service.getTrendingQuotes(10);

        expect(mockRedis.zrevrange).toHaveBeenCalledWith(
          TRENDING_REDIS_KEY,
          0,
          9
        );
        expect(mockPrisma.quote.findMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["quote-2", "quote-1", "quote-3"] },
            deletedAt: null,
          },
        });
        // Preserves Redis order: 2, 1, 3
        expect(result).toHaveLength(3);
        expect(result[0].id).toBe("quote-2");
        expect(result[1].id).toBe("quote-1");
        expect(result[2].id).toBe("quote-3");
      });

      it("should filter out soft-deleted quotes if present in Redis cache", async () => {
        const mockRedis = {
          zrevrange: vi.fn().mockResolvedValue(["quote-1", "deleted-quote", "quote-2"]),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi.fn().mockResolvedValue([mockQuote1, mockQuote2]),
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        const result = await service.getTrendingQuotes(20);

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe("quote-1");
        expect(result[1].id).toBe("quote-2");
      });

      it("should fallback to 24h Postgres query when Redis returns an empty array", async () => {
        const mockRedis = {
          zrevrange: vi.fn().mockResolvedValue([]),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi.fn().mockResolvedValue([mockQuote1, mockQuote2]),
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        const result = await service.getTrendingQuotes(2);

        expect(mockPrisma.quote.findMany).toHaveBeenCalledWith({
          where: {
            deletedAt: null,
            createdAt: { gte: expect.any(Date) },
          },
          orderBy: [
            { likeCount: "desc" },
            { repostCount: "desc" },
            { createdAt: "desc" },
          ],
          take: 2,
        });
        expect(result).toEqual([mockQuote1, mockQuote2]);
      });

      it("should return 24h quotes preserving engagement order even when count is less than limit", async () => {
        const mockRedis = {
          zrevrange: vi.fn().mockResolvedValue([]),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi
              .fn()
              // 24h query returns only 1 quote (less than requested limit 5)
              .mockResolvedValueOnce([mockQuote1]),
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        const result = await service.getTrendingQuotes(5);

        // Only 1 call made to preserve 24h engagement results without discarding them
        expect(mockPrisma.quote.findMany).toHaveBeenCalledTimes(1);
        expect(mockPrisma.quote.findMany).toHaveBeenCalledWith({
          where: {
            deletedAt: null,
            createdAt: { gte: expect.any(Date) },
          },
          orderBy: [
            { likeCount: "desc" },
            { repostCount: "desc" },
            { createdAt: "desc" },
          ],
          take: 5,
        });
        expect(result).toEqual([mockQuote1]);
      });

      it("should fallback to recent non-deleted quotes only when 24h window has 0 quotes", async () => {
        const mockRedis = {
          zrevrange: vi.fn().mockResolvedValue([]),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi
              .fn()
              // First call: 24h query returns 0 quotes
              .mockResolvedValueOnce([])
              // Second call: recent active quotes fallback returns quotes
              .mockResolvedValueOnce([mockQuote1, mockQuote2, mockQuote3]),
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        const result = await service.getTrendingQuotes(5);

        expect(mockPrisma.quote.findMany).toHaveBeenCalledTimes(2);
        expect(mockPrisma.quote.findMany).toHaveBeenNthCalledWith(1, {
          where: {
            deletedAt: null,
            createdAt: { gte: expect.any(Date) },
          },
          orderBy: [
            { likeCount: "desc" },
            { repostCount: "desc" },
            { createdAt: "desc" },
          ],
          take: 5,
        });
        expect(mockPrisma.quote.findMany).toHaveBeenNthCalledWith(2, {
          where: {
            deletedAt: null,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
        });
        expect(result).toHaveLength(3);
      });

      it("should fallback to Postgres when Redis operation throws or is disconnected", async () => {
        const mockSafeCall = vi.fn().mockImplementation(async (_op, fallback) => {
          return await fallback();
        });

        const mockPrisma = {
          quote: {
            findMany: vi.fn().mockResolvedValue([mockQuote1]),
          },
        } as any;

        const service = new TrendingService(mockPrisma, {} as any, mockSafeCall);
        const result = await service.getTrendingQuotes(1);

        expect(mockPrisma.quote.findMany).toHaveBeenCalledWith({
          where: {
            deletedAt: null,
            createdAt: { gte: expect.any(Date) },
          },
          orderBy: [
            { likeCount: "desc" },
            { repostCount: "desc" },
            { createdAt: "desc" },
          ],
          take: 1,
        });
        expect(result).toEqual([mockQuote1]);
      });

      it("should fallback to Postgres when all IDs returned by Redis are soft-deleted", async () => {
        const mockRedis = {
          zrevrange: vi.fn().mockResolvedValue(["deleted-quote-1", "deleted-quote-2"]),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi
              .fn()
              // First call: postgres finds 0 active quotes for Redis IDs
              .mockResolvedValueOnce([])
              // Fallback call: 24h query
              .mockResolvedValueOnce([mockQuote1]),
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        const result = await service.getTrendingQuotes(1);

        expect(result).toEqual([mockQuote1]);
      });

      it("should return empty array when database has no quotes at all", async () => {
        const mockRedis = {
          zrevrange: vi.fn().mockResolvedValue([]),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi
              .fn()
              .mockResolvedValueOnce([]) // 24h query returns empty
              .mockResolvedValueOnce([]), // recent fallback returns empty
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        const result = await service.getTrendingQuotes(10);

        expect(result).toEqual([]);
      });

      it("should clamp invalid limits to at least 1", async () => {
        const mockRedis = {
          zrevrange: vi.fn().mockResolvedValue(["quote-1"]),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi.fn().mockResolvedValue([mockQuote1]),
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        await service.getTrendingQuotes(0);

        expect(mockRedis.zrevrange).toHaveBeenCalledWith(
          TRENDING_REDIS_KEY,
          0,
          0
        );
      });
    });

    describe("recalculateTrendingScores", () => {
      it("should query 24h active quotes, compute scores, and pipeline update Redis", async () => {
        const mockPipeline = {
          del: vi.fn().mockReturnThis(),
          zadd: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          rename: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([[null, "OK"]]),
        };

        const mockRedis = {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi.fn().mockResolvedValue([mockQuote1, mockQuote2]),
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        await service.recalculateTrendingScores();

        expect(mockPrisma.quote.findMany).toHaveBeenCalledWith({
          where: {
            deletedAt: null,
            createdAt: { gte: expect.any(Date) },
          },
          select: {
            id: true,
            likeCount: true,
            repostCount: true,
            createdAt: true,
          },
        });

        const tmpKey = `${TRENDING_REDIS_KEY}:tmp`;
        expect(mockPipeline.del).toHaveBeenCalledWith(tmpKey);
        expect(mockPipeline.zadd).toHaveBeenCalledTimes(2);
        expect(mockPipeline.zadd).toHaveBeenCalledWith(
          tmpKey,
          expect.any(Number),
          "quote-1"
        );
        expect(mockPipeline.zadd).toHaveBeenCalledWith(
          tmpKey,
          expect.any(Number),
          "quote-2"
        );
        expect(mockPipeline.expire).toHaveBeenCalledWith(
          tmpKey,
          TRENDING_TTL_SECONDS
        );
        expect(mockPipeline.rename).toHaveBeenCalledWith(
          tmpKey,
          TRENDING_REDIS_KEY
        );
        expect(mockPipeline.exec).toHaveBeenCalled();
      });

      it("should delete existing key and avoid zadd when no active quotes found in 24h window", async () => {
        const mockPipeline = {
          del: vi.fn().mockReturnThis(),
          zadd: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          rename: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([[null, "OK"]]),
        };

        const mockRedis = {
          pipeline: vi.fn().mockReturnValue(mockPipeline),
        } as any;

        const mockPrisma = {
          quote: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (op) => op(mockRedis));

        const service = new TrendingService(mockPrisma, mockRedis, mockSafeCall);
        await service.recalculateTrendingScores();

        expect(mockPrisma.quote.findMany).toHaveBeenCalledWith({
          where: {
            deletedAt: null,
            createdAt: { gte: expect.any(Date) },
          },
          select: {
            id: true,
            likeCount: true,
            repostCount: true,
            createdAt: true,
          },
        });

        expect(mockPipeline.del).toHaveBeenCalledWith(TRENDING_REDIS_KEY);
        expect(mockPipeline.zadd).not.toHaveBeenCalled();
        expect(mockPipeline.expire).not.toHaveBeenCalled();
        expect(mockPipeline.rename).not.toHaveBeenCalled();
        expect(mockPipeline.exec).toHaveBeenCalled();
      });

      it("should not throw when Redis safe call fails during recalculation", async () => {
        const mockPrisma = {
          quote: {
            findMany: vi.fn().mockResolvedValue([mockQuote1]),
          },
        } as any;

        const mockSafeCall = vi.fn().mockImplementation(async (_op, fallback) => {
          return await fallback();
        });

        const service = new TrendingService(mockPrisma, {} as any, mockSafeCall);
        await expect(service.recalculateTrendingScores()).resolves.toBeUndefined();
      });
    });
  });

  describe("TrendingController", () => {
    it("should parse default limit 20 and return quotes in data envelope", async () => {
      const mockQuotes = [{ id: "quote-1", text: "Hello" }];
      const mockService = {
        getTrendingQuotes: vi.fn().mockResolvedValue(mockQuotes),
      } as any;

      const controller = new TrendingController(mockService);

      const req = { query: {} } as unknown as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await controller.getTrending(req, res, next);

      expect(mockService.getTrendingQuotes).toHaveBeenCalledWith(20);
      expect(statusFn).toHaveBeenCalledWith(200);
      expect(jsonFn).toHaveBeenCalledWith({ data: mockQuotes });
      expect(next).not.toHaveBeenCalled();
    });

    it("should parse custom limit parameter", async () => {
      const mockService = {
        getTrendingQuotes: vi.fn().mockResolvedValue([]),
      } as any;

      const controller = new TrendingController(mockService);

      const req = { query: { limit: "15" } } as unknown as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await controller.getTrending(req, res, next);

      expect(mockService.getTrendingQuotes).toHaveBeenCalledWith(15);
      expect(statusFn).toHaveBeenCalledWith(200);
    });

    it("should clamp limit to max 50 when request limit exceeds 50", async () => {
      const mockService = {
        getTrendingQuotes: vi.fn().mockResolvedValue([]),
      } as any;

      const controller = new TrendingController(mockService);

      const req = { query: { limit: "100" } } as unknown as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await controller.getTrending(req, res, next);

      expect(mockService.getTrendingQuotes).toHaveBeenCalledWith(50);
    });

    it("should fallback to 20 when limit is invalid string or negative", async () => {
      const mockService = {
        getTrendingQuotes: vi.fn().mockResolvedValue([]),
      } as any;

      const controller = new TrendingController(mockService);

      const req = { query: { limit: "-5" } } as unknown as Request;
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
      const res = { status: statusFn } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await controller.getTrending(req, res, next);

      expect(mockService.getTrendingQuotes).toHaveBeenCalledWith(20);
    });

    it("should call next with error when service throws", async () => {
      const testError = new Error("Trending computation error");
      const mockService = {
        getTrendingQuotes: vi.fn().mockRejectedValue(testError),
      } as any;

      const controller = new TrendingController(mockService);

      const req = { query: {} } as unknown as Request;
      const res = {} as unknown as Response;
      const next = vi.fn() as NextFunction;

      await controller.getTrending(req, res, next);

      expect(next).toHaveBeenCalledWith(testError);
    });
  });

  describe("Integration: GET /api/v1/trending route", () => {
    it("should be mounted on app and return 200 with data array", async () => {
      const app = createApp();

      // Spy on trendingService.getTrendingQuotes
      const { trendingService } = await import(
        "../../../../src/modules/trending/services/trending.service"
      );
      vi.spyOn(trendingService, "getTrendingQuotes").mockResolvedValueOnce([
        {
          id: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
          userId: "018f972b-5b3a-7d4e-8fa1-0123456789cd",
          text: "Integrated trending quote",
          isOriginal: true,
          authorName: null,
          themeId: "018f972b-5b3a-7d4e-8fa1-0123456789ef",
          likeCount: 42,
          repostCount: 12,
          createdAt: new Date("2026-10-08T00:00:00Z"),
          updatedAt: new Date("2026-10-08T00:00:00Z"),
          deletedAt: null,
        },
      ]);

      const res = await request(app).get("/api/v1/trending?limit=10");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe("018f972b-5b3a-7d4e-8fa1-0123456789ab");
      expect(res.body.data[0].text).toBe("Integrated trending quote");
    });
  });
});
