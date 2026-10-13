import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../../src/app/app";
import { auth } from "../../../src/modules/auth/auth";
import { prisma } from "../../../src/infrastructure/database/prisma";
import { feedService } from "../../../src/modules/feeds/services/feed.service";
import { trendingService } from "../../../src/modules/trending/services/trending.service";
import { encodeCursor } from "../../../src/shared/utils/cursor";
import { invalidateByPattern } from "../../../src/infrastructure/redis/cache";

describe("E2E Journey 3: Discovery, Feeds & Search Lifecycle", () => {
  const app = createApp();

  const readerUser = {
    id: "01925b6a-9321-789a-b456-reader0000001",
    authId: "auth-reader-123",
    username: "reader_alice",
    displayName: "Alice Reader",
    bio: "Discovering great wisdom",
    profileImageUrl: "https://example.com/reader.webp",
    role: "USER" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 5,
    followingCount: 12,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  const readerSession = {
    session: {
      id: "session-reader-123",
      userId: "auth-reader-123",
      token: "reader-mock-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-reader-123",
      email: "reader@example.com",
      name: "Alice Reader",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const mockOriginalQuoteItem = {
    type: "ORIGINAL_QUOTE" as const,
    actor: {
      id: "01925b6a-9321-789a-b456-author0000001",
      username: "author_bob",
      displayName: "Bob The Creator",
      avatarUrl: "https://example.com/bob.webp",
      profileImageUrl: "https://example.com/bob.webp",
    },
    quote: {
      id: "01925b6a-9321-789a-b456-000000000001",
      text: "Simplicity is prerequisite for reliability.",
      isOriginal: true,
      authorName: null,
      likeCount: 42,
      repostCount: 15,
      createdAt: new Date("2026-10-07T12:00:00.000Z"),
      themeKey: "classic-serif",
      author: {
        id: "01925b6a-9321-789a-b456-author0000001",
        username: "author_bob",
        displayName: "Bob The Creator",
        avatarUrl: "https://example.com/bob.webp",
        profileImageUrl: "https://example.com/bob.webp",
      },
    },
    createdAt: new Date("2026-10-07T12:00:00.000Z"),
  };

  const mockRepostItem = {
    type: "REPOST" as const,
    actor: {
      id: "01925b6a-9321-789a-b456-curator000002",
      username: "curator_carol",
      displayName: "Carol Curator",
      avatarUrl: "https://example.com/carol.webp",
      profileImageUrl: "https://example.com/carol.webp",
    },
    quote: {
      id: "01925b6a-9321-789a-b456-000000000002",
      text: "Premature optimization is the root of all evil.",
      isOriginal: false,
      authorName: "Donald Knuth",
      likeCount: 88,
      repostCount: 30,
      createdAt: new Date("2026-10-07T08:00:00.000Z"),
      themeKey: "dark-mono",
      author: {
        id: "01925b6a-9321-789a-b456-knuth00000000",
        username: "knuth_scholar",
        displayName: "Knuth Scholar",
        avatarUrl: null,
        profileImageUrl: null,
      },
    },
    createdAt: new Date("2026-10-07T09:30:00.000Z"),
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    await invalidateByPattern("cache:search:*");
  });

  describe("1. Following Feed Retrieval & Cursor Pagination", () => {
    it("should reject unauthenticated access to /api/v1/feed/following with 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).get("/api/v1/feed/following");

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should retrieve quotes and reposts from followed accounts with cursor pagination", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(readerSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(readerUser as any);

      const initialCursor = encodeCursor(
        new Date("2026-10-07T09:30:00.000Z"),
        "01925b6a-9321-789a-b456-000000000002"
      );

      vi.spyOn(feedService, "getFollowingFeed").mockResolvedValueOnce({
        items: [mockOriginalQuoteItem, mockRepostItem],
        nextCursor: initialCursor,
        hasMore: true,
      });

      const res = await request(app)
        .get("/api/v1/feed/following?limit=10")
        .set("Cookie", "better-auth.session_token=reader-mock-token");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].type).toBe("ORIGINAL_QUOTE");
      expect(res.body.data[0].quote.id).toBe(mockOriginalQuoteItem.quote.id);
      expect(res.body.data[1].type).toBe("REPOST");
      expect(res.body.data[1].actor.username).toBe("curator_carol");
      expect(res.body.pagination).toEqual({
        nextCursor: initialCursor,
        hasMore: true,
      });
      expect(feedService.getFollowingFeed).toHaveBeenCalledWith(
        readerUser.id,
        undefined,
        10
      );
    });

    it("should accept valid pagination cursor and advance the feed", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(readerSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(readerUser as any);

      const pageCursor = encodeCursor(
        new Date("2026-10-07T09:30:00.000Z"),
        "01925b6a-9321-789a-b456-000000000002"
      );

      vi.spyOn(feedService, "getFollowingFeed").mockResolvedValueOnce({
        items: [mockOriginalQuoteItem],
        nextCursor: null,
        hasMore: false,
      });

      const res = await request(app)
        .get(`/api/v1/feed/following?cursor=${pageCursor}&limit=10`)
        .set("Cookie", "better-auth.session_token=reader-mock-token");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination.hasMore).toBe(false);
      expect(feedService.getFollowingFeed).toHaveBeenCalledWith(
        readerUser.id,
        pageCursor,
        10
      );
    });
  });

  describe("2. For You Feed (Algorithmic / Blended)", () => {
    it("should return candidate quotes for unauthenticated discovery users", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      vi.spyOn(feedService, "getForYouFeed").mockResolvedValueOnce({
        items: [mockOriginalQuoteItem],
        nextCursor: null,
        hasMore: false,
      });

      const res = await request(app).get("/api/v1/feed/for-you?limit=15");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].quote.text).toBe("Simplicity is prerequisite for reliability.");
      expect(res.body.pagination).toEqual({
        nextCursor: null,
        hasMore: false,
      });
      expect(feedService.getForYouFeed).toHaveBeenCalledWith(
        undefined,
        undefined,
        15
      );
    });

    it("should return personalized candidate quotes when authenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(readerSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(readerUser as any);

      vi.spyOn(feedService, "getForYouFeed").mockResolvedValueOnce({
        items: [mockOriginalQuoteItem, mockRepostItem],
        nextCursor: null,
        hasMore: false,
      });

      const res = await request(app)
        .get("/api/v1/feed/for-you?limit=20")
        .set("Cookie", "better-auth.session_token=reader-mock-token");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(feedService.getForYouFeed).toHaveBeenCalledWith(
        readerUser.id,
        undefined,
        20
      );
    });
  });

  describe("3. Trending Feed", () => {
    it("should return globally trending quotes with engagement scores via GET /api/v1/trending", async () => {
      const mockTrendingQuotes = [
        {
          id: "01925b6a-9321-789a-b456-000000000001",
          userId: "01925b6a-9321-789a-b456-author0000001",
          text: "Simplicity is prerequisite for reliability.",
          isOriginal: true,
          authorName: null,
          themeId: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
          likeCount: 250,
          repostCount: 95,
          createdAt: new Date("2026-10-07T12:00:00.000Z"),
          updatedAt: new Date("2026-10-07T12:00:00.000Z"),
          deletedAt: null,
        },
      ];

      vi.spyOn(trendingService, "getTrendingQuotes").mockResolvedValueOnce(mockTrendingQuotes as any);

      const res = await request(app).get("/api/v1/trending?limit=10");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe("01925b6a-9321-789a-b456-000000000001");
      expect(res.body.data[0].likeCount).toBe(250);
      expect(res.body.data[0].repostCount).toBe(95);
      expect(trendingService.getTrendingQuotes).toHaveBeenCalledWith(10);
    });
  });

  describe("4. Fuzzy Search (pg_trgm Similarity)", () => {
    it("should retrieve matching quotes and user profiles with rank scores via GET /api/v1/search", async () => {
      const mockRawRows = [
        {
          id: "01925b6a-9321-789a-b456-000000000001",
          text: "Simplicity is prerequisite for reliability.",
          author_name: "Edsger W. Dijkstra",
          is_original: false,
          like_count: 50,
          repost_count: 14,
          created_at: new Date("2026-10-07T12:00:00.000Z"),
          user_id: "01925b6a-9321-789a-b456-author0000001",
          username: "dijkstra_enthusiast",
          display_name: "E. Dijkstra",
          avatar_url: "https://example.com/avatar.webp",
          theme_key: "academic-dark",
          rank_score: 0.82,
        },
      ];

      const querySpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce(mockRawRows as any);

      // Search with typo "reliabilit"
      const res = await request(app).get("/api/v1/search?q=reliabilit&limit=10");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      const searchItem = res.body.data[0];
      expect(searchItem.id).toBe("01925b6a-9321-789a-b456-000000000001");
      expect(searchItem.text).toBe("Simplicity is prerequisite for reliability.");
      expect(searchItem.rankScore).toBe(0.82);
      expect(searchItem.author).toEqual({
        id: "01925b6a-9321-789a-b456-author0000001",
        username: "dijkstra_enthusiast",
        displayName: "E. Dijkstra",
        avatarUrl: "https://example.com/avatar.webp",
        profileImageUrl: "https://example.com/avatar.webp",
      });
      expect(querySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("5. Exclusion Verification (Soft-Deleted Quotes Omission)", () => {
    it("should verify search repository strictly filters out soft-deleted quotes (q.deleted_at IS NULL)", async () => {
      const querySpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([]);

      await request(app).get("/api/v1/search?q=test_query");

      expect(querySpy).toHaveBeenCalledTimes(1);
      const sqlArg = querySpy.mock.calls[0][0] as any;
      const sqlString = sqlArg.strings.join(" ");
      expect(sqlString).toContain("q.deleted_at IS NULL");
    });

    it("should verify direct quote retrieval excludes soft-deleted quotes, returning 404", async () => {
      // Direct quote endpoint uses where: { id, deletedAt: null }
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get("/api/v1/quotes/01925b6a-9321-789a-b456-deleted000000");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Quote not found");
      expect(prisma.quote.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        })
      );
    });
  });
});
