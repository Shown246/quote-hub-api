import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";
import * as outboxModule from "../../src/infrastructure/queue/outbox";

describe("Repost Routes Integration", () => {
  const app = createApp();

  const mockDomainUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-user-123",
    username: "reposter_user",
    displayName: "Reposter User",
    bio: "I repost quotes",
    profileImageUrl: null,
    role: "USER" as const,
    status: "ACTIVE" as const,
    suspendedAt: null,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 0,
    followingCount: 0,
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
      email: "reposter@example.com",
      name: "Reposter User",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const authorId = "01925b6a-9321-789a-b456-author000000";
  const quoteId = "01925b6a-9321-789a-b456-quote0000000";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Unauthenticated Access (401)", () => {
    it("POST /api/v1/quotes/:quoteId/repost without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/repost`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("DELETE /api/v1/quotes/:quoteId/repost without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/repost`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  describe("POST /api/v1/quotes/:quoteId/repost", () => {
    it("should return 404 when target quote does not exist or is soft-deleted", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce(null),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/repost`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Resource not found");
    });

    it("should return 200 with { reposted: true, quoteId } and stage outbox event on success", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: quoteId, userId: authorId }),
        },
        repost: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          create: vi.fn().mockResolvedValueOnce({
            id: "01925b6a-9321-789a-b456-repost000000",
            userId: mockDomainUser.id,
            quoteId,
            createdAt: new Date(),
          }),
        },
        $executeRaw: vi.fn().mockResolvedValueOnce(1),
        outboxEvent: {
          create: vi.fn().mockResolvedValueOnce({ id: "outbox-1" }),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/repost`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reposted: true, quoteId });
      expect(mockTx.repost.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          userId: mockDomainUser.id,
          quoteId,
        },
      });
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "RepostCreated",
        "Quote",
        quoteId,
        {
          actorId: mockDomainUser.id,
          quoteId,
          recipientId: authorId,
        }
      );
    });

    it("should idempotently return 200 without creating repost or staging duplicate event when already reposted", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: quoteId, userId: authorId }),
        },
        repost: {
          findUnique: vi.fn().mockResolvedValueOnce({
            id: "01925b6a-9321-789a-b456-repost000000",
            userId: mockDomainUser.id,
            quoteId,
            createdAt: new Date(),
          }),
          create: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/repost`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reposted: true, quoteId });
      expect(mockTx.repost.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });

    it("should idempotently return 200 without error when concurrent request hits P2002 unique constraint", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const p2002Error = new Error("Unique constraint failed");
      (p2002Error as any).code = "P2002";

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: quoteId, userId: authorId }),
        },
        repost: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          create: vi.fn().mockRejectedValueOnce(p2002Error),
        },
        $executeRaw: vi.fn(),
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/repost`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reposted: true, quoteId });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/v1/quotes/:quoteId/repost", () => {
    it("should return 404 when target quote does not exist", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce(null),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/repost`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Resource not found");
    });

    it("should return 200 with { reposted: false, quoteId } and stage RepostRemoved outbox event on successful unrepost", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: quoteId, userId: authorId }),
        },
        repost: {
          findUnique: vi.fn().mockResolvedValueOnce({
            id: "01925b6a-9321-789a-b456-repost000000",
            userId: mockDomainUser.id,
            quoteId,
            createdAt: new Date(),
          }),
          delete: vi.fn().mockResolvedValueOnce({
            id: "01925b6a-9321-789a-b456-repost000000",
            userId: mockDomainUser.id,
            quoteId,
          }),
        },
        $executeRaw: vi.fn().mockResolvedValueOnce(1),
        outboxEvent: {
          create: vi.fn().mockResolvedValueOnce({ id: "outbox-2" }),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/repost`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reposted: false, quoteId });
      expect(mockTx.repost.delete).toHaveBeenCalledWith({
        where: {
          uq_reposts_user_quote: {
            userId: mockDomainUser.id,
            quoteId,
          },
        },
      });
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "RepostRemoved",
        "Quote",
        quoteId,
        {
          actorId: mockDomainUser.id,
          quoteId,
        }
      );
    });

    it("should idempotently return 200 without deleting or counter decrement when quote was not reposted", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: quoteId, userId: authorId }),
        },
        repost: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          delete: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/repost`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reposted: false, quoteId });
      expect(mockTx.repost.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/v1/users/:userId/reposts", () => {
    it("should return 404 when target user is not found", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get(`/api/v1/users/non-existent-user/reposts`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("should return 200 with paginated reposts list for valid user UUID", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      const mockQuote = {
        id: quoteId,
        userId: authorId,
        text: "The only true wisdom is in knowing you know nothing.",
        isOriginal: false,
        authorName: "Socrates",
        themeId: "01925b6a-9321-789a-b456-theme0000000",
        likeCount: 15,
        repostCount: 4,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        deletedAt: null,
        user: {
          id: authorId,
          username: "socrates",
          displayName: "Socrates",
          profileImageUrl: null,
        },
        theme: {
          id: "01925b6a-9321-789a-b456-theme0000000",
          key: "classic-serif",
          name: "Classic Serif",
          isActive: true,
        },
      };

      vi.spyOn(prisma.repost, "findMany").mockResolvedValueOnce([
        {
          id: "01925b6a-9321-789a-b456-repost000001",
          userId: mockDomainUser.id,
          quoteId: mockQuote.id,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          quote: mockQuote,
        },
      ] as any);

      const res = await request(app).get(`/api/v1/users/${mockDomainUser.id}/reposts`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(quoteId);
      expect(res.body.data[0].text).toBe(mockQuote.text);
      expect(res.body.data[0].reposted).toBe(true);
      expect(res.body.pagination).toBeDefined();
    });

    it("should return 200 with reposts when queried by username", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.repost, "findMany").mockResolvedValueOnce([]);

      const res = await request(app).get(`/api/v1/users/${mockDomainUser.username}/reposts`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.hasMore).toBe(false);
    });

    it("should return 200 when querying via GET /api/v1/quotes?userId=...&type=reposts", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);
      vi.spyOn(prisma.repost, "findMany").mockResolvedValueOnce([]);

      const res = await request(app).get(
        `/api/v1/quotes?userId=${mockDomainUser.id}&type=reposts`
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.hasMore).toBe(false);
    });
  });
});
