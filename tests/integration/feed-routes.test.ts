import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";
import { feedService } from "../../src/modules/feeds/services/feed.service";
import { encodeCursor } from "../../src/shared/utils/cursor";

describe("Feed Routes Integration", () => {
  const app = createApp();

  const mockDomainUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-user-123",
    username: "feed_tester",
    displayName: "Feed Tester",
    bio: "Bio",
    profileImageUrl: "https://example.com/avatar.webp",
    role: "USER" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 5,
    followingCount: 10,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  const mockSession = {
    session: {
      id: "session-123",
      userId: "auth-user-123",
      token: "mock-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-user-123",
      email: "tester@example.com",
      name: "Feed Tester",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/v1/feed/following", () => {
    it("should return 401 when request is unauthenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).get("/api/v1/feed/following");

      expect(res.status).toBe(401);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("should return 200 with feed items and pagination when authenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockFeedItem = {
        type: "ORIGINAL_QUOTE" as const,
        actor: {
          id: "01925b6a-9321-789a-b456-author000001",
          username: "author1",
          displayName: "Author 1",
          avatarUrl: null,
          profileImageUrl: null,
        },
        quote: {
          id: "01925b6a-9321-789a-b456-quote0000001",
          text: "Quote text",
          isOriginal: true,
          authorName: null,
          likeCount: 5,
          repostCount: 1,
          createdAt: new Date("2026-10-07T12:00:00.000Z"),
          themeKey: "dark-mode",
          author: {
            id: "01925b6a-9321-789a-b456-author000001",
            username: "author1",
            displayName: "Author 1",
            avatarUrl: null,
            profileImageUrl: null,
          },
        },
        createdAt: new Date("2026-10-07T12:00:00.000Z"),
      };

      vi.spyOn(feedService, "getFollowingFeed").mockResolvedValueOnce({
        items: [mockFeedItem],
        nextCursor: "next-cursor-val",
        hasMore: true,
      });

      const res = await request(app)
        .get("/api/v1/feed/following?limit=10")
        .set("Cookie", "better-auth.session_token=mock-token");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].quote.id).toBe("01925b6a-9321-789a-b456-quote0000001");
      expect(res.body.pagination).toEqual({
        nextCursor: "next-cursor-val",
        hasMore: true,
      });
      expect(feedService.getFollowingFeed).toHaveBeenCalledWith(
        mockDomainUser.id,
        undefined,
        10
      );
    });

    it("should return 400 when invalid cursor parameter is provided", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app)
        .get("/api/v1/feed/following?cursor=invalid!cursor")
        .set("Cookie", "better-auth.session_token=mock-token");

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/v1/feed/for-you", () => {
    it("should return 200 without authentication", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      vi.spyOn(feedService, "getForYouFeed").mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      const res = await request(app).get("/api/v1/feed/for-you");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [],
        pagination: {
          nextCursor: null,
          hasMore: false,
        },
      });
      expect(feedService.getForYouFeed).toHaveBeenCalledWith(
        undefined,
        undefined,
        20
      );
    });

    it("should return 200 and attach user ID when authenticated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      vi.spyOn(feedService, "getForYouFeed").mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      const res = await request(app)
        .get("/api/v1/feed/for-you?limit=30")
        .set("Cookie", "better-auth.session_token=mock-token");

      expect(res.status).toBe(200);
      expect(feedService.getForYouFeed).toHaveBeenCalledWith(
        mockDomainUser.id,
        undefined,
        30
      );
    });

    it("should accept valid cursor and pass to feedService", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const validCursor = encodeCursor(
        new Date("2026-10-07T12:00:00.000Z"),
        "01925b6a-9321-789a-b456-123456789abc"
      );

      vi.spyOn(feedService, "getForYouFeed").mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      const res = await request(app).get(
        `/api/v1/feed/for-you?cursor=${validCursor}&limit=15`
      );

      expect(res.status).toBe(200);
      expect(feedService.getForYouFeed).toHaveBeenCalledWith(
        undefined,
        validCursor,
        15
      );
    });

    it("should return 400 when invalid cursor parameter is provided", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).get("/api/v1/feed/for-you?cursor=malformed_cursor");

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });
});
