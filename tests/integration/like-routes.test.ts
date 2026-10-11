import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";
import * as outboxModule from "../../src/infrastructure/queue/outbox";

describe("Like Routes Integration", () => {
  const app = createApp();

  const mockDomainUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-user-123",
    username: "liker_user",
    displayName: "Liker User",
    bio: "I like quotes",
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
      email: "liker@example.com",
      name: "Liker User",
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
    it("POST /api/v1/quotes/:quoteId/like without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("DELETE /api/v1/quotes/:quoteId/like without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  describe("Self-Like Guard (400)", () => {
    it("should return RFC 9457 400 with CANNOT_LIKE_OWN_QUOTE when user likes their own quote", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: mockDomainUser.id }),
        },
        like: {
          findUnique: vi.fn(),
          create: vi.fn(),
        },
        $executeRaw: vi.fn(),
        outboxEvent: {
          create: vi.fn(),
        },
      };

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CANNOT_LIKE_OWN_QUOTE");
      expect(res.body.detail).toBe("Users cannot like their own quote");
      expect(mockTx.like.create).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/v1/quotes/:quoteId/like", () => {
    it("should return 404 when target quote does not exist", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce(null),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("Quote not found");
    });

    it("should return 200 with { liked: true, quoteId } and stage outbox event on success", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: authorId }),
        },
        like: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          create: vi.fn().mockResolvedValueOnce({
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

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liked: true, quoteId });
      expect(mockTx.like.create).toHaveBeenCalledWith({
        data: { userId: mockDomainUser.id, quoteId },
      });
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "LikeCreated",
        "Quote",
        quoteId,
        {
          actorId: mockDomainUser.id,
          quoteId,
          recipientId: authorId,
        }
      );
    });

    it("should idempotently return 200 without creating like or staging duplicate event when already liked", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: authorId }),
        },
        like: {
          findUnique: vi.fn().mockResolvedValueOnce({
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

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liked: true, quoteId });
      expect(mockTx.like.create).not.toHaveBeenCalled();
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
          findFirst: vi.fn().mockResolvedValueOnce({ userId: authorId }),
        },
        like: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          create: vi.fn().mockRejectedValueOnce(p2002Error),
        },
        $executeRaw: vi.fn(),
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).post(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liked: true, quoteId });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/v1/quotes/:quoteId/like", () => {
    it("should return 404 when target quote does not exist", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce(null),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("should return 200 with { liked: false, quoteId } and stage LikeRemoved outbox event on successful unlike", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: authorId }),
        },
        like: {
          findUnique: vi.fn().mockResolvedValueOnce({
            userId: mockDomainUser.id,
            quoteId,
            createdAt: new Date(),
          }),
          delete: vi.fn().mockResolvedValueOnce({
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

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liked: false, quoteId });
      expect(mockTx.like.delete).toHaveBeenCalledWith({
        where: {
          userId_quoteId: {
            userId: mockDomainUser.id,
            quoteId,
          },
        },
      });
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "LikeRemoved",
        "Quote",
        quoteId,
        {
          actorId: mockDomainUser.id,
          quoteId,
        }
      );
    });

    it("should idempotently return 200 without deleting or counter decrement when quote was not liked", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        quote: {
          findFirst: vi.fn().mockResolvedValueOnce({ userId: authorId }),
        },
        like: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          delete: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) => cb(mockTx));
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).delete(`/api/v1/quotes/${quoteId}/like`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ liked: false, quoteId });
      expect(mockTx.like.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });
  });
});
