import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app/app";
import { auth } from "../../src/modules/auth/auth";
import { prisma } from "../../src/infrastructure/database/prisma";
import * as outboxModule from "../../src/infrastructure/queue/outbox";

describe("Follow Routes Integration", () => {
  const app = createApp();

  const mockDomainUser = {
    id: "01925b6a-9321-789a-b456-123456789abc",
    authId: "auth-user-123",
    username: "follower_user",
    displayName: "Follower User",
    bio: "I follow people",
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
      email: "follower@example.com",
      name: "Follower User",
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const targetUserId = "01925b6a-9321-789a-b456-target000000";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Unauthenticated Access (401)", () => {
    it("POST /api/v1/users/:userId/follow without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).post(`/api/v1/users/${targetUserId}/follow`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("DELETE /api/v1/users/:userId/follow without auth cookie should return 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null as any);

      const res = await request(app).delete(`/api/v1/users/${targetUserId}/follow`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  describe("Self-Follow Guard (400)", () => {
    it("should return 400 when user attempts to follow themselves", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const res = await request(app).post(
        `/api/v1/users/${mockDomainUser.id}/follow`
      );

      expect(res.status).toBe(400);
      expect(res.body.detail).toBe("Users cannot follow themselves");
    });
  });

  describe("POST /api/v1/users/:userId/follow", () => {
    it("should return 404 when target user does not exist", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst")
        .mockResolvedValueOnce(mockDomainUser as any) // auth lookup
        .mockResolvedValueOnce(null); // target user lookup

      const mockTx = {
        user: {
          findFirst: vi.fn().mockResolvedValueOnce(null),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) =>
        cb(mockTx)
      );

      const res = await request(app).post(`/api/v1/users/${targetUserId}/follow`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(res.body.detail).toBe("User not found");
    });

    it("should return 200 with { following: true, userId: targetUserId } and stage outbox event on success", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        user: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: targetUserId }),
        },
        follow: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          create: vi.fn().mockResolvedValueOnce({
            followerId: mockDomainUser.id,
            followingId: targetUserId,
            createdAt: new Date(),
          }),
        },
        $executeRaw: vi.fn().mockResolvedValue(1),
        outboxEvent: {
          create: vi.fn().mockResolvedValueOnce({ id: "outbox-1" }),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) =>
        cb(mockTx)
      );
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).post(`/api/v1/users/${targetUserId}/follow`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: true, userId: targetUserId });
      expect(mockTx.follow.create).toHaveBeenCalledWith({
        data: {
          followerId: mockDomainUser.id,
          followingId: targetUserId,
        },
      });
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "FollowCreated",
        "User",
        targetUserId,
        {
          actorId: mockDomainUser.id,
          recipientId: targetUserId,
        }
      );
    });

    it("should idempotently return 200 without duplicate creation when already following", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        user: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: targetUserId }),
        },
        follow: {
          findUnique: vi.fn().mockResolvedValueOnce({
            followerId: mockDomainUser.id,
            followingId: targetUserId,
            createdAt: new Date(),
          }),
          create: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) =>
        cb(mockTx)
      );
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).post(`/api/v1/users/${targetUserId}/follow`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: true, userId: targetUserId });
      expect(mockTx.follow.create).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/v1/users/:userId/follow", () => {
    it("should return 200 with { following: false, userId: targetUserId } and stage FollowRemoved outbox event on success", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        follow: {
          findUnique: vi.fn().mockResolvedValueOnce({
            followerId: mockDomainUser.id,
            followingId: targetUserId,
            createdAt: new Date(),
          }),
          delete: vi.fn().mockResolvedValueOnce({
            followerId: mockDomainUser.id,
            followingId: targetUserId,
          }),
        },
        $executeRaw: vi.fn().mockResolvedValue(1),
        outboxEvent: {
          create: vi.fn().mockResolvedValueOnce({ id: "outbox-2" }),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) =>
        cb(mockTx)
      );
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).delete(
        `/api/v1/users/${targetUserId}/follow`
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: false, userId: targetUserId });
      expect(mockTx.follow.delete).toHaveBeenCalledWith({
        where: {
          followerId_followingId: {
            followerId: mockDomainUser.id,
            followingId: targetUserId,
          },
        },
      });
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);
      expect(stageOutboxSpy).toHaveBeenCalledWith(
        mockTx,
        "FollowRemoved",
        "User",
        targetUserId,
        {
          actorId: mockDomainUser.id,
          recipientId: targetUserId,
        }
      );
    });

    it("should idempotently return 200 without counter decrement when relationship did not exist", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(mockSession as any);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(mockDomainUser as any);

      const mockTx = {
        follow: {
          findUnique: vi.fn().mockResolvedValueOnce(null),
          delete: vi.fn(),
        },
        $executeRaw: vi.fn(),
      };
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (cb: any) =>
        cb(mockTx)
      );
      const stageOutboxSpy = vi.spyOn(outboxModule, "stageOutboxEvent");

      const res = await request(app).delete(
        `/api/v1/users/${targetUserId}/follow`
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ following: false, userId: targetUserId });
      expect(mockTx.follow.delete).not.toHaveBeenCalled();
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(stageOutboxSpy).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/v1/users/:userId/followers", () => {
    it("should return 404 if target user does not exist", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get(`/api/v1/users/${targetUserId}/followers`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("should return 200 with paginated followers list without authentication", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({ id: targetUserId } as any);

      const mockFollower = {
        id: "follower-1",
        username: "fan1",
        displayName: "Fan One",
        bio: "Just a fan",
        profileImageUrl: null,
        followerCount: 1,
        followingCount: 1,
        createdAt: new Date(),
      };

      vi.spyOn(prisma.follow, "findMany").mockResolvedValueOnce([
        {
          followerId: "follower-1",
          followingId: targetUserId,
          createdAt: new Date(),
          follower: mockFollower,
        },
      ] as any);

      const res = await request(app).get(`/api/v1/users/${targetUserId}/followers`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].followerId).toBe("follower-1");
      expect(res.body.data[0].user).toEqual(
        expect.objectContaining({
          id: "follower-1",
          username: "fan1",
        })
      );
    });
  });

  describe("GET /api/v1/users/:userId/following", () => {
    it("should return 404 if target user does not exist", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null);

      const res = await request(app).get(`/api/v1/users/${targetUserId}/following`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("should return 200 with paginated following list without authentication", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({ id: targetUserId } as any);

      const mockFollowing = {
        id: "star-1",
        username: "star1",
        displayName: "Star One",
        bio: "A star",
        profileImageUrl: null,
        followerCount: 100,
        followingCount: 5,
        createdAt: new Date(),
      };

      vi.spyOn(prisma.follow, "findMany").mockResolvedValueOnce([
        {
          followerId: targetUserId,
          followingId: "star-1",
          createdAt: new Date(),
          following: mockFollowing,
        },
      ] as any);

      const res = await request(app).get(`/api/v1/users/${targetUserId}/following`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].followingId).toBe("star-1");
      expect(res.body.data[0].user).toEqual(
        expect.objectContaining({
          id: "star-1",
          username: "star1",
        })
      );
    });
  });
});
