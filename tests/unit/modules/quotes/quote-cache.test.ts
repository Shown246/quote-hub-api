import { describe, it, expect, vi, beforeEach } from "vitest";
import { QuoteService } from "../../../../src/modules/quotes/services/quote.service";
import { AdminQuoteService } from "../../../../src/modules/admin/services/admin-quote.service";
import { LikeService } from "../../../../src/modules/likes/services/like.service";
import { RepostService } from "../../../../src/modules/reposts/services/repost.service";
import * as cacheModule from "../../../../src/infrastructure/redis/cache";
import { redis } from "../../../../src/infrastructure/redis/redis";

describe("Quote Hot Path Caching & Invalidation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleQuote: any = {
    id: "quote-123",
    userId: "user-123",
    text: "Sample quote text",
    isOriginal: true,
    authorName: null,
    themeId: "theme-123",
    likeCount: 5,
    repostCount: 2,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  describe("QuoteService.getQuoteById", () => {
    it("should return cached quote on cache hit without querying database", async () => {
      const mockQuoteRepo = {
        findById: vi.fn(),
      } as any;
      const mockThemeRepo = {} as any;
      const service = new QuoteService(mockQuoteRepo, mockThemeRepo);

      vi.spyOn(redis, "get").mockResolvedValueOnce(JSON.stringify(sampleQuote));

      const result = await service.getQuoteById("quote-123");

      expect(result.id).toBe("quote-123");
      expect(result.text).toBe("Sample quote text");
      expect(mockQuoteRepo.findById).not.toHaveBeenCalled();
    });

    it("should query database and populate cache on cache miss", async () => {
      const mockQuoteRepo = {
        findById: vi.fn().mockResolvedValueOnce(sampleQuote),
      } as any;
      const mockThemeRepo = {} as any;
      const service = new QuoteService(mockQuoteRepo, mockThemeRepo);

      vi.spyOn(redis, "get").mockResolvedValueOnce(null);
      const setSpy = vi.spyOn(redis, "set").mockResolvedValueOnce("OK" as any);

      const result = await service.getQuoteById("quote-123");

      expect(result.id).toBe("quote-123");
      expect(mockQuoteRepo.findById).toHaveBeenCalledWith("quote-123");
      expect(setSpy).toHaveBeenCalledWith(
        "cache:quote:quote-123",
        expect.any(String),
        "EX",
        600
      );
    });
  });

  describe("Quote Invalidation", () => {
    it("should invalidate cache when quote is updated", async () => {
      const mockQuoteRepo = {
        findById: vi.fn().mockResolvedValueOnce(sampleQuote),
        update: vi.fn().mockResolvedValueOnce({ ...sampleQuote, text: "Updated text" }),
      } as any;
      const mockThemeRepo = {
        findById: vi.fn().mockResolvedValueOnce({ id: "theme-123", isActive: true }),
      } as any;
      const service = new QuoteService(mockQuoteRepo, mockThemeRepo);
      const invalidateSpy = vi.spyOn(cacheModule, "invalidateCache").mockResolvedValueOnce();

      await service.updateQuote("user-123", "quote-123", { text: "Updated text" });

      expect(invalidateSpy).toHaveBeenCalledWith("cache:quote:quote-123");
    });

    it("should invalidate cache when quote is deleted", async () => {
      const mockQuoteRepo = {
        findById: vi.fn().mockResolvedValueOnce(sampleQuote),
        softDelete: vi.fn().mockResolvedValueOnce({ ...sampleQuote, deletedAt: new Date() }),
      } as any;
      const mockThemeRepo = {} as any;
      const service = new QuoteService(mockQuoteRepo, mockThemeRepo);
      const invalidateSpy = vi.spyOn(cacheModule, "invalidateCache").mockResolvedValueOnce();

      await service.deleteQuote("user-123", "quote-123");

      expect(invalidateSpy).toHaveBeenCalledWith("cache:quote:quote-123");
    });
  });
});
