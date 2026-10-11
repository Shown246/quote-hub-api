import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../../src/app/app";
import { auth } from "../../../src/modules/auth/auth";
import { prisma } from "../../../src/infrastructure/database/prisma";
import * as outboxModule from "../../../src/infrastructure/queue/outbox";

describe("E2E Journey 2: Social Graph & Engagement Lifecycle", () => {
  const app = createApp();

  const userA = {
    id: "01925b6a-9321-789a-b456-usera0000001",
    authId: "auth-user-a-123",
    username: "alice_creator",
    displayName: "Alice Creator",
    bio: "Original thinker and creator",
    profileImageUrl: "https://example.com/alice.webp",
    role: "USER" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 100,
    followingCount: 50,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  const sessionA = {
    session: {
      id: "session-alice-123",
      userId: "auth-user-a-123",
      token: "alice-mock-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-user-a-123",
      email: "alice@example.com",
      name: "Alice Creator",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const userB = {
    id: "01925b6a-9321-789a-b456-userb0000002",
    authId: "auth-user-b-456",
    username: "bob_engager",
    displayName: "Bob Engager",
    bio: "Avid reader and follower",
    profileImageUrl: "https://example.com/bob.webp",
    role: "USER" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 20,
    followingCount: 15,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  const sessionB = {
    session: {
      id: "session-bob-456",
      userId: "auth-user-b-456",
      token: "bob-mock-token",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
    user: {
      id: "auth-user-b-456",
      email: "bob@example.com",
      name: "Bob Engager",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const quoteA = {
    id: "01925b6a-9321-789a-b456-quotea000001",
    userId: userA.id,
    text: "The only way to go fast is to go well.",
    isOriginal: true,
    authorName: null,
    themeId: "018f972b-5b3a-7d4e-8fa1-0123456789ab",
    likeCount: 10,
    repostCount: 3,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Follow Relationship & Self-Follow Guard", () => {
    it("should reject self-follow attempt with 400 Bad Request", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const res = await request(app).post(`/api/v1/users/${userB.id}/follow`);

      expect(res.status).toBe(400);
      expect(res.body.detail).toBe("Users cannot follow themselves");
    });

    it("should allow User B to follow User A, incrementing follower/following counters and staging outbox event", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        user: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: userA.id }),
        },
        follow: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          create: vi.fn().mockResolvedValueOnce({
            followerId: userB.id,
            followingId: userA.id,
            createdAt: new Date(),
          }),
        },
        $executeRaw: vi.fn().mockResolvedValue(1),
        outboxEvent: {
          create: vi.fn().mockResolvedValueOnce({ id: "outbox-follow-1" }),
        },
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).post(`/api/v1/users/${userA.id}/follow`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: true, userId: userA.id });
      expect(mockTx.follow.create).toHaveBeenCalledWith({
        data: {
          followerId: userB.id,
          followingId: userA.id,
        },
      });
      // 2 counter increments: userB following_count + 1 and userA follower_count + 1
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "FollowCreated",
        "User",
        userA.id,
        {
          actorId: userB.id,
          recipientId: userA.id,
        }
      );
    });

    it("should handle duplicate follow request idempotently without error or double increment", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        user: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: userA.id }),
        },
        follow: {
          findUnique: vi.fn().mockResolvedValueOnce({
            followerId: userB.id,
            followingId: userA.id,
            createdAt: new Date(),
          }),
          create: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).post(`/api/v1/users/${userA.id}/follow`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: true, userId: userA.id });
      expect(mockTx.follow.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("2. Like Lifecycle & Self-Like Guard", () => {
    it("should reject author liking own quote with 400 CANNOT_LIKE_OWN_QUOTE", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionA as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userA as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: userA.id }),
        },
        like: {
          findUnique: vi.fn(),
          create: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).post(`/api/v1/quotes/${quoteA.id}/like`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CANNOT_LIKE_OWN_QUOTE");
      expect(res.body.detail).toBe("Users cannot like their own quote");
      expect(mockTx.like.create).not.toHaveBeenCalled();
    });

    it("should allow User B to like User A's quote, incrementing like_count atomically and staging LikeCreated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: userA.id }),
        },
        like: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          create: vi.fn().mockResolvedValueOnce({
            userId: userB.id,
            quoteId: quoteA.id,
            createdAt: new Date(),
          }),
        },
        $executeRaw: vi.fn().mockResolvedValueOnce(1),
        outboxEvent: {
          create: vi.fn().mockResolvedValueOnce({ id: "outbox-like-1" }),
        },
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).post(`/api/v1/quotes/${quoteA.id}/like`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liked: true, quoteId: quoteA.id });
      expect(mockTx.like.create).toHaveBeenCalledWith({
        data: { userId: userB.id, quoteId: quoteA.id },
      });
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "LikeCreated",
        "Quote",
        quoteA.id,
        {
          actorId: userB.id,
          quoteId: quoteA.id,
          recipientId: userA.id,
        }
      );
    });

    it("should idempotently handle duplicate like request from User B without double counting", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: userA.id }),
        },
        like: {
          findUnique: vi.fn().mockResolvedValueOnce({
            userId: userB.id,
            quoteId: quoteA.id,
            createdAt: new Date(),
          }),
          create: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).post(`/api/v1/quotes/${quoteA.id}/like`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liked: true, quoteId: quoteA.id });
      expect(mockTx.like.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("3. Repost Lifecycle & Deduplication", () => {
    it("should allow User B to repost User A's quote, incrementing repost_count and staging RepostCreated", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: quoteA.id, userId: userA.id }),
        },
        repost: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          create: vi.fn().mockResolvedValueOnce({
            userId: userB.id,
            quoteId: quoteA.id,
            createdAt: new Date(),
          }),
        },
        $executeRaw: vi.fn().mockResolvedValueOnce(1),
        outboxEvent: {
          create: vi.fn().mockResolvedValueOnce({ id: "outbox-repost-1" }),
        },
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).post(`/api/v1/quotes/${quoteA.id}/repost`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reposted: true, quoteId: quoteA.id });
      expect(mockTx.repost.create).toHaveBeenCalledWith({
        data: { id: expect.any(String), userId: userB.id, quoteId: quoteA.id },
      });
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "RepostCreated",
        "Quote",
        quoteA.id,
        {
          actorId: userB.id,
          quoteId: quoteA.id,
          recipientId: userA.id,
        }
      );
    });

    it("should handle duplicate repost request idempotently without error", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: quoteA.id, userId: userA.id }),
        },
        repost: {
          findUnique: vi.fn().mockResolvedValueOnce({
            userId: userB.id,
            quoteId: quoteA.id,
            createdAt: new Date(),
          }),
          create: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).post(`/api/v1/quotes/${quoteA.id}/repost`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reposted: true, quoteId: quoteA.id });
      expect(mockTx.repost.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("4. Bookmark Lifecycle & Private Collection", () => {
    it("should allow User B to bookmark User A's quote into private collection", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);
      vi.spyOn(prisma.quote, "findFirst").mockResolvedValueOnce({ id: quoteA.id } as any);
      vi.spyOn(prisma.bookmark, "findUnique").mockResolvedValueOnce(null);
      vi.spyOn(prisma.bookmark, "create").mockResolvedValueOnce({
        userId: userB.id,
        quoteId: quoteA.id,
        createdAt: new Date(),
      } as any);

      const res = await request(app).post(`/api/v1/quotes/${quoteA.id}/bookmark`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ bookmarked: true, quoteId: quoteA.id });
      expect(prisma.bookmark.create).toHaveBeenCalledWith({
        data: { userId: userB.id, quoteId: quoteA.id },
      });
    });

    it("should allow User B to fetch their private bookmarks via GET /api/v1/users/me/bookmarks", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const bookmarkList = [
        {
          userId: userB.id,
          quoteId: quoteA.id,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          quote: {
            ...quoteA,
            user: {
              id: userA.id,
              username: userA.username,
              displayName: userA.displayName,
              avatarUrl: userA.profileImageUrl,
            },
            theme: { key: "classic-serif" },
          },
        },
      ];

      vi.spyOn(prisma.bookmark, "findMany").mockResolvedValueOnce(bookmarkList as any);

      const res = await request(app).get("/api/v1/users/me/bookmarks");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].quote.id).toBe(quoteA.id);
      expect(res.body.data[0].quote.text).toBe(quoteA.text);
    });
  });

  describe("5. Unlike & Atomic Counter Decrement", () => {
    it("should allow User B to unlike quote, atomically decrementing like_count without underflow", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: userA.id }),
        },
        like: {
          findUnique: vi.fn().mockResolvedValueOnce({
            userId: userB.id,
            quoteId: quoteA.id,
            createdAt: new Date(),
          }),
          delete: vi.fn().mockResolvedValueOnce({
            userId: userB.id,
            quoteId: quoteA.id,
          }),
        },
        $executeRaw: vi.fn().mockResolvedValueOnce(1),
        outboxEvent: {
          create: vi.fn().mockResolvedValueOnce({ id: "outbox-unlike-1" }),
        },
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).delete(`/api/v1/quotes/${quoteA.id}/like`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liked: false, quoteId: quoteA.id });
      expect(mockTx.like.delete).toHaveBeenCalledWith({
        where: {
          userId_quoteId: {
            userId: userB.id,
            quoteId: quoteA.id,
          },
        },
      });
      // Decrement query executes GREATEST(0, like_count - 1)
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "LikeRemoved",
        "Quote",
        quoteA.id,
        {
          actorId: userB.id,
          quoteId: quoteA.id,
        }
      );
    });

    it("should handle duplicate unlike idempotently without decrements or underflow", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: userA.id }),
        },
        like: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          delete: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).delete(`/api/v1/quotes/${quoteA.id}/like`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liked: false, quoteId: quoteA.id });
      expect(mockTx.like.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("6. Unfollow & Social Graph Edge Removal", () => {
    it("should allow User B to unfollow User A, removing social graph edge and decrementing counters", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        follow: {
          findUnique: vi.fn().mockResolvedValueOnce({
            followerId: userB.id,
            followingId: userA.id,
            createdAt: new Date(),
          }),
          delete: vi.fn().mockResolvedValueOnce({
            followerId: userB.id,
            followingId: userA.id,
          }),
        },
        $executeRaw: vi.fn().mockResolvedValue(1),
        outboxEvent: {
          create: vi.fn().mockResolvedValueOnce({ id: "outbox-unfollow-1" }),
        },
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).delete(`/api/v1/users/${userA.id}/follow`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: false, userId: userA.id });
      expect(mockTx.follow.delete).toHaveBeenCalledWith({
        where: {
          followerId_followingId: {
            followerId: userB.id,
            followingId: userA.id,
          },
        },
      });
      // 2 decrements: follower following_count - 1 and following follower_count - 1
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "FollowRemoved",
        "User",
        userA.id,
        {
          actorId: userB.id,
          recipientId: userA.id,
        }
      );
    });

    it("should handle duplicate unfollow idempotently when relationship no longer exists", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(sessionB as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(userB as any);

      const mockTx = {
        follow: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          delete: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).delete(`/api/v1/users/${userA.id}/follow`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: false, userId: userA.id });
      expect(mockTx.follow.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });
  });
});
