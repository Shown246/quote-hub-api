import { describe, it, expect, vi, beforeEach } from "vitest";
import { FeedService } from "../../../../src/modules/feeds/services/feed.service";
import { encodeCursor } from "../../../../src/shared/utils/cursor";
import { ValidationError } from "../../../../src/shared/errors/problem-details";

describe("FeedService", () => {
  let mockFollowingRepo: { getFollowingFeed: ReturnType<typeof vi.fn> };
  let mockTrendingService: { getTrendingQuotes: ReturnType<typeof vi.fn> };
  let mockPrisma: any;
  let service: FeedService;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockFollowingRepo = {
      getFollowingFeed: vi.fn(),
    };

    mockTrendingService = {
      getTrendingQuotes: vi.fn(),
    };

    mockPrisma = {
      quote: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };

    service = new FeedService(
      mockFollowingRepo as any,
      mockTrendingService as any,
      mockPrisma as any
    );
  });

  describe("getFollowingFeed", () => {
    it("should delegate to followingRepo with validated limit and cursor", async () => {
      const mockResult = {
        items: [],
        nextCursor: null,
        hasMore: false,
      };
      mockFollowingRepo.getFollowingFeed.mockResolvedValueOnce(mockResult);

      const result = await service.getFollowingFeed("user-1", "cursor-123", 20);

      expect(mockFollowingRepo.getFollowingFeed).toHaveBeenCalledWith(
        "user-1",
        "cursor-123",
        20
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe("getForYouFeed", () => {
    const mockUser = {
      id: "018f972b-5b3a-7d4e-8fa1-000000000001",
      username: "linus",
      displayName: "Linus Torvalds",
      profileImageUrl: "https://example.com/avatar.png",
    };

    const mockTheme = {
      id: "018f972b-5b3a-7d4e-8fa1-000000000002",
      key: "dark-mode",
      name: "Dark Mode",
    };

    const makeQuote = (id: string, createdAt: Date, deletedAt: Date | null = null) => ({
      id,
      userId: mockUser.id,
      text: `Quote ${id}`,
      isOriginal: true,
      authorName: null,
      themeId: mockTheme.id,
      likeCount: 10,
      repostCount: 5,
      createdAt,
      updatedAt: createdAt,
      deletedAt,
      user: mockUser,
      theme: mockTheme,
    });

    it("should return trending quotes on initial load when trending volume satisfies limit", async () => {
      const q1 = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000011", new Date("2026-10-07T12:00:00Z"));
      const q2 = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000012", new Date("2026-10-07T11:00:00Z"));

      mockTrendingService.getTrendingQuotes.mockResolvedValueOnce([q1, q2]);
      mockPrisma.quote.findFirst.mockResolvedValueOnce(null);

      const result = await service.getForYouFeed(undefined, undefined, 2);

      expect(mockTrendingService.getTrendingQuotes).toHaveBeenCalledWith(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].quote.id).toBe(q1.id);
      expect(result.items[0].actor.username).toBe("linus");
      expect(result.items[0].quote.author.displayName).toBe("Linus Torvalds");
      expect(result.items[0].quote.themeKey).toBe("dark-mode");
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("should defensively clamp trending quotes when trending volume exceeds limit and set hasMore via existence check", async () => {
      const q1 = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000011", new Date("2026-10-07T12:00:00Z"));
      const q2 = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000012", new Date("2026-10-07T11:00:00Z"));
      const q3 = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000013", new Date("2026-10-07T10:00:00Z"));

      // Returns 3 quotes when limit is 2
      mockTrendingService.getTrendingQuotes.mockResolvedValueOnce([q1, q2, q3]);
      // Existence check reports more quotes exist
      mockPrisma.quote.findFirst.mockResolvedValueOnce({ id: "older-quote-id" });

      const result = await service.getForYouFeed(undefined, undefined, 2);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].quote.id).toBe(q1.id);
      expect(result.items[1].quote.id).toBe(q2.id);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe(encodeCursor(q2.createdAt, q2.id));
      // findMany should not have been called with negative take
      expect(mockPrisma.quote.findMany).not.toHaveBeenCalled();
    });

    it("should backfill with recent quotes when trending quotes volume is low", async () => {
      const q1 = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000011", new Date("2026-10-07T12:00:00Z"));
      const qRecent1 = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000021", new Date("2026-10-07T10:00:00Z"));
      const qRecent2 = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000022", new Date("2026-10-07T09:00:00Z"));

      mockTrendingService.getTrendingQuotes.mockResolvedValueOnce([q1]);
      // Backfill takes needed (2 - 1 = 1) + 1 = 2 rows
      mockPrisma.quote.findMany.mockResolvedValueOnce([qRecent1, qRecent2]);

      const result = await service.getForYouFeed("user-id", undefined, 2);

      expect(mockTrendingService.getTrendingQuotes).toHaveBeenCalledWith(2);
      expect(mockPrisma.quote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            id: { notIn: [q1.id] },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 2,
        })
      );
      expect(result.items).toHaveLength(2);
      expect(result.items[0].quote.id).toBe(q1.id);
      expect(result.items[1].quote.id).toBe(qRecent1.id);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe(encodeCursor(qRecent1.createdAt, qRecent1.id));
    });

    it("should populate For You feed completely from PostgreSQL when trending is empty", async () => {
      const q1 = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000021", new Date("2026-10-07T10:00:00Z"));
      mockTrendingService.getTrendingQuotes.mockResolvedValueOnce([]);
      mockPrisma.quote.findMany.mockResolvedValueOnce([q1]);

      const result = await service.getForYouFeed(undefined, undefined, 2);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].quote.id).toBe(q1.id);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("should perform cursor pagination using decoded cursor", async () => {
      const cursorDate = new Date("2026-10-07T10:00:00Z");
      const cursorId = "018f972b-5b3a-7d4e-8fa1-000000000099";
      const cursor = encodeCursor(cursorDate, cursorId);

      const qNext = makeQuote("018f972b-5b3a-7d4e-8fa1-000000000031", new Date("2026-10-07T08:00:00Z"));
      mockPrisma.quote.findMany.mockResolvedValueOnce([qNext]);

      const result = await service.getForYouFeed(undefined, cursor, 2);

      expect(mockTrendingService.getTrendingQuotes).not.toHaveBeenCalled();
      expect(mockPrisma.quote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: cursorId } },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 3,
        })
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].quote.id).toBe(qNext.id);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("should throw ValidationError when pagination cursor is invalid", async () => {
      await expect(
        service.getForYouFeed(undefined, "invalid-cursor-string", 20)
      ).rejects.toThrow(ValidationError);
    });

    it("should exclude soft-deleted quotes from feed results", async () => {
      const qDeleted = makeQuote(
        "018f972b-5b3a-7d4e-8fa1-000000000099",
        new Date("2026-10-07T12:00:00Z"),
        new Date("2026-10-07T12:30:00Z")
      );
      mockTrendingService.getTrendingQuotes.mockResolvedValueOnce([qDeleted]);
      mockPrisma.quote.findMany.mockResolvedValueOnce([]);

      const result = await service.getForYouFeed(undefined, undefined, 20);

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });
  });
});
